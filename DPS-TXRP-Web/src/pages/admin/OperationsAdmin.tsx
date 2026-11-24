import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ANNOUNCEMENT_PRIORITIES, api, DEPARTMENT_STATUSES, EVENT_KINDS, FEEDBACK_STATUSES, formatDate, PAGE_SLUGS, Pill, RANK_TIERS, THEMES, TRAINING_RECORD_KINDS, TRAINING_RESULTS, uploadFile, type Announcement, type CalEvent, type Course, type Division, type Faq, type Page, type Rank, type RosterMember, type SiteConfig, type TrainingRecord } from "../../api";
import { Action, Collection, Field, Panel, WorkflowForm } from "../../components/Workflow";
import { useSite } from "../../site";
import { useApi } from "../../useApi";
import { TrainingRecordRow } from "../Portal";
import { AdminTop } from "./AdminLayout";
import { ResourceManager } from "./ResourceManager";

const selectOptions = (values: string[]) => values.map((value) => ({ value, label: value }));
const audiences = [{ value: "public", label: "Public" }, { value: "internal", label: "Personnel only" }];
const unitOptions = (units?: Division[]) => [{ value: null, label: "Department-wide" }, ...(units?.map((unit) => ({ value: unit.id, label: unit.name })) ?? [])];

export function AnnouncementsAdmin() {
  const [units] = useApi<Division[]>("/api/divisions");
  const scheduled = (row: Announcement) => row.publishAt && new Date(row.publishAt).getTime() > Date.now();
  return <ResourceManager<Announcement> endpoint="/api/admin/announcements" title="Announcements" singular="announcement" text="Publish notices to the website or Trooper Portal. Schedule one to announce itself automatically later." defaults={{ audience: "internal", priority: "Normal", pinned: false }} searchText={(row) => `${row.title} ${row.body}`}
    fields={[{ key: "title", label: "Title", required: true }, { key: "audience", label: "Audience", type: "select", options: audiences }, { key: "priority", label: "Priority", type: "select", options: selectOptions(ANNOUNCEMENT_PRIORITIES) }, { key: "unitId", label: "Unit", type: "select", options: unitOptions(units) }, { key: "publishAt", label: "Schedule publication", type: "datetime" }, { key: "expiresAt", label: "Expires", type: "datetime" }, { key: "pinned", label: "Pin to the top", type: "checkbox" }, { key: "body", label: "Announcement", type: "textarea", required: true }]}
    columns={[{ label: "Title", render: (row) => <strong>{row.title}</strong> }, { label: "Audience", render: (row) => row.audience }, { label: "Priority", render: (row) => <Pill s={row.priority} /> }, { label: "Status", render: (row) => scheduled(row) ? <Pill s="Pending" /> : <Pill s="Published" /> }, { label: "Publishes", render: (row) => row.publishAt ? formatDate(row.publishAt, true) : <span className="muted">Immediately</span> }, { label: "Expires", render: (row) => formatDate(row.expiresAt, true) }]} />;
}

export function EventsAdmin() {
  const [units] = useApi<Division[]>("/api/divisions");
  return <ResourceManager<CalEvent> endpoint="/api/admin/events" title="Calendar events" singular="event" text="Schedule training, community events and internal activities." defaults={{ kind: "Training", audience: "internal", allowSignup: false }} searchText={(row) => `${row.title} ${row.kind} ${row.location}`}
    beforeSave={(row) => !row.startsAt ? "Choose a start time." : row.endsAt && row.endsAt < row.startsAt ? "End time must follow the start time." : undefined}
    fields={[{ key: "title", label: "Title", required: true }, { key: "kind", label: "Type", type: "select", options: selectOptions(EVENT_KINDS) }, { key: "startsAt", label: "Starts", type: "datetime", required: true }, { key: "endsAt", label: "Ends", type: "datetime" }, { key: "location", label: "Location" }, { key: "audience", label: "Audience", type: "select", options: audiences }, { key: "unitId", label: "Unit", type: "select", options: unitOptions(units) }, { key: "allowSignup", label: "Allow troopers to sign up", type: "checkbox" }, { key: "description", label: "Description", type: "textarea" }]}
    columns={[{ label: "Event", render: (row) => <strong>{row.title}</strong> }, { label: "Type", render: (row) => row.kind }, { label: "Audience", render: (row) => row.audience }, { label: "Starts", render: (row) => formatDate(row.startsAt, true) }]} />;
}

