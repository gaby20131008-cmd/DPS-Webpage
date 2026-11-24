import type { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, sql, count } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  complaints, divisions, events, faqs, feedback, leaders, news, pages, ranks, rosterDividers, rosterMembers, unitMembers,
} from "../../db/schema.js";
import { COMPLAINT_CATEGORIES, FEEDBACK_KINDS } from "../../shared/constants.js";
import { throttle } from "../auth.js";
import { deliverComplaint } from "../discord.js";
import { background, clientIp, idParam, randomCode, readJson, str, type Env } from "../http.js";
import { activeAnnouncements, departmentStats, publicMember, rosterQuery, unitRoster } from "../queries.js";
import { flushScheduledAnnouncements } from "../scheduled.js";
import { getSiteConfig } from "../site.js";
import { parseFields, type FieldSpec } from "../validate.js";

const publishedNews = () =>
  db.select().from(news).where(eq(news.published, true)).orderBy(desc(news.publishedAt), desc(news.id));

const upcomingEvents = (audience: string[]) =>
  db
    .select()
    .from(events)
    .where(and(inArray(events.audience, audience), gte(events.startsAt, new Date(Date.now() - 6 * 3600_000))))
    .orderBy(asc(events.startsAt));

export function registerPublic(app: Hono<Env>) {
  app.get("/api/site", async (c) => {
    const [config, stats] = await Promise.all([getSiteConfig(), departmentStats()]);
    return c.json({ config, stats });
  });

  app.get("/api/home", async (c) => {
    await flushScheduledAnnouncements(new URL(c.req.url).origin);
    const [divs, latest, leadership, roster, ann, evts, stats, config] = await Promise.all([
      db.select().from(divisions).orderBy(asc(divisions.sortOrder), asc(divisions.id)),
      publishedNews().limit(3),
      db.select().from(leaders).orderBy(asc(leaders.sortOrder), asc(leaders.id)).limit(4),
      rosterQuery(),
      activeAnnouncements(["public"]).limit(4),
      upcomingEvents(["public"]).limit(3),
      departmentStats(),
      getSiteConfig(),
    ]);
    const featured = roster.filter((m) => m.featured).slice(0, 6).map(publicMember);
    return c.json({
      divisions: divs,
      news: latest,
      leaders: leadership,
      rosterCount: roster.length,
      announcements: ann,
      events: evts,
      featured,
      stats,
      config,
    });
  });

  app.get("/api/divisions", async (c) =>
    c.json(await db.select().from(divisions).orderBy(asc(divisions.sortOrder), asc(divisions.id))),
  );

  app.get("/api/divisions/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [division] = await db.select().from(divisions).where(eq(divisions.id, id));
    if (!division) return c.json({ error: "Not found" }, 404);
    const [members, ann] = await Promise.all([unitRoster(id), activeAnnouncements(["public"])]);
    return c.json({
      division,
      members: members.map(({ discord: _d, accountId: _a, ...m }) => m),
      announcements: ann.filter((a) => a.unitId === id).slice(0, 5),
    });
  });

  app.get("/api/roster", async (c) => c.json((await rosterQuery()).map(publicMember)));

  /** Roster divider headings, so sections show on the public roster even before members are assigned. */
  app.get("/api/roster-dividers", async (c) =>
    c.json(await db.select({ id: rosterDividers.id, label: rosterDividers.label, sortOrder: rosterDividers.sortOrder }).from(rosterDividers).orderBy(asc(rosterDividers.sortOrder), asc(rosterDividers.id))),
  );

  /** Live roster: who's on duty right now. Polled by the browser. */
  app.get("/api/roster/live", async (c) => {
    const roster = (await rosterQuery()).map(publicMember);
    const onDuty = roster.filter((m) => m.dutyStatus && m.dutyStatus !== "Off Duty");
    const byStatus: Record<string, number> = {};
    onDuty.forEach((m) => (byStatus[m.dutyStatus] = (byStatus[m.dutyStatus] ?? 0) + 1));
    c.header("Cache-Control", "no-store");
    return c.json({ onDuty, total: roster.length, byStatus, updatedAt: new Date().toISOString() });
  });

  app.get("/api/leadership", async (c) =>
    c.json(await db.select().from(leaders).orderBy(asc(leaders.sortOrder), asc(leaders.id))),
  );

  app.get("/api/news", async (c) => c.json(await publishedNews()));

  app.get("/api/news/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [post] = await db.select().from(news).where(and(eq(news.id, id), eq(news.published, true)));
    return post ? c.json(post) : c.json({ error: "Not found" }, 404);
  });

  app.get("/api/pages/:slug", async (c) => {
    const [page] = await db.select().from(pages).where(eq(pages.slug, c.req.param("slug")));
    return page ? c.json(page) : c.json({ error: "Not found" }, 404);
  });

  app.get("/api/ranks", async (c) => {
    const [rankRows, counts] = await Promise.all([
      db.select().from(ranks).orderBy(asc(ranks.sortOrder), asc(ranks.id)),
      db
        .select({ rank: sql<string>`lower(${rosterMembers.rank})`, n: count() })
        .from(rosterMembers)
        .groupBy(sql`lower(${rosterMembers.rank})`),
    ]);
    const map = new Map(counts.map((r) => [r.rank, r.n]));
    return c.json(rankRows.map((r) => ({ ...r, members: map.get(r.name.toLowerCase()) ?? 0 })));
  });

  /** Chain of command: ranks with their members, plus unit leaders. */
  app.get("/api/org-chart", async (c) => {
    const [rankRows, roster, units, memberships] = await Promise.all([
      db.select().from(ranks).orderBy(asc(ranks.sortOrder), asc(ranks.id)),
      rosterQuery(),
      db.select().from(divisions).orderBy(asc(divisions.sortOrder), asc(divisions.id)),
      db.select().from(unitMembers).orderBy(asc(unitMembers.sortOrder), asc(unitMembers.id)),
    ]);
    const active = roster.filter((m) => !["Resigned", "Inactive"].includes(m.status)).map(publicMember);
    const byId = new Map(active.map((m) => [m.id, m]));
    const unitLeaders = units.map((u) => {
      const ms = memberships.filter((x) => x.unitId === u.id);
      const ids = new Set([...ms.map((x) => x.memberId), ...active.filter((m) => m.divisionId === u.id).map((m) => m.id)]);
      return {
        id: u.id,
        name: u.name,
        code: u.code,
        size: [...ids].filter((id) => byId.has(id)).length,
        leaders: ms.filter((x) => x.isLeader && byId.has(x.memberId)).map((x) => ({ ...byId.get(x.memberId)!, position: x.position })),
      };
    });
    return c.json({
      ranks: rankRows.map((r) => ({ ...r, members: active.filter((m) => m.rank.toLowerCase() === r.name.toLowerCase()) })),
      unranked: active.filter((m) => !rankRows.some((r) => r.name.toLowerCase() === m.rank.toLowerCase())),
      units: unitLeaders,
    });
  });

  app.get("/api/faqs", async (c) => c.json(await db.select().from(faqs).orderBy(asc(faqs.sortOrder), asc(faqs.id))));

  app.get("/api/events", async (c) => c.json(await upcomingEvents(["public"]).limit(50)));

  app.get("/api/announcements", async (c) => c.json(await activeAnnouncements(["public"]).limit(30)));

  /* ------------------------------ Community feedback / contact ------------------------------ */

  app.post("/api/feedback", async (c) => {
    const body = await readJson(c);
    if (body?.website) return c.json({ ok: true });
    if (!throttle(`feedback:${clientIp(c)}`, 8, 60 * 60_000))
      return c.json({ error: "Too many messages from this connection. Please try again later." }, 429);
    const { data, error } = parseFields(
      {
        kind: { type: "string", oneOf: FEEDBACK_KINDS },
        name: { type: "string", required: true, max: 120 },
        contact: { type: "string", max: 200 },
        subject: { type: "string", max: 200 },
        message: { type: "text", required: true, max: 5000 },
      },
      body,
    );
    if (error || !data) return c.json({ error }, 400);
    await db.insert(feedback).values(data as any);
    return c.json({ ok: true }, 201);
  });

  /* ------------------------------ Complaints ------------------------------ */

  const complaintSpec: FieldSpec = {
    complainantName: { type: "string", required: true, max: 120 },
    complainantDiscord: { type: "string", max: 120 },
    complainantRoblox: { type: "string", max: 120 },
    contact: { type: "string", max: 200 },
    officerName: { type: "string", max: 120 },
    officerBadge: { type: "string", max: 40 },
    incidentDate: { type: "string", max: 60 },
    location: { type: "string", max: 200 },
    category: { type: "string", max: 60, oneOf: COMPLAINT_CATEGORIES },
    description: { type: "text", required: true, max: 6000 },
    evidence: { type: "text", max: 3000 },
  };

  app.post("/api/complaints", async (c) => {
    const body = await readJson(c);
    if (body?.website) return c.json({ ok: true, caseNumber: "IA-RECEIVED", trackingCode: "" }); // honeypot
    if (!throttle(`complaint:${clientIp(c)}`, 5, 60 * 60_000))
      return c.json({ error: "Too many complaints from this connection. Please try again later." }, 429);
    const { data, error } = parseFields(complaintSpec, body);
    if (error || !data) return c.json({ error }, 400);
    if (!data.complainantDiscord && !data.complainantRoblox && !data.contact)
      return c.json({ error: "Please provide at least one way to contact you." }, 400);
    const result = await fileComplaint(data, c.req.url, "public", null);
    return c.json({ ok: true, ...result }, 201);
  });

  app.get("/api/complaints/status", async (c) => {
    const caseNumber = str(c.req.query("case"), 40).toUpperCase();
    const code = str(c.req.query("code"), 20).toUpperCase();
    if (!throttle(`track:${clientIp(c)}`, 30, 15 * 60_000)) return c.json({ error: "Too many lookups. Try again shortly." }, 429);
    if (!caseNumber || !code) return c.json({ error: "Enter your case number and tracking code" }, 400);
    const [row] = await db
      .select({ caseNumber: complaints.caseNumber, status: complaints.status, category: complaints.category, createdAt: complaints.createdAt, updatedAt: complaints.updatedAt, trackingCode: complaints.trackingCode, confidential: complaints.confidential })
      .from(complaints)
      .where(eq(complaints.caseNumber, caseNumber));
    if (!row || !row.trackingCode || row.trackingCode !== code)
      return c.json({ error: "We couldn't find a case with that number and tracking code." }, 404);
    const { trackingCode: _t, confidential, ...out } = row;
    // Confidential cases share only their status — no category or dates leak publicly.
    if (confidential) return c.json({ caseNumber: row.caseNumber, status: row.status, updatedAt: row.updatedAt });
    return c.json(out);
  });
}

/** Saves a complaint, assigns a case number and sends the Discord alert. */
export async function fileComplaint(
  data: Record<string, unknown>,
  url: string,
  source: "public" | "internal",
  reporterAccountId: number | null,
) {
  const trackingCode = randomCode(8);
  const [row] = await db
    .insert(complaints)
    .values({ ...(data as any), source, reporterAccountId, trackingCode, caseNumber: `TMP-${crypto.randomUUID()}` })
    .returning();
  const caseNumber = `IA-${new Date().getFullYear()}-${String(row.id).padStart(4, "0")}`;
  const [saved] = await db.update(complaints).set({ caseNumber }).where(eq(complaints.id, row.id)).returning();
  await background(deliverComplaint(saved, new URL(url).origin));
  return { caseNumber, trackingCode };
}

