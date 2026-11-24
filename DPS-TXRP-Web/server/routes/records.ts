import type { Hono } from "hono";
import { and, asc, desc, eq, ilike, notInArray, or, type SQL } from "drizzle-orm";
import { db } from "../../db/index.js";
import { reports, rosterMembers, trainingCourses, trainingRecords } from "../../db/schema.js";
import { can, REPORT_STATUSES, REPORT_TYPES, reportType, TRAINING_RECORD_KINDS, TRAINING_RESULTS } from "../../shared/constants.js";
import { memberForAccount, requireAuth } from "../auth.js";
import { audit, memberEvent, notify } from "../audit.js";
import { postEmbed } from "../discord.js";
import { actorName, background, idParam, origin, readJson, str, type Env } from "../http.js";
import { maintenanceGate } from "../maintenance.js";
import { rosterQuery, publicMember } from "../queries.js";
import { parseFields } from "../validate.js";

const restrictedTypes = REPORT_TYPES.filter((t) => t.restricted).map((t) => t.key);

export function registerRecords(app: Hono<Env>) {
  /* ------------------------------ Reports ------------------------------ */

  app.use("/api/reports/*", requireAuth("officer"));
  app.use("/api/reports", requireAuth("officer"));
  app.use("/api/training/*", requireAuth("officer"));
  // Maintenance mode locks portal-side records for everyone below command staff.
  app.use("/api/reports/*", maintenanceGate());
  app.use("/api/reports", maintenanceGate());
  app.use("/api/training/*", maintenanceGate());

  app.get("/api/reports", async (c) => {
    const user = c.get("user");
    const q = str(c.req.query("q"), 100);
    const type = c.req.query("type");
    const status = c.req.query("status");
    const mine = c.req.query("mine") === "1";
    const conds: (SQL | undefined)[] = [];
    if (mine) conds.push(eq(reports.authorAccountId, user.id));
    if (type && reportType(type)) conds.push(eq(reports.type, type));
    if (status && REPORT_STATUSES.includes(status)) conds.push(eq(reports.status, status));
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      conds.push(or(ilike(reports.number, like), ilike(reports.title, like), ilike(reports.involved, like), ilike(reports.narrative, like), ilike(reports.location, like), ilike(reports.authorName, like)));
    }
    if (!can(user.role, ["command", "ia"])) conds.push(or(notInArray(reports.type, restrictedTypes), eq(reports.authorAccountId, user.id)));
    const rows = await db
      .select({ id: reports.id, number: reports.number, type: reports.type, title: reports.title, authorName: reports.authorName, location: reports.location, occurredAt: reports.occurredAt, status: reports.status, createdAt: reports.createdAt, authorAccountId: reports.authorAccountId })
      .from(reports)
      .where(and(...conds))
      .orderBy(desc(reports.createdAt))
      .limit(300);
    return c.json(rows);
  });

  const canSeeReport = (user: { id: number; role: string }, r: typeof reports.$inferSelect) =>
    r.authorAccountId === user.id || !restrictedTypes.includes(r.type) || can(user.role, ["command", "ia"]);

  app.get("/api/reports/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [r] = await db.select().from(reports).where(eq(reports.id, id));
    if (!r || !canSeeReport(c.get("user"), r)) return c.json({ error: "Not found" }, 404);
    return c.json(r);
  });

  const parseReport = (body: any) => {
    const t = reportType(String(body?.type ?? ""));
    if (!t) return { error: "Pick a report type" };
    const title = str(body?.title, 200);
    if (!title) return { error: "Give the report a title" };
    const details: Record<string, string> = {};
    for (const f of t.fields) {
      details[f.key] = str(body?.details?.[f.key], f.long ? 4000 : 300);
      if (f.required && !details[f.key]) return { error: `${f.label} is required` };
      if (f.options && details[f.key] && !f.options.includes(details[f.key])) return { error: `${f.label} is invalid` };
    }
    const narrative = str(body?.narrative, 20000);
    if (!narrative) return { error: "Write the narrative" };
    return {
      type: t,
      data: { type: t.key, title, details, narrative, occurredAt: str(body?.occurredAt, 60), location: str(body?.location, 200), involved: str(body?.involved, 2000) },
    };
  };

  app.post("/api/reports", async (c) => {
    const user = c.get("user");
    const parsed = parseReport(await readJson(c));
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const member = await memberForAccount(user.id);
    const authorName = member ? [member.rank, member.name].filter(Boolean).join(" ") + (member.badgeNumber ? ` #${member.badgeNumber}` : "") : actorName(user);
    const [row] = await db
      .insert(reports)
      .values({ ...parsed.data, number: `TMP-${crypto.randomUUID()}`, authorAccountId: user.id, authorMemberId: member?.id ?? null, authorName })
      .returning();
    const number = `${parsed.type.prefix}-${new Date().getFullYear()}-${String(row.id).padStart(5, "0")}`;
    const [saved] = await db.update(reports).set({ number }).where(eq(reports.id, row.id)).returning();
    if (parsed.type.restricted) {
      const link = `${origin(c)}/portal/reports/${saved.id}`;
      await background(postEmbed("personnel", origin(c), { title: `${parsed.type.label} filed · ${number}`, url: link, description: `${authorName}\n${saved.title}` }, { label: "Open report", url: link }));
    }
    return c.json(saved, 201);
  });

  app.put("/api/reports/:id", async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [r] = await db.select().from(reports).where(eq(reports.id, id));
    if (!r || r.authorAccountId !== user.id) return c.json({ error: "Only the author can edit this report" }, 403);
    if (r.status === "Approved") return c.json({ error: "Approved reports are locked" }, 400);
    const parsed = parseReport({ ...(await readJson(c)), type: r.type });
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const [saved] = await db.update(reports).set({ ...parsed.data, status: "Submitted", updatedAt: new Date() }).where(eq(reports.id, id)).returning();
    return c.json(saved);
  });

  app.post("/api/reports/:id/review", requireAuth("command"), async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const body = await readJson(c);
    const status = String(body?.status ?? "");
    if (!REPORT_STATUSES.includes(status)) return c.json({ error: "Pick a valid status" }, 400);
    const [saved] = await db
      .update(reports)
      .set({ status, reviewNote: str(body?.note, 2000), reviewedBy: actorName(user), updatedAt: new Date() })
      .where(eq(reports.id, id))
      .returning();
    if (!saved) return c.json({ error: "Not found" }, 404);
    if (saved.authorAccountId)
      await notify(saved.authorAccountId, `Report ${saved.number}: ${status}`, saved.reviewNote, `/portal/reports/${saved.id}`);
    await audit(user, `Reviewed report (${status})`, saved.number);
    return c.json(saved);
  });

  app.delete("/api/reports/:id", requireAuth("admin"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [r] = await db.delete(reports).where(eq(reports.id, id)).returning();
    if (r) await audit(c.get("user"), "Deleted report", r.number);
    return c.json({ ok: true });
  });

  /* ------------------------------ Training academy ------------------------------ */

  const publicCourse = (course: typeof trainingCourses.$inferSelect, withAnswers: boolean) => ({
    ...course,
    questionCount: course.questions.length,
    questions: withAnswers ? course.questions : course.questions.map(({ q, options }) => ({ q, options })),
  });

  app.get("/api/training/courses", async (c) => {
    const staff = can(c.get("user").role, "training");
    const rows = await db
      .select()
      .from(trainingCourses)
      .where(staff ? undefined : eq(trainingCourses.published, true))
      .orderBy(asc(trainingCourses.sortOrder), asc(trainingCourses.id));
    return c.json(rows.map((r) => ({ ...publicCourse(r, false), questions: undefined, content: undefined })));
  });

  app.get("/api/training/courses/:id", async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [course] = await db.select().from(trainingCourses).where(eq(trainingCourses.id, id));
    const staff = can(c.get("user").role, "training");
    if (!course || (!course.published && !staff)) return c.json({ error: "Not found" }, 404);
    const member = await memberForAccount(c.get("user").id);
    const attempts = member
      ? await db.select().from(trainingRecords).where(and(eq(trainingRecords.memberId, member.id), eq(trainingRecords.courseId, id))).orderBy(desc(trainingRecords.issuedAt))
      : [];
    return c.json({ course: publicCourse(course, false), attempts });
  });

  /** Grades a written exam and records the result on the officer's training file. */
  app.post("/api/training/courses/:id/exam", async (c) => {
    const user = c.get("user");
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [course] = await db.select().from(trainingCourses).where(and(eq(trainingCourses.id, id), eq(trainingCourses.published, true)));
    if (!course || course.questions.length === 0) return c.json({ error: "This course has no written exam" }, 400);
    const member = await memberForAccount(user.id);
    if (!member) return c.json({ error: "Your account isn't linked to a roster profile, so your result can't be recorded." }, 400);
    const recent = await db
      .select()
      .from(trainingRecords)
      .where(and(eq(trainingRecords.memberId, member.id), eq(trainingRecords.courseId, id), eq(trainingRecords.kind, "Written Exam")))
      .orderBy(desc(trainingRecords.issuedAt))
      .limit(1);
    if (recent[0] && Date.now() - new Date(recent[0].issuedAt).getTime() < 10 * 60_000)
      return c.json({ error: "Please wait 10 minutes between exam attempts." }, 429);
    const body = await readJson(c);
    const given: unknown[] = Array.isArray(body?.answers) ? body.answers : [];
    const correct = course.questions.reduce((n, q, i) => n + (Number(given[i]) === q.answer ? 1 : 0), 0);
    const score = Math.round((correct / course.questions.length) * 100);
    const passed = score >= course.passingScore;
    const [record] = await db
      .insert(trainingRecords)
      .values({
        memberId: member.id,
        courseId: id,
        title: `${course.title} — Written Exam`,
        kind: "Written Exam",
        result: passed ? "Passed" : "Failed",
        score,
        instructor: "Online exam",
        certification: passed ? course.certification : "",
      })
      .returning();
    if (passed) await memberEvent(member.id, "Training", `Passed ${course.title} written exam (${score}%).${course.certification ? ` Certified: ${course.certification}.` : ""}`, "Training Academy");
    return c.json({ score, passed, correct, total: course.questions.length, passingScore: course.passingScore, record });
  });

  app.get("/api/training/instructors", async (c) => {
    const roster = await rosterQuery(eq(rosterMembers.isInstructor, true));
    return c.json(roster.map(publicMember));
  });

  app.get("/api/training/records", async (c) => {
    const user = c.get("user");
    if (c.req.query("all") === "1" && can(user.role, "training")) {
      const rows = await db
        .select({ record: trainingRecords, memberName: rosterMembers.name, memberRank: rosterMembers.rank, badgeNumber: rosterMembers.badgeNumber })
        .from(trainingRecords)
        .innerJoin(rosterMembers, eq(trainingRecords.memberId, rosterMembers.id))
        .orderBy(desc(trainingRecords.issuedAt))
        .limit(500);
      return c.json(rows.map((r) => ({ ...r.record, memberName: r.memberName, memberRank: r.memberRank, badgeNumber: r.badgeNumber })));
    }
    const member = await memberForAccount(user.id);
    if (!member) return c.json([]);
    return c.json(await db.select().from(trainingRecords).where(eq(trainingRecords.memberId, member.id)).orderBy(desc(trainingRecords.issuedAt)));
  });

  /** Instructors log practical evaluations, course completions and certifications. */
  app.post("/api/training/records", requireAuth("training"), async (c) => {
    const user = c.get("user");
    const { data, error } = parseFields(
      {
        memberId: { type: "int", required: true },
        courseId: { type: "intOrNull" },
        title: { type: "string", required: true, max: 200 },
        kind: { type: "string", oneOf: TRAINING_RECORD_KINDS },
        result: { type: "string", oneOf: TRAINING_RESULTS },
        score: { type: "intOrNull" },
        instructor: { type: "string", max: 120 },
        notes: { type: "text", max: 3000 },
        certification: { type: "string", max: 120 },
        expiresAt: { type: "dateOrNull" },
      },
      await readJson(c),
    );
    if (error || !data) return c.json({ error }, 400);
    const [member] = await db.select().from(rosterMembers).where(eq(rosterMembers.id, data.memberId as number));
    if (!member) return c.json({ error: "Trooper not found" }, 400);
    if (!data.instructor) data.instructor = actorName(user);
    const [row] = await db.insert(trainingRecords).values(data as any).returning();
    await memberEvent(member.id, "Training", `${row.kind}: ${row.title} — ${row.result}${row.score != null ? ` (${row.score}%)` : ""}${row.certification ? `. Certified: ${row.certification}` : ""}.`, actorName(user));
    if (member.accountId) await notify(member.accountId, `Training record added: ${row.title}`, row.result, "/portal/training");
    await audit(user, "Added training record", `${member.name}: ${row.title}`);
    return c.json(row, 201);
  });

  app.delete("/api/training/records/:id", requireAuth("training"), async (c) => {
    const id = idParam(c);
    if (id === null) return c.json({ error: "Not found" }, 404);
    const [r] = await db.delete(trainingRecords).where(eq(trainingRecords.id, id)).returning();
    if (r) await audit(c.get("user"), "Deleted training record", r.title);
    return c.json({ ok: true });
  });
}
