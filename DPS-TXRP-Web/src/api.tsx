export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T = any>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  return data as T;
}

export async function uploadFile(file: File, opts: { image?: boolean; internal?: boolean } = {}) {
  const form = new FormData();
  form.append("file", file);
  const q = new URLSearchParams();
  if (opts.image) q.set("kind", "image");
  if (opts.internal) q.set("internal", "1");
  const res = await fetch(`/api/admin/uploads?${q}`, { method: "POST", body: form, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || "Upload failed", res.status);
  return data as { key: string; filename: string; url: string };
}

export const fileUrl = (key?: string | null) => (key ? `/api/files/${key}` : "");

export const formatDate = (v: string | Date | null | undefined, withTime = false) => {
  if (!v) return "—";
  const d = new Date(v);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
};

export type Division = { id: number; name: string; code: string; summary: string; description: string; requirements: string; imageKey: string | null; sortOrder: number };
export type RosterMember = {
  id: number; name: string; rank: string; badgeNumber: string; callsign: string; divisionId: number | null; divisionName?: string | null;
  dividerId?: number | null; dividerName?: string | null; dividerSort?: number | null;
  status: string; discord?: string; sortOrder: number; joinedAt: string; accountId?: number | null; photoKey: string | null; bio: string;
  dutyStatus: string; dutyUpdatedAt: string | null; featured: boolean; isInstructor: boolean; cardTheme: string; rankOrder?: number | null; rankTier?: string | null;
  position?: string; isLeader?: boolean; membershipId?: number | null;
};
export type Leader = { id: number; name: string; title: string; bio: string; imageKey: string | null; sortOrder: number };
export type RosterDivider = { id: number; label: string; sortOrder: number };
export type NewsPost = { id: number; title: string; category: string; summary: string; body: string; imageKey: string | null; published: boolean; publishedAt: string };
export type Doc = { id: number; title: string; category: string; description: string; fileKey: string | null; externalUrl: string | null; visibility: string; createdAt: string };
export type Complaint = {
  id: number; caseNumber: string; complainantName: string; complainantDiscord: string; complainantRoblox: string; contact: string;
  officerName: string; officerBadge: string; incidentDate: string; location: string; category: string; description: string; evidence: string;
  status: string; assignedTo: string; webhookStatus: string; createdAt: string; updatedAt: string;
  source: string; reporterAccountId: number | null; subjectMemberId: number | null; priority: string; findings: string;
  confidential: boolean; reviewStatus: string; requestedStatus: string; reviewNote: string; reviewedAt: string | null;
};
export type Me = { id: number; username: string; displayName: string; role: string };
export type Rank = { id: number; name: string; abbreviation: string; tier: string; description: string; grantsRole: string | null; sortOrder: number; members?: number };
export type Announcement = { id: number; title: string; body: string; audience: string; priority: string; pinned: boolean; unitId: number | null; unitName?: string | null; authorName: string; createdAt: string; expiresAt: string | null; publishAt: string | null; publishedAt?: string | null };
export type CustomRole = { id: number; key: string; label: string; perms: string[]; createdAt: string };
export type LoginEvent = { id: number; accountId: number | null; username: string; success: boolean; ip: string; userAgent: string; createdAt: string };
export type CalEvent = { id: number; title: string; description: string; kind: string; location: string; startsAt: string; endsAt: string | null; audience: string; unitId: number | null; unitName?: string | null; allowSignup: boolean; signups?: number; signedUp?: boolean; attendees?: string[] };
export type Stats = { officers: number; onDuty: number; units: number; reportsFiled: number; hoursPatrolled30d: number };
export type Page = { slug: string; title: string; body: string; updatedBy: string; updatedAt: string };
export type Faq = { id: number; question: string; answer: string; category: string; sortOrder: number };
export type TrainingRecord = { id: number; memberId: number; courseId: number | null; title: string; kind: string; result: string; score: number | null; instructor: string; notes: string; certification: string; issuedAt: string; expiresAt: string | null; memberName?: string; memberRank?: string; badgeNumber?: string };
export type Commendation = { id: number; memberId: number; title: string; kind: string; description: string; issuedBy: string; issuedAt: string };
export type Evaluation = { id: number; memberId: number; evaluator: string; period: string; ratings: Record<string, number>; overall: number; strengths: string; improvements: string; comments: string; createdAt: string };
export type Discipline = { id: number; memberId: number; complaintId: number | null; action: string; reason: string; issuedBy: string; issuedAt: string; expiresAt: string | null; memberName?: string; memberRank?: string; badgeNumber?: string; caseNumber?: string | null };
export type MemberEvent = { id: number; kind: string; body: string; actor: string; createdAt: string };
export type PersonnelRequest = { id: number; kind: string; accountId: number | null; memberId: number | null; requesterName: string; startDate: string; endDate: string; reason: string; status: string; reviewedBy: string; reviewNote: string; createdAt: string };
export type Shift = { id: number; memberId: number; startedAt: string; endedAt: string | null; minutes: number; notes: string };
export type PersonnelFile = {
  member: RosterMember | null; training: TrainingRecord[]; evaluations: Evaluation[]; commendations: Commendation[]; discipline: Discipline[];
  timeline: MemberEvent[]; units: { id: number; unitId: number; unitName: string; unitCode: string; position: string; isLeader: boolean }[];
  requests: PersonnelRequest[]; shifts: Shift[]; totalMinutes: number;
};
export type Report = {
  id: number; number: string; type: string; authorAccountId: number | null; authorName: string; title: string; occurredAt: string; location: string;
  involved: string; details: Record<string, string>; narrative: string; status: string; reviewedBy: string; reviewNote: string; createdAt: string; updatedAt: string;
};
export type Course = { id: number; title: string; category: string; summary: string; content?: string; fileKey: string | null; certification: string; passingScore: number; questions?: { q: string; options: string[]; answer?: number }[]; questionCount: number; published: boolean; sortOrder: number };

export * from "../shared/constants";

import { registerCustomRole as registerRolePerms, registerCustomRoleLabel as registerRoleLabel, resetCustomRoles } from "../shared/constants";

/** Loads custom roles into the client-side permission registry. */
export function hydrateCustomRoles(rows: CustomRole[]) {
  resetCustomRoles();
  for (const row of rows) {
    registerRolePerms(row.key, row.perms ?? []);
    registerRoleLabel(row.key, row.label);
  }
}

export const hours = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export const timeAgo = (v: string | Date | null | undefined) => {
  if (!v) return "—";
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return formatDate(v);
};

export function statusTone(status: string) {
  if (["Open", "Submitted", "Pending", "New", "LOA", "Reserve", "Probation", "Busy", "Break"].includes(status)) return "gold";
  if (["Under Investigation", "Under Review", "Interview Scheduled", "In Progress", "Responding", "In Training", "Needs Revision"].includes(status)) return "blue";
  if (["Sustained", "Denied", "Rejected", "Suspended", "Inactive", "Resigned", "Failed", "Critical", "Urgent"].includes(status)) return "red";
  if (["Not Sustained", "Unfounded", "Exonerated", "Closed", "Accepted", "Approved", "Passed", "Active", "On Duty", "On Patrol", "Responded"].includes(status)) return "green";
  return "";
}

export const Pill = ({ s }: { s: string }) => <span className={`pill ${statusTone(s)}`}>{s}</span>;
