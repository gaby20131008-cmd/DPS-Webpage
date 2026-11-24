import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  api, ASSIGNABLE_ROLES, can, COMPLAINT_CATEGORIES, COMPLAINT_CLOSED, COMPLAINT_PRIORITIES, COMPLAINT_STATUSES, CUSTOM_PERM_OPTIONS,
  CUSTOM_ROLE_PREFIX, formatDate, roleLabel, statusTone, type Complaint, type CustomRole, type LoginEvent, type RosterMember,
} from "../../api";
import { reloadCustomRoles } from "../../roles";
import { useApi } from "../../useApi";
import { CloseIcon, PlusIcon } from "../../components/Icons";
import { Field, Panel, WorkflowForm } from "../../components/Workflow";
import { AdminTop, RequirePerm, useMe, useRefreshCounts } from "./AdminLayout";

const webhookLabel: Record<string, [string, string]> = {
  sent: ["Sent to Discord", "green"],
  failed: ["Discord failed", "red"],
  not_configured: ["No webhook set", ""],
  pending: ["Sending…", "gold"],
  withheld: ["Confidential — not posted", "gold"],
};

/* ------------------------------ Internal Affairs ------------------------------ */

const CasePills = ({ c }: { c: Complaint }) => (
  <>
    <span className={`pill ${statusTone(c.status)}`}>{c.status}</span>
    {c.reviewStatus === "pending" && <span className="pill gold" style={{ marginLeft: 6 }}>Awaiting approval</span>}
    {c.confidential && <span className="pill red" style={{ marginLeft: 6 }}>Confidential</span>}
  </>
);

type IAStatsData = {
  byStatus: { k: string; n: number }[];
  byCategory: { k: string; n: number }[];
  byPriority: { k: string; n: number }[];
  bySource: { k: string; n: number }[];
  overdue: number;
  discipline90d: number;
  opened30d: number;
  closed30d: number;
  avgDaysToClose: number;
  trendOpen: { m: string; n: number }[];
  trendClosed: { m: string; n: number }[];
};

