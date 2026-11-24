import { count, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { documents, divisions, faqs, pages, ranks, rosterDividers, uploads } from "../db/schema.js";
import { getSetting, setSetting } from "./discord.js";

const SEED_VERSION = "5";

const RANKS: { name: string; abbreviation: string; tier: string; grantsRole: string | null; description: string }[] = [
  { name: "Sheriff", abbreviation: "SHF", tier: "Command", grantsRole: "command", description: "Head of the department." },
  { name: "Undersheriff", abbreviation: "USH", tier: "Command", grantsRole: "command", description: "Second in command." },
  { name: "Chief Trooper", abbreviation: "CTRP", tier: "Command", grantsRole: "command", description: "Oversees daily operations." },
  { name: "Major", abbreviation: "MAJ", tier: "Command", grantsRole: "command", description: "Bureau commander." },
  { name: "Captain", abbreviation: "CPT", tier: "Command", grantsRole: "command", description: "Division commander." },
  { name: "Lieutenant", abbreviation: "LT", tier: "Supervisor", grantsRole: "officer", description: "Shift commander." },
  { name: "Sergeant", abbreviation: "SGT", tier: "Supervisor", grantsRole: "officer", description: "Field supervisor." },
  { name: "Corporal", abbreviation: "CPL", tier: "Supervisor", grantsRole: "officer", description: "Senior trooper and acting supervisor." },
  { name: "Senior Trooper", abbreviation: "STRP", tier: "Trooper", grantsRole: "officer", description: "Experienced trooper." },
  { name: "Trooper", abbreviation: "TRP", tier: "Trooper", grantsRole: "officer", description: "Sworn state trooper." },
  { name: "Probationary Trooper", abbreviation: "PTRP", tier: "Probationary", grantsRole: "officer", description: "Completed academy; in field training." },
  { name: "Cadet", abbreviation: "CDT", tier: "Probationary", grantsRole: "officer", description: "Attending the training academy." },
];

const DIVIDERS: { label: string; sortOrder: number }[] = [
  { label: "Admin Staff", sortOrder: 0 },
  { label: "Command Staff", sortOrder: 1 },
  { label: "Supervisory Staff", sortOrder: 2 },
  { label: "Patrol Staff", sortOrder: 3 },
];

const UNITS = [
  { code: "SWAT", name: "Special Weapons and Tactics", summary: "High-risk warrants, barricaded subjects and hostage rescue.", requirements: "Senior Trooper or above\n60 days in the department\nFirearms and tactics certification\nNo active disciplinary actions" },
  { code: "K-9", name: "K-9 Unit", summary: "Narcotics detection, tracking and suspect apprehension with canine partners.", requirements: "Trooper or above\n30 days in the department\nK-9 handler course" },
  { code: "TRAFFIC", name: "Traffic Enforcement", summary: "Speed enforcement, DUI checkpoints and collision investigation.", requirements: "Trooper or above\nTraffic enforcement course" },
  { code: "CID", name: "Criminal Investigations Division", summary: "Detectives investigating major crimes from scene to court.", requirements: "Senior Trooper or above\nStrong report-writing record\nInterview with the CID commander" },
  { code: "HWP", name: "Highway Patrol", summary: "Interstate and highway safety, pursuits and commercial vehicle enforcement.", requirements: "Trooper or above\nPursuit driving certification" },
  { code: "AIR", name: "Aviation Unit", summary: "Air support for pursuits, searches and large-scale incidents.", requirements: "Senior Trooper or above\nAviation flight evaluation" },
  { code: "SOU", name: "Special Operations Unit", summary: "Crowd control, critical infrastructure and special events.", requirements: "Corporal or above\nCommand approval" },
  { code: "RTU", name: "Recruitment and Training Unit", summary: "Runs the academy, field training program and instructor certification.", requirements: "Senior Trooper or above\nInstructor certification\nExcellent evaluations" },
];

const PAGES: Record<string, { title: string; body: string }> = {
  history: {
    title: "Department History",
    body: "The Texas Department of Public Safety was created to unite state law enforcement and public safety services under one roof.\n\nWhat began as a small patrol force has grown into a full department with specialized units, a training academy and an Internal Affairs Division that holds every member accountable.\n\nEdit this page from Administration → Pages to tell your department's story.",
  },
  mission: {
    title: "Mission Statement",
    body: "The Texas Department of Public Safety protects life and property, preserves the peace and enforces the law with fairness and respect. We partner with the communities we serve to keep Texas safe.",
  },
  values: {
    title: "Our Values",
    body: "Integrity — We hold ourselves to the highest ethical standards, on and off duty.\n\nCommunity — We build partnerships with the residents we serve and listen to their concerns.\n\nAccountability — Every trooper answers for their actions.\n\nProfessionalism — Training, discipline and respect guide every interaction.",
  },
  rules: {
    title: "Rules & Regulations",
    body: "1. Treat every member of the public and the department with respect.\n\n2. Follow the chain of command.\n\n3. Use of force must be reasonable, necessary and reported.\n\n4. Do not abuse your powers or equipment.\n\n5. Report misconduct you witness to Internal Affairs.\n\nEdit this page from Administration → Pages.",
  },
  sop: {
    title: "Standard Operating Procedures",
    body: "Traffic stops\nAnnounce the stop on radio with location and plate. Approach from the driver's side unless the situation calls otherwise.\n\nPursuits\nRequest a supervisor. Terminate when the risk to the public outweighs the need to apprehend.\n\nArrests\nRead Miranda rights before questioning. File an arrest report before end of shift.\n\nEdit this page from Administration → Pages, or upload the full SOP under Documents.",
  },
  uniform: {
    title: "Uniform & Equipment Policy",
    body: "Patrol uniform: department tan shirt, dark trousers, duty belt and badge worn on the left chest.\n\nSpecialized units wear the uniform approved by their unit commander.\n\nStandard equipment: sidearm, taser, radio, handcuffs, flashlight and body camera.\n\nEdit this page from Administration → Pages.",
  },
  guidelines: {
    title: "Community Guidelines",
    body: "Be respectful to troopers and other community members.\n\nNo harassment, hate speech or discrimination.\n\nUse the complaint form for concerns about a trooper, not public channels.\n\nFalse reports may result in action against the reporter.",
  },
};

const FAQS = [
  { category: "General", question: "How do I contact the department?", answer: "Use the Contact page or email us. For complaints about a trooper, use the complaint form so Internal Affairs receives it directly." },
  { category: "Complaints", question: "What happens after I file a complaint?", answer: "Internal Affairs reviews every complaint, may contact you for more information and will investigate. You receive a case number and tracking code to follow its status." },
  { category: "Complaints", question: "Can I compliment a trooper?", answer: "Yes! Use the Community Feedback form and choose “Compliment”. Command staff read every message." },
];

let seeded = false;
/** Inserts default ranks, units, pages and FAQs once. Safe to call on every request. */
export async function ensureDefaults() {
  if (seeded) return;
  if ((await getSetting("seed_version")) === SEED_VERSION) {
    seeded = true;
    return;
  }
  const [{ n: rankCount }] = await db.select({ n: count() }).from(ranks);
  if (rankCount === 0)
    await db.insert(ranks).values(RANKS.map((r, i) => ({ ...r, sortOrder: (i + 1) * 10 }))).onConflictDoNothing();

  // Rename "Deputy" to "Trooper" in existing ranks, tiers, unit requirements and pages.
  await db.execute(
    sql`UPDATE ranks SET name = replace(name, 'Deputy', 'Trooper'), tier = replace(tier, 'Deputy', 'Trooper'), description = replace(description, 'Deputy', 'Trooper'), abbreviation = replace(replace(replace(abbreviation, 'SDEP', 'STRP'), 'PDEP', 'PTRP'), 'DEP', 'TRP')`,
  );
  await db.execute(sql`UPDATE divisions SET requirements = replace(requirements, 'Deputy', 'Trooper')`);
  await db.execute(
    sql`UPDATE pages SET body = replace(replace(body, 'Deputy', 'Trooper'), 'deputy', 'trooper'), title = replace(replace(title, 'Deputy', 'Trooper'), 'deputy', 'trooper')`,
  );

  // Default roster dividers, ordered by weight.
  const dividerLabels = await db.select({ label: rosterDividers.label }).from(rosterDividers);
  const missingDividers = DIVIDERS.filter((d) => !dividerLabels.some((row) => row.label.toLowerCase() === d.label.toLowerCase()));
  if (missingDividers.length) await db.insert(rosterDividers).values(missingDividers).onConflictDoNothing();

  const existing = await db.select({ code: divisions.code, name: divisions.name }).from(divisions);
  const has = (u: (typeof UNITS)[number]) =>
    existing.some((d) => d.code.toLowerCase() === u.code.toLowerCase() || d.name.toLowerCase() === u.name.toLowerCase());
  const missing = UNITS.filter((u) => !has(u));
  if (missing.length)
    await db.insert(divisions).values(
      missing.map((u, i) => ({
        ...u,
        description: `${u.summary}\n\nEdit this unit from Administration → Units to add its full description, image and leadership.`,
        sortOrder: 100 + i,
      })),
    );

  await db
    .insert(pages)
    .values(Object.entries(PAGES).map(([slug, p]) => ({ slug, ...p, updatedBy: "System" })))
    .onConflictDoNothing();

  const [{ n: faqCount }] = await db.select({ n: count() }).from(faqs);
  if (faqCount === 0) await db.insert(faqs).values(FAQS.map((f, i) => ({ ...f, sortOrder: i })));

  // Department documents are staff-only now: flip anything still marked public and lock its file.
  const docFiles = (await db.select({ key: documents.fileKey }).from(documents).where(ne(documents.visibility, "internal")))
    .map((row) => row.key)
    .filter((key): key is string => Boolean(key));
  if (docFiles.length) await db.update(uploads).set({ internal: true }).where(inArray(uploads.key, docFiles));
  await db.update(documents).set({ visibility: "internal" }).where(ne(documents.visibility, "internal"));

  await setSetting("seed_version", SEED_VERSION);
  seeded = true;
}

