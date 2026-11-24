import { useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { api, can, COMPLAINT_CATEGORIES, DUTY_STATUSES, fileUrl, formatDate, hours, Pill, roleLabel, uploadFile, type Announcement, type CalEvent, type Commendation, type Doc, type Me, type PersonnelFile, type PersonnelRequest, type Report, type RosterDivider, type RosterMember, type Shift, type TrainingRecord } from "../api";
import { useCustomRoles } from "../roles";
import { RosterTable } from "./Public";
import { Brand, ModeToggle } from "../components/Layout";
import { Action, AnnouncementRow, Collection, EventRow, Field, Panel, WorkflowForm } from "../components/Workflow";
import { useApi } from "../useApi";

type PortalSession = { user: Me; member: RosterMember | null; unreadMessages: number; unreadNotifications: number; openShift: Shift | null };
type PortalContext = PortalSession & { reload: () => void };
export const usePortal = () => useOutletContext<PortalContext>();

const navItems = [ ["", "Overview"], ["/roster", "Roster"], ["/profile", "Profile & records"], ["/messages", "Messages"], ["/notifications", "Notifications"], ["/calendar", "Calendar"], ["/training", "Training"], ["/reports", "Reports"], ["/requests", "Leave & resignation"], ["/documents", "Documents"], ["/misconduct", "Internal Affairs"], ["/leaderboard", "Leaderboard"], ["/search", "Search"] ];

export function PortalLayout() {
  const [session, error, reload] = useApi<PortalSession>("/api/portal/me");
  const [maint] = useApi<{ enabled: boolean; message: string }>("/api/maintenance");
  const roles = useCustomRoles();
  const location = useLocation();
  const navigate = useNavigate();
  if (maint?.enabled)
    return (
      <main className="wrap section">
        <Panel title="Portal under maintenance">
          <p role="alert" className="alert info">{maint.message}</p>
          <div className="row"><Link to="/">Public website</Link></div>
        </Panel>
      </main>
    );
  if (error === "Not signed in") return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!session || roles === null) return <main className="wrap section">{error ? <Panel title="Employee Portal unavailable"><p role="alert" className="alert error">{error}</p><div className="row"><Action run={async () => reload()}>Retry</Action><Link to="/">Public website</Link></div></Panel> : <p className="loading">Checking access…</p>}</main>;
  return <div className="portal-shell">
    <header className="portal-header"><div className="wrap portal-heading"><Brand to="/portal" /><div className="row"><span className="portal-identity">{session.user.displayName || session.user.username} · {roleLabel(session.user.role)}</span><ModeToggle /><Action run={async () => { await api("/api/auth/logout", { method: "POST" }); navigate("/", { replace: true }); }}>Sign out</Action></div></div></header>
    <div className="wrap portal-grid">
      <nav className="portal-nav" aria-label="Employee Portal"><p className="eyebrow">Employee workspace</p>{navItems.map(([path, label]) => {
        const count = path === "/messages" ? session.unreadMessages : path === "/notifications" ? session.unreadNotifications : 0;
        return <NavLink key={label} to={`/portal${path}`} end={!path}>{label}{count > 0 && <span className="count">{count}</span>}</NavLink>;
      })}
        {can(session.user.role, ["content", "command", "ia", "training", "admin"]) && <Link to="/admin">Staff administration ↗</Link>}
        <Link to="/admin/password">Change password ↗</Link><Link to="/">Public website ↗</Link>
      </nav>
      <main className="portal-content stack"><Outlet context={{ ...session, reload } satisfies PortalContext} /></main>
    </div>
  </div>;
}

export function PortalTitle({ title, text }: { title: string; text?: string }) {
  return <header className="desk-title"><p className="eyebrow">TXDPS / Employee Portal</p><h1>{title}</h1>{text && <p>{text}</p>}</header>;
}