export function RanksAdmin() {
  return <ResourceManager<Rank> endpoint="/api/admin/ranks" title="Rank structure" singular="rank" text="Set rank order and optional automatic access. Lower order numbers appear first." defaults={{ tier: "Trooper", sortOrder: 0, grantsRole: null }} searchText={(row) => `${row.name} ${row.abbreviation} ${row.tier}`}
    fields={[{ key: "name", label: "Rank name", required: true }, { key: "abbreviation", label: "Abbreviation" }, { key: "tier", label: "Tier", type: "select", options: selectOptions(RANK_TIERS) }, { key: "grantsRole", label: "Automatic access", type: "select", options: [{ value: null, label: "No extra access" }, { value: "officer", label: "Trooper" }, { value: "command", label: "Command staff" }, { value: "admin", label: "Administrator" }] }, { key: "sortOrder", label: "Order", type: "number" }, { key: "description", label: "Description", type: "textarea" }]}
    columns={[{ label: "Rank", render: (row) => <strong>{row.name}</strong> }, { label: "Tier", render: (row) => row.tier }, { label: "Automatic role", render: (row) => row.grantsRole === "officer" ? "Trooper" : row.grantsRole === "command" ? "Command staff" : row.grantsRole === "admin" ? "Administrator" : row.grantsRole || "—" }, { label: "Order", render: (row) => row.sortOrder }]} />;
}

export function FaqAdmin() {
  return <ResourceManager<Faq> endpoint="/api/admin/faqs" title="Community FAQs" singular="FAQ" defaults={{ sortOrder: 0 }} searchText={(row) => `${row.question} ${row.category}`}
    fields={[{ key: "question", label: "Question", required: true }, { key: "category", label: "Category" }, { key: "sortOrder", label: "Order", type: "number" }, { key: "answer", label: "Answer", type: "textarea", required: true }]}
    columns={[{ label: "Question", render: (row) => <strong>{row.question}</strong> }, { label: "Category", render: (row) => row.category }, { label: "Order", render: (row) => row.sortOrder }]} />;
}

type ExamQuestion = { q: string; options: string[]; answer: number };

function QuestionEditor({ questions, onChange }: { questions: ExamQuestion[]; onChange: (next: ExamQuestion[]) => void }) {
  const replace = (index: number, question: ExamQuestion) => onChange(questions.map((row, offset) => offset === index ? question : row));
  return <div className="stack">{questions.map((question, index) => <fieldset className="question-editor stack" key={index}>
    <legend>Question {index + 1}</legend>
    <label className="field"><span>Question text</span><input className="input" value={question.q} required onChange={(event) => replace(index, { ...question, q: event.target.value })} /></label>
    {question.options.map((option, optionIndex) => <label className="field" key={optionIndex}><span>Answer option {optionIndex + 1}</span><input className="input" value={option} required onChange={(event) => replace(index, { ...question, options: question.options.map((value, offset) => optionIndex === offset ? event.target.value : value) })} /></label>)}
    <label className="field"><span>Correct answer</span><select className="input" value={question.answer} onChange={(event) => replace(index, { ...question, answer: Number(event.target.value) })}>{question.options.map((_, optionIndex) => <option key={optionIndex} value={optionIndex}>Option {optionIndex + 1}</option>)}</select></label>
    <div className="row">{question.options.length < 8 && <button type="button" className="btn btn-outline btn-xs" onClick={() => replace(index, { ...question, options: [...question.options, ""] })}>Add option</button>}{question.options.length > 2 && <button type="button" className="btn btn-outline btn-xs" onClick={() => replace(index, { ...question, options: question.options.slice(0, -1), answer: Math.min(question.answer, question.options.length - 2) })}>Remove last option</button>}<button type="button" className="btn btn-danger btn-xs" onClick={() => onChange(questions.filter((_, offset) => offset !== index))}>Remove question</button></div>
  </fieldset>)}<div><button type="button" className="btn btn-outline btn-xs" disabled={questions.length >= 100} onClick={() => onChange([...questions, { q: "", options: ["", ""], answer: 0 }])}>Add exam question</button></div></div>;
}

