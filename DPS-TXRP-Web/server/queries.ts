import { and, asc, eq, gte, inArray, isNull, lte, or, sql, desc, count, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  activityLogs, announcements, commendations, disciplinaryRecords, divisions, evaluations, memberEvents,
  personnelRequests, ranks, reports, rosterDividers, rosterMembers, trainingRecords, unitMembers,
} from "../db/schema.js";

export const memberColumns = {
  id: rosterMembers.id,
  name: rosterMembers.name,
  rank: rosterMembers.rank,
  badgeNumber: rosterMembers.badgeNumber,
  callsign: rosterMembers.callsign,
  divisionId: rosterMembers.divisionId,
  divisionName: divisions.name,
  dividerId: rosterMembers.dividerId,
  dividerName: rosterDividers.label,
  dividerSort: rosterDividers.sortOrder,
  status: rosterMembers.status,
  discord: rosterMembers.discord,
  sortOrder: rosterMembers.sortOrder,
  joinedAt: rosterMembers.joinedAt,
  accountId: rosterMembers.accountId,
  photoKey: rosterMembers.photoKey,
  bio: rosterMembers.bio,
  dutyStatus: rosterMembers.dutyStatus,
  dutyUpdatedAt: rosterMembers.dutyUpdatedAt,
  featured: rosterMembers.featured,
  isInstructor: rosterMembers.isInstructor,
  cardTheme: rosterMembers.cardTheme,
};

/** Roster joined with division, ordered by rank seniority then sort order. */
export const rosterQuery = (where?: SQL) =>
  db
    .select({ ...memberColumns, rankOrder: ranks.sortOrder, rankTier: ranks.tier })
    .from(rosterMembers)
    .leftJoin(divisions, eq(rosterMembers.divisionId, divisions.id))
    .leftJoin(rosterDividers, eq(rosterMembers.dividerId, rosterDividers.id))
    .leftJoin(ranks, sql`lower(${ranks.name}) = lower(${rosterMembers.rank})`)
    .where(where)
    .orderBy(asc(sql`coalesce(${ranks.sortOrder}, 100000)`), asc(rosterMembers.sortOrder), asc(rosterMembers.id));

export type MemberRow = Awaited<ReturnType<typeof rosterQuery>>[number];

/** Strips staff-only fields before sending a member to the public site. */
export const publicMember = ({ discord: _d, accountId: _a, ...m }: MemberRow) => m;

export const activeAnnouncements = (audiences: string[]) =>
  db
    .select({
      id: announcements.id,
      title: announcements.title,
      body: announcements.body,
      audience: announcements.audience,
      priority: announcements.priority,
      pinned: announcements.pinned,
      unitId: announcements.unitId,
      unitName: divisions.name,
      authorName: announcements.authorName,
      createdAt: announcements.createdAt,
      expiresAt: announcements.expiresAt,
    })
    .from(announcements)
    .leftJoin(divisions, eq(announcements.unitId, divisions.id))
    .where(
      and(
        inArray(announcements.audience, audiences),
        or(isNull(announcements.expiresAt), gte(announcements.expiresAt, new Date())),
        // Scheduled announcements stay hidden until their publication time.
        or(isNull(announcements.publishAt), lte(announcements.publishAt, new Date())),
      ),
    )
    .orderBy(desc(announcements.pinned), desc(announcements.createdAt));

/** Department statistics for the home page and dashboards. */
export async function departmentStats() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [[officers], [onDuty], [units], [reportsFiled], [minutes]] = await Promise.all([
    db.select({ n: count() }).from(rosterMembers).where(sql`${rosterMembers.status} not in ('Resigned', 'Inactive')`),
    db.select({ n: count() }).from(rosterMembers).where(sql`${rosterMembers.dutyStatus} <> 'Off Duty'`),
    db.select({ n: count() }).from(divisions),
    db.select({ n: count() }).from(reports),
    db
      .select({ n: sql<number>`coalesce(sum(${activityLogs.minutes}), 0)::int` })
      .from(activityLogs)
      .where(gte(activityLogs.startedAt, since)),
  ]);
  return {
    officers: officers.n,
    onDuty: onDuty.n,
    units: units.n,
    reportsFiled: reportsFiled.n,
    hoursPatrolled30d: Math.round(Number(minutes.n) / 60),
  };
}

/** Members of a unit: explicit unit memberships plus anyone whose primary assignment is the unit. */
export async function unitRoster(unitId: number) {
  const [explicit, roster] = await Promise.all([
    db
      .select({ id: unitMembers.id, memberId: unitMembers.memberId, position: unitMembers.position, isLeader: unitMembers.isLeader, sortOrder: unitMembers.sortOrder })
      .from(unitMembers)
      .where(eq(unitMembers.unitId, unitId))
      .orderBy(desc(unitMembers.isLeader), asc(unitMembers.sortOrder), asc(unitMembers.id)),
    rosterQuery(),
  ]);
  const byId = new Map(roster.map((m) => [m.id, m]));
  const seen = new Set<number>();
  const out: (MemberRow & { position: string; isLeader: boolean; membershipId: number | null })[] = [];
  for (const e of explicit) {
    const m = byId.get(e.memberId);
    if (!m) continue;
    seen.add(m.id);
    out.push({ ...m, position: e.position, isLeader: e.isLeader, membershipId: e.id });
  }
  for (const m of roster)
    if (m.divisionId === unitId && !seen.has(m.id)) out.push({ ...m, position: "Member", isLeader: false, membershipId: null });
  return out;
}

/** Everything in an officer's personnel file. */
export async function personnelFile(memberId: number) {
  const [training, evals, awards, discipline, timeline, units, requests, shifts, [total]] = await Promise.all([
    db.select().from(trainingRecords).where(eq(trainingRecords.memberId, memberId)).orderBy(desc(trainingRecords.issuedAt)),
    db.select().from(evaluations).where(eq(evaluations.memberId, memberId)).orderBy(desc(evaluations.createdAt)),
    db.select().from(commendations).where(eq(commendations.memberId, memberId)).orderBy(desc(commendations.issuedAt)),
    db.select().from(disciplinaryRecords).where(eq(disciplinaryRecords.memberId, memberId)).orderBy(desc(disciplinaryRecords.issuedAt)),
    db.select().from(memberEvents).where(eq(memberEvents.memberId, memberId)).orderBy(desc(memberEvents.createdAt)).limit(100),
    db
      .select({ id: unitMembers.id, unitId: unitMembers.unitId, unitName: divisions.name, unitCode: divisions.code, position: unitMembers.position, isLeader: unitMembers.isLeader })
      .from(unitMembers)
      .innerJoin(divisions, eq(unitMembers.unitId, divisions.id))
      .where(eq(unitMembers.memberId, memberId)),
    db.select().from(personnelRequests).where(eq(personnelRequests.memberId, memberId)).orderBy(desc(personnelRequests.createdAt)).limit(30),
    db.select().from(activityLogs).where(eq(activityLogs.memberId, memberId)).orderBy(desc(activityLogs.startedAt)).limit(50),
    db.select({ n: sql<number>`coalesce(sum(${activityLogs.minutes}), 0)::int` }).from(activityLogs).where(eq(activityLogs.memberId, memberId)),
  ]);
  const totalMinutes = Number(total.n);
  return { training, evaluations: evals, commendations: awards, discipline, timeline, units, requests, shifts, totalMinutes };
}

export async function memberById(id: number) {
  const rows = await rosterQuery(eq(rosterMembers.id, id));
  return rows[0] ?? null;
}
