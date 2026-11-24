import type { Context, Hono } from "hono";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "../../db/index.js";
import {
  accounts, activityLogs, announcements, commendations, complaintNotes, complaints, customRoles,
  disciplinaryRecords, divisions, documents, evaluations, events, faqs, feedback, leaders, loginEvents, news, pages, personnelRequests,
  ranks, reports, rosterDividers, rosterMembers, trainingCourses, unitMembers, uploads, auditLogs,
} from "../../db/schema.js";
import {
  ANNOUNCEMENT_PRIORITIES, ASSIGNABLE_ROLES, can, COMMENDATION_KINDS, CUSTOM_PERM_OPTIONS, CUSTOM_ROLE_PREFIX,
  COMPLAINT_CATEGORIES, COMPLAINT_CLOSED, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, DISCIPLINARY_ACTIONS, EVALUATION_CATEGORIES, EVENT_KINDS,
  FEEDBACK_STATUSES, MAINTENANCE_ENABLED_KEY, MAINTENANCE_MESSAGE_KEY, OWNER_LEVEL_ROLES, PAGE_SLUGS, RANK_GRANTABLE_ROLES, RANK_MANAGED_ROLES, RANK_TIERS, REQUEST_STATUSES, ROSTER_STATUSES, type Permission,
} from "../../shared/constants.js";
import { findAccountByUsername, hashPassword, OWNER_USERNAME, requireAuth, type SessionUser } from "../auth.js";
import { audit, memberEvent, notify } from "../audit.js";
import { CHANNELS, deliverComplaint, getChannelWebhook, getSetting, isValidWebhookUrl, postEmbed, sendComplaintWebhook, setSetting, type Channel } from "../discord.js";
import { actorName, background, idParam, origin, randomCode, readJson, str, type Env } from "../http.js";
import { departmentStats, memberById, personnelFile, rosterQuery, unitRoster } from "../queries.js";
import { customRoleExists, refreshCustomRoles } from "../roles.js";
import { flushScheduledAnnouncements, isScheduled } from "../scheduled.js";
import { getSiteConfig, saveSiteConfig } from "../site.js";
import { parseFields, type FieldSpec } from "../validate.js";
import { maintenanceStatus } from "../maintenance.js";

type Ctx = { user: SessionUser; origin: string };

type Resource = {
  table: PgTable & { id: any };
  spec: FieldSpec;
  perm: Permission | Permission[];
  label: string;
  name: (row: any) => string;
  order: any[];
  list?: () => Promise<unknown[]>;
  validate?: (data: Record<string, unknown>, id: number | null) => Promise<string | void> | string | void;
  prepare?: (data: Record<string, unknown>, ctx: Ctx, isNew: boolean) => void;
  afterSave?: (row: any, ctx: Ctx, before: any | null) => Promise<void>;
  beforeDelete?: (row: any) => Promise<void>;
};

/* ------------------------------ Helpers ------------------------------ */

async function removeUpload(key: string | null | undefined) {
  if (!key) return;
  const { getStore } = await import("@netlify/blobs");
  await getStore("uploads").delete(key);
  await db.delete(uploads).where(eq(uploads.key, key));
}

const findRank = async (name: string) =>
  name ? (await db.select().from(ranks).where(sql`lower(${ranks.name}) = lower(${name})`))[0] : undefined;

/** Applies "automatic rank permissions" to the account linked to a roster member. */
async function applyRankRole(accountId: number | null, rankName: string, ctx: Ctx) {
  if (!accountId) return;
  const rank = await findRank(rankName);
  if (!rank?.grantsRole || !RANK_GRANTABLE_ROLES.includes(rank.grantsRole as any)) return;
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  if (!account || account.role === rank.grantsRole || !RANK_MANAGED_ROLES.includes(account.role as any)) return;
  if (account.username.toLowerCase() === OWNER_USERNAME.toLowerCase()) return;
  await db.update(accounts).set({ role: rank.grantsRole }).where(eq(accounts.id, accountId));
  await audit(ctx.user, "Access changed by rank", account.username, `${account.role} → ${rank.grantsRole} (${rank.name})`);
}

/** Records timeline entries, notifications and permission changes when a roster entry changes. */
async function recordMemberChanges(before: any, after: any, ctx: Ctx) {
  const actor = actorName(ctx.user);
  if (before.rank !== after.rank) {
    const [oldRank, newRank] = await Promise.all([findRank(before.rank), findRank(after.rank)]);
    const kind = oldRank && newRank ? (newRank.sortOrder < oldRank.sortOrder ? "Promotion" : "Demotion") : "Rank Change";
    const text = `${kind === "Promotion" ? "Promoted" : kind === "Demotion" ? "Demoted" : "Rank changed"} from ${before.rank || "—"} to ${after.rank || "—"}.`;
    await memberEvent(after.id, kind, text, actor);
    if (after.accountId) await notify(after.accountId, kind === "Promotion" ? `Congratulations! You've been promoted to ${after.rank}` : `Your rank is now ${after.rank}`, text, "/portal/profile");
    await applyRankRole(after.accountId, after.rank, ctx);
    await background(postEmbed("personnel", ctx.origin, { title: `${kind}: ${after.name}`, description: text, color: kind === "Demotion" ? 0xe2574c : 0x5cb87a }));
  }
  if (before.divisionId !== after.divisionId) {
    const [d] = after.divisionId ? await db.select().from(divisions).where(eq(divisions.id, after.divisionId)) : [];
    await memberEvent(after.id, "Assignment", d ? `Assigned to ${d.name}.` : "Removed from division assignment.", actor);
    if (after.accountId) await notify(after.accountId, d ? `You've been assigned to ${d.name}` : "Your division assignment changed", "", "/portal/profile");
  }
  if (before.status !== after.status) await memberEvent(after.id, "Status", `Status changed from ${before.status} to ${after.status}.`, actor);
  if (before.callsign !== after.callsign) {
    await memberEvent(after.id, "Callsign", `Callsign changed from ${before.callsign || "—"} to ${after.callsign || "—"}.`, actor);
    if (after.accountId) await notify(after.accountId, `Your callsign is now ${after.callsign || "unassigned"}`, "", "/portal/profile");
  }
}

const syncDocumentFile = async (doc: typeof documents.$inferSelect) => {
  // Department documents live only inside the Trooper Portal, so their files are always internal.
  if (doc.fileKey) await db.update(uploads).set({ internal: true }).where(eq(uploads.key, doc.fileKey));
};

const validQuestions = (qs: unknown) =>
  Array.isArray(qs) &&
  qs.length <= 100 &&
  qs.every(
    (q: any) =>
      q && typeof q.q === "string" && q.q.trim() && Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 8 &&
      q.options.every((o: any) => typeof o === "string") && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length,
  );

/* ------------------------------ Generic content resources ------------------------------ */