export function PortalHome() {
  const session = usePortal();
  const [dashboard, error] = useApi<{ announcements: Announcement[]; events: CalEvent[]; reports: Report[]; pendingRequests: PersonnelRequest[]; minutesThisWeek: number }>("/api/portal/dashboard");
  return <>
    <PortalTitle title={`Welcome, ${session.member?.name || session.user.displayName || session.user.username}`} text="Your TXDPS shift brief, communications and recent activity." />
    <div className="desk-grid">
      <Panel title="Duty status" kicker="Shift desk">{session.member ? <>
        <div className="row"><Pill s={session.member.dutyStatus} />{session.openShift && <span>Since {formatDate(session.openShift.startedAt, true)}</span>}</div>
        <WorkflowForm label="Update status" submit={async (body) => { await api("/api/portal/duty", { body }); session.reload(); }}>
          <Field name="status" label="New duty status" options={DUTY_STATUSES} initial={session.member.dutyStatus} required /><Field name="notes" label="End-of-shift notes (optional)" multiline maxLength={1000} />
        </WorkflowForm>
      </> : <p className="empty">Ask command staff to link your account to a roster profile before logging duty.</p>}</Panel>
      <Panel title="My activity" kicker="At a glance"><p>Duty time this week: <strong>{dashboard ? hours(dashboard.minutesThisWeek) : "—"}</strong></p><p>Pending personnel requests: <strong>{dashboard?.pendingRequests.length ?? "—"}</strong></p><Link className="text-link" to="/portal/profile">Open personnel file →</Link>
        <Collection data={dashboard?.reports} error={error} empty="No recent reports.">{(report) => <div key={report.id} className="desk-row row"><Link to={`/portal/reports/${report.id}`}>{report.number} · {report.title}</Link><Pill s={report.status} /></div>}</Collection>
      </Panel>
    </div>
    <div className="desk-grid"><Panel title="Announcements"><Collection data={dashboard?.announcements} error={error} empty="No active announcements.">{(row) => <AnnouncementRow key={row.id} row={row} />}</Collection><Link className="text-link" to="/portal/announcements">All announcements →</Link></Panel>
      <Panel title="Upcoming events"><Collection data={dashboard?.events} error={error} empty="No upcoming events.">{(row) => <EventRow key={row.id} row={row} />}</Collection><Link className="text-link" to="/portal/calendar">Open calendar →</Link></Panel></div>
  </>;
}

export function TrainingRecordRow({ record, certificate = true }: { record: TrainingRecord; certificate?: boolean }) {
  return <div className="desk-row"><div className="row"><h3>{record.title}</h3><Pill s={record.result} /></div><p className="muted">{[record.memberName, record.kind, formatDate(record.issuedAt), record.instructor, record.score == null ? "" : `${record.score}%`].filter(Boolean).join(" · ")}</p>
    {record.certification && <p>{record.certification}{record.expiresAt && ` · Expires ${formatDate(record.expiresAt)}`}</p>}
    {record.notes && <p className="preserve">{record.notes}</p>}
    {certificate && record.certification && record.result === "Passed" && <Link className="text-link" to={`/portal/certificate/training/${record.id}`}>View certificate →</Link>}
  </div>;
}

