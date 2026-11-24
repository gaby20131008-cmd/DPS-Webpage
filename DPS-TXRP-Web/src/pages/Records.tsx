import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, can, fileUrl, formatDate, Pill, REPORT_STATUSES, REPORT_TYPES, reportType, type Course, type Report, type ReportType, type RosterMember, type TrainingRecord } from "../api";
import { Action, Collection, Field, localDateTime, Panel, WorkflowForm } from "../components/Workflow";
import { useApi } from "../useApi";
import { PortalCalendar, PortalTitle, TrainingRecordRow, usePortal } from "./Portal";

export function Reports() {
  const [params, setParams] = useSearchParams();
  const [data, error] = useApi<Report[]>(`/api/reports?${params}`);
  return <><PortalTitle title="Records & reports" text="File, find and review records for in-game incidents and department activity." />
    <div><Link to="/portal/reports/new" className="btn btn-gold btn-sm">File a report</Link></div>
    <Panel title="Report search"><WorkflowForm key={params.toString()} label="Search reports" success="" submit={async (values) => setParams(new URLSearchParams(Object.entries(values).filter(([, value]) => value)))}>
      <div className="form-grid"><Field name="q" label="Number, title, location or keyword" initial={params.get("q")} maxLength={100} /><Field name="type" label="Report type" options={REPORT_TYPES.map((type) => ({ value: type.key, label: type.label }))} placeholder="All report types" initial={params.get("type")} /><Field name="status" label="Status" options={REPORT_STATUSES} placeholder="All statuses" initial={params.get("status")} /><Field name="mine" label="Author" options={[{ value: "1", label: "My reports" }]} placeholder="All visible reports" initial={params.get("mine")} /></div>
    </WorkflowForm></Panel>
    <Panel title="Report register"><Collection data={data} error={error} empty="No reports match these filters.">{(row) => <article className="desk-row" key={row.id}><div className="row"><h3><Link className="text-link" to={`/portal/reports/${row.id}`}>{row.title}</Link></h3><Pill s={row.status} /></div><p className="muted">{[row.number, reportType(row.type)?.label, row.authorName, formatDate(row.createdAt)].filter(Boolean).join(" · ")}</p></article>}</Collection></Panel>
  </>;
}

function ReportForm({ type, report, onSaved }: { type: ReportType; report?: Report; onSaved: (value: Report) => void }) {
  return <WorkflowForm label={report ? "Save and resubmit" : "Submit report"} success="" submit={async (values) => {
    const details = Object.fromEntries(type.fields.map((field) => [field.key, values[`detail-${field.key}`]]));
    const body = { type: type.key, title: values.title, occurredAt: values.occurredAt ? new Date(values.occurredAt).toISOString() : "", location: values.location, involved: values.involved, narrative: values.narrative, details };
    onSaved(await api<Report>(report ? `/api/reports/${report.id}` : "/api/reports", { method: report ? "PUT" : "POST", body }));
  }}>
    <div className="form-grid"><Field name="title" label="Report title" initial={report?.title} required maxLength={200} /><Field name="occurredAt" label="Date and time" type="datetime-local" initial={localDateTime(report?.occurredAt)} /><Field name="location" label="In-game location" initial={report?.location} maxLength={200} /><Field name="involved" label="People involved" initial={report?.involved} maxLength={2000} /></div>
    {type.fields.map((field) => <Field key={field.key} name={`detail-${field.key}`} label={field.label} options={field.options} placeholder={field.options ? "Choose an option" : undefined} initial={report?.details[field.key]} required={field.required} multiline={field.long} maxLength={field.long ? 4000 : 300} />)}
    <Field name="narrative" label="Narrative" initial={report?.narrative} required multiline maxLength={20000} />
  </WorkflowForm>;
}

export function ReportNew() {
  const [key, setKey] = useState(REPORT_TYPES[0].key);
  const navigate = useNavigate();
  return <><PortalTitle title="File a report" /><Panel title="Report details">
    <label className="field"><span>Report type</span><select className="input" value={key} onChange={(event) => setKey(event.target.value)}>{REPORT_TYPES.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label>
    <ReportForm type={reportType(key) ?? REPORT_TYPES[0]} key={key} onSaved={(report) => navigate(`/portal/reports/${report.id}`, { replace: true })} />
  </Panel></>;
}

export function ReportDetail() {
  const { id } = useParams();
  const { user } = usePortal();
  const [data, error, reload] = useApi<Report>(`/api/reports/${id}`);
  const [editId, setEditId] = useState<number>();
  const navigate = useNavigate();
  const type = reportType(data?.type ?? "");
  return <><PortalTitle title={data?.title ?? "Report detail"} text={data ? `${data.number} · ${type?.label ?? data.type}` : undefined} /><div><Link to="/portal/reports" className="text-link">← Report register</Link></div>
    {error ? <p className="alert error">{error}</p> : !data ? <p className="loading">Loading report…</p> : <div className="desk-grid" key={data.id}>
      <Panel title="Filed report"><div className="row"><Pill s={data.status} /><span className="muted">{data.authorName} · {formatDate(data.createdAt, true)}</span></div>
        {data.authorAccountId === user.id && data.status !== "Approved" && type && editId !== data.id && <div><button type="button" className="btn btn-outline btn-xs" onClick={() => setEditId(data.id)}>Edit report</button></div>}
        {editId === data.id && type && data.status !== "Approved" ? <><ReportForm report={data} type={type} onSaved={() => { setEditId(undefined); reload(); }} /><div><button type="button" className="btn btn-outline btn-xs" onClick={() => setEditId(undefined)}>Cancel edit</button></div></> : <>
          <dl className="kv">{[["Occurred", data.occurredAt ? formatDate(data.occurredAt, true) : ""], ["Location", data.location], ["People involved", data.involved], ...(type?.fields.map((field) => [field.label, data.details[field.key]]) ?? [])].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="preserve">{value}</dd></div>)}</dl>
          <h3>Narrative</h3><p className="preserve">{data.narrative}</p>
        </>}
      </Panel>
      <Panel title="Command review">{data.reviewedBy && <p className="muted">Reviewed by {data.reviewedBy}</p>}{data.reviewNote && <p className="preserve">{data.reviewNote}</p>}
        {can(user.role, "command") ? <WorkflowForm label="Save review" submit={async (body) => { await api(`/api/reports/${data.id}/review`, { body }); reload(); }}><Field name="status" label="Review status" initial={data.status} options={REPORT_STATUSES} required /><Field name="note" label="Review note" initial={data.reviewNote} multiline maxLength={2000} /></WorkflowForm> : !data.reviewedBy && <p className="empty">This report hasn’t been reviewed yet.</p>}
        {can(user.role, "admin") && <Action run={async () => { if (!confirm("Permanently delete this report?")) return; await api(`/api/reports/${data.id}`, { method: "DELETE" }); navigate("/portal/reports", { replace: true }); }}>Delete report</Action>}
      </Panel>
    </div>}
  </>;
}

