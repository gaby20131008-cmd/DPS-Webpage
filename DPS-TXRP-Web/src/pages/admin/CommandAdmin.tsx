import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, can, COMMENDATION_KINDS, DISCIPLINARY_ACTIONS, EVALUATION_CATEGORIES, formatDate, hours, Pill, REQUEST_STATUSES, type Complaint, type Discipline, type PersonnelFile, type PersonnelRequest, type Rank, type Report, type RosterMember, type Shift } from "../../api";
import { Action, Collection, Field, Panel, WorkflowForm } from "../../components/Workflow";
import { useApi } from "../../useApi";
import { PersonnelHistory } from "../Portal";
import { AdminTop, useMe } from "./AdminLayout";

export function RequestsAdmin() {
  const [data, error, reload] = useApi<PersonnelRequest[]>("/api/admin/requests");
  return <><AdminTop title="Personnel requests" text="Review leave of absence and resignation submissions." /><Panel title="Request queue">
    <Collection data={data} error={error} empty="No requests have been filed.">{(row) => <details className="desk-row" key={row.id}><summary>{row.requesterName} · {row.kind === "LOA" ? "Leave of absence" : row.kind} · {row.status}</summary><p>{row.startDate}{row.endDate && ` – ${row.endDate}`}</p><p className="preserve">{row.reason}</p>{row.reviewedBy && <p className="muted">Reviewed by {row.reviewedBy}</p>}
      {row.status === "Pending" ? <WorkflowForm label="Save decision" submit={async (body) => { await api(`/api/admin/requests/${row.id}`, { method: "PATCH", body }); reload(); }}><Field name="status" label="Decision" options={REQUEST_STATUSES.filter((status) => status !== "Pending")} placeholder="Choose a decision" required /><Field name="note" label="Review note" multiline maxLength={2000} /></WorkflowForm> : row.reviewNote && <p className="preserve">{row.reviewNote}</p>}
    </details>}</Collection>
  </Panel></>;
}

export function PersonnelDirectory() {
  const [roster, error] = useApi<RosterMember[]>("/api/roster");
  const [query, setQuery] = useState("");
  return <><AdminTop title="Personnel files" text="Open a trooper’s service record or manage rank and discipline." /><Panel title="Directory">
    <label className="field"><span>Find a trooper</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    <Collection data={roster?.filter((row) => `${row.name} ${row.rank} ${row.callsign} ${row.badgeNumber}`.toLowerCase().includes(query.toLowerCase().trim()))} error={error} empty="No matching troopers.">{(row) => <div className="desk-row row" key={row.id}><Link className="text-link" to={`/admin/members/${row.id}`}>{row.name}</Link><span className="muted">{[row.rank, row.callsign].filter(Boolean).join(" · ")}</span><Pill s={row.status} /></div>}</Collection>
  </Panel></>;
}

export function MemberAdmin() {
  const { id } = useParams();
  const endpoint = `/api/admin/members/${id}`;
  const user = useMe();
  const [data, error, reload] = useApi<PersonnelFile & { account: { id: number; username: string } | null }>(`${endpoint}/file`);
  const [ranks] = useApi<Rank[]>(can(user.role, "command") ? "/api/ranks" : null);
  const [complaints] = useApi<Complaint[]>(can(user.role, "ia") ? "/api/admin/complaints" : null);
  const member = data?.member;
  const create = (path: string) => async (body: Record<string, unknown>) => { await api(`${endpoint}/${path}`, { body }); reload(); };
  return <><AdminTop title={member?.name ?? "Personnel file"} text={member ? [member.rank, member.callsign, member.divisionName].filter(Boolean).join(" · ") : undefined}><Link className="btn btn-outline btn-sm" to="/admin/members">Personnel directory</Link></AdminTop>
    {error ? <p className="alert error">{error}</p> : !data || !member ? <p className="loading">Loading personnel file…</p> : <div className="stack" key={member.id}>
      <div className="row"><Pill s={member.status} /><span>Badge {member.badgeNumber || "—"}</span>{data.account && <span className="muted">Account: {data.account.username}</span>}</div>
      <div className="desk-grid">
        {can(user.role, "command") && <>
          <Panel title="Rank assignment"><WorkflowForm label="Change rank" submit={create("rank")}><Field name="rank" label="New rank (highest to lowest)" options={(ranks ?? []).map((rank) => rank.name)} initial={member.rank} placeholder="Choose a rank" required /><Field name="note" label="Reason for promotion or demotion" multiline maxLength={1000} /></WorkflowForm></Panel>
          <Panel title="Issue a commendation"><WorkflowForm label="Issue award" reset submit={create("commendations")}><Field name="title" label="Award title" required maxLength={200} /><Field name="kind" label="Award type" options={COMMENDATION_KINDS} required /><Field name="description" label="Citation" multiline maxLength={3000} /></WorkflowForm></Panel>
        </>}
        {can(user.role, "training") && <Panel title="Performance evaluation"><WorkflowForm label="Record evaluation" reset submit={async (body) => {
          const ratings = Object.fromEntries(EVALUATION_CATEGORIES.map((category) => [category, body[category]]));
          await create("evaluations")({ period: body.period, strengths: body.strengths, improvements: body.improvements, comments: body.comments, ratings });
        }}><Field name="period" label="Review period" required maxLength={80} /><div className="form-grid">{EVALUATION_CATEGORIES.map((category) => <Field key={category} name={category} label={`${category} (1–5)`} type="number" min={1} max={5} />)}</div><Field name="strengths" label="Strengths" multiline maxLength={3000} /><Field name="improvements" label="Areas for improvement" multiline maxLength={3000} /><Field name="comments" label="Comments" multiline maxLength={3000} /></WorkflowForm></Panel>}
        {can(user.role, "ia") && <Panel title="Record disciplinary action"><WorkflowForm label="Record action" reset submit={async (body) => create("discipline")({ ...body, complaintId: body.complaintId || null, expiresAt: body.expiresAt ? new Date(body.expiresAt).toISOString() : null })}><Field name="action" label="Disciplinary action" options={DISCIPLINARY_ACTIONS} required /><Field name="complaintId" label="Related case" options={(complaints ?? []).map((row) => ({ value: row.id, label: row.caseNumber }))} placeholder="No related case" /><Field name="expiresAt" label="Expiry date and time" type="datetime-local" /><Field name="reason" label="Reason" multiline required maxLength={4000} /></WorkflowForm></Panel>}
        {can(user.role, "owner") && <Panel title="Linked account"><p>{data.account ? `Linked to ${data.account.username}.` : "No login is linked to this trooper."}</p><Link className="text-link" to="/admin/accounts">Manage accounts →</Link></Panel>}
      </div><PersonnelHistory data={data} showCertificates={can(user.role, ["command", "training"])} />
    </div>}
  </>;
}

