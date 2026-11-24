import { DEFAULT_SITE_CONFIG, type SiteConfig } from "../shared/constants.js";
import { getSetting, setSetting } from "./discord.js";

export async function getSiteConfig(): Promise<SiteConfig> {
  const raw = await getSetting("site_config");
  if (!raw) return { ...DEFAULT_SITE_CONFIG };
  try {
    return { ...DEFAULT_SITE_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
}

const STRING_KEYS: (keyof SiteConfig)[] = [
  "departmentName", "shortName", "tagline", "heroTitle", "heroHighlight", "heroText", "chiefName", "chiefTitle",
  "chiefMessage", "status", "statusMessage", "contactEmail", "discordInvite", "theme",
];

export async function saveSiteConfig(input: any): Promise<SiteConfig | string> {
  const current = await getSiteConfig();
  const next: any = { ...current };
  for (const k of STRING_KEYS) {
    if (input?.[k] === undefined) continue;
    const v = String(input[k] ?? "").trim();
    if (v.length > (k === "chiefMessage" || k === "heroText" ? 4000 : 300)) return `${k} is too long`;
    next[k] = v;
  }
  if (next.discordInvite && !/^https:\/\//i.test(next.discordInvite)) return "The Discord invite must be an https:// link";
  if (input?.chiefPhotoKey !== undefined) next.chiefPhotoKey = input.chiefPhotoKey ? String(input.chiefPhotoKey).slice(0, 100) : null;
  if (input?.showStats !== undefined) next.showStats = Boolean(input.showStats);
  await setSetting("site_config", JSON.stringify(next));
  return next;
}