export function CoursesAdmin() {
  return <ResourceManager<Course> endpoint="/api/admin/courses" title="Training courses" singular="course" text="Publish guides, build exams and assign certifications." defaults={{ questions: [], passingScore: 70, published: false, sortOrder: 0 }} searchText={(row) => `${row.title} ${row.category}`}
    fields={[{ key: "title", label: "Course title", required: true }, { key: "category", label: "Category" }, { key: "summary", label: "Summary" }, { key: "certification", label: "Certification on passing" }, { key: "passingScore", label: "Passing score (%)", type: "number" }, { key: "sortOrder", label: "Order", type: "number" }, { key: "published", label: "Published", type: "checkbox" }, { key: "content", label: "Training guide", type: "textarea" }, { key: "fileKey", label: "Internal attachment", type: "file" }, { key: "questions", label: "Written exam", type: "custom", render: (draft, update) => <QuestionEditor questions={draft.questions ?? []} onChange={(questions) => update("questions", questions)} /> }]}
    columns={[{ label: "Course", render: (row) => <strong>{row.title}</strong> }, { label: "Category", render: (row) => row.category }, { label: "Exam", render: (row) => `${row.questions?.length ?? 0} questions` }, { label: "Visibility", render: (row) => <Pill s={row.published ? "Published" : "Draft"} /> }]} />;
}

export function TrainingRecordsAdmin() {
  const [records, error, reload] = useApi<TrainingRecord[]>("/api/training/records?all=1");
  const [roster, rosterError] = useApi<RosterMember[]>("/api/roster");
  const [courses] = useApi<Course[]>("/api/training/courses");
  return <><AdminTop title="Training records" text="Log practical evaluations, completion records and certifications."><Link className="btn btn-outline btn-sm" to="/admin/courses">Manage courses</Link></AdminTop><div className="desk-grid">
    <Panel title="Record training result">{rosterError ? <p className="alert error">{rosterError}</p> : roster ? <WorkflowForm label="Save training record" reset submit={async (body) => { await api("/api/training/records", { body: { ...body, expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null } }); reload(); }}>
      <Field name="memberId" label="Trooper" options={roster.map((row) => ({ value: row.id, label: `${row.name}${row.callsign ? ` · ${row.callsign}` : ""}` }))} placeholder="Choose a trooper" required /><Field name="title" label="Record title" required maxLength={200} />
      <div className="form-grid"><Field name="courseId" label="Related course" options={(courses ?? []).map((row) => ({ value: row.id, label: row.title }))} placeholder="No related course" /><Field name="kind" label="Record type" options={TRAINING_RECORD_KINDS} initial="Practical Evaluation" /><Field name="result" label="Result" options={TRAINING_RESULTS} /><Field name="score" label="Score (%)" type="number" min={0} max={100} /><Field name="certification" label="Certification" maxLength={120} /><Field name="expiresAt" label="Expires" type="datetime-local" /></div><Field name="notes" label="Instructor notes" multiline maxLength={3000} />
    </WorkflowForm> : <p className="loading">Loading roster…</p>}</Panel>
    <Panel title="Recent results"><Collection data={records} error={error} empty="No training records filed.">{(row) => <div key={row.id}><TrainingRecordRow record={row} /><Action run={async () => { if (!confirm("Delete this training record?")) return; await api(`/api/training/records/${row.id}`, { method: "DELETE" }); reload(); }}>Delete record</Action></div>}</Collection></Panel>
  </div></>;
}