export function PersonnelHistory({ data, showCertificates = true }: { data: PersonnelFile; showCertificates?: boolean }) {
  return <div className="desk-grid">
    <Panel title="Activity & assignments"><p>Total logged time: <strong>{hours(data.totalMinutes)}</strong></p>
      {data.units.map((unit) => <div key={unit.id} className="row"><Link to={`/divisions/${unit.unitId}`}>{unit.unitName}</Link><Pill s={unit.position || (unit.isLeader ? "Leader" : "Member")} /></div>)}
      <Collection data={data.shifts} empty="No shifts logged.">{(shift) => <div className="desk-row" key={shift.id}><strong>{formatDate(shift.startedAt, true)}</strong><p className="muted">{shift.endedAt ? `${hours(shift.minutes)} · Ended ${formatDate(shift.endedAt, true)}` : "In progress"}</p><p className="preserve">{shift.notes}</p></div>}</Collection>
    </Panel>
    <Panel title="Training & certifications"><Collection data={data.training} empty="No training records.">{(record) => <TrainingRecordRow key={record.id} record={record} certificate={showCertificates} />}</Collection></Panel>
    <Panel title="Performance evaluations"><Collection data={data.evaluations} empty="No evaluations recorded.">{(record) => <div className="desk-row" key={record.id}><h3>{record.period || "Performance evaluation"} · {record.overall}/5</h3><p className="muted">{record.evaluator} · {formatDate(record.createdAt)}</p>{Object.entries(record.ratings).map(([key, rating]) => <Pill key={key} s={`${key}: ${rating}/5`} />)}{record.strengths && <p className="preserve">Strengths: {record.strengths}</p>}{record.improvements && <p className="preserve">Improvements: {record.improvements}</p>}{record.comments && <p className="preserve">{record.comments}</p>}</div>}</Collection></Panel>
    <Panel title="Commendations & digital badges"><Collection data={data.commendations} empty="No commendations recorded.">{(record) => <div className="desk-row" key={record.id}><h3>{record.title}</h3><p className="muted">{record.kind} · {record.issuedBy} · {formatDate(record.issuedAt)}</p><p className="preserve">{record.description}</p>{showCertificates && <Link className="text-link" to={`/portal/certificate/commendation/${record.id}`}>View award →</Link>}</div>}</Collection></Panel>
    <Panel title="Disciplinary records"><Collection data={data.discipline} empty="No disciplinary records.">{(record) => <div className="desk-row" key={record.id}><h3>{record.action}</h3><p className="muted">{record.issuedBy} · {formatDate(record.issuedAt)}{record.expiresAt && ` · Expires ${formatDate(record.expiresAt)}`}</p><p className="preserve">{record.reason}</p></div>}</Collection></Panel>
    <Panel title="Personnel timeline"><Collection data={data.timeline} empty="No timeline entries.">{(record) => <div className="desk-row" key={record.id}><h3>{record.kind}</h3><p className="preserve">{record.body}</p><p className="muted">{record.actor} · {formatDate(record.createdAt)}</p></div>}</Collection></Panel>
  </div>;
}

export function PortalProfile() {
  const session = usePortal();
  const [data, error, reload] = useApi<PersonnelFile>("/api/portal/file");
  const [photo, setPhoto] = useState<File>();
  const member = data?.member;
  return <><PortalTitle title="Profile & personnel file" />
    {error ? <p className="alert error">{error}</p> : !data ? <p className="loading">Loading profile…</p> : !member ? <p className="empty">No roster profile is linked to this account. Contact command staff.</p> : <>
      <div className="desk-grid"><section className="trooper-id" data-card={member.cardTheme}>
        <div className="row"><img src="/badge.png" width="42" alt="" /><p className="eyebrow">Texas Department of Public Safety</p></div><p className="id-label">EMPLOYEE IDENTIFICATION · ROLEPLAY</p>
        <div className="row"><img className="trooper-avatar" src={fileUrl(member.photoKey) || "/badge.png"} alt="" /><div><h2>{member.name}</h2><p>{member.rank} · {member.divisionName || "Unassigned"}</p></div></div>
        <div className="row"><strong>Badge {member.badgeNumber || "—"}</strong><strong>Callsign {member.callsign || "—"}</strong><Pill s={member.status} /></div>
      </section>
      <Panel title="Edit my profile"><WorkflowForm label="Save profile" submit={async (body) => {
        const photoKey = photo ? (await uploadFile(photo, { image: true })).key : member.photoKey;
        await api("/api/portal/profile", { method: "PUT", body: { ...body, photoKey } });
        setPhoto(undefined); reload(); session.reload();
      }}><Field name="bio" label="Public bio" initial={member.bio} multiline maxLength={1500} /><Field name="cardTheme" label="ID card theme" options={["classic", "midnight", "steel", "desert", "crimson", "forest"]} initial={member.cardTheme} /><label className="field"><span>Public profile photo</span><input className="input" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setPhoto(event.target.files?.[0])} /></label></WorkflowForm></Panel></div>
      <PersonnelHistory data={data} />
    </>}
  </>;
}

