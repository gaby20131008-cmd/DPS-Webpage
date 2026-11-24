import { useEffect, useState } from "react";
import { api, hydrateCustomRoles, type CustomRole } from "./api";

let cache: CustomRole[] | null = null;
let inflight: Promise<CustomRole[]> | null = null;

function load(): Promise<CustomRole[]> {
  if (cache) return Promise.resolve(cache);
  inflight ??= api<CustomRole[]>("/api/admin/roles")
    .then((rows) => {
      hydrateCustomRoles(rows);
      cache = rows;
      return rows;
    })
    .catch(() => [] as CustomRole[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Re-fetches custom roles after the owner edits them. */
export function reloadCustomRoles(rows: CustomRole[]) {
  hydrateCustomRoles(rows);
  cache = rows;
}

/**
 * Loads custom roles once per page so client-side can() can evaluate them.
 * Returns null until loaded; layouts gate rendering on it.
 */
export function useCustomRoles(): CustomRole[] | null {
  const [roles, setRoles] = useState<CustomRole[] | null>(cache);
  useEffect(() => {
    load().then(setRoles);
  }, []);
  return roles;
}
