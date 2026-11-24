// Shared between the API (server/, netlify/server) and the browser (src/).
// This is the single source of truth for roles, permissions and form definitions.

/* ------------------------------ Roles & permissions ------------------------------ */

export type Role = "owner" | "commissioner" | "admin" | "command" | "ia" | "training" | "content" | "officer";
export type Permission = "officer" | "content" | "training" | "ia" | "command" | "admin" | "owner";

export const ROLES: Role[] = ["owner", "commissioner", "admin", "command", "ia", "training", "content", "officer"];
/** Roles the owner can hand out. Only the owner can create accounts and grant access. */
export const ASSIGNABLE_ROLES: Role[] = ["commissioner", "admin", "command", "ia", "training", "content", "officer"];

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  commissioner: "Commissioners Board",
  admin: "Administrator",
  command: "Command Staff",
  ia: "Internal Affairs",
  training: "Training Staff",
  content: "Content Editor",
  officer: "Trooper",
};

export const ROLE_HELP: Record<string, string> = {
  commissioner: "Commissioners Board: full owner-level access to every section, including accounts and settings.",
  admin: "Full access to the Administration dashboard, except Discord settings and accounts.",
  command: "Internal Affairs, personnel management, report review and department notifications.",
  ia: "Internal Affairs complaints, investigations and disciplinary records.",
  training: "Training Academy: courses, exams, records and certifications.",
  content: "Website content: news, divisions, leadership, documents, pages and FAQs.",
  officer: "Trooper Portal, Training Academy and Reports only.",
};

// Custom role labels, hydrated at runtime alongside the permission registry.
const customRoleLabels = new Map<string, string>();
export function registerCustomRoleLabel(key: string, label: string) {
  customRoleLabels.set(key, label);
}

/** Human label for any role, fixed or custom. */
export function roleLabel(role: string | undefined | null): string {
  if (!role) return "—";
  if (isCustomRole(role)) return customRoleLabels.get(customRoleOf(role)!) ?? "Custom role";
  return ROLE_LABELS[role] ?? role;
}

/** True when a role string can be assigned to an account: a fixed role or a registered custom role. */
export function isKnownRole(role: string | undefined | null): boolean {
  if (!role) return false;
  if (isCustomRole(role)) return customRolePerms.has(customRoleOf(role)!);
  return ROLES.includes(role as Role);
}

const COMMAND_PERMS: Permission[] = ["command", "ia", "training", "officer"];

/** Roles treated as top-level owners of the panel (can't be edited or removed by other staff). */
export const OWNER_LEVEL_ROLES: Role[] = ["owner", "commissioner"];

/* ------------------------------ Custom roles ------------------------------ */

// Permissions a custom role may hold. "owner" is reserved for the built-in owner accounts.
export const CUSTOM_PERM_OPTIONS: { key: Permission; label: string; help: string }[] = [
  { key: "officer", label: "Trooper Portal", help: "Access to the Trooper Portal, Training Academy and Reports." },
  { key: "content", label: "Website content", help: "News, divisions, leadership, documents, pages and FAQs." },
  { key: "training", label: "Training Academy", help: "Courses, exams, records and certifications." },
  { key: "ia", label: "Internal Affairs", help: "Complaints, investigations and disciplinary records." },
  { key: "command", label: "Command staff", help: "Personnel management, report review and department notifications." },
  { key: "admin", label: "Administration", help: "Full dashboard access except Discord settings and accounts." },
];

export const CUSTOM_ROLE_PREFIX = "custom:";
export const customRoleKey = (key: string) => `${CUSTOM_ROLE_PREFIX}${key}`;

// Registry of custom roles, hydrated from the database on the server and from
// /api/admin/roles on the client. `can()` reads it synchronously.
const customRolePerms = new Map<string, Permission[]>();

/**
 * Merges a custom role's permissions into the runtime registry. Several roles
 * may share a key; accounts holding that key get the union of their permissions.
 */
export function registerCustomRole(key: string, perms: string[]) {
  const valid = perms.filter((p): p is Permission => CUSTOM_PERM_OPTIONS.some((o) => o.key === p));
  const merged = [...new Set([...(customRolePerms.get(key) ?? []), ...valid])];
  if (merged.length) customRolePerms.set(key, merged);
  else customRolePerms.delete(key);
}

/** Clears the runtime registries before re-hydrating from a fresh role list. */
export function resetCustomRoles() {
  customRolePerms.clear();
  customRoleLabels.clear();
}

export const isCustomRole = (role: string | undefined | null) => Boolean(role?.startsWith(CUSTOM_ROLE_PREFIX));
export const customRoleOf = (role: string | undefined | null) =>
  isCustomRole(role) ? role!.slice(CUSTOM_ROLE_PREFIX.length) : null;

