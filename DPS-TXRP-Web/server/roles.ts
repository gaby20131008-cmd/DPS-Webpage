import { asc } from "drizzle-orm";
import { db } from "../db/index.js";
import { customRoles } from "../db/schema.js";
import { customRoleOf, isCustomRole, registerCustomRole, registerCustomRoleLabel, resetCustomRoles } from "../shared/constants.js";

let loadedAt = 0;
const TTL = 30_000;

/** Loads custom roles into the shared permission registry (cached for 30s per process). */
export async function refreshCustomRoles(force = false) {
  if (!force && Date.now() - loadedAt < TTL) return;
  loadedAt = Date.now();
  try {
    resetCustomRoles();
    const rows = await db.select().from(customRoles).orderBy(asc(customRoles.id));
    for (const row of rows) {
      registerCustomRole(row.key, row.perms ?? []);
      registerCustomRoleLabel(row.key, row.label);
    }
  } catch (e) {
    console.error("custom roles load failed", e);
  }
}

/** True when "custom:<key>" points at an existing custom role. */
export async function customRoleExists(key: string): Promise<boolean> {
  if (!isCustomRole(key)) return false;
  await refreshCustomRoles();
  return Boolean(customRoleOf(key));
}