export function PortalRoster() {
  const [members, error] = useApi<RosterMember[]>("/api/roster");
  const [dividers] = useApi<RosterDivider[]>("/api/roster-dividers");
  const [live, liveError, refreshLive] = useApi<{ onDuty: RosterMember[]; updatedAt: string }>("/api/roster/live");
  useEffect(() => {
    const timer = window.setInterval(refreshLive, 30_000);
    return () => window.clearInterval(timer);
  }, [refreshLive]);
  const rankGroups = new Map<string, RosterMember[]>();
  const unranked: RosterMember[] = [];
  const dividerSections = new Map<number, { label: string; sort: number; members: RosterMember[] }>();
  (dividers ?? []).forEach((d) => dividerSections.set(d.id, { label: d.label, sort: d.sortOrder, members: [] }));
  members?.forEach((m) => {
    if (m.dividerId != null || m.dividerName) {
      const key = m.dividerId ?? -1;
      const section =
        dividerSections.get(key) ?? { label: m.dividerName ?? "Section", sort: m.dividerSort ?? 0, members: [] };
      section.members.push(m);
      dividerSections.set(key, section);
      return;
    }
    if (m.rank && m.rankOrder != null) rankGroups.set(m.rank, [...(rankGroups.get(m.rank) ?? []), m]);
    else unranked.push(m);
  });
  const sections = [
    ...[...dividerSections.values()].sort((a, b) => a.sort - b.sort).map((s) => ({ name: s.label, members: s.members })),
    ...[...rankGroups.entries()].map(([name, list]) => ({ name, members: list })),
    ...(unranked.length ? [{ name: "Other", members: unranked }] : []),
  ];
  return <>
    <PortalTitle title="Department roster" text="Sworn members of the TXDPS, by chain of command." />
    <Panel title="On duty now" kicker="Live roster · refreshes every 30 seconds">
      <Collection data={live?.onDuty} error={liveError} empty="No personnel are currently on duty.">{(member) => <div className="desk-row row" key={member.id}><strong>{member.name}</strong><span className="muted">{[member.rank, member.callsign, member.divisionName].filter(Boolean).join(" · ")}</span><Pill s={member.dutyStatus} /></div>}</Collection>
      {live && <p className="muted">Updated {formatDate(live.updatedAt, true)}</p>}
    </Panel>
    {error && <p className="alert error">{error}</p>}
    {!members && !error && <p className="loading">Loading roster…</p>}
    {members?.length === 0 && <p className="empty">The roster is being updated. Check back soon.</p>}
    {sections.map((section) => (
      <div className="roster-group" key={section.name}>
        <h3>{section.name} <small>{section.members.length} {section.members.length === 1 ? "member" : "members"}</small></h3>
        <RosterTable members={section.members} />
      </div>
    ))}
  </>;
}

