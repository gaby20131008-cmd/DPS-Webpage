import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { complaints, settings } from "../db/schema.js";

type Complaint = typeof complaints.$inferSelect;

const WEBHOOK_PATTERN = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+$/;

export function isValidWebhookUrl(url: string) {
  return WEBHOOK_PATTERN.test(url.trim());
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Webhook URL saved in the admin panel, falling back to the DISCORD_WEBHOOK_URL env var. */
export async function getWebhookUrl(): Promise<string | null> {
  const saved = await getSetting("discord_webhook_url");
  const url = saved || process.env.DISCORD_WEBHOOK_URL || "";
  return url && isValidWebhookUrl(url) ? url.trim() : null;
}

const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + "…" : v) || "—";

export function buildComplaintMessage(c: Complaint, origin: string) {
  const link = `${origin}/admin/internal-affairs/${c.id}`;
  const fields = [
    { name: "Case Number", value: c.caseNumber, inline: true },
    { name: "Category", value: clip(c.category, 100), inline: true },
    { name: "Status", value: c.status, inline: true },
    { name: "Complainant", value: clip(c.complainantName, 200), inline: true },
    { name: "Discord", value: clip(c.complainantDiscord, 200), inline: true },
    { name: "Roblox", value: clip(c.complainantRoblox, 200), inline: true },
    { name: "Officer Involved", value: clip([c.officerName, c.officerBadge && `#${c.officerBadge}`].filter(Boolean).join(" "), 200), inline: true },
    { name: "Incident Date", value: clip(c.incidentDate, 100), inline: true },
    { name: "Location", value: clip(c.location, 200), inline: true },
  ];
  return {
    username: "TXDPS Internal Affairs",
    avatar_url: `${origin}/badge.png`,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `${c.source === "ia" ? "New IA Case Opened" : "New Complaint Filed"} · ${c.caseNumber}`,
        url: link,
        color: 0xe8b93f,
        description: `${clip(c.description, 1500)}\n\n**[Open this complaint in the IA dashboard →](${link})**`,
        fields,
        footer: { text: "Texas Department of Public Safety · Internal Affairs Division" },
        timestamp: new Date(c.createdAt).toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 5, label: "Open in IA Dashboard", url: link }],
      },
    ],
  };
}

/** Posts the complaint to Discord. Returns the resulting webhook status. */
export async function sendComplaintWebhook(c: Complaint, origin: string, urlOverride?: string): Promise<string> {
  const url = urlOverride ?? (await getWebhookUrl());
  if (!url) return "not_configured";
  const payload = buildComplaintMessage(c, origin);
  try {
    // Link buttons need with_components=true; retry without them if Discord rejects it.
    let res = await fetch(`${url}?wait=true&with_components=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 400) {
      const { components: _ignored, ...withoutComponents } = payload;
      res = await fetch(`${url}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withoutComponents),
      });
    }
    if (!res.ok) {
      console.error("Discord webhook failed", res.status, await res.text().catch(() => ""));
      return "failed";
    }
    return "sent";
  } catch (err) {
    console.error("Discord webhook error", err);
    return "failed";
  }
}

/** Posts the complaint to Discord. Returns the resulting webhook status.
 *  Confidential cases never leave the system — nothing is posted about them. */
export async function deliverComplaint(c: Complaint, origin: string) {
  if (c.confidential) {
    await db.update(complaints).set({ webhookStatus: "withheld" }).where(eq(complaints.id, c.id));
    return "withheld";
  }
  const status = await sendComplaintWebhook(c, origin);
  await db.update(complaints).set({ webhookStatus: status }).where(eq(complaints.id, c.id));
  return status;
}

/* ------------------------------------------------------------------ */
/* Other notification channels                                         */
/* ------------------------------------------------------------------ */

export const CHANNELS = {
  complaints: { key: "discord_webhook_url", label: "Internal Affairs complaints" },
  announcements: { key: "discord_webhook_announcements", label: "Announcements & events" },
  personnel: { key: "discord_webhook_personnel", label: "Personnel (LOA, resignations, promotions, reports)" },
} as const;
export type Channel = keyof typeof CHANNELS;

export async function getChannelWebhook(ch: Channel): Promise<string | null> {
  if (ch === "complaints") return getWebhookUrl();
  const saved = await getSetting(CHANNELS[ch].key);
  return saved && isValidWebhookUrl(saved) ? saved.trim() : null;
}

type Embed = {
  title: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
};

/** Posts a simple embed to a channel's webhook. Never throws. */
export async function postEmbed(ch: Channel, origin: string, embed: Embed, button?: { label: string; url: string }): Promise<string> {
  const url = await getChannelWebhook(ch);
  if (!url) return "not_configured";
  const payload: any = {
    username: "TXDPS Dispatch",
    avatar_url: `${origin}/badge.png`,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        color: 0xe8b93f,
        ...embed,
        description: embed.description ? clip(embed.description, 1800) : undefined,
        fields: embed.fields?.map((f) => ({ ...f, value: clip(f.value, 900) })),
        footer: { text: "Texas Department of Public Safety" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
  if (button) payload.components = [{ type: 1, components: [{ type: 2, style: 5, label: button.label, url: button.url }] }];
  try {
    let res = await fetch(`${url}?wait=true${button ? "&with_components=true" : ""}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 400 && button) {
      delete payload.components;
      res = await fetch(`${url}?wait=true`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    }
    return res.ok ? "sent" : "failed";
  } catch (err) {
    console.error("Discord webhook error", err);
    return "failed";
  }
}
