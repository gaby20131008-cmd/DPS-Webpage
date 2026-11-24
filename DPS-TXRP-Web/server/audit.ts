import { db } from "../db/index.js";
import { auditLogs, memberEvents, notifications } from "../db/schema.js";
import type { SessionUser } from "./auth.js";

/** Records an administrative action in the audit log. */
export async function audit(user: SessionUser | null, action: string, target = "", details = "") {
  try {
    await db.insert(auditLogs).values({
      accountId: user?.id ?? null,
      actor: user ? user.displayName || user.username : "System",
      action: action.slice(0, 200),
      target: target.slice(0, 300),
      details: details.slice(0, 2000),
    });
  } catch (e) {
    console.error("audit failed", e);
  }
}

/** Sends an in-portal notification. accountId null = everyone. */
export async function notify(accountId: number | null, title: string, body = "", link = "") {
  try {
    await db.insert(notifications).values({ accountId, title: title.slice(0, 200), body: body.slice(0, 1000), link });
  } catch (e) {
    console.error("notify failed", e);
  }
}

/** Adds an entry to an officer's personnel-file timeline. */
export async function memberEvent(memberId: number, kind: string, body: string, actor = "") {
  await db.insert(memberEvents).values({ memberId, kind, body: body.slice(0, 1000), actor });
}