export function PortalMessages() {
  const [box, setBox] = useState("inbox");
  const [directory, directoryError] = useApi<{ id: number; displayName: string; username: string }[]>("/api/portal/directory");
  const [messages, error, reload] = useApi<{ id: number; fromName: string; toName: string; subject: string; body: string; readAt: string | null; createdAt: string }[]>(`/api/portal/messages?box=${box}`);
  const session = usePortal();
  return <><PortalTitle title="Messages" text="Send and receive messages within the department." /><div className="desk-grid">
    <Panel title={box === "inbox" ? "Inbox" : "Sent messages"}><div className="row">{["inbox", "sent"].map((tab) => <button type="button" className={`btn btn-xs ${box === tab ? "btn-gold" : "btn-outline"}`} aria-pressed={box === tab} key={tab} onClick={() => setBox(tab)}>{tab === "inbox" ? "Inbox" : "Sent"}</button>)}</div>
      <Collection data={messages} error={error} empty="No messages in this folder.">{(message) => <details className="desk-row" key={message.id}><summary>{message.subject}{box === "inbox" && !message.readAt && " · Unread"}</summary><p className="muted">{box === "inbox" ? `From ${message.fromName}` : `To ${message.toName}`} · {formatDate(message.createdAt, true)}</p><p className="preserve">{message.body}</p><div className="row">{box === "inbox" && !message.readAt && <Action run={async () => { await api(`/api/portal/messages/${message.id}/read`, { method: "POST" }); reload(); session.reload(); }}>Mark as read</Action>}<Action run={async () => { if (!confirm("Delete this message?")) return; await api(`/api/portal/messages/${message.id}`, { method: "DELETE" }); reload(); session.reload(); }}>Delete</Action></div></details>}</Collection>
    </Panel>
    <Panel title="Compose message">{directoryError ? <p className="alert error">{directoryError}</p> : directory && <WorkflowForm label="Send message" reset success="Message sent." submit={async (body) => { await api("/api/portal/messages", { body }); if (box === "sent") reload(); }}><Field name="to" label="Recipient" options={directory.map((person) => ({ value: person.id, label: person.displayName || person.username }))} placeholder="Choose a recipient" required /><Field name="subject" label="Subject" maxLength={200} /><Field name="body" label="Message" required multiline maxLength={5000} /></WorkflowForm>}{!directory && !directoryError && <p className="loading">Loading recipients…</p>}</Panel>
  </div></>;
}

export function PortalNotifications() {
  const [data, error, reload] = useApi<{ id: number; title: string; body: string; link: string; unread: boolean; createdAt: string }[]>("/api/portal/notifications");
  const session = usePortal();
  return <><PortalTitle title="Notifications" /><Panel title="Department updates">{data?.some((row) => row.unread) && <Action run={async () => { await api("/api/portal/notifications/seen", { method: "POST" }); reload(); session.reload(); }}>Mark all as read</Action>}
    <Collection data={data} error={error} empty="No notifications.">{(row) => <div className="desk-row" key={row.id}><h3>{row.title} {row.unread && <Pill s="New" />}</h3><p className="muted">{formatDate(row.createdAt, true)}</p><p className="preserve">{row.body}</p>{/^\/(portal|admin|training|reports)(\/|$)/.test(row.link) && <Link className="text-link" to={row.link}>View details →</Link>}</div>}</Collection>
  </Panel></>;
}

export function PortalAnnouncements() {
  const [data, error] = useApi<Announcement[]>("/api/portal/announcements");
  return <><PortalTitle title="Department announcements" /><Panel title="Notice board"><Collection data={data} error={error} empty="No announcements.">{(row) => <AnnouncementRow key={row.id} row={row} />}</Collection></Panel></>;
}

export function PortalCalendar({ training = false }: { training?: boolean }) {
  const [data, error, reload] = useApi<CalEvent[]>("/api/portal/events");
  return <Panel title={training ? "Training schedule" : "Department calendar"}>
    <Collection data={data?.filter((row) => (!training || row.kind === "Training") && new Date(row.endsAt || row.startsAt).getTime() > Date.now())} error={error} empty="No upcoming events.">{(row) => <EventRow row={row} key={row.id}>
      {row.allowSignup && <div className="row"><span className="muted">{row.signups ?? 0} signed up</span><Action run={async () => { await api(`/api/portal/events/${row.id}/signup`, { method: row.signedUp ? "DELETE" : "POST" }); reload(); }}>{row.signedUp ? "Cancel sign-up" : "Sign up"}</Action></div>}
      {!!row.attendees?.length && <p className="muted">Attendees: {row.attendees.join(", ")}</p>}
    </EventRow>}</Collection>
  </Panel>;
}