export function DisciplineAdmin() {
  const [rows, error, reload] = useApi<Discipline[]>("/api/admin/discipline");
  return <><AdminTop title="Disciplinary records"><Link className="btn btn-outline btn-sm" to="/admin/members">Personnel directory</Link></AdminTop><Panel title="Records register"><Collection data={rows} error={error} empty="No disciplinary actions recorded.">{(row) => <div className="desk-row" key={row.id}><h3><Link className="text-link" to={`/admin/members/${row.memberId}`}>{row.memberName}</Link> · {row.action}</h3><p className="muted">{row.issuedBy} · {formatDate(row.issuedAt)}{row.caseNumber && ` · ${row.caseNumber}`}</p><p className="preserve">{row.reason}</p><Action run={async () => { if (!confirm("Delete this disciplinary record?")) return; await api(`/api/admin/discipline/${row.id}`, { method: "DELETE" }); reload(); }}>Delete record</Action></div>}</Collection></Panel></>;
}

type Audit = { id: number; actor: string; action: string; target: string; details: string; createdAt: string };

export function ActivityAdmin() {
  const [data, error] = useApi<{ shifts: (Shift & { name: string; rank: string })[]; reports: Report[] }>("/api/admin/activity");
  return <><AdminTop title="Department activity" /><div className="desk-grid">
    <Panel title="Recent duty shifts"><Collection data={data?.shifts} error={error} empty="No recent shifts.">{(row) => <div className="desk-row" key={row.id}><h3>{row.name}</h3><p className="muted">{formatDate(row.startedAt, true)} · {row.endedAt ? hours(row.minutes) : "In progress"}</p></div>}</Collection></Panel>
    <Panel title="Recent reports"><Collection data={data?.reports} error={error} empty="No recent reports.">{(row) => <div className="desk-row" key={row.id}><div className="row"><Link className="text-link" to={`/portal/reports/${row.id}`}>{row.title}</Link><Pill s={row.status} /></div><p className="muted">{row.number} · {row.authorName}</p></div>}</Collection></Panel>
  </div></>;
}

export function AuditAdmin() {
  const [query, setQuery] = useState("");
  const [data, error] = useApi<Audit[]>(`/api/admin/audit?${new URLSearchParams({ q: query })}`);
  return <><AdminTop title="Audit log" text="Review administrative changes and who made them." /><Panel title="Administrative history"><WorkflowForm label="Search audit log" success="" submit={async (body) => setQuery(body.q.trim())}><Field name="q" label="Actor, action or target" maxLength={100} /></WorkflowForm>
    <Collection data={data} error={error} empty="No audit entries match.">{(row) => <div className="desk-row" key={row.id}><h3>{row.action}{row.target && ` · ${row.target}`}</h3><p className="muted">{row.actor} · {formatDate(row.createdAt, true)}</p>{row.details && <p className="preserve">{row.details}</p>}</div>}</Collection>
  </Panel></>;
}
