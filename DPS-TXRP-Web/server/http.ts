import type { Context } from "hono";
import { getContext } from "@netlify/server";
import type { SessionUser } from "./auth.js";

export type Env = { Variables: { user: SessionUser } };

export const origin = (c: Context) => new URL(c.req.url).origin;

export const clientIp = (c: Context) => {
  try {
    return getContext().ip ?? "unknown";
  } catch {
    return c.req.header("x-nf-client-connection-ip") ?? "unknown";
  }
};

export const idParam = (c: Context, name = "id") => {
  const id = Number.parseInt(c.req.param(name) ?? "", 10);
  return Number.isFinite(id) ? id : null;
};

export const readJson = async (c: Context) => {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
};

/** Runs work after the response is sent when the platform supports it. */
export async function background(p: Promise<unknown>) {
  const safe = p.catch((e) => console.error(e));
  try {
    getContext().waitUntil(safe);
  } catch {
    await safe;
  }
}

export const actorName = (u: SessionUser) => u.displayName || u.username;

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Random, hard-to-guess code like 7KQ2-M9XD. */
export function randomCode(len = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  bytes.forEach((b, i) => {
    out += ALPHABET[b % ALPHABET.length];
    if (i === 3 && len > 4) out += "-";
  });
  return out;
}

export const str = (v: unknown, max = 300) => (v == null ? "" : String(v).trim().slice(0, max));