export function PortalRequests() {
  const [requests, error, reload] = useApi<PersonnelRequest[]>("/api/portal/requests");
  const [kind, setKind] = useState("LOA");
  const session = usePortal();
  return <><PortalTitle title="Leave & resignation" /><div className="desk-grid"><Panel title="Request history">
    <Collection data={requests} error={error} empty="You have not submitted any requests.">{(row) => <div className="desk-row" key={row.id}><div className="row"><h3>{row.kind === "LOA" ? "Leave of absence" : "Resignation"}</h3><Pill s={row.status} /></div><p>{row.startDate}{row.endDate && ` – ${row.endDate}`}</p><p className="preserve">{row.reason}</p>{row.reviewNote && <p className="preserve">Review: {row.reviewNote}</p>}{row.status === "Pending" && <Action run={async () => { if (!confirm("Cancel this request?")) return; await api(`/api/portal/requests/${row.id}/cancel`, { method: "POST" }); reload(); }}>Cancel request</Action>}</div>}</Collection>
  </Panel><Panel title="Submit a request">{session.member ? <>
    {session.member.status === "LOA" && <Action run={async () => { await api("/api/portal/return-from-loa", { method: "POST" }); session.reload(); }}>Return from leave</Action>}
    <label className="field"><span>Request type</span><select className="input" value={kind} onChange={(event) => setKind(event.target.value)}><option value="LOA">Leave of absence</option><option>Resignation</option></select></label>
    <WorkflowForm label="Submit request" reset success="Request sent to command staff." submit={async (body) => { if (body.endDate && body.endDate < body.startDate) throw new Error("End date must be on or after the start date."); await api("/api/portal/requests", { body: { ...body, kind } }); reload(); }}>
      <Field name="startDate" label={kind === "LOA" ? "Start date" : "Effective date"} type="date" required />{kind === "LOA" && <Field name="endDate" label="End date" type="date" />}<Field name="reason" label="Reason" multiline required maxLength={3000} />
    </WorkflowForm></> : <p className="empty">Your account must be linked to a roster profile before you can submit a request.</p>}</Panel></div></>;
}

export function DocumentRow({ row }: { row: Doc }) {
  const target = fileUrl(row.fileKey) || row.externalUrl;
  return <div className="desk-row"><h3>{row.title}</h3><p className="muted">{row.category}</p>{row.description && <p className="preserve">{row.description}</p>}{target && /^(https?:\/\/|\/api\/files\/)/i.test(target) && <a className="text-link" href={target} target="_blank" rel="noreferrer">Open document →</a>}</div>;
}

export function PortalDocuments() {
  const [data, error] = useApi<Doc[]>("/api/portal/documents");
  return <><PortalTitle title="Department documents" text="Policies, procedures, forms and records for department staff." /><Panel title="Resource library"><Collection data={data} error={error} empty="No documents available.">{(row) => <DocumentRow key={row.id} row={row} />}</Collection></Panel></>;
}

export function PortalMisconduct() {
  const [receipt, setReceipt] = useState<{ caseNumber: string; trackingCode: string }>();
  return <><PortalTitle title="Report misconduct" text="Submit a report to TXDPS Internal Affairs." /><Panel title={receipt ? "Report received" : "Internal report"}>
    {receipt ? <><p>Case <strong>{receipt.caseNumber}</strong> · Private tracking code <strong className="reference-code">{receipt.trackingCode}</strong></p><Link className="text-link" to="/complaint/status">Check status →</Link><div><Action run={async () => setReceipt(undefined)}>File another report</Action></div></> : <WorkflowForm label="Submit to Internal Affairs" success="" submit={async (body) => setReceipt(await api("/api/portal/misconduct", { body }))}>
      <div className="form-grid"><Field name="officerName" label="Employee name" required maxLength={120} /><Field name="officerBadge" label="Badge or callsign" maxLength={40} /><Field name="incidentDate" label="Incident date" type="date" /><Field name="location" label="Location" maxLength={200} /><Field name="category" label="Category" options={COMPLAINT_CATEGORIES} required /></div>
      <Field name="description" label="What happened?" required multiline maxLength={6000} /><Field name="evidence" label="Evidence links or details" multiline maxLength={3000} />
    </WorkflowForm>}
  </Panel></>;
}