const Bar = ({ label, n, max, tone }: { label: string; n: number; max: number; tone?: string }) => (
  <div className="row" style={{ gap: 12, alignItems: "center" }}>
    <span style={{ minWidth: 150, flex: "none" }} className="muted">{label || "—"}</span>
    <div style={{ flex: 1, height: 8, background: "rgba(128,128,128,.25)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${max ? Math.round((n / max) * 100) : 0}%`, height: "100%", background: tone === "green" ? "#5cb87a" : "var(--gold)", borderRadius: 4 }} />
    </div>
    <span style={{ minWidth: 30, textAlign: "right", fontWeight: 700 }}>{n}</span>
  </div>
);

function IAStats() {
  const [s, error] = useApi<IAStatsData>("/api/admin/ia/stats");
  if (error || !s) return null;
  const total = s.byStatus.reduce((a, b) => a + b.n, 0);
  const open = s.byStatus.filter((x) => !COMPLAINT_CLOSED.includes(x.k)).reduce((a, b) => a + b.n, 0);
  const maxStatus = Math.max(1, ...s.byStatus.map((x) => x.n));
  const maxCat = Math.max(1, ...s.byCategory.map((x) => x.n));
  const maxPri = Math.max(1, ...s.byPriority.map((x) => x.n));
  const months = [...new Set([...s.trendOpen.map((t) => t.m), ...s.trendClosed.map((t) => t.m)])].sort();
  const openedAt = (m: string) => s.trendOpen.find((t) => t.m === m)?.n ?? 0;
  const closedAt = (m: string) => s.trendClosed.find((t) => t.m === m)?.n ?? 0;
  const maxMonth = Math.max(1, ...months.map((m) => Math.max(openedAt(m), closedAt(m))));
  const monthLabel = (m: string) => new Date(`${m}-15T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  return (
    <>
      <div className="stats">
        {[
          [total, "Total cases"],
          [open, "Open cases"],
          [s.opened30d, "Opened · 30 days"],
          [s.closed30d, "Closed · 30 days"],
          [s.avgDaysToClose, "Avg days to close"],
          [s.overdue, "Overdue >14 days"],
          [s.discipline90d, "Discipline · 90 days"],
        ].map(([n, label]) => (
          <div className="stat" key={label as string}><div className="n">{n}</div><div className="l">{label}</div></div>
        ))}
      </div>
      <div className="stack" style={{ marginBottom: 30 }}>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Cases by status</h3>
          {s.byStatus.length === 0 && <p className="muted" style={{ margin: 0 }}>No cases yet.</p>}
          {s.byStatus.map((x) => <Bar key={x.k} label={x.k} n={x.n} max={maxStatus} tone={COMPLAINT_CLOSED.includes(x.k) ? "green" : undefined} />)}
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Cases by type</h3>
          {s.byCategory.map((x) => <Bar key={x.k} label={x.k} n={x.n} max={maxCat} />)}
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Priority</h3>
          {s.byPriority.map((x) => <Bar key={x.k} label={x.k} n={x.n} max={maxPri} />)}
        </div>
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Opened vs closed · last 6 months</h3>
          {months.length === 0 && <p className="muted" style={{ margin: 0 }}>No activity in this period.</p>}
          {months.map((m) => (
            <div key={m} className="stack" style={{ gap: 6 }}>
              <Bar label={`${monthLabel(m)} · opened`} n={openedAt(m)} max={maxMonth} />
              <Bar label={`${monthLabel(m)} · closed`} n={closedAt(m)} max={maxMonth} tone="green" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Closure requests waiting on a command decision. */
function ReviewQueue({ reloadParent }: { reloadParent: () => void }) {
  const me = useMe();
  const refreshCounts = useRefreshCounts();
  const [rows, error, reload] = useApi<Complaint[]>(can(me.role, "command") ? "/api/admin/ia/reviews" : null);
  const [busy, setBusy] = useState(false);
  if (!can(me.role, "command") || error || !rows) return null;

  async function decide(id: number, approved: boolean) {
    let note = "";
    if (!approved) {
      const input = prompt("Reason for rejecting this closure (shared with the investigator):");
      if (input === null) return;
      note = input;
    }
    setBusy(true);
    try {
      await api(`/api/admin/complaints/${id}/review`, { body: { approved, note } });
      reload();
      reloadParent();
      refreshCounts();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack" style={{ marginBottom: 30, borderColor: "var(--gold)" }}>
      <h3 style={{ margin: 0 }}>Cases awaiting closure approval ({rows.length})</h3>
      {rows.map((c) => (
        <details className="desk-row" key={c.id}>
          <summary>{c.caseNumber} · close as “{c.requestedStatus}” · {c.category}</summary>
          <p className="muted">Assigned to {c.assignedTo || "—"} · last update {formatDate(c.updatedAt, true)}</p>
          <div className="row">
            <button className="btn btn-gold btn-xs" disabled={busy} onClick={() => decide(c.id, true)}>Approve closure</button>
            <button className="btn btn-danger btn-xs" disabled={busy} onClick={() => decide(c.id, false)}>Reject</button>
          </div>
        </details>
      ))}
    </div>
  );
}

export function IAList() {
  const [rows, error, reload] = useApi<Complaint[]>("/api/admin/complaints");
  const [showStats, setShowStats] = useState(false);
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const filtered = rows?.filter((c) => {
    if (c.source === "ia") return false;
    if (status === "active" && COMPLAINT_CLOSED.includes(c.status)) return false;
    if (status !== "active" && status !== "all" && c.status !== status) return false;
    const hay = `${c.caseNumber} ${c.complainantName} ${c.complainantDiscord} ${c.complainantRoblox} ${c.officerName} ${c.officerBadge} ${c.category}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  return (
    <RequirePerm perm="ia">
      <AdminTop title="Internal Affairs" text="Complaints filed through the website and the employee portal. Cases opened by your division live under Cases." />
      <ReviewQueue reloadParent={reload} />
      <div className="toolbar">
        <button className="btn btn-outline btn-sm" onClick={() => setShowStats(!showStats)}>{showStats ? "Hide statistics" : "Show statistics"}</button>
      </div>
      {showStats && <IAStats />}
      <div className="toolbar">
        <input className="input search" placeholder="Search by case, name, trooper…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Open &amp; in progress</option>
          <option value="all">All complaints</option>
          {COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="alert error">{error}</p>}
      {!rows && !error && <p className="loading">Loading complaints…</p>}
      {rows && filtered?.length === 0 && <div className="card center muted">No complaints match this view.</div>}
      {filtered && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Case</th><th>Filed</th><th>Complainant</th><th>Trooper</th><th>Type</th><th>Assigned</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/admin/internal-affairs/${c.id}`} className="gold" style={{ fontWeight: 700 }}>{c.caseNumber}</Link></td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>{c.complainantName}</td>
                  <td>{c.officerName || "—"}{c.officerBadge ? ` #${c.officerBadge}` : ""}</td>
                  <td>{c.category}</td>
                  <td>{c.assignedTo || <span className="muted">—</span>}</td>
                  <td><CasePills c={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </RequirePerm>
  );
}

/* ------------------------------ IA cases (opened by Internal Affairs) ------------------------------ */

type CaseDraft = {
  complainantName: string; officerName: string; officerBadge: string; incidentDate: string; location: string;
  category: string; description: string; evidence: string; priority: string; subjectMemberId: number | null; confidential: boolean;
};

const EMPTY_CASE: CaseDraft = {
  complainantName: "", officerName: "", officerBadge: "", incidentDate: "", location: "",
  category: "Misconduct", description: "", evidence: "", priority: "Normal", subjectMemberId: null, confidential: false,
};

export function IACases() {
  const [rows, error] = useApi<Complaint[]>("/api/admin/complaints");
  const [roster] = useApi<RosterMember[]>("/api/roster");
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<CaseDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const nav = useNavigate();
  const cases = rows?.filter((c) => c.source === "ia");
  const openCount = cases?.filter((c) => !COMPLAINT_CLOSED.includes(c.status)).length ?? 0;
  const filtered = cases?.filter((c) => {
    if (status === "active" && COMPLAINT_CLOSED.includes(c.status)) return false;
    if (status !== "active" && status !== "all" && c.status !== status) return false;
    const hay = `${c.caseNumber} ${c.complainantName} ${c.officerName} ${c.officerBadge} ${c.category} ${c.description}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setErr(undefined);
    try {
      const saved: Complaint = await api("/api/admin/cases", { body: draft });
      setDraft(null);
      nav(`/admin/internal-affairs/${saved.id}`);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequirePerm perm="ia">
      <AdminTop title="Internal Affairs Cases" text={`Cases opened by your division, separate from complaints filed through the website. ${openCount === 1 ? "1 case is" : `${openCount} cases are`} still open.`}>
        <button className="btn btn-gold btn-sm" onClick={() => { setErr(undefined); setDraft({ ...EMPTY_CASE }); }}>
          <PlusIcon size={18} /> New case
        </button>
      </AdminTop>
      <div className="toolbar">
        <input className="input search" placeholder="Search by case, trooper, details…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: "auto" }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Open &amp; in progress</option>
          <option value="all">All cases</option>
          {COMPLAINT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      {error && <p className="alert error">{error}</p>}
      {!rows && !error && <p className="loading">Loading cases…</p>}
      {rows && filtered?.length === 0 && <div className="card center muted">No cases match this view. Use “New case” to open one.</div>}
      {filtered && filtered.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Case</th><th>Opened</th><th>Subject trooper</th><th>Type</th><th>Assigned</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/admin/internal-affairs/${c.id}`} className="gold" style={{ fontWeight: 700 }}>{c.caseNumber}</Link></td>
                  <td>{formatDate(c.createdAt)}</td>
                  <td>{c.officerName || "—"}{c.officerBadge ? ` #${c.officerBadge}` : ""}</td>
                  <td>{c.category}</td>
                  <td>{c.assignedTo || <span className="muted">—</span>}</td>
                  <td><CasePills c={c} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <form className="modal" onSubmit={create}>
            <div className="modal-head">
              <h2>Open a new case</h2>
              <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label="Close"><CloseIcon /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="c-cat">Case type *</label>
                  <select id="c-cat" className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                    {COMPLAINT_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-pri">Priority</label>
                  <select id="c-pri" className="input" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                    {COMPLAINT_PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-rep">Reporting party</label>
                  <input id="c-rep" className="input" placeholder="Leave blank if opened internally" value={draft.complainantName} onChange={(e) => setDraft({ ...draft, complainantName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="c-dep">Subject trooper</label>
                  <input id="c-dep" className="input" placeholder="Name" value={draft.officerName} onChange={(e) => setDraft({ ...draft, officerName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="c-badge">Badge / callsign</label>
                  <input id="c-badge" className="input" value={draft.officerBadge} onChange={(e) => setDraft({ ...draft, officerBadge: e.target.value })} />
                </div>
                {roster && (
                  <div className="field">
                    <label htmlFor="c-member">Roster profile</label>
                    <select id="c-member" className="input" value={draft.subjectMemberId ?? ""} onChange={(e) => setDraft({ ...draft, subjectMemberId: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">Not linked</option>
                      {roster.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.rank}</option>)}
                    </select>
                  </div>
                )}
                <div className="field">
                  <label htmlFor="c-date">Incident date</label>
                  <input id="c-date" className="input" placeholder="e.g. 12 March 2026" value={draft.incidentDate} onChange={(e) => setDraft({ ...draft, incidentDate: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="c-loc">Location</label>
                  <input id="c-loc" className="input" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="c-desc">Case summary *</label>
                  <textarea id="c-desc" className="input" rows={5} required maxLength={6000} placeholder="What is being investigated, and why was this case opened?" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="c-ev">Evidence links or references</label>
                  <textarea id="c-ev" className="input" rows={3} maxLength={3000} placeholder="One item per line — links, report numbers, bodycam references…" value={draft.evidence} onChange={(e) => setDraft({ ...draft, evidence: e.target.value })} />
                </div>
                <label className="checkbox" style={{ gridColumn: "1 / -1" }}>
                  <input type="checkbox" checked={draft.confidential} onChange={(e) => setDraft({ ...draft, confidential: e.target.checked })} />
                  Confidential case <span className="hint">— visible only to command staff and the assigned investigator, and never posted to Discord</span>
                </label>
              </div>
              {err && <p className="alert error" style={{ margin: 0 }}>{err}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-gold btn-sm" disabled={busy}>{busy ? "Opening…" : "Open case"}</button>
            </div>
          </form>
        </div>
      )}
    </RequirePerm>
  );
}

export function IADetail() {
  const { id } = useParams();
  const me = useMe();
  const nav = useNavigate();
  const refreshCounts = useRefreshCounts();
  const [data, error, reload] = useApi<{ complaint: Complaint; notes: { id: number; author: string; body: string; createdAt: string }[] }>(
    can(me.role, "ia") ? `/api/admin/complaints/${id}` : null,
  );
  const [note, setNote] = useState("");
  const [assign, setAssign] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const [roster] = useApi<RosterMember[]>(can(me.role, "ia") ? "/api/roster" : null);

  if (!can(me.role, "ia")) return <p className="alert error">Your account doesn't have access to Internal Affairs.</p>;
  if (error) return <p className="alert error">{error}</p>;
  if (!data) return <p className="loading">Loading complaint…</p>;
  const c = data.complaint;
  const isCommand = can(me.role, "command");
  const pending = c.reviewStatus === "pending";

  async function patch(body: Record<string, string>) {
    setBusy(true);
    try {
      await api(`/api/admin/complaints/${c.id}`, { method: "PATCH", body });
      reload();
      refreshCounts();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await api(`/api/admin/complaints/${c.id}/notes`, { body: { body: note } });
      setNote("");
      reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setMsg(undefined);
    try {
      const r = await api(`/api/admin/complaints/${c.id}/resend`, { method: "POST" });
      setMsg(r.webhookStatus === "sent" ? "Sent to Discord." : r.webhookStatus === "not_configured" ? "No Discord webhook is set up yet." : "Discord rejected the message. Check the webhook in Settings.");
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Permanently delete ${c.caseNumber}? This can't be undone.`)) return;
    await api(`/api/admin/complaints/${c.id}`, { method: "DELETE" });
    refreshCounts();
    nav("/admin/internal-affairs");
  }

  async function review(approved: boolean, note: string) {
    setBusy(true);
    try {
      await api(`/api/admin/complaints/${c.id}/review`, { body: { approved, note } });
      reload();
      refreshCounts();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  const [wl, wt] = webhookLabel[c.webhookStatus] ?? [c.webhookStatus, ""];
  const kv: [string, string][] = [
    ["Complainant", c.complainantName],
    ["Discord", c.complainantDiscord],
    ["Roblox", c.complainantRoblox],
    ["Other contact", c.contact],
    ["Trooper involved", c.officerName],
    ["Badge / callsign", c.officerBadge],
    ["Incident date", c.incidentDate],
    ["Location", c.location],
    ["Type", c.category],
    ["Filed", formatDate(c.createdAt, true)],
  ];

  return (
    <>
      <p style={{ margin: "0 0 10px" }}><Link to={c.source === "ia" ? "/admin/internal-affairs/cases" : "/admin/internal-affairs"} className="muted">← {c.source === "ia" ? "All cases" : "All complaints"}</Link></p>
      <AdminTop title={c.caseNumber} text={`${c.category} · filed ${formatDate(c.createdAt, true)}`}>
        {c.confidential && <span className="pill red" style={{ fontSize: 15, padding: "5px 14px" }}>Confidential</span>}
        <span className={`pill ${statusTone(c.status)}`} style={{ fontSize: 15, padding: "5px 14px" }}>{c.status}</span>
      </AdminTop>
      {pending && (
        <div className="alert info" style={{ marginBottom: 16 }}>
          Closure to <strong>{c.requestedStatus}</strong> is awaiting command approval — the case stays open until a decision is made.
          {!isCommand && " You'll be notified once command staff review it."}
        </div>
      )}
      {c.reviewStatus === "rejected" && c.reviewNote && (
        <div className="alert error" style={{ marginBottom: 16 }}>
          A closure request was rejected by command staff: “{c.reviewNote}” — pick a new status to continue.
        </div>
      )}
      <div className="ia-layout">
        <div className="stack">
          <div className="card">
            <dl className="kv" style={{ margin: 0 }}>
              {kv.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">—</span>}</dd></div>
              ))}
            </dl>
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 12 }}>Statement</h3>
            <p style={{ whiteSpace: "pre-wrap", margin: 0, color: "#dcdcde" }}>{c.description}</p>
            {c.evidence && (
              <>
                <h3 style={{ margin: "26px 0 12px" }}>Evidence</h3>
                <div className="stack" style={{ gap: 6 }}>
                  {c.evidence.split(/\s*\n\s*/).filter(Boolean).map((line, i) =>
                    /^https?:\/\//i.test(line) ? (
                      <a key={i} href={line} target="_blank" rel="noopener noreferrer nofollow" className="gold" style={{ wordBreak: "break-all" }}>{line}</a>
                    ) : (
                      <span key={i}>{line}</span>
                    ),
                  )}
                </div>
              </>
            )}
          </div>
          <div className="card">
            <h3 style={{ marginBottom: 16 }}>Investigation log</h3>
            <div className="stack">
              {data.notes.length === 0 && <p className="muted" style={{ margin: 0 }}>No notes yet.</p>}
              {data.notes.map((n) => (
                <div className="note" key={n.id}>
                  <span className="who">{n.author}</span><span className="when">{formatDate(n.createdAt, true)}</span>
                  <p>{n.body}</p>
                </div>
              ))}
            </div>
            <form onSubmit={addNote} className="stack" style={{ marginTop: 20 }}>
              <textarea className="input" rows={3} placeholder="Add an investigation note…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div><button className="btn btn-gold btn-sm" disabled={busy || !note.trim()}>Add note</button></div>
            </form>
          </div>
        </div>
        <div className="stack">
          <Panel title="Investigation report">
            <WorkflowForm key={c.id} label="Save findings" submit={async (body) => { await api(`/api/admin/complaints/${c.id}`, { method: "PATCH", body }); reload(); }}>
              <Field name="priority" label="Priority" options={COMPLAINT_PRIORITIES} initial={c.priority} />
              {roster && <Field name="subjectMemberId" label="Trooper involved" options={roster.map((member) => ({ value: member.id, label: member.name }))} placeholder="No linked trooper" initial={c.subjectMemberId} />}
              <Field name="findings" label="Internal findings" multiline initial={c.findings} maxLength={20000} />
            </WorkflowForm>
            {c.subjectMemberId && <Link className="text-link" to={`/admin/members/${c.subjectMemberId}`}>Open personnel file →</Link>}
          </Panel>
          <div className="card stack">
            <div className="field">
              <label htmlFor="st">Status</label>
              <select id="st" className="input" value={c.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
                {COMPLAINT_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {!isCommand && <span className="hint">Closing a case requires command approval — picking a closing status sends it for review.</span>}
              {pending && <span className="hint">Picking a non-closing status cancels the pending review.</span>}
            </div>
            {pending && isCommand && (
              <div className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                <h3 style={{ margin: 0 }}>Closure review</h3>
                <p className="muted" style={{ margin: 0 }}>An investigator requested closing this case as “{c.requestedStatus}”.</p>
                <WorkflowForm label="Approve closure" success="Closure approved." submit={async (body) => { await review(true, body.note ?? ""); }}>
                  <Field name="note" label="Decision note (optional)" multiline maxLength={2000} placeholder="Why the closure is approved" />
                </WorkflowForm>
                <WorkflowForm label="Reject closure" success="Closure rejected." submit={async (body) => { await review(false, body.note ?? ""); }}>
                  <Field name="note" label="Reason (shared with the investigator)" multiline maxLength={2000} placeholder="Why the case should stay open" />
                </WorkflowForm>
              </div>
            )}
            <label className="checkbox" style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <input
                type="checkbox"
                checked={c.confidential}
                disabled={busy || (c.confidential && !isCommand)}
                onChange={(e) => patch({ confidential: String(e.target.checked) })}
              />
              <span>Confidential case<span className="hint" style={{ display: "block" }}>Visible only to command staff and the assigned investigator. Never posted to Discord{!isCommand && " — only command staff can remove this flag"}.</span></span>
            </label>
            <div className="field">
              <label htmlFor="as">Assigned investigator</label>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <input id="as" className="input" value={assign ?? c.assignedTo} onChange={(e) => setAssign(e.target.value)} placeholder="Name" />
                <button className="btn btn-outline btn-xs" disabled={busy || assign === null || assign === c.assignedTo} onClick={() => patch({ assignedTo: assign ?? "" }).then(() => setAssign(null))}>Save</button>
              </div>
              <button className="btn btn-dark btn-xs" style={{ justifySelf: "start" }} disabled={busy} onClick={() => patch({ assignedTo: me.displayName || me.username }).then(() => setAssign(null))}>Assign to me</button>
            </div>
          </div>
          <div className="card stack">
            <h3>Discord</h3>
            <div><span className={`pill ${wt}`}>{wl}</span></div>
            <button className="btn btn-outline btn-xs" style={{ justifySelf: "start" }} disabled={busy} onClick={resend}>Send to Discord again</button>
            {msg && <p className="muted" style={{ margin: 0, fontSize: 15 }}>{msg}</p>}
          </div>
          {can(me.role, "owner") && (
            <button className="btn btn-danger btn-xs" style={{ justifySelf: "start" }} onClick={remove}>Delete complaint</button>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Custom roles ------------------------------ */

export function RolesAdmin() {
  const [roles, error, reload] = useApi<CustomRole[]>("/api/admin/roles");
  const [draft, setDraft] = useState<CustomRole | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setErr(undefined);
    try {
      if (draft.id) await api(`/api/admin/roles/${draft.id}`, { method: "PUT", body: { label: draft.label, perms: draft.perms } });
      else await api("/api/admin/roles", { body: draft });
      const rows = await api<CustomRole[]>("/api/admin/roles");
      reloadCustomRoles(rows);
      setDraft(null);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: CustomRole) {
    if (!confirm(`Remove the ${role.label} role?`)) return;
    try {
      await api(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      const rows = await api<CustomRole[]>("/api/admin/roles");
      reloadCustomRoles(rows);
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <RequirePerm perm="owner">
      <AdminTop title="Custom roles" text="Build roles like Training Director or Recruitment Director from the permissions below, then assign them on the Accounts page.">
        <button className="btn btn-gold btn-sm" onClick={() => { setErr(undefined); setDraft({ id: 0, key: "", label: "", perms: ["officer"], createdAt: "" }); }}>
          <PlusIcon size={18} /> New role
        </button>
      </AdminTop>
      {error && <p className="alert error">{error}</p>}
      {roles && roles.length === 0 && <div className="card center muted">No custom roles yet. Fixed roles like Administrator and Command Staff keep working as before.</div>}
      {roles && roles.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Role</th><th>Key</th><th>Permissions</th><th /></tr></thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td><strong>{role.label}</strong></td>
                  <td><span className="muted">{CUSTOM_ROLE_PREFIX}{role.key}</span></td>
                  <td>
                    <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                      {role.perms.length === 0 && <span className="pill red">No access</span>}
                      {role.perms.map((perm) => <span className="pill" key={perm}>{CUSTOM_PERM_OPTIONS.find((o) => o.key === perm)?.label ?? perm}</span>)}
                    </div>
                  </td>
                  <td className="actions">
                    <button className="btn btn-outline btn-xs" onClick={() => { setErr(undefined); setDraft({ ...role, perms: [...role.perms] }); }}>Edit</button>
                    <button className="btn btn-danger btn-xs" onClick={() => remove(role)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-head">
              <h2>{draft.id ? `Edit ${draft.label}` : "New custom role"}</h2>
              <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label="Close"><CloseIcon /></button>
            </div>
            <div className="modal-body stack">
              <div className="field">
                <label htmlFor="r-label">Role name *</label>
                <input id="r-label" className="input" required maxLength={60} placeholder="e.g. Training Director" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
                {!draft.id && <span className="hint">The key is generated from the name (lowercase letters, numbers and dashes).</span>}
              </div>
              <fieldset className="stack" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
                <legend>Permissions</legend>
                {CUSTOM_PERM_OPTIONS.map((option) => (
                  <label className="checkbox" key={option.key}>
                    <input
                      type="checkbox"
                      checked={draft.perms.includes(option.key)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          perms: e.target.checked ? [...draft.perms, option.key] : draft.perms.filter((p) => p !== option.key),
                        })
                      }
                    />
                    <span><strong>{option.label}</strong><span className="hint" style={{ display: "block" }}>{option.help}</span></span>
                  </label>
                ))}
              </fieldset>
              {err && <p className="alert error" style={{ margin: 0 }}>{err}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-gold btn-sm" disabled={busy}>{busy ? "Saving…" : "Save role"}</button>
            </div>
          </form>
        </div>
      )}
    </RequirePerm>
  );
}

/* ------------------------------ Accounts ------------------------------ */

type Account = {
  id: number; username: string; displayName: string; role: string; disabled: boolean;
  memberId: number | null; memberName: string | null; createdAt: string; lastLoginAt: string | null;
  suspendedUntil: string | null; suspendedReason: string;
};

const isOwnerLevel = (role: string) => role === "owner" || role === "commissioner";

const suspendedNow = (a: { suspendedUntil: string | null }) => Boolean(a.suspendedUntil && new Date(a.suspendedUntil).getTime() > Date.now());

/** Role options for the account form: fixed roles plus every custom role. */
function roleOptions(custom: CustomRole[] | undefined, meRole: string) {
  const fixed = ASSIGNABLE_ROLES.filter((role) => role !== "admin" || meRole === "owner").map((role) => ({ value: role, label: roleLabel(role) }));
  // Several roles may share a key (their permissions merge), so the dropdown
  // lists one option per key and keeps the first label for it.
  const customOpts: { value: string; label: string }[] = [];
  for (const role of custom ?? []) {
    const value = CUSTOM_ROLE_PREFIX + role.key;
    if (customOpts.some((option) => option.value === value)) continue;
    customOpts.push({ value, label: role.label });
  }
  return [...fixed, ...customOpts];
}

const roleHint = (role: string, custom: CustomRole[] | undefined) => {
  if (role.startsWith(CUSTOM_ROLE_PREFIX)) {
    const match = custom?.find((r) => CUSTOM_ROLE_PREFIX + r.key === role);
    if (match) return match.perms.length ? `Permissions: ${match.perms.map((p) => CUSTOM_PERM_OPTIONS.find((o) => o.key === p)?.label ?? p).join(", ")}` : "This role currently grants no permissions.";
  }
  return undefined;
};

export function Accounts() {
  const me = useMe();
  const [rows, error, reload] = useApi<Account[]>("/api/admin/accounts");
  const [roster] = useApi<RosterMember[]>("/api/admin/roster");
  const [custom] = useApi<CustomRole[]>("/api/admin/roles");
  const [draft, setDraft] = useState<any | null>(null);
  const [history, setHistory] = useState<{ account: Account; rows: LoginEvent[] | null } | null>(null);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(undefined);
    try {
      if (draft.id) {
        const body: any = { displayName: draft.displayName, disabled: draft.disabled, memberId: draft.memberId };
        // Compare against the account's current role, not the newly picked one —
        // otherwise picking "Commissioners Board" would hide the field and drop the change.
        if (!isOwnerLevel(draft.originalRole ?? draft.role)) body.role = draft.role;
        if (draft.password) body.password = draft.password;
        if (draft.id !== me.id && !isOwnerLevel(draft.originalRole)) {
          body.suspendedUntil = draft.suspendedUntil ? new Date(draft.suspendedUntil).toISOString() : null;
          body.suspendedReason = draft.suspendedReason ?? "";
        }
        await api(`/api/admin/accounts/${draft.id}`, { method: "PUT", body });
      } else {
        await api("/api/admin/accounts", { body: draft });
      }
      setDraft(null);
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(a: Account) {
    if (!confirm(`Remove ${a.username}'s access? They'll be signed out immediately.`)) return;
    try {
      await api(`/api/admin/accounts/${a.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  async function openHistory(a: Account) {
    setHistory({ account: a, rows: null });
    try {
      const logins = await api<LoginEvent[]>(`/api/admin/accounts/${a.id}/logins`);
      setHistory({ account: a, rows: logins });
    } catch (e: any) {
      setHistory({ account: a, rows: [] });
      alert(e.message);
    }
  }

  return (
    <RequirePerm perm="owner">
      <AdminTop title="Accounts" text="Manage Employee Portal logins, roles and roster links. Only you can give people access to the admin panel.">
        <button className="btn btn-gold btn-sm" onClick={() => { setErr(undefined); setDraft({ username: "", displayName: "", password: "", role: "officer", memberId: null, disabled: false }); }}>
          <PlusIcon size={18} /> Add account
        </button>
      </AdminTop>
      {error && <p className="alert error">{error}</p>}
      {rows && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Username</th><th>Display name</th><th>Access</th><th>Roster profile</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.username}</strong></td>
                  <td>{a.displayName}</td>
                  <td>
                    <span className={`pill ${isOwnerLevel(a.role) ? "gold" : a.role === "ia" ? "blue" : ""}`}>{roleLabel(a.role)}</span>
                    {a.disabled && <span className="pill red" style={{ marginLeft: 6 }}>Disabled</span>}
                    {suspendedNow(a) && <span className="pill gold" style={{ marginLeft: 6 }} title={a.suspendedReason}>Suspended</span>}
                  </td>
                  <td>{a.memberName ?? "—"}</td>
                  <td>{a.lastLoginAt ? formatDate(a.lastLoginAt, true) : <span className="muted">Never</span>}</td>
                  <td className="actions">
                    <button className="btn btn-outline btn-xs" onClick={() => { setErr(undefined); setDraft({ ...a, password: "", originalRole: a.role }); }}>Edit</button>
                    <button className="btn btn-outline btn-xs" onClick={() => openHistory(a)}>History</button>
                    {a.id !== me.id && !isOwnerLevel(a.role) && <button className="btn btn-danger btn-xs" onClick={() => remove(a)}>Remove</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-head">
              <h2>{draft.id ? `Edit ${draft.username}` : "Add account"}</h2>
              <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label="Close"><CloseIcon /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                {!draft.id && (
                  <div className="field">
                    <label htmlFor="a-u">Username *</label>
                    <input id="a-u" className="input" required autoComplete="off" value={draft.username} onChange={(e) => setDraft({ ...draft, username: e.target.value })} />
                  </div>
                )}
                <div className="field">
                  <label htmlFor="a-d">Display name</label>
                  <input id="a-d" className="input" placeholder="e.g. Sgt. Ramirez" value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="a-p">{draft.id ? "New password" : "Password *"}</label>
                  <input id="a-p" className="input" type="password" autoComplete="new-password" required={!draft.id} minLength={8} placeholder={draft.id ? "Leave blank to keep current" : "At least 8 characters"} value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
                </div>
                {!(draft.id && isOwnerLevel(draft.originalRole)) && draft.id !== me.id && (
                  <div className="field">
                    <label htmlFor="a-r">Access level</label>
                    <select id="a-r" className="input" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                      {roleOptions(custom, me.role).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <span className="hint">{roleHint(draft.role, custom) ?? "Pick a fixed role, or build your own under Custom roles."}</span>
                  </div>
                )}
                {roster && <div className="field"><label htmlFor="a-member">Roster profile</label><select id="a-member" className="input" value={draft.memberId ?? ""} onChange={(event) => setDraft({ ...draft, memberId: event.target.value ? Number(event.target.value) : null })}><option value="">Not linked</option>{roster.filter((member) => !member.accountId || member.accountId === draft.id).map((member) => <option key={member.id} value={member.id}>{member.name} · {member.rank}</option>)}</select></div>}
                {draft.id && draft.id !== me.id && !(isOwnerLevel(draft.originalRole)) && <label className="checkbox"><input type="checkbox" checked={draft.disabled} onChange={(event) => setDraft({ ...draft, disabled: event.target.checked })} /> Disable access</label>}
                {draft.id && draft.id !== me.id && !(isOwnerLevel(draft.originalRole)) && (
                  <>
                    <div className="field">
                      <label htmlFor="a-suspend">Suspend access until</label>
                      <input
                        id="a-suspend"
                        className="input"
                        type="datetime-local"
                        value={draft.suspendedUntil ? String(draft.suspendedUntil).slice(0, 16) : ""}
                        onChange={(event) => setDraft({ ...draft, suspendedUntil: event.target.value || null })}
                      />
                      <span className="hint">Temporary suspension — portal access is blocked until this time, then lifts automatically. Leave blank to lift a suspension.</span>
                    </div>
                    <div className="field">
                      <label htmlFor="a-reason">Suspension reason (shown at sign-in)</label>
                      <input id="a-reason" className="input" maxLength={500} value={draft.suspendedReason ?? ""} onChange={(event) => setDraft({ ...draft, suspendedReason: event.target.value })} />
                    </div>
                  </>
                )}
              </div>
              {err && <p className="alert error" style={{ margin: 0 }}>{err}</p>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn btn-gold btn-sm" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
            </div>
          </form>
        </div>
      )}
      {history && (
        <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setHistory(null)}>
          <div className="modal">
            <div className="modal-head">
              <h2>Sign-in history · {history.account.username}</h2>
              <button type="button" className="icon-btn" onClick={() => setHistory(null)} aria-label="Close"><CloseIcon /></button>
            </div>
            <div className="modal-body">
              {!history.rows && <p className="loading">Loading history…</p>}
              {history.rows && history.rows.length === 0 && <p className="muted">No sign-in attempts recorded yet.</p>}
              {history.rows && history.rows.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>When</th><th>Result</th><th>IP address</th><th>Browser</th></tr></thead>
                    <tbody>
                      {history.rows.map((row) => (
                        <tr key={row.id}>
                          <td>{formatDate(row.createdAt, true)}</td>
                          <td><span className={`pill ${row.success ? "green" : "red"}`}>{row.success ? "Signed in" : "Failed"}</span></td>
                          <td><span className="muted">{row.ip || "—"}</span></td>
                          <td><span className="muted" style={{ fontSize: 14 }}>{row.userAgent.slice(0, 60) || "—"}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setHistory(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </RequirePerm>
  );
}

/* ------------------------------ Settings ------------------------------ */

type ChannelInfo = { channel: string; label: string; configured: boolean; source: string | null; preview: string | null };

function MaintenanceCard() {
  const [state, error, reload] = useApi<{ enabled: boolean; message: string }>("/api/admin/maintenance");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string }>();

  async function save(enabled: boolean) {
    setBusy(true);
    setMsg(undefined);
    try {
      await api("/api/admin/maintenance", { method: "PUT", body: { enabled, message: message ?? state?.message ?? "" } });
      setMsg({ tone: "success", text: enabled ? "Maintenance mode is on — the portal is now locked for troopers." : "Maintenance mode is off — the portal is open again." });
      setMessage(null);
      reload();
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <h3>System maintenance mode</h3>
      {error ? (
        <p className="alert error" style={{ margin: 0 }}>{error}</p>
      ) : !state ? (
        <p className="loading">Loading maintenance status…</p>
      ) : (
        <>
          <p className={`alert ${state.enabled ? "error" : "success"}`} style={{ margin: 0 }}>
            {state.enabled ? "Maintenance mode is ON — the Trooper Portal, reports and training are locked for everyone below command staff." : "Maintenance mode is off. The portal is open."}
          </p>
          <div className="field">
            <label htmlFor="mm">Message shown to locked-out personnel</label>
            <input
              id="mm"
              className="input"
              maxLength={500}
              placeholder="The Trooper Portal is temporarily down for maintenance. Please check back soon."
              value={message ?? state.message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div className="row">
            {state.enabled ? (
              <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => save(false)}>End maintenance</button>
            ) : (
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => confirm("Lock the portal for everyone below command staff?") && save(true)}>Start maintenance</button>
            )}
          </div>
        </>
      )}
      {msg && <p className={`alert ${msg.tone}`} style={{ margin: 0 }}>{msg.text}</p>}
    </div>
  );
}

export function Settings() {
  const [s, error, reload] = useApi<{ channels: ChannelInfo[] }>("/api/admin/settings");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: string; text: string }>();

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMsg(undefined);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      reload();
    } catch (e: any) {
      setMsg({ tone: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <RequirePerm perm="owner">
      <AdminTop title="Discord & Settings" text="Connect Discord channels so complaints, announcements and personnel updates are posted there automatically." />
      <div className="stack" style={{ maxWidth: 760 }}>
        <MaintenanceCard />
        {(s?.channels ?? []).map((ch) => (
          <div className="card stack" key={ch.channel}>
            <h3>{ch.label}</h3>
            <p className={`alert ${ch.configured ? "success" : "info"}`} style={{ margin: 0 }}>
              {ch.configured
                ? ch.source === "panel"
                  ? `A webhook is connected (ending in ${ch.preview}).`
                  : "A webhook is connected through the site's environment settings."
                : "No webhook connected yet. These events are still saved here, but nothing is posted to Discord."}
            </p>
            <div className="field">
              <label htmlFor={`wh-${ch.channel}`}>Discord webhook URL</label>
              <input
                id={`wh-${ch.channel}`}
                className="input"
                type="password"
                autoComplete="off"
                placeholder="https://discord.com/api/webhooks/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="row">
              <button
                className="btn btn-gold btn-sm"
                disabled={busy || !url.trim()}
                onClick={() => run(() => api("/api/admin/settings/webhook", { method: "PUT", body: { channel: ch.channel, url } }).then(() => setUrl("")), "Webhook saved.")}
              >
                Save webhook
              </button>
              <button
                className="btn btn-outline btn-sm"
                disabled={busy || !ch.configured}
                onClick={() => run(() => api("/api/admin/settings/webhook/test", { method: "POST", body: { channel: ch.channel } }), "Test message sent. Check your Discord channel.")}
              >
                Send test
              </button>
              {ch.source === "panel" && (
                <button
                  className="btn btn-danger btn-sm"
                  disabled={busy}
                  onClick={() => confirm("Disconnect this webhook?") && run(() => api("/api/admin/settings/webhook", { method: "PUT", body: { channel: ch.channel, url: "" } }), "Webhook disconnected.")}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
        ))}
        <ol className="muted" style={{ margin: 0, paddingLeft: 20, fontSize: 15.5 }}>
          <li>In Discord, open the channel's settings → Integrations → Webhooks.</li>
          <li>Create a webhook (name it “TXDPS Dispatch”) and copy its URL.</li>
          <li>Paste it above and save. Embeds include a button that opens the item in this dashboard.</li>
        </ol>
        {msg && <p className={`alert ${msg.tone}`} style={{ margin: 0 }}>{msg.text}</p>}
      </div>
    </RequirePerm>
  );
}

export function ChangePassword() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ tone: string; text: string }>();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/auth/password", { body: { currentPassword: cur, newPassword: next } });
      setCur("");
      setNext("");
      setMsg({ tone: "success", text: "Password updated." });
    } catch (err: any) {
      setMsg({ tone: "error", text: err.message });
    }
  }
  return (
    <>
      <AdminTop title="Change Password" />
      <form className="card stack" style={{ maxWidth: 480 }} onSubmit={submit}>
        <div className="field"><label htmlFor="cp">Current password</label><input id="cp" className="input" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="field"><label htmlFor="np">New password</label><input id="np" className="input" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} /></div>
        {msg && <p className={`alert ${msg.tone}`} style={{ margin: 0 }}>{msg.text}</p>}
        <div><button className="btn btn-gold btn-sm">Update password</button></div>
      </form>
    </>
  );
}