const resources: Record<string, Resource> = {
  divisions: {
    table: divisions,
    perm: ["content", "command"],
    label: "unit",
    name: (r) => r.name,
    order: [asc(divisions.sortOrder), asc(divisions.id)],
    spec: {
      name: { type: "string", required: true, max: 120 },
      code: { type: "string", max: 40 },
      summary: { type: "string", max: 400 },
      description: { type: "text" },
      requirements: { type: "text", max: 4000 },
      imageKey: { type: "stringOrNull", max: 100 },
      sortOrder: { type: "int" },
    },
  },
  rosterDividers: {
    table: rosterDividers,
    perm: ["content", "command"],
    label: "roster divider",
    name: (r) => r.label,
    order: [asc(rosterDividers.sortOrder), asc(rosterDividers.id)],
    spec: {
      label: { type: "string", required: true, max: 120 },
      sortOrder: { type: "int" },
    },
  },
  roster: {
    table: rosterMembers,
    perm: ["content", "command"],
    label: "roster member",
    name: (r) => `${r.rank} ${r.name}`.trim(),
    order: [asc(rosterMembers.sortOrder), asc(rosterMembers.id)],
    list: () => rosterQuery(),
    /** Issues a random unique badge number whenever a member is saved with a blank one. */
    prepare: async (data) => {
      if (typeof data.badgeNumber === "string" && !data.badgeNumber.trim()) {
        for (let i = 0; i < 25; i++) {
          const n = String(1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000));
          const [taken] = await db.select({ id: rosterMembers.id }).from(rosterMembers).where(sql`lower(${rosterMembers.badgeNumber}) = ${n}`);
          if (!taken) {
            data.badgeNumber = n;
            break;
          }
        }
      }
    },
    spec: {
      name: { type: "string", required: true, max: 120 },
      rank: { type: "string", max: 80 },
      badgeNumber: { type: "string", max: 40 },
      callsign: { type: "string", max: 40 },
      divisionId: { type: "intOrNull" },
      dividerId: { type: "intOrNull" },
      status: { type: "string", max: 40, oneOf: ROSTER_STATUSES },
      discord: { type: "string", max: 120 },
      joinedAt: { type: "string", max: 40 },
      photoKey: { type: "stringOrNull", max: 100 },
      bio: { type: "text", max: 1500 },
      featured: { type: "bool" },
      isInstructor: { type: "bool" },
      sortOrder: { type: "int" },
    },
    validate: async (data, id) => {
      if (data.callsign) {
        const [dupe] = await db
          .select({ id: rosterMembers.id, name: rosterMembers.name })
          .from(rosterMembers)
          .where(and(sql`lower(${rosterMembers.callsign}) = lower(${String(data.callsign)})`, id ? ne(rosterMembers.id, id) : undefined));
        if (dupe) return `Callsign ${data.callsign} is already assigned to ${dupe.name}`;
      }
      if (data.badgeNumber) {
        const [dupe] = await db
          .select({ id: rosterMembers.id, name: rosterMembers.name })
          .from(rosterMembers)
          .where(and(sql`lower(${rosterMembers.badgeNumber}) = lower(${String(data.badgeNumber)})`, id ? ne(rosterMembers.id, id) : undefined));
        if (dupe) return `Badge ${data.badgeNumber} is already assigned to ${dupe.name}`;
      }
    },
    afterSave: async (row, ctx, before) => {
      if (before) await recordMemberChanges(before, row, ctx);
      else await memberEvent(row.id, "Joined", `Added to the roster as ${row.rank || "member"}.`, actorName(ctx.user));
    },
  },
  leadership: {
    table: leaders,
    perm: "content",
    label: "leader",
    name: (r) => r.name,
    order: [asc(leaders.sortOrder), asc(leaders.id)],
    spec: {
      name: { type: "string", required: true, max: 120 },
      title: { type: "string", max: 120 },
      bio: { type: "text", max: 4000 },
      imageKey: { type: "stringOrNull", max: 100 },
      sortOrder: { type: "int" },
    },
  },
  news: {
    table: news,
    perm: "content",
    label: "news article",
    name: (r) => r.title,
    order: [desc(news.publishedAt), desc(news.id)],
    spec: {
      title: { type: "string", required: true, max: 200 },
      category: { type: "string", max: 60 },
      summary: { type: "string", max: 500 },
      body: { type: "text", max: 30000 },
      imageKey: { type: "stringOrNull", max: 100 },
      published: { type: "bool" },
      publishedAt: { type: "date" },
    },
    prepare: (data, ctx, isNew) => {
      if (isNew) data.authorId = ctx.user.id;
    },
  },
  documents: {
    table: documents,
    perm: "content",
    label: "document",
    name: (r) => r.title,
    order: [asc(documents.category), desc(documents.createdAt)],
    spec: {
      title: { type: "string", required: true, max: 200 },
      category: { type: "string", max: 80 },
      description: { type: "string", max: 1000 },
      fileKey: { type: "stringOrNull", max: 100 },
      externalUrl: { type: "stringOrNull", max: 2000 },
      visibility: { type: "string", oneOf: ["internal"] },
    },
    validate: (data) => {
      if (data.externalUrl && !/^https?:\/\//i.test(String(data.externalUrl))) return "Links must start with http:// or https://";
    },
    afterSave: syncDocumentFile,
    beforeDelete: (doc) => removeUpload(doc.fileKey),
  },
  ranks: {
    table: ranks,
    perm: "admin",
    label: "rank",
    name: (r) => r.name,
    order: [asc(ranks.sortOrder), asc(ranks.id)],
    spec: {
      name: { type: "string", required: true, max: 80 },
      abbreviation: { type: "string", max: 20 },
      tier: { type: "string", oneOf: RANK_TIERS },
      description: { type: "string", max: 500 },
      grantsRole: { type: "stringOrNull", max: 20 },
      sortOrder: { type: "int" },
    },
    validate: async (data, id) => {
      if (data.grantsRole && !RANK_GRANTABLE_ROLES.includes(data.grantsRole as any))
        return "Ranks can only grant Officer, Command Staff or Administrator access automatically";
      if (data.name) {
        const [dupe] = await db.select().from(ranks).where(and(sql`lower(${ranks.name}) = lower(${String(data.name)})`, id ? ne(ranks.id, id) : undefined));
        if (dupe) return "A rank with that name already exists";
      }
    },
  },
  faqs: {
    table: faqs,
    perm: "content",
    label: "FAQ",
    name: (r) => r.question,
    order: [asc(faqs.sortOrder), asc(faqs.id)],
    spec: {
      question: { type: "string", required: true, max: 300 },
      answer: { type: "text", max: 4000 },
      category: { type: "string", max: 60 },
      sortOrder: { type: "int" },
    },
  },
  announcements: {
    table: announcements,
    perm: ["content", "command"],
    label: "announcement",
    name: (r) => r.title,
    order: [desc(announcements.pinned), desc(announcements.createdAt)],
    spec: {
      title: { type: "string", required: true, max: 200 },
      body: { type: "text", max: 10000 },
      audience: { type: "string", oneOf: ["public", "internal"] },
      priority: { type: "string", oneOf: ANNOUNCEMENT_PRIORITIES },
      pinned: { type: "bool" },
      unitId: { type: "intOrNull" },
      expiresAt: { type: "dateOrNull" },
      publishAt: { type: "dateOrNull" },
    },
    prepare: (data, ctx, isNew) => {
      if (isNew) {
        data.authorId = ctx.user.id;
        data.authorName = actorName(ctx.user);
      }
    },
    afterSave: async (row, ctx, before) => {
      // Re-scheduling an announcement clears its published marker so it announces again when due.
      if (before && (before.publishAt?.getTime() ?? null) !== (row.publishAt ? new Date(row.publishAt).getTime() : null))
        await db.update(announcements).set({ publishedAt: null }).where(eq(announcements.id, row.id));
      // Scheduled for later: the lazy scheduler publishes it once the time arrives.
      if (isScheduled(row) || row.publishedAt) return;
      await db.update(announcements).set({ publishedAt: new Date() }).where(eq(announcements.id, row.id));
      await notify(null, `${row.priority === "Urgent" ? "URGENT: " : row.priority === "Important" ? "Important: " : ""}${row.title}`, row.body.slice(0, 300), "/portal/announcements");
      await background(
        postEmbed("announcements", ctx.origin, {
          title: `📣 ${row.title}`,
          description: row.body,
          color: row.priority === "Urgent" ? 0xe2574c : row.priority === "Important" ? 0xe8b93f : 0x4f8fe8,
          fields: [{ name: "Posted by", value: row.authorName || "Command", inline: true }, { name: "Audience", value: row.audience === "public" ? "Public" : "Department", inline: true }],
        }),
      );
    },
  },
  events: {
    table: events,
    perm: ["content", "training", "command"],
    label: "event",
    name: (r) => r.title,
    order: [desc(events.startsAt)],
    spec: {
      title: { type: "string", required: true, max: 200 },
      description: { type: "text", max: 5000 },
      kind: { type: "string", oneOf: EVENT_KINDS },
      location: { type: "string", max: 200 },
      startsAt: { type: "date", required: true },
      endsAt: { type: "dateOrNull" },
      audience: { type: "string", oneOf: ["public", "internal"] },
      unitId: { type: "intOrNull" },
      allowSignup: { type: "bool" },
    },
    prepare: (data, ctx, isNew) => {
      if (isNew) data.createdBy = actorName(ctx.user);
    },
    afterSave: async (row, ctx, before) => {
      if (before) return;
      const when = new Date(row.startsAt).toUTCString().replace(":00 GMT", " UTC");
      await notify(null, `${row.kind === "Training" ? "Training reminder" : "New event"}: ${row.title}`, `${when}${row.location ? ` · ${row.location}` : ""}`, "/portal/calendar");
      await background(
        postEmbed("announcements", ctx.origin, {
          title: `🗓️ ${row.kind}: ${row.title}`,
          description: row.description,
          fields: [{ name: "When", value: `<t:${Math.floor(new Date(row.startsAt).getTime() / 1000)}:F>`, inline: true }, { name: "Where", value: row.location || "—", inline: true }],
        }),
      );
    },
  },
  courses: {
    table: trainingCourses,
    perm: "training",
    label: "training course",
    name: (r) => r.title,
    order: [asc(trainingCourses.sortOrder), asc(trainingCourses.id)],
    spec: {
      title: { type: "string", required: true, max: 200 },
      category: { type: "string", max: 80 },
      summary: { type: "string", max: 500 },
      content: { type: "text", max: 50000 },
      fileKey: { type: "stringOrNull", max: 100 },
      certification: { type: "string", max: 120 },
      passingScore: { type: "int" },
      questions: { type: "json" },
      published: { type: "bool" },
      sortOrder: { type: "int" },
    },
    validate: (data) => {
      if (data.questions !== undefined && !validQuestions(data.questions))
        return "Each exam question needs text, 2–8 answer options and a correct answer";
      if (data.passingScore !== undefined && ((data.passingScore as number) < 0 || (data.passingScore as number) > 100)) return "Passing score must be 0–100";
    },
  },
};