export function UnitMembersAdmin() {
  const { id } = useParams();
  const endpoint = `/api/admin/units/${id}/members`;
  const [data, error, reload] = useApi<RosterMember[]>(endpoint);
  const [roster, rosterError] = useApi<RosterMember[]>("/api/admin/roster");
  const [divisions] = useApi<Division[]>("/api/divisions");
  return <><AdminTop title={divisions?.find((unit) => String(unit.id) === id)?.name ?? "Unit roster"}><Link className="btn btn-outline btn-sm" to="/admin/divisions">Manage divisions</Link></AdminTop><div className="desk-grid">
    <Panel title="Unit membership"><Collection data={data} error={error} empty="No members assigned.">{(row) => <div className="desk-row" key={row.id}><h3>{row.name}</h3><div className="row"><span className="muted">{row.rank} · {row.position || "Member"}</span>{row.isLeader && <Pill s="Leader" />}</div>{row.membershipId && <Action run={async () => { if (!confirm("Remove this explicit unit membership?")) return; await api(`/api/admin/unit-members/${row.membershipId}`, { method: "DELETE" }); reload(); }}>Remove membership</Action>}</div>}</Collection></Panel>
    <Panel title="Assign role in this unit">{rosterError ? <p className="alert error">{rosterError}</p> : roster ? <WorkflowForm label="Save assignment" reset submit={async (body) => { await api(endpoint, { body: { ...body, isLeader: body.isLeader === "yes" } }); reload(); }}><Field name="memberId" label="Trooper" options={roster.map((row) => ({ value: row.id, label: `${row.name} · ${row.rank}` }))} placeholder="Choose a trooper" required /><Field name="position" label="Position" initial="Member" maxLength={80} /><Field name="isLeader" label="List as unit leader" options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} /><Field name="sortOrder" label="Order" type="number" initial={0} /></WorkflowForm> : <p className="loading">Loading roster…</p>}</Panel>
  </div></>;
}

export function PagesAdmin() {
  const [pages, error, reload] = useApi<Page[]>("/api/admin/pages");
  const [slug, setSlug] = useState(PAGE_SLUGS[0].slug);
  const entry = PAGE_SLUGS.find((page) => page.slug === slug);
  const page = pages?.find((row) => row.slug === slug);
  return <><AdminTop title="Information pages" text="Edit TXDPS history, regulations, policies and public guidance." /><Panel title="Page editor">
    <label className="field"><span>Page to edit</span><select className="input" value={slug} onChange={(event) => setSlug(event.target.value)}>{PAGE_SLUGS.map((page) => <option key={page.slug} value={page.slug}>{page.title}</option>)}</select></label>
    {error ? <p className="alert error">{error}</p> : pages ? <WorkflowForm key={slug} label="Publish updates" submit={async (body) => { await api(`/api/admin/pages/${slug}`, { method: "PUT", body }); reload(); }}><Field name="title" label="Page title" initial={page?.title ?? entry?.title} required maxLength={200} /><Field name="body" label="Page content" initial={page?.body} multiline maxLength={60000} />{page && <p className="muted">Last updated {formatDate(page.updatedAt)}{page.updatedBy && ` by ${page.updatedBy}`}</p>}</WorkflowForm> : <p className="loading">Loading pages…</p>}
  </Panel></>;
}

type Feedback = { id: number; kind: string; name: string; contact: string; subject: string; message: string; status: string; handledBy: string; createdAt: string };

export function FeedbackAdmin() {
  const [rows, error, reload] = useApi<Feedback[]>("/api/admin/feedback");
  return <><AdminTop title="Community inbox" text="Read and triage public feedback and contact messages." /><Panel title="Received messages"><Collection data={rows} error={error} empty="No public messages have been received.">{(row) => <details className="desk-row" key={row.id}><summary>{row.subject || row.kind} · {row.status}</summary><p className="muted">{row.name} · {formatDate(row.createdAt, true)}{row.contact && ` · Reply: ${row.contact}`}</p><p className="preserve">{row.message}</p><WorkflowForm label="Update status" submit={async (body) => { await api(`/api/admin/feedback/${row.id}`, { method: "PATCH", body }); reload(); }}><Field name="status" label="Message status" options={FEEDBACK_STATUSES} initial={row.status} /></WorkflowForm></details>}</Collection></Panel></>;
}

