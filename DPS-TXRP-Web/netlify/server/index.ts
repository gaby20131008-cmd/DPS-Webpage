import { Hono } from "hono";
import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accounts, loginEvents, uploads } from "../../db/schema.js";
import {
  can,
  createSession,
  destroySession,
  ensureOwner,
  findAccountByUsername,
  getSessionUser,
  hashPassword,
  requireAuth,
  throttle,
  verifyPassword,
} from "../../server/auth.js";
import { clientIp, readJson, type Env } from "../../server/http.js";
import { maintenanceStatus } from "../../server/maintenance.js";
import { refreshCustomRoles } from "../../server/roles.js";
import { ensureDefaults } from "../../server/seed.js";
import { registerPublic } from "../../server/routes/public.js";
import { registerPortal } from "../../server/routes/portal.js";
import { registerRecords } from "../../server/routes/records.js";
import { registerAdmin } from "../../server/routes/admin.js";

const app = new Hono<Env>();

const files = () => getStore("uploads");

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Something went wrong on our end. Please try again." }, 500);
});

// Make sure the owner account and default content exist before handling anything.
app.use("/api/*", async (_c, next) => {
  await ensureOwner();
  await ensureDefaults();
  await refreshCustomRoles();
  await next();
});

// Reject cross-site writes to the API.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const o = c.req.header("origin");
    if (o && new URL(o).host !== new URL(c.req.url).host) return c.json({ error: "Cross-site request blocked" }, 403);
  }
  await next();
});

/* ------------------------------------------------------------------ */
/* Files (Netlify Blobs)                                               */
/* ------------------------------------------------------------------ */

const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_UPLOAD = 15 * 1024 * 1024;

app.get("/api/files/:key", async (c) => {
  const key = c.req.param("key");
  const [meta] = await db.select().from(uploads).where(eq(uploads.key, key));
  if (!meta) return c.text("Not found", 404);
  if (meta.internal) {
    const user = await getSessionUser(c);
    if (!user) return c.text("Sign in to view this file", 401);
  }
  const data = await files().get(key, { type: "arrayBuffer" });
  if (!data) return c.text("Not found", 404);
  const inline = INLINE_TYPES.has(meta.contentType);
  return new Response(data, {
    headers: {
      "Content-Type": inline ? meta.contentType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(meta.filename)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": meta.internal ? "private, no-store" : "public, max-age=3600",
    },
  });
});

// Any signed-in officer can upload images (profile photos). Other files need a staff role.
app.post("/api/admin/uploads", requireAuth("officer"), async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: "No file uploaded" }, 400);
  if (file.size > MAX_UPLOAD) return c.json({ error: "File is larger than 15 MB" }, 400);
  const isImage = c.req.query("kind") === "image";
  if (isImage && !IMAGE_TYPES.includes(file.type)) return c.json({ error: "Images must be PNG, JPG, GIF or WebP" }, 400);
  if (!isImage && !can(user.role, ["content", "training", "admin"])) return c.json({ error: "You can only upload images" }, 403);
  if (!isImage && file.size > MAX_UPLOAD) return c.json({ error: "File is larger than 15 MB" }, 400);
  if (isImage && !can(user.role, ["content", "command", "training"]) && file.size > 5 * 1024 * 1024)
    return c.json({ error: "Photos must be under 5 MB" }, 400);
  const key = randomUUID();
  await files().set(key, await file.arrayBuffer());
  await db.insert(uploads).values({
    key,
    filename: file.name.slice(0, 200) || "file",
    contentType: file.type || "application/octet-stream",
    size: file.size,
    internal: c.req.query("internal") === "1",
  });
  return c.json({ key, filename: file.name, url: `/api/files/${key}` }, 201);
});

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

app.post("/api/auth/login", async (c) => {
  const body = await readJson(c);
  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  const userAgent = (c.req.header("user-agent") ?? "").slice(0, 200);
  const recordLogin = async (accountId: number | null, success: boolean, name: string) => {
    try {
      await db.insert(loginEvents).values({ accountId, username: name.slice(0, 40), success, ip: clientIp(c).slice(0, 60), userAgent });
    } catch (e) {
      console.error("login event failed", e);
    }
  };
  if (!username || !password) return c.json({ error: "Enter your username and password" }, 400);
  if (!throttle(`login:${clientIp(c)}`, 10, 15 * 60_000))
    return c.json({ error: "Too many sign-in attempts. Wait a few minutes and try again." }, 429);
  const account = await findAccountByUsername(username);
  if (!account || !(await verifyPassword(password, account.passwordHash))) {
    await recordLogin(account?.id ?? null, false, username);
    return c.json({ error: "Incorrect username or password" }, 401);
  }
  if (account.disabled) {
    await recordLogin(account.id, false, username);
    return c.json({ error: "This account has been disabled. Contact command staff." }, 403);
  }
  if (account.suspendedUntil && new Date(account.suspendedUntil).getTime() > Date.now()) {
    await recordLogin(account.id, false, username);
    const until = new Date(account.suspendedUntil).toUTCString();
    return c.json({ error: `This account is suspended until ${until}.${account.suspendedReason ? ` Reason: ${account.suspendedReason}` : ""}` }, 403);
  }
  await createSession(c, account.id);
  await recordLogin(account.id, true, username);
  await db.update(accounts).set({ lastLoginAt: new Date() }).where(eq(accounts.id, account.id));
  return c.json({ id: account.id, username: account.username, displayName: account.displayName, role: account.role });
});

app.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await getSessionUser(c);
  return user ? c.json(user) : c.json({ error: "Not signed in" }, 401);
});

app.post("/api/auth/password", requireAuth(), async (c) => {
  const body = await readJson(c);
  const user = c.get("user");
  const [account] = await db.select().from(accounts).where(eq(accounts.id, user.id));
  if (!account || !(await verifyPassword(String(body?.currentPassword ?? ""), account.passwordHash)))
    return c.json({ error: "Your current password is incorrect" }, 400);
  const next = String(body?.newPassword ?? "");
  if (next.length < 8) return c.json({ error: "New password must be at least 8 characters" }, 400);
  await db.update(accounts).set({ passwordHash: await hashPassword(next) }).where(eq(accounts.id, user.id));
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Public status (maintenance mode)                                    */
/* ------------------------------------------------------------------ */

app.get("/api/maintenance", async (c) => c.json(await maintenanceStatus()));

/* ------------------------------------------------------------------ */
/* Feature modules                                                     */
/* ------------------------------------------------------------------ */

registerPublic(app);
registerPortal(app);
registerRecords(app);
registerAdmin(app);

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

export const config = { path: "/api/*" };

export default app;