/** Does this role grant this permission? Every role includes the "officer" permission. */
export function can(role: string | undefined | null, perm: Permission | Permission[]): boolean {
  if (!role) return false;
  if (isCustomRole(role)) {
    const perms = customRolePerms.get(customRoleOf(role)!);
    if (!perms || !perms.length) return false;
    if (Array.isArray(perm)) return perm.some((p) => canCustom(perms, p));
    return canCustom(perms, perm);
  }
  if (!ROLES.includes(role as Role)) return false;
  if (Array.isArray(perm)) return perm.some((p) => can(role, p));
  if (role === "owner" || role === "commissioner") return true;
  if (perm === "owner") return false;
  if (role === "admin") return true;
  if (perm === "admin") return false;
  if (perm === "officer") return true;
  if (role === "command") return COMMAND_PERMS.includes(perm);
  return role === perm;
}

function canCustom(perms: Permission[], perm: Permission): boolean {
  if (perm === "owner") return false;
  if (perms.includes("admin") && perm !== "admin") return true;
  if (perm === "officer") return true;
  return perms.includes(perm);
}

/** Roles that automatic rank permissions are allowed to change. Specialist roles are left alone. */
export const RANK_MANAGED_ROLES: Role[] = ["officer", "command"];
/** Roles a rank may grant automatically. Includes admin so ranks can hand out dashboard access. */
export const RANK_GRANTABLE_ROLES: Role[] = [...RANK_MANAGED_ROLES, "admin"];

/* ------------------------------ Status lists ------------------------------ */

// Settings-table keys for system maintenance mode.
export const MAINTENANCE_ENABLED_KEY = "maintenance_enabled";
export const MAINTENANCE_MESSAGE_KEY = "maintenance_message";
export const DEFAULT_MAINTENANCE_MESSAGE = "The Trooper Portal is temporarily down for maintenance. Please check back soon.";

export const ROSTER_STATUSES = ["Active", "Probation", "LOA", "Reserve", "Suspended", "Inactive", "Resigned"];
export const DUTY_STATUSES = ["Off Duty", "On Duty", "On Patrol", "Busy", "Responding", "In Training", "Break"];
export const RANK_TIERS = ["Command", "Supervisor", "Trooper", "Probationary"];

export const COMPLAINT_CATEGORIES = [
  "Misconduct", "Excessive Force", "Abuse of Power", "Unprofessional Conduct", "Rule / SOP Violation", "Corruption", "Other",
];
export const COMPLAINT_STATUSES = ["Open", "Under Investigation", "Sustained", "Not Sustained", "Unfounded", "Exonerated", "Closed"];
export const COMPLAINT_CLOSED = ["Sustained", "Not Sustained", "Unfounded", "Exonerated", "Closed"];
export const COMPLAINT_PRIORITIES = ["Low", "Normal", "High", "Critical"];
export const DISCIPLINARY_ACTIONS = ["Verbal Warning", "Written Warning", "Strike", "Suspension", "Demotion", "Probation", "Termination"];
export const COMMENDATION_KINDS = ["Commendation", "Medal", "Ribbon", "Award", "Badge", "Certificate"];

export const REQUEST_STATUSES = ["Pending", "Approved", "Denied", "Cancelled"];
export const REPORT_STATUSES = ["Submitted", "Approved", "Needs Revision", "Rejected"];
export const EVENT_KINDS = ["Training", "Meeting", "Patrol", "Ceremony", "Community", "Interview", "Other"];
export const ANNOUNCEMENT_PRIORITIES = ["Normal", "Important", "Urgent"];
export const FEEDBACK_KINDS = ["Feedback", "Compliment", "Suggestion", "Question", "Contact"];
export const FEEDBACK_STATUSES = ["New", "In Progress", "Responded", "Archived"];
export const TRAINING_RECORD_KINDS = ["Course", "Written Exam", "Practical Evaluation", "Certification", "Field Training"];
export const TRAINING_RESULTS = ["Passed", "Failed", "In Progress", "Incomplete"];
export const EVALUATION_CATEGORIES = ["Professionalism", "Knowledge", "Communication", "Tactics", "Report Writing", "Conduct"];
export const NEWS_CATEGORIES = ["Press Release", "Announcement", "Public Information Release", "Community", "Event"];

/* ------------------------------ Reports ------------------------------ */

export type ReportField = { key: string; label: string; long?: boolean; options?: string[]; required?: boolean };
export type ReportType = { key: string; label: string; prefix: string; restricted?: boolean; fields: ReportField[] };