export function BroadcastAdmin() {
  return <><AdminTop title="Department notifications" text="Send a notification to every Trooper Portal account." /><Panel title="Compose broadcast"><WorkflowForm label="Send notification" reset success="Notification sent to department accounts." submit={async (values) => {
    if (values.link && !/^\/(?:portal|admin)(?:\/|$)/.test(values.link)) throw new Error("Use an internal /portal or /admin link.");
    await api("/api/admin/broadcast", { body: { ...values, discord: values.discord === "yes" } });
  }}><Field name="title" label="Title" required maxLength={200} /><Field name="body" label="Message" required multiline maxLength={1000} /><Field name="link" label="Optional internal link" placeholder="/portal/calendar" maxLength={200} /><Field name="discord" label="Also send to configured announcements webhook" options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} /></WorkflowForm></Panel></>;
}

export function SiteConfigAdmin() {
  const [config, error, reload] = useApi<SiteConfig>("/api/admin/site-config");
  const [photo, setPhoto] = useState<File>();
  const site = useSite();
  return <><AdminTop title="Website configuration" text="Manage the public homepage, theme and status." />
    <Panel title="Public website">{error ? <p className="alert error">{error}</p> : config ? <WorkflowForm label="Save website settings" submit={async (values) => {
      const { showStats, removePhoto, ...fields } = values;
      const chiefPhotoKey = photo ? (await uploadFile(photo, { image: true })).key : removePhoto ? null : config.chiefPhotoKey;
      await api("/api/admin/site-config", { method: "PUT", body: { ...fields, chiefPhotoKey, showStats: Boolean(showStats) } });
      setPhoto(undefined); reload(); site.reload();
    }}>
      <div className="form-grid"><Field name="departmentName" label="Department name" initial={config.departmentName} required maxLength={300} /><Field name="shortName" label="Department acronym" initial={config.shortName} required maxLength={300} /><Field name="tagline" label="Footer tagline" initial={config.tagline} maxLength={300} /><Field name="contactEmail" label="Public contact email" type="email" initial={config.contactEmail} maxLength={300} /><Field name="discordInvite" label="Optional Discord community invite (HTTPS)" type="url" initial={config.discordInvite} maxLength={300} /><Field name="theme" label="Accent theme" options={THEMES.map((theme) => ({ value: theme.key, label: theme.label }))} initial={config.theme} /><Field name="heroTitle" label="Homepage headline" initial={config.heroTitle} required maxLength={300} /><Field name="heroHighlight" label="Headline highlight" initial={config.heroHighlight} maxLength={300} /></div>
      <Field name="heroText" label="Homepage introduction" initial={config.heroText} multiline maxLength={4000} />
      <div className="form-grid"><Field name="chiefName" label="Director name" initial={config.chiefName} maxLength={300} /><Field name="chiefTitle" label="Sheriff title" initial={config.chiefTitle} maxLength={300} /></div>
      <Field name="chiefMessage" label="Director welcome message" initial={config.chiefMessage} multiline maxLength={4000} />
      <label className="field"><span>Director photo</span><input className="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setPhoto(event.target.files?.[0])} /></label>
      {config.chiefPhotoKey && <label className="checkbox"><input type="checkbox" name="removePhoto" />Remove existing photo</label>}
      <div className="form-grid"><Field name="status" label="Department operations" initial={config.status} options={DEPARTMENT_STATUSES.map((status) => ({ value: status.key, label: status.label }))} /><Field name="statusMessage" label="Public status message" initial={config.statusMessage} maxLength={300} /></div>
      <label className="checkbox"><input type="checkbox" name="showStats" defaultChecked={config.showStats} /> Show statistics on the homepage</label>
    </WorkflowForm> : <p className="loading">Loading website settings…</p>}</Panel>
  </>;
}
