import { pgTable, serial, text, timestamp, integer, boolean, jsonb, unique } from "drizzle-orm/pg-core";

// Staff accounts that can sign in to the admin panel.
// role: "owner" can manage accounts and settings; "admin" manages site content.
export const accounts = pgTable("accounts", {
  id: serial().primaryKey(),
  username: text().notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  passwordHash: text("password_hash").notNull(),
  role: text().notNull().default("admin"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  notificationsSeenAt: timestamp("notifications_seen_at", { withTimezone: true }),
  disabled: boolean().notNull().default(false),
  // Temporary suspension: portal access is blocked until this time (null = not suspended).
  suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
  suspendedReason: text("suspended_reason").notNull().default(""),
});

// Record of every sign-in attempt, successful or not.
export const loginEvents = pgTable("login_events", {
  id: serial().primaryKey(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  username: text().notNull().default(""),
  success: boolean().notNull().default(false),
  ip: text().notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Custom admin roles ("Training Director", …). Accounts reference them as role = "custom:<key>".
export const customRoles = pgTable("custom_roles", {
  id: serial().primaryKey(),
  key: text().notNull(),
  label: text().notNull(),
  perms: jsonb().$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const divisions = pgTable("divisions", {
  id: serial().primaryKey(),
  name: text().notNull(),
  code: text().notNull().default(""),
  summary: text().notNull().default(""),
  description: text().notNull().default(""),
  imageKey: text("image_key"),
  requirements: text().notNull().default(""),
  acceptingApplications: boolean("accepting_applications").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Custom section headings ("dividers") that group members on the public roster.
export const rosterDividers = pgTable("roster_dividers", {
  id: serial().primaryKey(),
  label: text().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const rosterMembers = pgTable("roster_members", {
  id: serial().primaryKey(),
  name: text().notNull(),
  rank: text().notNull().default(""),
  badgeNumber: text("badge_number").notNull().default(""),
  callsign: text().notNull().default(""),
  divisionId: integer("division_id").references(() => divisions.id, { onDelete: "set null" }),
  // Optional custom roster divider; members with one are grouped under its label.
  dividerId: integer("divider_id").references(() => rosterDividers.id, { onDelete: "set null" }),
  status: text().notNull().default("Active"),
  discord: text().notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  joinedAt: text("joined_at").notNull().default(""),
  accountId: integer("account_id").unique().references((): any => accounts.id, { onDelete: "set null" }),
  photoKey: text("photo_key"),
  bio: text().notNull().default(""),
  dutyStatus: text("duty_status").notNull().default("Off Duty"),
  dutyUpdatedAt: timestamp("duty_updated_at", { withTimezone: true }),
  featured: boolean().notNull().default(false),
  isInstructor: boolean("is_instructor").notNull().default(false),
  cardTheme: text("card_theme").notNull().default("classic"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const leaders = pgTable("leaders", {
  id: serial().primaryKey(),
  name: text().notNull(),
  title: text().notNull().default(""),
  bio: text().notNull().default(""),
  imageKey: text("image_key"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const news = pgTable("news", {
  id: serial().primaryKey(),
  title: text().notNull(),
  category: text().notNull().default("Press Release"),
  summary: text().notNull().default(""),
  body: text().notNull().default(""),
  imageKey: text("image_key"),
  published: boolean().notNull().default(true),
  authorId: integer("author_id").references(() => accounts.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: serial().primaryKey(),
  title: text().notNull(),
  category: text().notNull().default("General"),
  description: text().notNull().default(""),
  fileKey: text("file_key"),
  externalUrl: text("external_url"),
  // Department documents are staff-only ("internal"): shown in the Trooper Portal, never on the public site.
  visibility: text().notNull().default("internal"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Metadata for files stored in Netlify Blobs (images and documents).
export const uploads = pgTable("uploads", {
  id: serial().primaryKey(),
  key: text().notNull().unique(),
  filename: text().notNull(),
  contentType: text("content_type").notNull(),
  size: integer().notNull(),
  // Internal files can only be downloaded by signed-in staff.
  internal: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const complaints = pgTable("complaints", {
  id: serial().primaryKey(),
  caseNumber: text("case_number").notNull().unique(),
  complainantName: text("complainant_name").notNull(),
  complainantDiscord: text("complainant_discord").notNull().default(""),
  complainantRoblox: text("complainant_roblox").notNull().default(""),
  contact: text().notNull().default(""),
  officerName: text("officer_name").notNull().default(""),
  officerBadge: text("officer_badge").notNull().default(""),
  incidentDate: text("incident_date").notNull().default(""),
  location: text().notNull().default(""),
  category: text().notNull().default("Misconduct"),
  description: text().notNull(),
  evidence: text().notNull().default(""),
  status: text().notNull().default("Open"),
  assignedTo: text("assigned_to").notNull().default(""),
  webhookStatus: text("webhook_status").notNull().default("pending"),
  // "public" = website complaint form, "internal" = misconduct reported by an officer.
  source: text().notNull().default("public"),
  reporterAccountId: integer("reporter_account_id").references(() => accounts.id, { onDelete: "set null" }),
  subjectMemberId: integer("subject_member_id").references(() => rosterMembers.id, { onDelete: "set null" }),
  priority: text().notNull().default("Normal"),
  findings: text().notNull().default(""),
  // Secret code given to the complainant so they can check the status of their case.
  trackingCode: text("tracking_code").notNull().default(""),
  // Confidential cases are restricted to command staff and the assigned investigator.
  confidential: boolean("confidential").notNull().default(false),
  // Command review gate: "" = no review needed, "pending" = closure awaiting command approval.
  reviewStatus: text("review_status").notNull().default(""),
  requestedStatus: text("requested_status").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  reviewedByAccountId: integer("reviewed_by_account_id").references(() => accounts.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const complaintNotes = pgTable("complaint_notes", {
  id: serial().primaryKey(),
  complaintId: integer("complaint_id").notNull().references(() => complaints.id, { onDelete: "cascade" }),
  author: text().notNull(),
  body: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Key/value site settings (Discord webhook URL, etc.).
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Department platform (portal, training, records…)                    */
/* ------------------------------------------------------------------ */

// Rank ladder. Lower sortOrder = more senior. grantsRole is applied to the linked
// account automatically on promotion/demotion ("automatic rank permissions").
export const ranks = pgTable("ranks", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  abbreviation: text().notNull().default(""),
  tier: text().notNull().default("Trooper"),
  description: text().notNull().default(""),
  grantsRole: text("grants_role"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Editable informational pages (history, mission, SOPs, uniform policy…).
export const pages = pgTable("pages", {
  slug: text().primaryKey(),
  title: text().notNull(),
  body: text().notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const unitMembers = pgTable(
  "unit_members",
  {
    id: serial().primaryKey(),
    unitId: integer("unit_id").notNull().references(() => divisions.id, { onDelete: "cascade" }),
    memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
    position: text().notNull().default("Member"),
    isLeader: boolean("is_leader").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("unit_members_unit_member").on(t.unitId, t.memberId)],
);

export const announcements = pgTable("announcements", {
  id: serial().primaryKey(),
  title: text().notNull(),
  body: text().notNull().default(""),
  // "public" shows on the home page; "internal" only in the Officer Portal.
  audience: text().notNull().default("internal"),
  priority: text().notNull().default("Normal"),
  pinned: boolean().notNull().default(false),
  unitId: integer("unit_id").references(() => divisions.id, { onDelete: "set null" }),
  authorId: integer("author_id").references(() => accounts.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Scheduled publication: hidden until this time, then announced once (publishedAt marks it done).
  publishAt: timestamp("publish_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const events = pgTable("events", {
  id: serial().primaryKey(),
  title: text().notNull(),
  description: text().notNull().default(""),
  kind: text().notNull().default("Meeting"),
  location: text().notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  audience: text().notNull().default("internal"),
  unitId: integer("unit_id").references(() => divisions.id, { onDelete: "set null" }),
  allowSignup: boolean("allow_signup").notNull().default(false),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const eventSignups = pgTable(
  "event_signups",
  {
    id: serial().primaryKey(),
    eventId: integer("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    accountId: integer("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("event_signups_event_account").on(t.eventId, t.accountId)],
);

// accountId null = department-wide notification.
export const notifications = pgTable("notifications", {
  id: serial().primaryKey(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  title: text().notNull(),
  body: text().notNull().default(""),
  link: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial().primaryKey(),
  fromAccountId: integer("from_account_id").references(() => accounts.id, { onDelete: "set null" }),
  fromName: text("from_name").notNull().default(""),
  toAccountId: integer("to_account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  subject: text().notNull().default(""),
  body: text().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const reports = pgTable("reports", {
  id: serial().primaryKey(),
  number: text().notNull().unique(),
  type: text().notNull(),
  authorAccountId: integer("author_account_id").references(() => accounts.id, { onDelete: "set null" }),
  authorMemberId: integer("author_member_id").references(() => rosterMembers.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull().default(""),
  title: text().notNull(),
  occurredAt: text("occurred_at").notNull().default(""),
  location: text().notNull().default(""),
  involved: text().notNull().default(""),
  details: jsonb().$type<Record<string, string>>().notNull().default({}),
  narrative: text().notNull().default(""),
  status: text().notNull().default("Submitted"),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Duty shifts (on-duty → off-duty). Feeds activity logs and the leaderboard.
export const activityLogs = pgTable("activity_logs", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  minutes: integer().notNull().default(0),
  notes: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trainingCourses = pgTable("training_courses", {
  id: serial().primaryKey(),
  title: text().notNull(),
  category: text().notNull().default("General"),
  summary: text().notNull().default(""),
  content: text().notNull().default(""),
  fileKey: text("file_key"),
  certification: text().notNull().default(""),
  passingScore: integer("passing_score").notNull().default(80),
  questions: jsonb().$type<{ q: string; options: string[]; answer: number }[]>().notNull().default([]),
  published: boolean().notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trainingRecords = pgTable("training_records", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  courseId: integer("course_id").references(() => trainingCourses.id, { onDelete: "set null" }),
  title: text().notNull(),
  kind: text().notNull().default("Course"),
  result: text().notNull().default("Passed"),
  score: integer(),
  instructor: text().notNull().default(""),
  notes: text().notNull().default(""),
  certification: text().notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const evaluations = pgTable("evaluations", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  evaluator: text().notNull().default(""),
  period: text().notNull().default(""),
  ratings: jsonb().$type<Record<string, number>>().notNull().default({}),
  overall: integer().notNull().default(3),
  strengths: text().notNull().default(""),
  improvements: text().notNull().default(""),
  comments: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const commendations = pgTable("commendations", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  title: text().notNull(),
  kind: text().notNull().default("Commendation"),
  description: text().notNull().default(""),
  issuedBy: text("issued_by").notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const disciplinaryRecords = pgTable("disciplinary_records", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  complaintId: integer("complaint_id").references(() => complaints.id, { onDelete: "set null" }),
  action: text().notNull(),
  reason: text().notNull().default(""),
  issuedBy: text("issued_by").notNull().default(""),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// LOA requests and resignations.
export const personnelRequests = pgTable("personnel_requests", {
  id: serial().primaryKey(),
  kind: text().notNull(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  memberId: integer("member_id").references(() => rosterMembers.id, { onDelete: "cascade" }),
  requesterName: text("requester_name").notNull().default(""),
  startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""),
  reason: text().notNull().default(""),
  status: text().notNull().default("Pending"),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Personnel file timeline: promotions, transfers, awards, discipline…
export const memberEvents = pgTable("member_events", {
  id: serial().primaryKey(),
  memberId: integer("member_id").notNull().references(() => rosterMembers.id, { onDelete: "cascade" }),
  kind: text().notNull(),
  body: text().notNull(),
  actor: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: serial().primaryKey(),
  accountId: integer("account_id").references(() => accounts.id, { onDelete: "set null" }),
  actor: text().notNull(),
  action: text().notNull(),
  target: text().notNull().default(""),
  details: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const faqs = pgTable("faqs", {
  id: serial().primaryKey(),
  question: text().notNull(),
  answer: text().notNull().default(""),
  category: text().notNull().default("General"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Community feedback and "contact the department" messages.
export const feedback = pgTable("feedback", {
  id: serial().primaryKey(),
  kind: text().notNull().default("Feedback"),
  name: text().notNull(),
  contact: text().notNull().default(""),
  subject: text().notNull().default(""),
  message: text().notNull(),
  status: text().notNull().default("New"),
  handledBy: text("handled_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
