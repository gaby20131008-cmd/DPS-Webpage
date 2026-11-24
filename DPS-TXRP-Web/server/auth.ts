import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import type { Context, Next } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db } from "../db/index.js";
import { accounts, rosterMembers, sessions } from "../db/schema.js";
import { can, type Permission } from "../shared/constants.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const OWNER_USERNAME = "gabyplays.dev.dps";
// scrypt hashes of the owners' passwords. Only the hashes are stored, never the passwords themselves.
const OWNER_PASSWORD_HASH = "scrypt$c5d709dba16622b18521375737ca71a8$23075912c64be488abaa9cff39eb08df8669f5bf9897ba70b8819ac14d5673b8df72daa6421a7ae2d1dd02ab5df8e6364211ddb0ed6c85918086e3fa5d994266";
const SECOND_OWNER_PASSWORD_HASH = "scrypt$abc21770040b41721b3a6171fcfacbd6$4712ff311b2b6060f5b7570b379d9a6cf61810c0e8d622427e7bac593030cc0c26f5737e6338bf8fe7ef6bd2a16b9a6408e6db56fb50ff9dbadcc6b19bca1dd6";

export const SESSION_COOKIE = "bcso_session";
const SESSION_DAYS = 7;

export { ASSIGNABLE_ROLES, can } from "../shared/constants.js";
export type { Permission, Role } from "../shared/constants.js";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltHex, hashHex] = stored.split("$");
  if (algo !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384, r: 8, p: 1 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

let ownerEnsured = false;
/** Makes sure the owner accounts exist. Runs once per server process. */
export async function ensureOwner() {
  if (ownerEnsured) return;
  await db
    .insert(accounts)
    .values([
      { username: "Gabyplays.dev.01", displayName: "Gabyplays", passwordHash: OWNER_PASSWORD_HASH, role: "owner" },
      { username: OWNER_USERNAME, displayName: "Gabyplays", passwordHash: SECOND_OWNER_PASSWORD_HASH, role: "owner" },
    ])
    .onConflictDoNothing({ target: accounts.username });
  ownerEnsured = true;
}

export async function findAccountByUsername(username: string) {
  const rows = await db
    .select()
    .from(accounts)
    .where(sql`lower(${accounts.username}) = lower(${username})`)
    .limit(1);
  return rows[0];
}

export async function createSession(c: Context, accountId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), accountId, expiresAt });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(c: Context) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export type SessionUser = { id: number; username: string; displayName: string; role: string };

export async function getSessionUser(c: Context): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const rows = await db
    .select({ id: accounts.id, username: accounts.username, displayName: accounts.displayName, role: accounts.role })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(
      and(
        eq(sessions.tokenHash, sha256(token)),
        gt(sessions.expiresAt, new Date()),
        eq(accounts.disabled, false),
        // A suspension lifts itself once its end time passes.
        or(isNull(accounts.suspendedUntil), lte(accounts.suspendedUntil, new Date())),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Middleware: requires a signed-in staff account, optionally with a permission. */
export function requireAuth(perm?: Permission | Permission[]) {
  return async (c: Context, next: Next) => {
    const user = await getSessionUser(c);
    if (!user) return c.json({ error: "Not signed in" }, 401);
    if (perm && !can(user.role, perm)) return c.json({ error: "You don't have access to this section" }, 403);
    c.set("user", user);
    await next();
  };
}

/** The roster profile linked to an account, if any. */
export async function memberForAccount(accountId: number) {
  const [m] = await db.select().from(rosterMembers).where(eq(rosterMembers.accountId, accountId)).limit(1);
  return m ?? null;
}

// Best-effort in-memory throttle for login attempts (resets on cold start).
const attempts = new Map<string, { count: number; until: number }>();
export function throttle(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until < now) {
    attempts.set(key, { count: 1, until: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}