export function Training() {
  const [courses, courseError] = useApi<Course[]>("/api/training/courses");
  const [instructors, instructorError] = useApi<RosterMember[]>("/api/training/instructors");
  const [records, recordError] = useApi<TrainingRecord[]>("/api/training/records");
  const { user } = usePortal();
  return <><PortalTitle title="Training Academy" text="Review course materials, take written exams and track your certifications." />
    <div className="row">{can(user.role, "training") && <Link className="btn btn-outline btn-sm" to="/admin/training-records">Manage training records</Link>}</div>
    <div className="desk-grid">
      <Panel title="Course catalog"><Collection data={courses} error={courseError} empty="No courses have been published yet.">{(course) => <div className="desk-row" key={course.id}><div className="row"><h3><Link className="text-link" to={`/portal/training/${course.id}`}>{course.title}</Link></h3>{!course.published && <Pill s="Draft" />}</div><p className="muted">{course.category}{course.questionCount > 0 && ` · ${course.questionCount} exam questions`}</p><p>{course.summary}</p></div>}</Collection></Panel>
      <PortalCalendar training />
      <Panel title="My training record"><Collection data={records} error={recordError} empty="You don’t have any training records yet.">{(row) => <TrainingRecordRow key={row.id} record={row} />}</Collection></Panel>
      <Panel title="Instructor directory"><Collection data={instructors} error={instructorError} empty="No instructors are listed yet.">{(row) => <div className="desk-row" key={row.id}><h3>{row.name}</h3><p className="muted">{[row.rank, row.callsign, row.divisionName].filter(Boolean).join(" · ")}</p></div>}</Collection></Panel>
    </div>
  </>;
}

export function CourseDetail() {
  const { id } = useParams();
  const [data, error, reload] = useApi<{ course: Course; attempts: TrainingRecord[] }>(`/api/training/courses/${id}`);
  const [result, setResult] = useState<{ id: string | undefined; score: number; passed: boolean }>();
  const { member } = usePortal();
  const course = data?.course;
  return <><PortalTitle title={course?.title ?? "Training course"} text={course?.summary} /><div><Link className="text-link" to="/portal/training">← Training Academy</Link></div>
    {error ? <p className="alert error">{error}</p> : !course ? <p className="loading">Loading course…</p> : <>
      <Panel title="Training guide">{course.content ? <p className="preserve">{course.content}</p> : <p className="empty">No written material has been added.</p>}{course.fileKey && <a className="text-link" href={fileUrl(course.fileKey)} target="_blank" rel="noreferrer">Open course attachment →</a>}</Panel>
      {!!course.questions?.length && <Panel title="Written exam"><p>Passing score: {course.passingScore}%</p>
        {result && result.id === id && <p role="status" className={`alert ${result.passed ? "success" : "error"}`}>{result.passed ? "Passed" : "Not passed"} · {result.score}%</p>}
        {course.published && member ? <WorkflowForm key={id} label="Submit exam" reset success="" submit={async (values) => {
          setResult(undefined);
          const attempt = await api<{ score: number; passed: boolean }>(`/api/training/courses/${id}/exam`, { body: { answers: course.questions?.map((_, index) => Number(values[`question-${index}`])) } });
          setResult({ id, ...attempt }); reload();
        }}>{course.questions.map((question, index) => <Field key={`${index}-${question.q}`} name={`question-${index}`} label={`${index + 1}. ${question.q}`} options={question.options.map((label, value) => ({ value, label }))} placeholder="Choose an answer" required />)}</WorkflowForm> : <p className="empty">{course.published ? "Link your roster profile before taking the exam." : "The exam opens when the course is published."}</p>}
      </Panel>}
      <Panel title="My course history"><Collection data={data?.attempts} empty="No attempts or completions recorded.">{(row) => <TrainingRecordRow key={row.id} record={row} />}</Collection></Panel>
    </>}
  </>;
}
