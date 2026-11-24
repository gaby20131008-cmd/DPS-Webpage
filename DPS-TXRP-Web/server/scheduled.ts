import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "../db/index.js";
import { announcements } from "../db/schema.js";
import { notify } from "./audit.js";
import { postEmbed } from "./discord.js";

/**
 * Publishes announcements whose scheduled time has arrived: marks them published,
 * sends the portal notification and posts the Discord embed. Runs lazily whenever
 * announcements are read (portal, public site, admin overview).
 */
export async function flushScheduledAnnouncements(origin: string) {
  let due: (typeof announcements.$inferSelect)[];
  try {
    due = await db
      .select()
      .from(announcements)
      .where(and(isNotNull(announcements.publishAt), isNull(announcements.publishedAt), lte(announcements.publishAt, new Date())));
  } catch (e) {
    console.error("scheduled announcement flush failed", e);
    return;
  }
  for (const row of due) {
    // The conditional update makes concurrent publishes safe: only one wins.
    const [saved] = await db
      .update(announcements)
      .set({ publishedAt: new Date() })
      .where(and(eq(announcements.id, row.id), isNull(announcements.publishedAt)))
      .returning();
    if (!saved) continue;
    try {
      await notify(
        null,
        `${row.priority === "Urgent" ? "URGENT: " : row.priority === "Important" ? "Important: " : ""}${row.title}`,
        row.body.slice(0, 300),
        "/portal/announcements",
      );
      await postEmbed("announcements", origin, {
        title: `📣 ${row.title}`,
        description: row.body,
        color: row.priority === "Urgent" ? 0xe2574c : row.priority === "Important" ? 0xe8b93f : 0x4f8fe8,
        fields: [
          { name: "Posted by", value: row.authorName || "Command", inline: true },
          { name: "Audience", value: row.audience === "public" ? "Public" : "Department", inline: true },
        ],
      });
    } catch (e) {
      console.error("scheduled announcement publish failed", e);
    }
  }
}

/** An announcement that hasn't reached its scheduled publication time yet. */
export const isScheduled = (row: { publishAt: Date | string | null }) =>
  Boolean(row.publishAt && new Date(row.publishAt).getTime() > Date.now());