const toKebab = (key: string) => key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

export function registerAdmin(app: Hono<Env>) {
  const ctxOf = (c: Context<Env>): Ctx => ({ user: c.get("user"), origin: origin(c) });

  for (const [name, r] of Object.entries(resources)) {
    const base = `/api/admin/${toKebab(name)}`;
    const t = r.table as any;

    app.get(base, requireAuth(r.perm), async (c) => c.json(r.list ? await r.list() : await db.select().from(t).orderBy(...r.order)));

    app.post(base, requireAuth(r.perm), async (c) => {
      const { data, error } = parseFields(r.spec, await readJson(c));
      if (error || !data) return c.json({ error }, 400);
      const problem = await r.validate?.(data, null);
      if (problem) return c.json({ error: problem }, 400);
      await r.prepare?.(data, ctxOf(c), true);
      const [row] = await db.insert(t).values(data).returning();
      await r.afterSave?.(row, ctxOf(c), null);
      await audit(c.get("user"), `Created ${r.label}`, r.name(row));
      return c.json(row, 201);
    });

    app.put(`${base}/:id`, requireAuth(r.perm), async (c) => {
      const id = idParam(c);
      if (id === null) return c.json({ error: "Not found" }, 404);
      const { data, error } = parseFields(r.spec, await readJson(c), true);
      if (error || !data) return c.json({ error }, 400);
      const problem = await r.validate?.(data, id);
      if (problem) return c.json({ error: problem }, 400);
      const [before] = await db.select().from(t).where(eq(t.id, id));
      if (!before) return c.json({ error: "Not found" }, 404);
      if (name === "roster" && data.rank !== undefined && data.rank !== before.rank && !can(c.get("user").role, "command"))
        return c.json({ error: "Only command staff can change a trooper's rank" }, 403);
      await r.prepare?.(data, ctxOf(c), false);
      const [row] = await db.update(t).set(data).where(eq(t.id, id)).returning();
      await r.afterSave?.(row, ctxOf(c), before);
      await audit(c.get("user"), `Updated ${r.label}`, r.name(row));
      return c.json(row);
    });

    app.delete(`${base}/:id`, requireAuth(r.perm), async (c) => {
      const id = idParam(c);
      if (id === null) return c.json({ error: "Not found" }, 404);
      const [row] = await db.select().from(t).where(eq(t.id, id));
      if (!row) return c.json({ error: "Not found" }, 404);
      await r.beforeDelete?.(row);
      await db.delete(t).where(eq(t.id, id));
      await audit(c.get("user"), `Deleted ${r.label}`, r.name(row));
      return c.json({ ok: true });
    });
  }

  /* ------------------------------ Overview & activity ------------------------------ */

  app.get("/api/admin/overview", requireAuth("officer"), async (c) => {
    const user = c.get("user");
    await flushScheduledAnnouncements(origin(c));
    const countOf = async (t: any, where?: any) => (await db.select({ n: count() }).from(t).where(where))[0].n;
    const ia = can(user.role, "ia");
    const command = can(user.role, "command");
    const [roster, divs, newsCount, docs, openComplaints, pendingRequests, reportsToReview, newFeedback, stats] = await Promise.all([
      countOf(rosterMembers),
      countOf(divisions),
      countOf(news),
      countOf(documents),
      ia ? countOf(complaints, command ? notInArray(complaints.status, COMPLAINT_CLOSED) : and(notInArray(complaints.status, COMPLAINT_CLOSED), eq(complaints.confidential, false))) : 0,
      command ? countOf(personnelRequests, eq(personnelRequests.status, "Pending")) : 0,
      command ? countOf(reports, eq(reports.status, "Submitted")) : 0,
      can(user.role, ["content", "command"]) ? countOf(feedback, eq(feedback.status, "New")) : 0,
      departmentStats(),
    ]);
    const recent = ia
      ? await db
          .select({ id: complaints.id, caseNumber: complaints.caseNumber, category: complaints.category, status: complaints.status, createdAt: complaints.createdAt, officerName: complaints.officerName })
          .from(complaints)
          .where(command ? undefined : eq(complaints.confidential, false))
          .orderBy(desc(complaints.createdAt))
          .limit(5)
      : [];
    return c.json({ roster, divisions: divs, news: newsCount, documents: docs, openComplaints, pendingRequests, reportsToReview, newFeedback, stats, recent });
  });

  app.get("/api/admin/activity", requireAuth("command"), async (c) => {
    const user = c.get("user");
    const [shifts, recentReports, log] = await Promise.all([
      db
        .select({ id: activityLogs.id, startedAt: activityLogs.startedAt, endedAt: activityLogs.endedAt, minutes: activityLogs.minutes, name: rosterMembers.name, rank: rosterMembers.rank, callsign: rosterMembers.callsign })
        .from(activityLogs)
        .innerJoin(rosterMembers, eq(activityLogs.memberId, rosterMembers.id))
        .orderBy(desc(activityLogs.startedAt))
        .limit(40),
      db.select({ id: reports.id, number: reports.number, type: reports.type, title: reports.title, authorName: reports.authorName, status: reports.status, createdAt: reports.createdAt }).from(reports).orderBy(desc(reports.createdAt)).limit(20),
      can(user.role, "admin") ? db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(25) : Promise.resolve([]),
    ]);
    return c.json({ shifts, reports: recentReports, audit: log });
  });

  app.get("/api/admin/audit", requireAuth("admin"), async (c) => {
    const q = str(c.req.query("q"), 100);
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    return c.json(
      await db
        .select()
        .from(auditLogs)
        .where(q ? or(ilike(auditLogs.actor, like), ilike(auditLogs.action, like), ilike(auditLogs.target, like), ilike(auditLogs.details, like)) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(500),
    );
  });

  /* ------------------------------ Personnel management ------------------------------ */

  const FILE_PERMS: Permission[] = ["command", "ia", "training"];

  app.get("/api/admin/members/:id/file", requireAuth(FILE_PERMS), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const member = await memberById(id);
    if (!member) return c.json({ error: "Not found" }, 404);
    const file = await personnelFile(id);
    const user = c.get("user");
    const [account] = member.accountId
      ? await db.select({ id: accounts.id, username: accounts.username, role: accounts.role, lastLoginAt: accounts.lastLoginAt, disabled: accounts.disabled }).from(accounts).where(eq(accounts.id, member.accountId))
      : [];
    return c.json({ member, account: account ?? null, ...file, discipline: can(user.role, ["ia", "command"]) ? file.discipline : [] });
  });

  app.post("/api/admin/members/:id/rank", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [before] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, id));
    if (!before) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const ladder = await db.select().from(ranks).orderBy(asc(ranks.sortOrder), asc(ranks.id));
    let target: string | undefined;
    if (body?.rank) target = ladder.find((r) => r.name.toLowerCase() === String(body.rank).toLowerCase())?.name;
    else {
      const idx = ladder.findIndex((r) => r.name.toLowerCase() === before.rank.toLowerCase());
      if (idx === -1) return c.json({ error: `${before.rank || "This rank"} isn't in the rank structure. Pick a rank instead.` }, 400);
      target = ladder[body?.direction === "up" ? idx - 1 : idx + 1]?.name;
      if (!target) return c.json({ error: body?.direction === "up" ? "Already at the highest rank" : "Already at the lowest rank" }, 400);
    }
    if (!target) return c.json({ error: "Pick a valid rank" }, 400);
    const [after] = await db.update(rosterMembers).set({ rank: target }).where(eq(rosterMembers.id, id)).returning();
    await recordMemberChanges(before, after, ctxOf(c));
    if (body?.note) await memberEvent(id, "Note", str(body.note, 1000), actorName(c.get("user")));
    await audit(c.get("user"), "Changed rank", after.name, `${before.rank} → ${after.rank}`);
    return c.json(after);
  });

  app.post("/api/admin/members/:id/commendations", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [member] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, id));
    if (!member) return c.json({ error: "Not found" }, 404);
    const { data, error } = parseFields(
      { title: { type: "string", required: true, max: 200 }, kind: { type: "string", oneOf: COMMENDATION_KINDS }, description: { type: "text", max: 3000 } },
      await readJson(c),
    );
    if (error || !data) return c.json({ error }, 400);
    const user = c.get("user");
    const [row] = await db.insert(commendations).values({ ...(data as any), memberId: id, issuedBy: actorName(user) }).returning();
    await memberEvent(id, "Commendation", `Awarded ${row.kind}: ${row.title}.`, actorName(user));
    if (member.accountId) await notify(member.accountId, `You received a ${row.kind.toLowerCase()}: ${row.title}`, row.description, "/portal/profile");
    await background(postEmbed("personnel", origin(c), { title: `🏅 ${row.kind}: ${row.title}`, description: `Awarded to **${member.rank} ${member.name}**\n${row.description}`, color: 0xe8b93f }));
    await audit(user, "Issued commendation", member.name, row.title);
    return c.json(row, 201);
  });

  app.delete("/api/admin/commendations/:id", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [row] = await db.delete(commendations).where(eq(commendations.id, id)).returning();
    if (row) await audit(c.get("user"), "Removed commendation", row.title);
    return c.json({ ok: true });
  });

  app.post("/api/admin/members/:id/evaluations", requireAuth(["command", "training"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [member] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, id));
    if (!member) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const ratings: Record<string, number> = {};
    for (const k of EVALUATION_CATEGORIES) {
      const v = Number.parseInt(body?.ratings?.[k], 10);
      if (Number.isFinite(v)) ratings[k] = Math.min(5, Math.max(1, v));
    }
    const values = Object.values(ratings);
    const overall = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 3;
    const user = c.get("user");
    const [row] = await db
      .insert(evaluations)
      .values({ memberId: id, evaluator: actorName(user), period: str(body?.period, 80), ratings, overall, strengths: str(body?.strengths, 3000), improvements: str(body?.improvements, 3000), comments: str(body?.comments, 3000) })
      .returning();
    await memberEvent(id, "Evaluation", `Performance evaluation${row.period ? ` (${row.period})` : ""}: ${overall}/5 overall.`, actorName(user));
    if (member.accountId) await notify(member.accountId, "You have a new performance evaluation", `Overall ${overall}/5`, "/portal/profile");
    await audit(user, "Added evaluation", member.name);
    return c.json(row, 201);
  });

  app.delete("/api/admin/evaluations/:id", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    await db.delete(evaluations).where(eq(evaluations.id, id));
    await audit(c.get("user"), "Deleted evaluation", String(id));
    return c.json({ ok: true });
  });

  app.get("/api/admin/discipline", requireAuth(["ia", "command"]), async (c) =>
    c.json(
      await db
        .select({ record: disciplinaryRecords, memberName: rosterMembers.name, memberRank: rosterMembers.rank, badgeNumber: rosterMembers.badgeNumber, caseNumber: complaints.caseNumber })
        .from(disciplinaryRecords)
        .innerJoin(rosterMembers, eq(disciplinaryRecords.memberId, rosterMembers.id))
        .leftJoin(complaints, eq(disciplinaryRecords.complaintId, complaints.id))
        .orderBy(desc(disciplinaryRecords.issuedAt))
        .limit(500)
        .then((rows) => rows.map((r) => ({ ...r.record, memberName: r.memberName, memberRank: r.memberRank, badgeNumber: r.badgeNumber, caseNumber: r.caseNumber }))),
    ),
  );

  app.post("/api/admin/members/:id/discipline", requireAuth(["ia", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [member] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, id));
    if (!member) return c.json({ error: "Not found" }, 404);
    const { data, error } = parseFields(
      { action: { type: "string", required: true, oneOf: DISCIPLINARY_ACTIONS }, reason: { type: "text", required: true, max: 4000 }, complaintId: { type: "intOrNull" }, expiresAt: { type: "dateOrNull" } },
      await readJson(c),
    );
    if (error || !data) return c.json({ error }, 400);
    const user = c.get("user");
    const [row] = await db.insert(disciplinaryRecords).values({ ...(data as any), memberId: id, issuedBy: actorName(user) }).returning();
    await memberEvent(id, "Discipline", `${row.action} issued.`, actorName(user));
    if (row.action === "Suspension") await db.update(rosterMembers).set({ status: "Suspended", dutyStatus: "Off Duty" }).where(eq(rosterMembers.id, id));
    if (member.accountId) await notify(member.accountId, `Disciplinary action: ${row.action}`, row.reason.slice(0, 300), "/portal/profile");
    await audit(user, "Issued disciplinary action", member.name, row.action);
    return c.json(row, 201);
  });

  app.delete("/api/admin/discipline/:id", requireAuth(["ia", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [row] = await db.delete(disciplinaryRecords).where(eq(disciplinaryRecords.id, id)).returning();
    if (row) await audit(c.get("user"), "Removed disciplinary record", row.action);
    return c.json({ ok: true });
  });

  /* ------------------------------ Unit memberships ------------------------------ */

  app.get("/api/admin/units/:id/members", requireAuth(["content", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    return c.json(await unitRoster(id));
  });

  app.post("/api/admin/units/:id/members", requireAuth(["content", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const memberId = Number.parseInt(body?.memberId, 10);
    const [[unit], [member]] = await Promise.all([
      db.select().from(divisions).where(eq(divisions.id, id)),
      Number.isFinite(memberId) ? db.select().from(rosterMembers).where(eq(rosterMembers.id, memberId)) : Promise.resolve([]),
    ]);
    if (!unit || !member) return c.json({ error: "Pick a trooper" }, 400);
    const values = { position: str(body?.position, 80) || "Member", isLeader: Boolean(body?.isLeader), sortOrder: Number.parseInt(body?.sortOrder, 10) || 0 };
    await db
      .insert(unitMembers)
      .values({ unitId: id, memberId, ...values })
      .onConflictDoUpdate({ target: [unitMembers.unitId, unitMembers.memberId], set: values });
    await memberEvent(memberId, "Assignment", `${values.isLeader ? "Appointed" : "Added"} to ${unit.name} as ${values.position}.`, actorName(c.get("user")));
    if (member.accountId) await notify(member.accountId, `You've been added to ${unit.name}`, values.position, `/divisions/${unit.id}`);
    await audit(c.get("user"), "Updated unit membership", unit.name, `${member.name}: ${values.position}`);
    return c.json({ ok: true });
  });

  app.delete("/api/admin/unit-members/:id", requireAuth(["content", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [row] = await db.delete(unitMembers).where(eq(unitMembers.id, id)).returning();
    if (row) {
      const [unit] = await db.select().from(divisions).where(eq(divisions.id, row.unitId));
      await memberEvent(row.memberId, "Assignment", `Removed from ${unit?.name ?? "unit"}.`, actorName(c.get("user")));
      await audit(c.get("user"), "Removed unit member", unit?.name ?? "");
    }
    return c.json({ ok: true });
  });

  /* ------------------------------ LOA & resignation review ------------------------------ */

  app.get("/api/admin/requests", requireAuth("command"), async (c) =>
    c.json(await db.select().from(personnelRequests).orderBy(desc(personnelRequests.createdAt)).limit(300)),
  );

  app.patch("/api/admin/requests/:id", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const status = String(body?.status ?? "");
    if (!REQUEST_STATUSES.includes(status)) return c.json({ error: "Pick a valid status" }, 400);
    const user = c.get("user");
    const [row] = await db
      .update(personnelRequests)
      .set({ status, reviewNote: str(body?.note, 2000), reviewedBy: actorName(user), updatedAt: new Date() })
      .where(eq(personnelRequests.id, id))
      .returning();
    if (!row) return c.json({ error: "Not found" }, 404);
    if (status === "Approved" && row.memberId) {
      if (row.kind === "LOA") {
        await db.update(rosterMembers).set({ status: "LOA", dutyStatus: "Off Duty" }).where(eq(rosterMembers.id, row.memberId));
        await memberEvent(row.memberId, "Status", `Leave of absence approved (${row.startDate}${row.endDate ? ` – ${row.endDate}` : ""}).`, actorName(user));
      } else {
        await db.update(rosterMembers).set({ status: "Resigned", dutyStatus: "Off Duty" }).where(eq(rosterMembers.id, row.memberId));
        await memberEvent(row.memberId, "Status", `Resignation accepted, effective ${row.startDate}.`, actorName(user));
        if (body?.disableAccount && row.accountId) await db.update(accounts).set({ disabled: true }).where(and(eq(accounts.id, row.accountId), notInArray(accounts.role, OWNER_LEVEL_ROLES)));
      }
    }
    if (row.accountId) await notify(row.accountId, `${row.kind === "LOA" ? "Leave of absence" : "Resignation"} ${status.toLowerCase()}`, row.reviewNote, "/portal/requests");
    await audit(user, `${status} ${row.kind} request`, row.requesterName);
    return c.json(row);
  });

  /* ------------------------------ Internal Affairs ------------------------------ */

  /** Names this account may appear under as an assigned investigator. */
  async function investigatorNames(user: SessionUser): Promise<Set<string>> {
    const names = new Set<string>([user.displayName || "", user.username]);
    const [member] = await db.select({ name: rosterMembers.name, rank: rosterMembers.rank }).from(rosterMembers).where(eq(rosterMembers.accountId, user.id));
    if (member) {
      names.add(member.name);
      names.add(`${member.rank} ${member.name}`.trim());
    }
    return names;
  }

  /** Confidential cases are only visible to command staff and the assigned investigator. */
  const confidentialWhere = async (user: SessionUser) => {
    if (can(user.role, "command")) return undefined;
    const names = [...(await investigatorNames(user))];
    return or(eq(complaints.confidential, false), inArray(complaints.assignedTo, names));
  };

  const canSeeComplaint = async (user: SessionUser, complaint: { confidential: boolean; assignedTo: string }) => {
    if (!complaint.confidential || can(user.role, "command")) return true;
    return (await investigatorNames(user)).has(complaint.assignedTo);
  };

  app.get("/api/admin/complaints", requireAuth("ia"), async (c) => {
    const user = c.get("user");
    return c.json(await db.select().from(complaints).where(await confidentialWhere(user)).orderBy(desc(complaints.createdAt)));
  });

  // Cases opened directly by Internal Affairs (not filed through the website or portal).
  app.post("/api/admin/cases", requireAuth("ia"), async (c) => {
    const { data, error } = parseFields(
      {
        complainantName: { type: "string", max: 120 },
        officerName: { type: "string", max: 120 },
        officerBadge: { type: "string", max: 40 },
        incidentDate: { type: "string", max: 60 },
        location: { type: "string", max: 200 },
        category: { type: "string", oneOf: COMPLAINT_CATEGORIES },
        description: { type: "text", required: true, max: 6000 },
        evidence: { type: "text", max: 3000 },
        priority: { type: "string", oneOf: COMPLAINT_PRIORITIES },
        subjectMemberId: { type: "intOrNull" },
        confidential: { type: "bool" },
      },
      await readJson(c),
    );
    if (error || !data) return c.json({ error }, 400);
    const user = c.get("user");
    const [row] = await db
      .insert(complaints)
      .values({ ...(data as any), source: "ia", reporterAccountId: null, trackingCode: "", caseNumber: `TMP-${crypto.randomUUID()}` })
      .returning();
    const caseNumber = `IA-${new Date().getFullYear()}-${String(row.id).padStart(4, "0")}`;
    const [saved] = await db.update(complaints).set({ caseNumber }).where(eq(complaints.id, row.id)).returning();
    await audit(user, "Opened IA case", caseNumber);
    await background(deliverComplaint(saved, origin(c)));
    return c.json(saved, 201);
  });

  app.get("/api/admin/ia/stats", requireAuth("ia"), async (c) => {
    const user = c.get("user");
    const vis = await confidentialWhere(user);
    const since = (days: number) => new Date(Date.now() - days * 86400_000);
    const [byStatus, byCategory, byPriority, bySource, [openOld], discipline, [opened30], [closed30], [avgClose], trendOpen, trendClosed] = await Promise.all([
      db.select({ k: complaints.status, n: count() }).from(complaints).where(vis).groupBy(complaints.status),
      db.select({ k: complaints.category, n: count() }).from(complaints).where(vis).groupBy(complaints.category),
      db.select({ k: complaints.priority, n: count() }).from(complaints).where(vis).groupBy(complaints.priority),
      db.select({ k: complaints.source, n: count() }).from(complaints).where(vis).groupBy(complaints.source),
      db.select({ n: count() }).from(complaints).where(and(vis, notInArray(complaints.status, COMPLAINT_CLOSED), sql`${complaints.createdAt} < now() - interval '14 days'`)),
      db.select({ n: count() }).from(disciplinaryRecords).where(gte(disciplinaryRecords.issuedAt, since(90))),
      db.select({ n: count() }).from(complaints).where(and(vis, gte(complaints.createdAt, since(30)))),
      db.select({ n: count() }).from(complaints).where(and(vis, inArray(complaints.status, COMPLAINT_CLOSED), gte(complaints.updatedAt, since(30)))),
      db
        .select({ n: sql<number>`coalesce(round(avg(extract(epoch from (${complaints.updatedAt} - ${complaints.createdAt})) / 86400.0))::int, 0)` })
        .from(complaints)
        .where(and(vis, inArray(complaints.status, COMPLAINT_CLOSED))),
      db
        .select({ m: sql<string>`to_char(date_trunc('month', ${complaints.createdAt}), 'YYYY-MM')`, n: count() })
        .from(complaints)
        .where(and(vis, gte(complaints.createdAt, since(182))))
        .groupBy(sql`1`),
      db
        .select({ m: sql<string>`to_char(date_trunc('month', ${complaints.updatedAt}), 'YYYY-MM')`, n: count() })
        .from(complaints)
        .where(and(vis, inArray(complaints.status, COMPLAINT_CLOSED), gte(complaints.updatedAt, since(182))))
        .groupBy(sql`1`),
    ]);
    return c.json({
      byStatus, byCategory, byPriority, bySource,
      overdue: openOld.n, discipline90d: discipline[0].n,
      opened30d: opened30.n, closed30d: closed30.n, avgDaysToClose: avgClose?.n ?? 0,
      trendOpen, trendClosed,
    });
  });

  app.get("/api/admin/complaints/:id", requireAuth("ia"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, id));
    if (!complaint || !(await canSeeComplaint(c.get("user"), complaint))) return c.json({ error: "Not found" }, 404);
    const [notes, discipline, subject] = await Promise.all([
      db.select().from(complaintNotes).where(eq(complaintNotes.complaintId, id)).orderBy(asc(complaintNotes.createdAt)),
      db.select().from(disciplinaryRecords).where(eq(disciplinaryRecords.complaintId, id)),
      complaint.subjectMemberId ? memberById(complaint.subjectMemberId) : Promise.resolve(null),
    ]);
    return c.json({ complaint, notes, discipline, subject });
  });

  app.patch("/api/admin/complaints/:id", requireAuth("ia"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const { data, error } = parseFields(
      {
        status: { type: "string", oneOf: COMPLAINT_STATUSES },
        assignedTo: { type: "string", max: 120 },
        priority: { type: "string", oneOf: COMPLAINT_PRIORITIES },
        findings: { type: "text", max: 20000 },
        subjectMemberId: { type: "intOrNull" },
        confidential: { type: "bool" },
      },
      await readJson(c),
      true,
    );
    if (error || !data) return c.json({ error }, 400);
    const [before] = await db.select().from(complaints).where(eq(complaints.id, id));
    if (!before || !(await canSeeComplaint(c.get("user"), before))) return c.json({ error: "Not found" }, 404);
    const user = c.get("user");
    const reviewer = can(user.role, "command");

    // Only command staff can lift the confidential flag from a case.
    if (data.confidential === false && before.confidential && !reviewer)
      return c.json({ error: "Only command staff can remove the confidential flag" }, 403);

    const patchData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    let reviewNoteText: string | null = null;

    if (data.status !== undefined && data.status !== before.status) {
      const closing = COMPLAINT_CLOSED.includes(data.status as string);
      const wasClosed = COMPLAINT_CLOSED.includes(before.status);
      if (closing && !wasClosed && !reviewer) {
        // Investigators request closure; command staff approve or reject it.
        patchData.status = before.status;
        patchData.reviewStatus = "pending";
        patchData.requestedStatus = data.status;
        reviewNoteText = before.reviewStatus === "pending" && before.requestedStatus !== data.status
          ? `Closure request changed to ${data.status} — still awaiting command approval.`
          : `Closure requested (${data.status}) — awaiting command approval.`;
      } else if (closing && !wasClosed && reviewer) {
        // Command closes directly; any stale review state is cleared.
        patchData.reviewStatus = "";
        patchData.requestedStatus = "";
      } else if (!closing && before.reviewStatus === "pending") {
        // A non-closing status was picked: the pending review is moot.
        patchData.reviewStatus = "";
        patchData.requestedStatus = "";
      }
    }

    const [row] = await db.update(complaints).set(patchData).where(eq(complaints.id, id)).returning();
    const changes: string[] = [];
    if (data.status !== undefined && data.status !== before.status) changes.push(`Status changed from ${before.status} to ${row.status}`);
    if (data.assignedTo !== undefined && data.assignedTo !== before.assignedTo) changes.push(data.assignedTo ? `Assigned to ${data.assignedTo}` : "Unassigned");
    if (data.priority !== undefined && data.priority !== before.priority) changes.push(`Priority set to ${data.priority}`);
    if (data.findings !== undefined && data.findings !== before.findings) changes.push("Investigation report updated");
    if (data.subjectMemberId !== undefined && data.subjectMemberId !== before.subjectMemberId) changes.push("Subject officer linked");
    if (data.confidential !== undefined && data.confidential !== before.confidential)
      changes.push(data.confidential ? "Case marked confidential" : "Confidential flag removed");
    if (reviewNoteText) changes.push(reviewNoteText);
    if (changes.length) {
      await db.insert(complaintNotes).values({ complaintId: id, author: actorName(user), body: changes.join(". ") + "." });
      await audit(user, "Updated IA case", row.caseNumber, changes.join(". "));
    }
    if (row.source === "internal" && row.reporterAccountId && row.status !== before.status)
      await notify(row.reporterAccountId, `Misconduct report ${row.caseNumber}: ${row.status}`, "", "/portal");
    return c.json(row);
  });

  /** Cases awaiting a command decision on closure. */
  app.get("/api/admin/ia/reviews", requireAuth("command"), async (c) =>
    c.json(await db.select().from(complaints).where(eq(complaints.reviewStatus, "pending")).orderBy(asc(complaints.updatedAt))),
  );

  /** Command approves or rejects a requested case closure. */
  app.post("/api/admin/complaints/:id/review", requireAuth("command"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const approved = Boolean(body?.approved);
    const note = str(body?.note, 2000);
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, id));
    if (!complaint) return c.json({ error: "Not found" }, 404);
    if (complaint.reviewStatus !== "pending") return c.json({ error: "This case isn't awaiting review" }, 400);
    const user = c.get("user");
    const decision = `${approved ? "Closure approved" : "Closure rejected"} by ${actorName(user)}${note ? ` — ${note}` : "."}`;
    const [row] = await db
      .update(complaints)
      .set({
        ...(approved ? { status: complaint.requestedStatus } : {}),
        reviewStatus: approved ? "approved" : "rejected",
        reviewNote: note,
        reviewedByAccountId: user.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(complaints.id, id))
      .returning();
    await db.insert(complaintNotes).values({ complaintId: id, author: actorName(user), body: decision });
    await audit(user, approved ? "Approved case closure" : "Rejected case closure", complaint.caseNumber, note);
    if (approved && row.source === "internal" && row.reporterAccountId)
      await notify(row.reporterAccountId, `Misconduct report ${row.caseNumber}: ${row.status}`, "", "/portal");
    await background(
      postEmbed("complaints", origin(c), {
        title: `${approved ? "Closure approved" : "Closure rejected"} · ${complaint.caseNumber}`,
        url: `${origin(c)}/admin/internal-affairs/${id}`,
        color: approved ? 0x5cb87a : 0xe2574c,
        description: decision,
      }),
    );
    return c.json(row);
  });

  app.post("/api/admin/complaints/:id/notes", requireAuth("ia"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const body = str((await readJson(c))?.body, 5000);
    if (!body) return c.json({ error: "Write a note first" }, 400);
    const [note] = await db.insert(complaintNotes).values({ complaintId: id, author: actorName(c.get("user")), body }).returning();
    await db.update(complaints).set({ updatedAt: new Date() }).where(eq(complaints.id, id));
    return c.json(note, 201);
  });

  app.post("/api/admin/complaints/:id/resend", requireAuth("ia"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [complaint] = await db.select().from(complaints).where(eq(complaints.id, id));
    if (!complaint) return c.json({ error: "Not found" }, 404);
    return c.json({ webhookStatus: await deliverComplaint(complaint, origin(c)) });
  });

  app.delete("/api/admin/complaints/:id", requireAuth("owner"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [row] = await db.delete(complaints).where(eq(complaints.id, id)).returning();
    if (row) await audit(c.get("user"), "Deleted IA case", row.caseNumber);
    return c.json({ ok: true });
  });

  /* ------------------------------ Community inbox ------------------------------ */

  app.get("/api/admin/feedback", requireAuth(["content", "command"]), async (c) => c.json(await db.select().from(feedback).orderBy(desc(feedback.createdAt)).limit(500)));

  app.patch("/api/admin/feedback/:id", requireAuth(["content", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const status = String((await readJson(c))?.status ?? "");
    if (!FEEDBACK_STATUSES.includes(status)) return c.json({ error: "Pick a valid status" }, 400);
    const [row] = await db.update(feedback).set({ status, handledBy: actorName(c.get("user")) }).where(eq(feedback.id, id)).returning();
    return row ? c.json(row) : c.json({ error: "Not found" }, 404);
  });

  app.delete("/api/admin/feedback/:id", requireAuth(["content", "command"]), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    await db.delete(feedback).where(eq(feedback.id, id));
    return c.json({ ok: true });
  });

  /* ------------------------------ Pages & website configuration ------------------------------ */

  app.get("/api/admin/pages", requireAuth("content"), async (c) => c.json(await db.select().from(pages).orderBy(asc(pages.slug))));

  app.put("/api/admin/pages/:slug", requireAuth("content"), async (c) => {
    const slug = c.req.param("slug");
    if (!PAGE_SLUGS.some((p) => p.slug === slug)) return c.json({ error: "Unknown page" }, 404);
    const body = await readJson(c);
    const title = str(body?.title, 200) || PAGE_SLUGS.find((p) => p.slug === slug)!.title;
    const text = String(body?.body ?? "").slice(0, 60000);
    const user = c.get("user");
    await db
      .insert(pages)
      .values({ slug: String(slug), title: String(title), body: text, updatedBy: actorName(user) } as typeof pages.$inferInsert)
      .onConflictDoUpdate({ target: pages.slug, set: { title, body: text, updatedBy: actorName(user), updatedAt: new Date() } });
    await audit(user, "Edited page", title);
    return c.json({ ok: true });
  });

  app.get("/api/admin/site-config", requireAuth("admin"), async (c) => c.json(await getSiteConfig()));

  app.put("/api/admin/site-config", requireAuth("admin"), async (c) => {
    const result = await saveSiteConfig(await readJson(c));
    if (typeof result === "string") return c.json({ error: result }, 400);
    await audit(c.get("user"), "Updated website configuration");
    return c.json(result);
  });

  /** Department-wide notification, optionally posted to Discord. */
  app.post("/api/admin/broadcast", requireAuth("command"), async (c) => {
    const body = await readJson(c);
    const title = str(body?.title, 200);
    if (!title) return c.json({ error: "Give the notification a title" }, 400);
    const text = str(body?.body, 1000);
    await notify(null, title, text, str(body?.link, 200));
    if (body?.discord) await background(postEmbed("announcements", origin(c), { title: `🔔 ${title}`, description: text }));
    await audit(c.get("user"), "Sent department notification", title);
    return c.json({ ok: true });
  });

  /* ------------------------------ Maintenance mode ------------------------------ */

  app.get("/api/admin/maintenance", requireAuth("admin"), async (c) => c.json(await maintenanceStatus()));

  app.put("/api/admin/maintenance", requireAuth("admin"), async (c) => {
    const body = await readJson(c);
    const enabled = Boolean(body?.enabled);
    const message = str(body?.message, 500);
    await setSetting(MAINTENANCE_ENABLED_KEY, enabled ? "1" : "");
    await setSetting(MAINTENANCE_MESSAGE_KEY, message);
    await audit(c.get("user"), enabled ? "Enabled maintenance mode" : "Disabled maintenance mode", message);
    return c.json({ enabled, message });
  });

  /* ------------------------------ Custom roles ------------------------------ */

  const ROLE_KEY = /^[a-z0-9][a-z0-9-]{1,31}$/;
  const slugify = (s: string) =>
    s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

  const readPerms = (value: unknown): string[] | null => {
    if (!Array.isArray(value)) return null;
    const perms = value.map(String).filter((p) => CUSTOM_PERM_OPTIONS.some((o) => o.key === p));
    return [...new Set(perms)];
  };

  // Any signed-in staff member can read the role list: the browser needs labels
  // and permission sets to evaluate access client-side.
  app.get("/api/admin/roles", requireAuth("officer"), async (c) => {
    await refreshCustomRoles(true);
    return c.json(await db.select().from(customRoles).orderBy(asc(customRoles.id)));
  });

  app.post("/api/admin/roles", requireAuth("owner"), async (c) => {
    const body = await readJson(c);
    const label = str(body?.label, 60);
    if (!label) return c.json({ error: "Give the role a name" }, 400);
    const key = str(body?.key, 32) || slugify(label);
    if (!ROLE_KEY.test(key)) return c.json({ error: "Role keys are 2–32 characters: lowercase letters, numbers and dashes" }, 400);
    const perms = readPerms(body?.perms);
    if (perms === null) return c.json({ error: "Pick valid permissions" }, 400);
    const [row] = await db.insert(customRoles).values({ key, label, perms }).returning();
    await refreshCustomRoles(true);
    await audit(c.get("user"), "Created custom role", label, perms.join(", ") || "no permissions");
    return c.json(row, 201);
  });

  app.put("/api/admin/roles/:id", requireAuth("owner"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [role] = await db.select().from(customRoles).where(eq(customRoles.id, id));
    if (!role) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const label = str(body?.label, 60) || role.label;
    const perms = readPerms(body?.perms);
    if (perms === null) return c.json({ error: "Pick valid permissions" }, 400);
    const [row] = await db.update(customRoles).set({ label, perms }).where(eq(customRoles.id, id)).returning();
    await refreshCustomRoles(true);
    await audit(c.get("user"), "Updated custom role", label, `${role.perms.join(", ") || "none"} → ${perms.join(", ") || "none"}`);
    return c.json(row);
  });

  app.delete("/api/admin/roles/:id", requireAuth("owner"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [role] = await db.select().from(customRoles).where(eq(customRoles.id, id));
    if (!role) return c.json({ error: "Not found" }, 404);
    // Another role sharing this key keeps the permission set alive, so accounts
    // only block deletion when this is the last row with that key.
    const siblings = await db.select({ id: customRoles.id }).from(customRoles).where(eq(customRoles.key, role.key));
    if (siblings.length <= 1) {
      const inUse = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.role, CUSTOM_ROLE_PREFIX + role.key)).limit(1);
      if (inUse.length) return c.json({ error: "Accounts still use this role. Move them to another role first." }, 400);
    }
    await db.delete(customRoles).where(eq(customRoles.id, id));
    await refreshCustomRoles(true);
    await audit(c.get("user"), "Removed custom role", role.label);
    return c.json({ ok: true });
  });

  /** A role value an account may hold: a fixed assignable role or an existing custom role. */
  async function validRole(role: string): Promise<boolean> {
    return ASSIGNABLE_ROLES.includes(role as any) || customRoleExists(role).then(Boolean);
  }

  /* ------------------------------ Accounts ------------------------------ */

  const accountColumns = {
    id: accounts.id,
    username: accounts.username,
    displayName: accounts.displayName,
    role: accounts.role,
    disabled: accounts.disabled,
    createdAt: accounts.createdAt,
    lastLoginAt: accounts.lastLoginAt,
    suspendedUntil: accounts.suspendedUntil,
    suspendedReason: accounts.suspendedReason,
  };

  app.get("/api/admin/accounts", requireAuth("owner"), async (c) => {
    const rows = await db
      .select({ ...accountColumns, memberId: rosterMembers.id, memberName: rosterMembers.name, memberRank: rosterMembers.rank })
      .from(accounts)
      .leftJoin(rosterMembers, eq(rosterMembers.accountId, accounts.id))
      .orderBy(asc(accounts.id));
    return c.json(rows);
  });

  /** Only the owner can give out, change or remove access. */
  async function linkMember(accountId: number, memberId: unknown) {
    if (memberId === undefined) return;
    await db.update(rosterMembers).set({ accountId: null }).where(eq(rosterMembers.accountId, accountId));
    const id = Number.parseInt(String(memberId), 10);
    if (Number.isFinite(id)) await db.update(rosterMembers).set({ accountId }).where(eq(rosterMembers.id, id));
  }

  app.post("/api/admin/accounts", requireAuth("owner"), async (c) => {
    const user = c.get("user");
    const body = await readJson(c);
    const username = str(body?.username, 40);
    const password = String(body?.password ?? "");
    const role = String(body?.role ?? "officer");
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return c.json({ error: "Usernames are 3–40 characters: letters, numbers, dots, dashes or underscores" }, 400);
    if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
    if (!(await validRole(role))) return c.json({ error: "Pick a valid access level" }, 400);
    if (await findAccountByUsername(username)) return c.json({ error: "That username is already taken" }, 409);
    const [row] = await db
      .insert(accounts)
      .values({ username, displayName: str(body?.displayName, 80) || username, passwordHash: await hashPassword(password), role })
      .returning(accountColumns);
    await linkMember(row.id, body?.memberId);
    await audit(user, "Created account", username, role);
    return c.json(row, 201);
  });

  app.put("/api/admin/accounts/:id", requireAuth("owner"), async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!account) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const update: Record<string, unknown> = {};
    const isOwner = OWNER_LEVEL_ROLES.includes(account.role as any);
    if (account.role === "commissioner" && user.role !== "owner") return c.json({ error: "Only the owner can manage Commissioners Board accounts" }, 403);
    if (body?.password && isOwner && user.role !== "owner") return c.json({ error: "Only the owner can change an owner's password" }, 403);
    if (body?.displayName !== undefined) update.displayName = str(body.displayName, 80) || account.username;
    if (body?.role !== undefined && !isOwner && body.role !== account.role) {
      if (!(await validRole(String(body.role)))) return c.json({ error: "Pick a valid access level" }, 400);
      if (account.id === user.id) return c.json({ error: "You can't change your own access level" }, 400);
      update.role = body.role;
    }
    if (body?.disabled !== undefined && !isOwner && account.id !== user.id) update.disabled = Boolean(body.disabled);
    // Temporary suspension: portal access is blocked until the end time passes.
    if (body?.suspendedUntil !== undefined && !isOwner && account.id !== user.id) {
      const until = body.suspendedUntil ? new Date(body.suspendedUntil) : null;
      if (body.suspendedUntil && (!until || Number.isNaN(until.getTime()))) return c.json({ error: "That isn't a valid suspension end date" }, 400);
      const active = until && until.getTime() > Date.now();
      update.suspendedUntil = active ? until : null;
      update.suspendedReason = active ? str(body?.suspendedReason, 500) : "";
    }
    if (body?.password) {
      if (String(body.password).length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);
      update.passwordHash = await hashPassword(String(body.password));
    }
    if (Object.keys(update).length) await db.update(accounts).set(update).where(eq(accounts.id, id));
    await linkMember(id, body?.memberId);
    const changes = [
      update.role && `role → ${update.role}`,
      update.disabled !== undefined && (update.disabled ? "disabled" : "enabled"),
      update.suspendedUntil !== undefined && (update.suspendedUntil ? `suspended until ${new Date(update.suspendedUntil as Date).toUTCString()}` : "suspension lifted"),
      update.passwordHash && "password reset",
      body?.memberId !== undefined && "roster link updated",
    ].filter(Boolean);
    await audit(user, "Updated account", account.username, changes.join(", "));
    const [row] = await db.select(accountColumns).from(accounts).where(eq(accounts.id, id));
    return c.json(row);
  });

  app.delete("/api/admin/accounts/:id", requireAuth("owner"), async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [account] = await db.select().from(accounts).where(and(eq(accounts.id, id), notInArray(accounts.role, OWNER_LEVEL_ROLES)));
    if (!account || account.username.toLowerCase() === OWNER_USERNAME.toLowerCase()) return c.json({ error: "The owner account can't be removed" }, 400);
    if (account.role === "commissioner" && user.role !== "owner") return c.json({ error: "Only the owner can manage Commissioners Board accounts" }, 403);
    if (account.id === user.id) return c.json({ error: "You can't remove your own account" }, 400);
    await db.delete(accounts).where(eq(accounts.id, id));
    await audit(user, "Removed account", account.username);
    return c.json({ ok: true });
  });

  /** Recent sign-in activity for one account (successful and failed attempts). */
  app.get("/api/admin/accounts/:id/logins", requireAuth("owner"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
    if (!account) return c.json({ error: "Not found" }, 404);
    return c.json(
      await db
        .select()
        .from(loginEvents)
        .where(or(eq(loginEvents.accountId, id), and(isNull(loginEvents.accountId), sql`lower(${loginEvents.username}) = lower(${account.username})`)))
        .orderBy(desc(loginEvents.createdAt))
        .limit(50),
    );
  });

  /** Creates a login for an existing roster member. Returns a one-time password. */
  app.post("/api/admin/members/:id/account", requireAuth("owner"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [member] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, id));
    if (!member) return c.json({ error: "Not found" }, 404);
    if (member.accountId) return c.json({ error: "This trooper already has a login" }, 400);
    const username = str((await readJson(c))?.username, 40);
    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return c.json({ error: "Usernames are 3–40 characters: letters, numbers, dots, dashes or underscores" }, 400);
    if (await findAccountByUsername(username)) return c.json({ error: "That username is already taken" }, 409);
    const password = randomCode(12).replace("-", "");
    const [account] = await db.insert(accounts).values({ username, displayName: `${member.rank} ${member.name}`.trim(), passwordHash: await hashPassword(password), role: "officer" }).returning();
    await db.update(rosterMembers).set({ accountId: account.id }).where(eq(rosterMembers.id, id));
    await applyRankRole(account.id, member.rank, ctxOf(c));
    await audit(c.get("user"), "Created trooper login", username, member.name);
    return c.json({ username, password }, 201);
  });

  /* ------------------------------ Discord settings (owner) ------------------------------ */

  app.get("/api/admin/settings", requireAuth("owner"), async (c) => {
    const channels = await Promise.all(
      (Object.keys(CHANNELS) as Channel[]).map(async (ch) => {
        const saved = await getSetting(CHANNELS[ch].key);
        const env = ch === "complaints" && !saved && Boolean(process.env.DISCORD_WEBHOOK_URL);
        return { channel: ch, label: CHANNELS[ch].label, configured: Boolean(saved) || env, source: saved ? "panel" : env ? "environment" : null, preview: saved ? `…${saved.slice(-6)}` : null };
      }),
    );
    return c.json({
      channels,
      // Kept for older clients.
      webhookConfigured: channels[0].configured,
      webhookSource: channels[0].source,
      webhookPreview: channels[0].preview,
    });
  });

  app.put("/api/admin/settings/webhook", requireAuth("owner"), async (c) => {
    const body = await readJson(c);
    const ch = (body?.channel ?? "complaints") as Channel;
    if (!CHANNELS[ch]) return c.json({ error: "Unknown channel" }, 400);
    const url = str(body?.url, 500);
    if (url && !isValidWebhookUrl(url)) return c.json({ error: "That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…)" }, 400);
    await setSetting(CHANNELS[ch].key, url);
    await audit(c.get("user"), url ? "Connected Discord webhook" : "Disconnected Discord webhook", CHANNELS[ch].label);
    return c.json({ ok: true });
  });

  app.post("/api/admin/settings/webhook/test", requireAuth("owner"), async (c) => {
    const ch = ((await readJson(c))?.channel ?? "complaints") as Channel;
    if (!CHANNELS[ch]) return c.json({ error: "Unknown channel" }, 400);
    let status: string;
    if (ch === "complaints") {
      const now = new Date();
      status = await sendComplaintWebhook(
        {
          id: 0, caseNumber: "IA-TEST-0000", complainantName: "Test Complainant", complainantDiscord: "test#0000", complainantRoblox: "TestUser", contact: "",
          officerName: "Trooper Example", officerBadge: "000", incidentDate: now.toLocaleDateString("en-US"), location: "Test location", category: "Other",
          description: "This is a test message from the TXDPS admin panel. If you can see this, complaint alerts are set up correctly.",
          evidence: "", status: "Open", assignedTo: "", webhookStatus: "pending", source: "public", reporterAccountId: null, subjectMemberId: null,
          priority: "Normal", findings: "", trackingCode: "", createdAt: now, updatedAt: now,
          confidential: false, reviewStatus: "", requestedStatus: "", reviewNote: "", reviewedByAccountId: null, reviewedAt: null,
        },
        origin(c),
      );
    } else {
      status = (await getChannelWebhook(ch))
        ? await postEmbed(ch, origin(c), { title: "Test message", description: `If you can see this, ${CHANNELS[ch].label.toLowerCase()} alerts are set up correctly.` })
        : "not_configured";
    }
    if (status === "not_configured") return c.json({ error: "Save a webhook URL first" }, 400);
    if (status !== "sent") return c.json({ error: "Discord rejected the message. Check the webhook URL." }, 502);
    return c.json({ ok: true });
  });
}
