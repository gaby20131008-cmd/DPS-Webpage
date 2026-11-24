import { useState } from "react";
import { Link } from "react-router-dom";
import { api, fileUrl, formatDate, ROSTER_STATUSES, statusTone, type Division, type Doc, type Leader, type NewsPost, type Rank, type RosterDivider, type RosterMember } from "../../api";
import { useApi } from "../../useApi";
import { AdminTop, RequirePerm, useMe } from "./AdminLayout";
import { ResourceManager } from "./ResourceManager";
import { can, ROLE_LABELS } from "../../api";

const docHref = (d: Doc) => (d.fileKey ? fileUrl(d.fileKey) : d.externalUrl || "#");

const thumb = (key: string | null) => (
  <div style={{ width: 64, height: 40, borderRadius: 6, background: key ? `#202022 url(${fileUrl(key)}) center/cover` : "#202022", border: "1px solid #424245" }} />
);

export function AdminRoster() {
  const [divs] = useApi<Division[]>("/api/divisions");
  const [ranks] = useApi<Rank[]>("/api/ranks");
  const [dividers] = useApi<RosterDivider[]>("/api/admin/roster-dividers");
  const [members, , reloadMembers] = useApi<RosterMember[]>("/api/admin/roster");
  const missingBadges = (members ?? []).filter((m) => !m.badgeNumber?.trim()).length;
  const [assigning, setAssigning] = useState(false);
  const { role } = useMe();

  async function assignMissingBadges(reload: () => void) {
    setAssigning(true);
    try {
      const list = await api<RosterMember[]>("/api/admin/roster");
      const targets = list.filter((m) => !m.badgeNumber?.trim());
      for (const m of targets) await api(`/api/admin/roster/${m.id}`, { method: "PUT", body: { badgeNumber: "" } });
      reload();
      reloadMembers();
      alert(targets.length ? `Assigned ${targets.length} random badge number${targets.length === 1 ? "" : "s"}.` : "Every member already has a badge number.");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setAssigning(false);
    }
  }

  return (
    <RequirePerm perm={["content", "command"]}>
      <ResourceManager<RosterMember>
        endpoint="/api/admin/roster"
        title="Roster"
        singular="Member"
        text="Everyone listed here shows on the public Roster page. Lower sort numbers appear first."
        toolbar={(reload) =>
          missingBadges > 0 && (
            <button className="btn btn-outline btn-sm" disabled={assigning} onClick={() => assignMissingBadges(reload)}>
              {assigning ? "Assigning…" : `Assign ${missingBadges} badge number${missingBadges === 1 ? "" : "s"}`}
            </button>
          )
        }
        defaults={{ name: "", rank: "Cadet", badgeNumber: "", callsign: "", divisionId: null, status: "Active", discord: "", joinedAt: "", sortOrder: 0 }}
        searchText={(r) => `${r.name} ${r.rank} ${r.badgeNumber} ${r.callsign} ${r.divisionName ?? ""} ${r.dividerName ?? ""} ${r.discord ?? ""}`}
        emptyText="Nobody is on the roster yet."
        rowActions={(row) => can(role, "command") && <Link className="btn btn-outline btn-xs" to={`/admin/members/${row.id}`}>Personnel file</Link>}
        fields={(draft) => [
          { key: "name", label: "Name", required: true },
          ...(!draft.id || can(role, "command") ? [{ key: "rank", label: "Rank", type: "select" as const, options: [...new Set([draft.rank, ...(ranks ?? []).map((rank) => rank.name)].filter(Boolean))].map((value) => ({ value, label: String(value) })) }] : []),
          { key: "badgeNumber", label: "Badge number", hint: "Leave blank and a random badge number is issued automatically." },
          { key: "callsign", label: "Callsign" },
          { key: "divisionId", label: "Division", type: "select", options: [{ value: null, label: "Unassigned" }, ...(divs ?? []).map((d) => ({ value: d.id, label: d.name }))] },
          { key: "dividerId", label: "Roster divider", type: "select", options: [{ value: null, label: "None (grouped by rank)" }, ...(dividers ?? []).map((d) => ({ value: d.id, label: d.label }))], hint: "Puts this member in a custom section on the public roster instead of their rank group." },
          { key: "status", label: "Status", type: "select", options: ROSTER_STATUSES.map((s) => ({ value: s, label: s })) },
          { key: "discord", label: "Discord username", hint: "Staff-only. Not shown on the public site." },
          { key: "joinedAt", label: "Date joined", placeholder: "e.g. Nov 2026" },
          { key: "featured", label: "Feature on the homepage", type: "checkbox" },
          { key: "isInstructor", label: "List as an academy instructor", type: "checkbox" },
          { key: "bio", label: "Public bio", type: "textarea" },
          { key: "photoKey", label: "Public photo", type: "image" },
          { key: "sortOrder", label: "Sort order", type: "number", hint: "Lower numbers are listed first, so rank order is up to you." },
        ]}
        columns={[
          { label: "Badge", render: (r) => <span className="gold" style={{ fontWeight: 600 }}>{r.badgeNumber || "—"}</span> },
          { label: "Name", render: (r) => <strong>{r.name}</strong> },
          { label: "Rank", render: (r) => r.rank || "—" },
          { label: "Division", render: (r) => r.divisionName || <span className="muted">Unassigned</span> },
          { label: "Callsign", render: (r) => r.callsign || "—" },
          { label: "Status", render: (r) => <span className={`pill ${r.status === "Active" ? "green" : r.status === "Suspended" || r.status === "Inactive" ? "red" : "gold"}`}>{r.status}</span> },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminRosterDividers() {
  return (
    <RequirePerm perm={["content", "command"]}>
      <ResourceManager<RosterDivider>
        endpoint="/api/admin/roster-dividers"
        title="Roster dividers"
        singular="Divider"
        text="Custom section headings for the public Roster page. Assign members to a divider from the Roster page; lower sort numbers appear first."
        defaults={{ label: "", sortOrder: 0 }}
        searchText={(r) => r.label}
        emptyText="No dividers yet. Members without a divider are grouped by division."
        fields={[
          { key: "label", label: "Divider label", required: true, placeholder: "e.g. High Command" },
          { key: "sortOrder", label: "Sort order", type: "number", hint: "Lower numbers appear first on the roster." },
        ]}
        columns={[
          { label: "Label", render: (r) => <strong>{r.label}</strong> },
          { label: "Order", render: (r) => r.sortOrder },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminDivisions() {
  return (
    <RequirePerm perm={["content", "command"]}>
      <ResourceManager<Division>
        endpoint="/api/admin/divisions"
        title="Divisions"
        singular="Division"
        text="Divisions appear on the home page and the Divisions page. Roster members can be assigned to them."
        defaults={{ name: "", code: "", summary: "", description: "", imageKey: null, sortOrder: 0 }}
        rowActions={(row) => <Link className="btn btn-outline btn-xs" to={`/admin/divisions/${row.id}/members`}>Manage members</Link>}
        fields={[
          { key: "name", label: "Division name", required: true, placeholder: "e.g. Patrol Division" },
          { key: "code", label: "Short label", placeholder: "e.g. PATROL, CID, SWAT" },
          { key: "summary", label: "One-line summary", full: true },
          { key: "description", label: "Full description", type: "textarea", rows: 6 },
          { key: "requirements", label: "Membership requirements", type: "textarea" },
          { key: "imageKey", label: "Card image", type: "image" },
          { key: "sortOrder", label: "Sort order", type: "number" },
        ]}
        columns={[
          { label: "Image", render: (r) => thumb(r.imageKey) },
          { label: "Name", render: (r) => <strong>{r.name}</strong> },
          { label: "Label", render: (r) => r.code || "—" },
          { label: "Summary", render: (r) => <span className="muted">{r.summary || "—"}</span> },
          { label: "Order", render: (r) => r.sortOrder },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminLeadership() {
  return (
    <RequirePerm perm="content">
      <ResourceManager<Leader>
        endpoint="/api/admin/leadership"
        title="Leadership"
        singular="Leader"
        text="Command staff shown on the Leadership page. Lower sort numbers appear first."
        defaults={{ name: "", title: "", bio: "", imageKey: null, sortOrder: 0 }}
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "title", label: "Title", placeholder: "e.g. Sheriff, Chief Trooper" },
          { key: "bio", label: "Bio", type: "textarea", rows: 4 },
          { key: "imageKey", label: "Photo", type: "image" },
          { key: "sortOrder", label: "Sort order", type: "number" },
        ]}
        columns={[
          { label: "Photo", render: (r) => thumb(r.imageKey) },
          { label: "Name", render: (r) => <strong>{r.name}</strong> },
          { label: "Title", render: (r) => <span className="gold">{r.title || "—"}</span> },
          { label: "Order", render: (r) => r.sortOrder },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminNews() {
  return (
    <RequirePerm perm="content">
      <ResourceManager<NewsPost>
        endpoint="/api/admin/news"
        title="News"
        singular="Article"
        text="Press releases and announcements. Drafts stay hidden until you mark them as published."
        defaults={{ title: "", category: "Press Release", summary: "", body: "", imageKey: null, published: true, publishedAt: new Date().toISOString() }}
        searchText={(r) => `${r.title} ${r.category} ${r.summary}`}
        fields={[
          { key: "title", label: "Headline", required: true, full: true },
          { key: "category", label: "Category", type: "select", options: ["Press Release", "Announcement", "Community", "Event"].map((c) => ({ value: c, label: c })) },
          { key: "publishedAt", label: "Publish date", type: "datetime" },
          { key: "summary", label: "Summary", full: true, hint: "Shown on news cards." },
          { key: "body", label: "Article", type: "textarea", rows: 10, hint: "Leave a blank line between paragraphs." },
          { key: "imageKey", label: "Cover image", type: "image" },
          { key: "published", label: "Published (visible on the website)", type: "checkbox", full: true },
        ]}
        columns={[
          { label: "Image", render: (r) => thumb(r.imageKey) },
          { label: "Headline", render: (r) => <strong>{r.title}</strong> },
          { label: "Category", render: (r) => r.category },
          { label: "Date", render: (r) => formatDate(r.publishedAt) },
          { label: "Status", render: (r) => <span className={`pill ${r.published ? "green" : ""}`}>{r.published ? "Published" : "Draft"}</span> },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminDocuments() {
  return (
    <RequirePerm perm="content">
      <ResourceManager<Doc>
        endpoint="/api/admin/documents"
        title="Documents"
        singular="Document"
        text="Upload files or link to existing documents. Department documents are only available to signed-in staff inside the Trooper Portal."
        defaults={{ title: "", category: "General", description: "", fileKey: null, externalUrl: "", visibility: "internal" }}
        searchText={(r) => `${r.title} ${r.category} ${r.description}`}
        beforeSave={(d) => (!d.fileKey && !d.externalUrl ? "Upload a file or add a link." : undefined)}
        fields={[
          { key: "title", label: "Title", required: true, placeholder: "e.g. Standard Operating Procedures" },
          { key: "category", label: "Category", placeholder: "e.g. Policy, Forms, Training" },
          { key: "description", label: "Description", full: true },
          { key: "fileKey", label: "File", type: "file", hint: "PDF, Word, images, etc. Up to 15 MB." },
          { key: "externalUrl", label: "…or link", full: true, placeholder: "https://docs.google.com/…", hint: "Used when no file is uploaded." },
          { key: "visibility", label: "Visibility", type: "select", options: [{ value: "internal", label: "Internal — signed-in staff (Trooper Portal)" }] },
        ]}
        columns={[
          { label: "Title", render: (r) => <a href={docHref(r)} target="_blank" rel="noreferrer"><strong>{r.title}</strong></a> },
          { label: "Category", render: (r) => r.category },
          { label: "Type", render: (r) => (r.fileKey ? "File" : "Link") },
          { label: "Visibility", render: () => <span className="pill gold">Internal</span> },
          { label: "Added", render: (r) => formatDate(r.createdAt) },
        ]}
      />
    </RequirePerm>
  );
}

export function AdminOverview() {
  const me = useMe();
  const [o, error] = useApi<any>("/api/admin/overview");
  const [docs] = useApi<Doc[]>(can(me.role, "content") ? "/api/admin/documents" : null);
  const internalDocs = docs?.filter((d) => d.visibility === "internal") ?? [];
  return (
    <>
      <AdminTop title={`Welcome, ${me.displayName || me.username}`} text={`Signed in as ${ROLE_LABELS[me.role] ?? me.role}.`} />
      {error && <p className="alert error">{error}</p>}
      {o && (
        <div className="stats">
          {can(me.role, "ia") && <Link to="/admin/internal-affairs" className="stat hot"><div className="n">{o.openComplaints}</div><div className="l">Open complaints</div></Link>}
          <Link to="/admin/roster" className="stat"><div className="n">{o.roster}</div><div className="l">Roster members</div></Link>
          <Link to="/admin/divisions" className="stat"><div className="n">{o.divisions}</div><div className="l">Divisions</div></Link>
          <Link to="/admin/news" className="stat"><div className="n">{o.news}</div><div className="l">News articles</div></Link>
          <Link to="/admin/documents" className="stat"><div className="n">{o.documents}</div><div className="l">Documents</div></Link>
        </div>
      )}
      <div className="grid grid-2">
        {can(me.role, "ia") && (
          <div className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <h3>Recent complaints</h3>
              <span className="spacer" />
              <Link to="/admin/internal-affairs" className="text-link" style={{ fontSize: 15 }}>View all</Link>
            </div>
            {o?.recent.length === 0 && <p className="muted">No complaints have been filed.</p>}
            <div className="stack" style={{ gap: 10 }}>
              {o?.recent.map((c: any) => (
                <Link key={c.id} to={`/admin/internal-affairs/${c.id}`} className="doc-row" style={{ padding: "12px 16px" }}>
                  <div className="grow">
                    <strong className="gold">{c.caseNumber}</strong> · {c.category}
                    <p>{c.officerName ? `Involving ${c.officerName} · ` : ""}{formatDate(c.createdAt, true)}</p>
                  </div>
                  <span className={`pill ${statusTone(c.status)}`}>{c.status}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {can(me.role, "content") && (
          <div className="card">
            <div className="row" style={{ marginBottom: 14 }}>
              <h3>Internal documents</h3>
              <span className="spacer" />
              <Link to="/admin/documents" className="text-link" style={{ fontSize: 15 }}>Manage</Link>
            </div>
            {internalDocs.length === 0 && <p className="muted">No staff-only documents yet.</p>}
            <div className="stack" style={{ gap: 10 }}>
              {internalDocs.slice(0, 6).map((d) => (
                <a key={d.id} href={docHref(d)} target="_blank" rel="noreferrer" className="doc-row" style={{ padding: "12px 16px" }}>
                  <div className="grow"><strong>{d.title}</strong><p>{d.category}</p></div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
