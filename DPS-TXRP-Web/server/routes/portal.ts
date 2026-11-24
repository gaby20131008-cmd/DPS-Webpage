import type { Hono } from "hono";
import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  accounts, activityLogs, announcements, commendations, divisions, documents, eventSignups, events, messages, notifications,
  pages, personnelRequests, reports, rosterMembers, trainingRecords,
} from "../../db/schema.js";
import { can, COMPLAINT_CATEGORIES, DUTY_STATUSES, REPORT_TYPES } from "../../shared/constants.js";
import { memberForAccount, requireAuth, throttle } from "../auth.js";
import { memberEvent, notify } from "../audit.js";
import { postEmbed } from "../discord.js";
import { actorName, background, idParam, origin, readJson, str, type Env } from "../http.js";
import { maintenanceGate } from "../maintenance.js";
import { activeAnnouncements, memberById, personnelFile, publicMember, rosterQuery } from "../queries.js";
import { parseFields } from "../validate.js";
import { flushScheduledAnnouncements } from "../scheduled.js";
import { fileComplaint } from "./public.js";

const restrictedTypes = REPORT_TYPES.filter((t) => t.restricted).map((t) => t.key);

export function registerPortal(app: Hono<Env>) {
  app.use("/api/portal/*", requireAuth("officer"));
  // Maintenance mode locks the portal for everyone below command staff.
  app.use("/api/portal/*", maintenanceGate());

  app.get("/api/portal/me", async (c) => {
    const user = c.get("user");
    const [account] = await db.select({ notificationsSeenAt: accounts.notificationsSeenAt }).from(accounts).where(eq(accounts.id, user.id));
    const linked = await memberForAccount(user.id);
    const member = linked ? await memberById(linked.id) : null;
    const seen = account?.notificationsSeenAt ?? new Date(0);
    const [[unreadMessages], [unreadNotifications], [openShift]] = await Promise.all([
      db.select({ n: count() }).from(messages).where(and(eq(messages.toAccountId, user.id), isNull(messages.readAt))),
      db
        .select({ n: count() })
        .from(notifications)
        .where(and(or(eq(notifications.accountId, user.id), isNull(notifications.accountId)), gt(notifications.createdAt, seen))),
      member
        ? db.select().from(activityLogs).where(and(eq(activityLogs.memberId, member.id), isNull(activityLogs.endedAt))).orderBy(desc(activityLogs.startedAt)).limit(1)
        : Promise.resolve([undefined]),
    ]);
    return c.json({ user, member, unreadMessages: unreadMessages.n, unreadNotifications: unreadNotifications.n, openShift: openShift ?? null });
  });

  app.get("/api/portal/file", async (c) => {
    const member = await memberForAccount(c.get("user").id);
    if (!member) return c.json({ member: null });
    return c.json({ member: await memberById(member.id), ...(await personnelFile(member.id)) });
  });

  app.put("/api/portal/profile", async (c) => {
    const member = await memberForAccount(c.get("user").id);
    if (!member) return c.json({ error: "Your account isn't linked to a roster profile yet. Ask command staff to link it." }, 400);
    const { data, error } = parseFields(
      {
        bio: { type: "text", max: 1500 },
        photoKey: { type: "stringOrNull", max: 100 },
        cardTheme: { type: "string", oneOf: ["classic", "midnight", "steel", "desert", "crimson", "forest"] },
      },
      await readJson(c),
      true,
    );
    if (error || !data) return c.json({ error }, 400);
    await db.update(rosterMembers).set(data).where(eq(rosterMembers.id, member.id));
    return c.json(await memberById(member.id));
  });

  /* ------------------------------ Duty status & activity ------------------------------ */

  app.post("/api/portal/duty", async (c) => {
    const user = c.get("user");
    const member = await memberForAccount(user.id);
    if (!member) return c.json({ error: "Your account isn't linked to a roster profile yet." }, 400);
    const body = await readJson(c);
    const status = String(body?.status ?? "");
    if (!DUTY_STATUSES.includes(status)) return c.json({ error: "Pick a valid status" }, 400);
    if (["Suspended", "Resigned"].includes(member.status) && status !== "Off Duty")
      return c.json({ error: `You can't go on duty while your status is ${member.status}.` }, 400);
    const now = new Date();
    const [open] = await db
      .select()
      .from(activityLogs)
      .where(and(eq(activityLogs.memberId, member.id), isNull(activityLogs.endedAt)))
      .orderBy(desc(activityLogs.startedAt))
      .limit(1);
    if (status === "Off Duty") {
      if (open) {
        const minutes = Math.max(0, Math.min(24 * 60, Math.round((now.getTime() - new Date(open.startedAt).getTime()) / 60000)));
        await db.update(activityLogs).set({ endedAt: now, minutes, notes: str(body?.notes, 1000) || open.notes }).where(eq(activityLogs.id, open.id));
      }
    } else if (!open) {
      await db.insert(activityLogs).values({ memberId: member.id, startedAt: now });
    }
    await db.update(rosterMembers).set({ dutyStatus: status, dutyUpdatedAt: now }).where(eq(rosterMembers.id, member.id));
    return c.json({ ok: true, status });
  });

  /* ------------------------------ Communications ------------------------------ */

  app.get("/api/portal/announcements", async (c) => {
    await flushScheduledAnnouncements(origin(c));
    return c.json(await activeAnnouncements(["internal", "public"]).limit(60));
  });

  app.get("/api/portal/notifications", async (c) => {
    const user = c.get("user");
    const [account] = await db.select({ seen: accounts.notificationsSeenAt }).from(accounts).where(eq(accounts.id, user.id));
    const rows = await db
      .select()
      .from(notifications)
      .where(or(eq(notifications.accountId, user.id), isNull(notifications.accountId)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const seen = account?.seen ? new Date(account.seen).getTime() : 0;
    return c.json(rows.map((n) => ({ ...n, unread: new Date(n.createdAt).getTime() > seen })));
  });

  app.post("/api/portal/notifications/seen", async (c) => {
    await db.update(accounts).set({ notificationsSeenAt: new Date() }).where(eq(accounts.id, c.get("user").id));
    return c.json({ ok: true });
  });

  app.get("/api/portal/directory", async (c) => {
    const rows = await db
      .select({ id: accounts.id, displayName: accounts.displayName, username: accounts.username, role: accounts.role, rank: rosterMembers.rank, callsign: rosterMembers.callsign, badgeNumber: rosterMembers.badgeNumber })
      .from(accounts)
      .leftJoin(rosterMembers, eq(rosterMembers.accountId, accounts.id))
      .where(eq(accounts.disabled, false))
      .orderBy(asc(accounts.displayName));
    return c.json(rows);
  });

  app.get("/api/portal/messages", async (c) => {
    const user = c.get("user");
    const box = c.req.query("box") === "sent" ? "sent" : "inbox";
    const rows = await db
      .select({
        id: messages.id,
        fromAccountId: messages.fromAccountId,
        fromName: messages.fromName,
        toAccountId: messages.toAccountId,
        toName: accounts.displayName,
        subject: messages.subject,
        body: messages.body,
        readAt: messages.readAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .leftJoin(accounts, eq(messages.toAccountId, accounts.id))
      .where(box === "sent" ? eq(messages.fromAccountId, user.id) : eq(messages.toAccountId, user.id))
      .orderBy(desc(messages.createdAt))
      .limit(200);
    return c.json(rows);
  });

  app.post("/api/portal/messages", async (c) => {
    const user = c.get("user");
    if (!throttle(`msg:${user.id}`, 60, 60 * 60_000)) return c.json({ error: "You're sending messages too quickly." }, 429);
    const body = await readJson(c);
    const text = str(body?.body, 5000);
    if (!text) return c.json({ error: "Write a message first" }, 400);
    const ids: number[] = (Array.isArray(body?.to) ? body.to : [body?.to]).map((v: any) => Number.parseInt(v, 10)).filter(Number.isFinite);
    if (!ids.length) return c.json({ error: "Pick at least one recipient" }, 400);
    if (ids.length > 50) return c.json({ error: "You can message up to 50 people at once" }, 400);
    const recipients = await db.select({ id: accounts.id }).from(accounts).where(and(inArray(accounts.id, ids), eq(accounts.disabled, false)));
    if (!recipients.length) return c.json({ error: "Recipient not found" }, 400);
    const subject = str(body?.subject, 200) || "(no subject)";
    await db.insert(messages).values(recipients.map((r) => ({ fromAccountId: user.id, fromName: actorName(user), toAccountId: r.id, subject, body: text })));
    return c.json({ ok: true, sent: recipients.length }, 201);
  });

  app.post("/api/portal/messages/:id/read", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    await db.update(messages).set({ readAt: new Date() }).where(and(eq(messages.id, id), eq(messages.toAccountId, c.get("user").id), isNull(messages.readAt)));
    return c.json({ ok: true });
  });

  app.delete("/api/portal/messages/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    await db.delete(messages).where(and(eq(messages.id, id), eq(messages.toAccountId, c.get("user").id)));
    return c.json({ ok: true });
  });

  /* ------------------------------ Calendar ------------------------------ */

  app.get("/api/portal/events", async (c) => {
    const user = c.get("user");
    const since = new Date(Date.now() - 45 * 86400_000);
    const [rows, signups] = await Promise.all([
      db
        .select({
          id: events.id, title: events.title, description: events.description, kind: events.kind, location: events.location,
          startsAt: events.startsAt, endsAt: events.endsAt, audience: events.audience, unitId: events.unitId, unitName: divisions.name,
          allowSignup: events.allowSignup, createdBy: events.createdBy,
        })
        .from(events)
        .leftJoin(divisions, eq(events.unitId, divisions.id))
        .where(gte(events.startsAt, since))
        .orderBy(asc(events.startsAt)),
      db.select({ eventId: eventSignups.eventId, accountId: eventSignups.accountId, name: accounts.displayName }).from(eventSignups).innerJoin(accounts, eq(eventSignups.accountId, accounts.id)),
    ]);
    return c.json(
      rows.map((e) => {
        const list = signups.filter((s) => s.eventId === e.id);
        return { ...e, signups: list.length, signedUp: list.some((s) => s.accountId === user.id), attendees: can(user.role, ["training", "command", "content"]) ? list.map((s) => s.name) : undefined };
      }),
    );
  });

  app.post("/api/portal/events/:id/signup", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [evt] = await db.select().from(events).where(eq(events.id, id));
    if (!evt || !evt.allowSignup) return c.json({ error: "Sign-ups aren't open for this event" }, 400);
    await db.insert(eventSignups).values({ eventId: id, accountId: c.get("user").id }).onConflictDoNothing();
    return c.json({ ok: true });
  });

  app.delete("/api/portal/events/:id/signup", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    await db.delete(eventSignups).where(and(eq(eventSignups.eventId, id), eq(eventSignups.accountId, c.get("user").id)));
    return c.json({ ok: true });
  });

  /* ------------------------------ LOA & resignations ------------------------------ */

  app.get("/api/portal/requests", async (c) =>
    c.json(await db.select().from(personnelRequests).where(eq(personnelRequests.accountId, c.get("user").id)).orderBy(desc(personnelRequests.createdAt))),
  );

  app.post("/api/portal/requests", async (c) => {
    const user = c.get("user");
    const member = await memberForAccount(user.id);
    if (!member) return c.json({ error: "Your account isn't linked to a roster profile yet." }, 400);
    const body = await readJson(c);
    const kind = body?.kind === "Resignation" ? "Resignation" : body?.kind === "LOA" ? "LOA" : null;
    if (!kind) return c.json({ error: "Pick a request type" }, 400);
    const reason = str(body?.reason, 3000);
    const startDate = str(body?.startDate, 40);
    if (!reason) return c.json({ error: "Please give a reason" }, 400);
    if (!startDate) return c.json({ error: kind === "LOA" ? "Choose a start date" : "Choose your effective date" }, 400);
    const pending = await db
      .select({ id: personnelRequests.id })
      .from(personnelRequests)
      .where(and(eq(personnelRequests.accountId, user.id), eq(personnelRequests.kind, kind), eq(personnelRequests.status, "Pending")));
    if (pending.length) return c.json({ error: `You already have a pending ${kind === "LOA" ? "leave of absence" : "resignation"} request.` }, 400);
    const [row] = await db
      .insert(personnelRequests)
      .values({ kind, accountId: user.id, memberId: member.id, requesterName: `${member.rank} ${member.name}`.trim(), startDate, endDate: str(body?.endDate, 40), reason })
      .returning();
    const link = `${origin(c)}/admin/personnel`;
    await background(
      postEmbed("personnel", origin(c), {
        title: kind === "LOA" ? "Leave of Absence Request" : "Resignation Submitted",
        url: link,
        description: `**${row.requesterName}**${member.callsign ? ` (${member.callsign})` : ""}\n${reason}`,
        fields: [
          { name: kind === "LOA" ? "From" : "Effective", value: startDate, inline: true },
          ...(row.endDate ? [{ name: "Until", value: row.endDate, inline: true }] : []),
        ],
      }, { label: "Review request", url: link }),
    );
    return c.json(row, 201);
  });

  app.post("/api/portal/requests/:id/cancel", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [row] = await db
      .update(personnelRequests)
      .set({ status: "Cancelled", updatedAt: new Date() })
      .where(and(eq(personnelRequests.id, id), eq(personnelRequests.accountId, c.get("user").id), eq(personnelRequests.status, "Pending")))
      .returning();
    return row ? c.json(row) : c.json({ error: "Only pending requests can be cancelled" }, 400);
  });

  /** Officer returns early from an approved LOA. */
  app.post("/api/portal/return-from-loa", async (c) => {
    const user = c.get("user");
    const member = await memberForAccount(user.id);
    if (!member || member.status !== "LOA") return c.json({ error: "You're not currently on leave." }, 400);
    await db.update(rosterMembers).set({ status: "Active" }).where(eq(rosterMembers.id, member.id));
    await memberEvent(member.id, "Status", "Returned from leave of absence.", actorName(user));
    return c.json({ ok: true });
  });

  /* ------------------------------ Misconduct ------------------------------ */

  app.post("/api/portal/misconduct", async (c) => {
    const user = c.get("user");
    if (!throttle(`misconduct:${user.id}`, 10, 60 * 60_000)) return c.json({ error: "Too many reports. Try again later." }, 429);
    const { data, error } = parseFields(
      {
        officerName: { type: "string", required: true, max: 120 },
        officerBadge: { type: "string", max: 40 },
        incidentDate: { type: "string", max: 60 },
        location: { type: "string", max: 200 },
        category: { type: "string", oneOf: COMPLAINT_CATEGORIES },
        description: { type: "text", required: true, max: 6000 },
        evidence: { type: "text", max: 3000 },
      },
      await readJson(c),
    );
    if (error || !data) return c.json({ error }, 400);
    const member = await memberForAccount(user.id);
    const result = await fileComplaint(
      { ...data, complainantName: member ? `${member.rank} ${member.name}`.trim() : actorName(user), complainantDiscord: member?.discord ?? "", contact: `Trooper Portal: ${user.username}` },
      c.req.url,
      "internal",
      user.id,
    );
    return c.json({ ok: true, ...result }, 201);
  });

  /* ------------------------------ Leaderboard ------------------------------ */

  app.get("/api/portal/leaderboard", async (c) => {
    const days = Math.min(365, Math.max(1, Number.parseInt(c.req.query("days") ?? "30", 10) || 30));
    const since = new Date(Date.now() - days * 86400_000);
    const [roster, mins, reps, awards, certs] = await Promise.all([
      rosterQuery(sql`${rosterMembers.status} not in ('Resigned', 'Inactive')`),
      db.select({ id: activityLogs.memberId, n: sql<number>`coalesce(sum(${activityLogs.minutes}), 0)::int` }).from(activityLogs).where(gte(activityLogs.startedAt, since)).groupBy(activityLogs.memberId),
      db.select({ id: reports.authorMemberId, n: count() }).from(reports).where(and(gte(reports.createdAt, since), sql`${reports.status} <> 'Rejected'`)).groupBy(reports.authorMemberId),
      db.select({ id: commendations.memberId, n: count() }).from(commendations).where(gte(commendations.issuedAt, since)).groupBy(commendations.memberId),
      db.select({ id: trainingRecords.memberId, n: count() }).from(trainingRecords).where(and(gte(trainingRecords.issuedAt, since), eq(trainingRecords.result, "Passed"))).groupBy(trainingRecords.memberId),
    ]);
    const m = (rows: { id: number | null; n: number }[]) => new Map(rows.map((r) => [r.id, Number(r.n)]));
    const [mm, rm, am, cm] = [m(mins), m(reps), m(awards), m(certs)];
    const board = roster
      .map((r) => {
        const minutes = mm.get(r.id) ?? 0;
        const reportsFiled = rm.get(r.id) ?? 0;
        const commendationCount = am.get(r.id) ?? 0;
        const trainingPassed = cm.get(r.id) ?? 0;
        // One point per patrol hour, 3 per report, 10 per commendation, 5 per passed training.
        const score = Math.round(minutes / 60 + reportsFiled * 3 + commendationCount * 10 + trainingPassed * 5);
        return { ...publicMember(r), minutes, reports: reportsFiled, commendations: commendationCount, training: trainingPassed, score };
      })
      .sort((a, b) => b.score - a.score || b.minutes - a.minutes)
      .slice(0, 50);
    return c.json({ days, board });
  });

  /* ------------------------------ Search ------------------------------ */

  app.get("/api/portal/search", async (c) => {
    const user = c.get("user");
    const q = str(c.req.query("q"), 100);
    if (q.length < 2) return c.json({ members: [], reports: [], documents: [], announcements: [], pages: [] });
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    const seeRestricted = can(user.role, ["command", "ia"]);
    const [members, reps, docs, anns, pgs] = await Promise.all([
      rosterQuery(or(ilike(rosterMembers.name, like), ilike(rosterMembers.badgeNumber, like), ilike(rosterMembers.callsign, like), ilike(rosterMembers.rank, like))),
      db
        .select({ id: reports.id, number: reports.number, type: reports.type, title: reports.title, authorName: reports.authorName, status: reports.status, createdAt: reports.createdAt })
        .from(reports)
        .where(
          and(
            or(ilike(reports.number, like), ilike(reports.title, like), ilike(reports.involved, like), ilike(reports.narrative, like), ilike(reports.location, like), ilike(reports.authorName, like)),
            seeRestricted ? undefined : or(notInArray(reports.type, restrictedTypes), eq(reports.authorAccountId, user.id)),
          ),
        )
        .orderBy(desc(reports.createdAt))
        .limit(25),
      db.select().from(documents).where(or(ilike(documents.title, like), ilike(documents.description, like), ilike(documents.category, like))).limit(15),
      db.select({ id: announcements.id, title: announcements.title, createdAt: announcements.createdAt }).from(announcements).where(and(or(isNull(announcements.publishAt), lte(announcements.publishAt, new Date())), or(ilike(announcements.title, like), ilike(announcements.body, like)))).orderBy(desc(announcements.createdAt)).limit(10),
      db.select({ slug: pages.slug, title: pages.title }).from(pages).where(or(ilike(pages.title, like), ilike(pages.body, like))).limit(10),
    ]);
    return c.json({ members: members.slice(0, 25).map(publicMember), reports: reps, documents: docs, announcements: anns, pages: pgs });
  });

  /** Documents visible to signed-in staff (public + internal). */
  app.get("/api/portal/documents", async (c) =>
    c.json(await db.select().from(documents).orderBy(asc(documents.category), desc(documents.createdAt))),
  );

  /** Certificate data for a commendation or training record. Own records, or command/training staff. */
  app.get("/api/portal/certificate/:kind/:id", async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const kind = c.req.param("kind");
    const row =
      kind === "commendation"
        ? (await db.select().from(commendations).where(eq(commendations.id, id)))[0]
        : kind === "training"
          ? (await db.select().from(trainingRecords).where(eq(trainingRecords.id, id)))[0]
          : undefined;
    if (!row) return c.json({ error: "Not found" }, 404);
    const member = await memberById(row.memberId);
    if (!member) return c.json({ error: "Not found" }, 404);
    if (member.accountId !== user.id && !can(user.role, ["command", "training"])) return c.json({ error: "Not found" }, 404);
    return c.json({ kind, record: row, member: publicMember(member) });
  });

  /** Quick dashboard numbers for the portal home. */
  app.get("/api/portal/dashboard", async (c) => {
    const user = c.get("user");
    const member = await memberForAccount(user.id);
    await flushScheduledAnnouncements(origin(c));
    const [ann, upcoming, myReports, pendingReq] = await Promise.all([
      activeAnnouncements(["internal", "public"]).limit(5),
      db.select().from(events).where(gte(events.startsAt, new Date(Date.now() - 3600_000))).orderBy(asc(events.startsAt)).limit(5),
      db.select({ id: reports.id, number: reports.number, title: reports.title, status: reports.status, createdAt: reports.createdAt }).from(reports).where(eq(reports.authorAccountId, user.id)).orderBy(desc(reports.createdAt)).limit(5),
      db.select().from(personnelRequests).where(and(eq(personnelRequests.accountId, user.id), eq(personnelRequests.status, "Pending"))),
    ]);
    const week = new Date(Date.now() - 7 * 86400_000);
    const [mins] = member
      ? await db.select({ n: sql<number>`coalesce(sum(${activityLogs.minutes}), 0)::int` }).from(activityLogs).where(and(eq(activityLogs.memberId, member.id), gte(activityLogs.startedAt, week)))
      : [{ n: 0 }];
    return c.json({ announcements: ann, events: upcoming, reports: myReports, pendingRequests: pendingReq, minutesThisWeek: Number(mins.n) });
  });
}
