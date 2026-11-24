import type { Context, Next } from "hono";
import { can, DEFAULT_MAINTENANCE_MESSAGE, MAINTENANCE_ENABLED_KEY, MAINTENANCE_MESSAGE_KEY } from "../shared/constants.js";
import { getSetting } from "./discord.js";
import type { Env } from "./http.js";

export async function maintenanceStatus() {
  const [enabled, message] = await Promise.all([getSetting(MAINTENANCE_ENABLED_KEY), getSetting(MAINTENANCE_MESSAGE_KEY)]);
  return { enabled: enabled === "1", message: message || DEFAULT_MAINTENANCE_MESSAGE };
}

/**
 * Blocks portal access for everyone below command staff while maintenance mode is on.
 * Command staff, administrators and owners keep access so they can finish work.
 */
export function maintenanceGate() {
  return async (c: Context<Env>, next: Next) => {
    const { enabled, message } = await maintenanceStatus();
    if (enabled && !can(c.get("user")?.role, "command")) return c.json({ error: message, maintenance: true }, 503);
    await next();
  };
}