export function PortalLeaderboard() {
  const [days, setDays] = useState("30");
  const [data, error] = useApi<{ board: (RosterMember & { minutes: number; reports: number; commendations: number; training: number; score: number })[] }>(`/api/portal/leaderboard?days=${days}`);
  return <><PortalTitle title="Department leaderboard" /><Panel title="Activity rankings"><label className="field"><span>Time range</span><select className="input" value={days} onChange={(event) => setDays(event.target.value)}>{[7, 30, 90, 365].map((value) => <option value={value} key={value}>Last {value} days</option>)}</select></label><Collection data={data?.board} error={error} empty="No activity to rank yet.">{(row) => <div className="desk-row" key={row.id}><div className="row"><h3>{row.name}</h3><Pill s={`${row.score} points`} /></div><p className="muted">{row.rank} · {hours(row.minutes)} on duty · {row.reports} reports · {row.training} training passes · {row.commendations} commendations</p></div>}</Collection></Panel></>;
}

export function PortalSearch() {
  const [q, setQ] = useState("");
  const [data, error] = useApi<{ members: RosterMember[]; reports: Report[]; documents: Doc[]; announcements: Announcement[]; pages: { slug: string; title: string }[] }>(q ? `/api/portal/search?${new URLSearchParams({ q })}` : null);
  return <><PortalTitle title="Search the department" /><Panel title="Search"><WorkflowForm label="Search" success="" submit={async ({ query }) => setQ(query.trim())}><Field name="query" label="Name, callsign, report or document" required maxLength={100} /></WorkflowForm></Panel>
    {q && <div className="desk-grid">
      <Panel title="Troopers"><Collection data={data?.members} error={error} empty="No matching troopers.">{(row) => <div className="desk-row" key={row.id}><strong>{row.name}</strong><p className="muted">{[row.rank, row.callsign, row.divisionName].filter(Boolean).join(" · ")}</p></div>}</Collection></Panel>
      <Panel title="Reports"><Collection data={data?.reports} error={error} empty="No matching reports.">{(row) => <div className="desk-row" key={row.id}><Link className="text-link" to={`/portal/reports/${row.id}`}>{row.number} · {row.title}</Link></div>}</Collection></Panel>
      <Panel title="Documents"><Collection data={data?.documents} error={error} empty="No matching documents.">{(row) => <DocumentRow key={row.id} row={row} />}</Collection></Panel>
      <Panel title="Announcements & pages"><Collection data={data?.announcements} error={error} empty="No matching announcements.">{(row) => <div className="desk-row" key={row.id}><Link to="/portal/announcements">{row.title}</Link></div>}</Collection><Collection data={data?.pages} error={error} empty="No matching pages.">{(row) => <div className="desk-row" key={row.slug}><Link to={row.slug === "guidelines" ? "/community" : ["history", "mission", "values"].includes(row.slug) ? "/about" : `/policies/${row.slug}`}>{row.title}</Link></div>}</Collection></Panel>
    </div>}
  </>;
}

export function PortalCertificate() {
  const { kind, id } = useParams();
  const [data, error] = useApi<{ kind: string; record: Commendation | TrainingRecord; member: RosterMember }>(`/api/portal/certificate/${kind}/${id}`);
  return <><PortalTitle title="Digital award" />{error ? <p className="alert error">{error}</p> : !data ? <p className="loading">Loading award…</p> : <>
    <div className="trooper-certificate"><img src="/badge.png" width="74" alt="" /><p className="eyebrow">Texas Department of Public Safety</p><h2>{"certification" in data.record ? data.record.certification || data.record.title : data.record.title}</h2><p>Presented to</p><strong>{data.member.name}</strong><p>{data.member.rank} · {formatDate(data.record.issuedAt)}</p><p className="muted">TXDPS roleplay community</p></div>
    <div className="print-control"><button type="button" className="btn btn-gold btn-sm" onClick={() => window.print()}>Print award</button></div>
  </>}</>;
}