export const REPORT_TYPES: ReportType[] = [
  {
    key: "incident", label: "Incident Report", prefix: "INC",
    fields: [
      { key: "incidentType", label: "Incident type", required: true },
      { key: "units", label: "Units on scene" },
      { key: "evidence", label: "Evidence collected", long: true },
    ],
  },
  {
    key: "arrest", label: "Arrest Report", prefix: "ARR",
    fields: [
      { key: "suspect", label: "Suspect name", required: true },
      { key: "charges", label: "Charges", long: true, required: true },
      { key: "mirandized", label: "Miranda rights read", options: ["Yes", "No", "N/A"] },
      { key: "sentence", label: "Sentence / bail" },
      { key: "evidence", label: "Evidence collected", long: true },
    ],
  },
  {
    key: "citation", label: "Traffic Citation", prefix: "CIT",
    fields: [
      { key: "driver", label: "Driver name", required: true },
      { key: "vehicle", label: "Vehicle & plate" },
      { key: "violation", label: "Violation(s)", required: true },
      { key: "fine", label: "Fine amount" },
    ],
  },
  {
    key: "pursuit", label: "Pursuit Report", prefix: "PUR",
    fields: [
      { key: "reason", label: "Reason for pursuit", required: true },
      { key: "suspectVehicle", label: "Suspect vehicle" },
      { key: "duration", label: "Duration" },
      { key: "units", label: "Units involved" },
      { key: "tactics", label: "Tactics used (PIT, spikes…)" },
      { key: "outcome", label: "Outcome", options: ["Suspect apprehended", "Suspect escaped", "Terminated by supervisor", "Crash", "Other"] },
    ],
  },
  {
    key: "force", label: "Use-of-Force Report", prefix: "UOF", restricted: true,
    fields: [
      { key: "subject", label: "Subject name", required: true },
      { key: "forceType", label: "Force used", options: ["Physical", "Taser", "OC Spray", "Baton", "K-9", "Less-lethal", "Firearm", "Other"], required: true },
      { key: "justification", label: "Justification", long: true, required: true },
      { key: "injuries", label: "Injuries (subject / officers)", long: true },
      { key: "bodycam", label: "Body camera / clip link" },
    ],
  },
  {
    key: "accident", label: "MVA (Motor Vehicle Accident)", prefix: "MVA",
    fields: [
      { key: "vehicles", label: "Vehicles involved", long: true, required: true },
      { key: "injuries", label: "Injuries" },
      { key: "cause", label: "Probable cause" },
      { key: "citations", label: "Citations issued" },
      { key: "damage", label: "Property / vehicle damage", long: true },
    ],
  },
  {
    key: "daily", label: "Daily Activity Report", prefix: "DAR",
    fields: [
      { key: "shift", label: "Shift (start – end)", required: true },
      { key: "calls", label: "Calls handled" },
      { key: "arrests", label: "Arrests" },
      { key: "citations", label: "Citations" },
    ],
  },
];
export const reportType = (key: string) => REPORT_TYPES.find((t) => t.key === key);

/* ------------------------------ Site configuration ------------------------------ */

export const THEMES = [
  { key: "gold", label: "DPS Red", color: "#c8102e" },
  { key: "blue", label: "Highway Patrol Blue", color: "#4f8fe8" },
  { key: "crimson", label: "Crimson", color: "#e0534a" },
  { key: "emerald", label: "Emerald", color: "#3fbf7f" },
  { key: "violet", label: "Violet", color: "#9b7bf0" },
];

export const DEPARTMENT_STATUSES = [
  { key: "normal", label: "Normal Operations", tone: "green" },
  { key: "elevated", label: "Elevated Activity", tone: "gold" },
  { key: "critical", label: "Critical Incident", tone: "red" },
  { key: "training", label: "Training Day", tone: "blue" },
  { key: "closed", label: "Limited Operations", tone: "" },
];

export type SiteConfig = {
  departmentName: string;
  shortName: string;
  tagline: string;
  heroTitle: string;
  heroHighlight: string;
  heroText: string;
  chiefName: string;
  chiefTitle: string;
  chiefMessage: string;
  chiefPhotoKey: string | null;
  status: string;
  statusMessage: string;
  contactEmail: string;
  discordInvite: string;
  theme: string;
  showStats: boolean;
};

export const DEFAULT_SITE_CONFIG: SiteConfig = {
  departmentName: "Texas Department of Public Safety",
  shortName: "TXDPS",
  tagline: "Courtesy. Service. Protection.",
  heroTitle: "Serving and protecting Texas.",
  heroHighlight: "Courtesy. Service. Protection.",
  heroText:
    "Welcome to the Texas Department of Public Safety. Dedicated to protecting the people of Texas through professional law enforcement, homeland security and emergency management — with courtesy, service and protection.",
  chiefName: "Director",
  chiefTitle: "Director of Public Safety",
  chiefMessage:
    "Thank you for visiting the Texas Department of Public Safety. Every trooper and employee in this department has sworn to protect the people of Texas with professionalism, fairness and respect. Whether you're a resident, a visitor or someone thinking about wearing the TXDPS badge, our doors are open. We hold ourselves accountable, and we welcome your feedback.",
  chiefPhotoKey: null,
  status: "normal",
  statusMessage: "",
  contactEmail: "",
  discordInvite: "",
  theme: "gold",
  showStats: true,
};

/** Informational pages that can be edited from the admin panel. */
export const PAGE_SLUGS = [
  { slug: "history", title: "Department History", group: "about" },
  { slug: "mission", title: "Mission Statement", group: "about" },
  { slug: "values", title: "Our Values", group: "about" },
  { slug: "rules", title: "Rules & Regulations", group: "policy" },
  { slug: "sop", title: "Standard Operating Procedures", group: "policy" },
  { slug: "uniform", title: "Uniform & Equipment Policy", group: "policy" },
  { slug: "guidelines", title: "Community Guidelines", group: "community" },
];
