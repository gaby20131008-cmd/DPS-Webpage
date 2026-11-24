import { createContext, useContext, useEffect, useState } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api, can, roleLabel, type Me, type Permission } from "../../api";
import { useCustomRoles } from "../../roles";
import { Brand, ModeToggle } from "../../components/Layout";
import {
  CogIcon, FileIcon, GavelIcon, GridIcon, HomeIcon, KeyIcon, ListIcon, LogoutIcon, MenuIcon, NewsIcon, StarIcon, UsersIcon,
} from "../../components/Icons";

type AuthCtx = { me: Me; refreshCounts: () => void };
const Ctx = createContext<AuthCtx | null>(null);
export const useMe = () => useContext(Ctx)!.me;
export const useRefreshCounts = () => useContext(Ctx)!.refreshCounts;

export function AdminLogin() {
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(loc.search).get("next");
  const destination = next && /^\/(?:portal|admin|reports|training)(?:\/|\?|$)/.test(next) && !next.startsWith("/admin/login") ? next : "/admin";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api("/api/auth/login", { body: { username, password } });
      nav(destination, { replace: true });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Brand />
        <h1>Employee Login</h1>
        <p className="muted center" style={{ margin: 0 }}>Authorized TXDPS personnel only.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="u">Username</label>
            <input id="u" className="input" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="p">Password</label>
            <input id="p" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p className="alert error" style={{ margin: 0 }}>{error}</p>}
          <button className="btn btn-gold" disabled={busy}>{busy ? "Signing in…" : "Sign In"}</button>
          <p className="muted center" style={{ fontSize: 14.5, margin: 0 }}>
            Need access? Ask the department owner to create an account for you.
          </p>
          <p className="muted center" style={{ fontSize: 14.5, margin: 0 }}>
            <Link to="/">← Back to the public website</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  const loc = useLocation();
  const nav = useNavigate();
  // Custom roles must be in the client registry before any can() call renders.
  const roles = useCustomRoles();

  useEffect(() => {
    api<Me>("/api/auth/me").then(setMe).catch(() => setMe(null));
  }, []);

  const refreshCounts = () => {
    api("/api/admin/overview").then((o) => setOpenCount(o.openComplaints)).catch(() => {});
  };
  useEffect(() => {
    if (me) refreshCounts();
  }, [me]);
  useEffect(() => setOpen(false), [loc.pathname]);

  if (me === undefined || roles === null) return <div className="login-page"><p className="loading">Checking access…</p></div>;
  if (me === null) return <Navigate to={`/admin/login?next=${encodeURIComponent(loc.pathname)}`} replace />;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    nav("/admin/login", { replace: true });
  }

  const link = (to: string, label: string, icon: React.ReactNode, extra?: React.ReactNode) => (
    <NavLink to={to} end={to === "/admin"} className="side-link">
      {icon} {label} {extra}
    </NavLink>
  );

  return (
    <Ctx.Provider value={{ me, refreshCounts }}>
      <div className="admin-mobile-bar">
        <Brand to="/admin" />
        <div className="row"><ModeToggle /><button className="icon-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close admin menu" : "Open admin menu"}><MenuIcon size={28} /></button></div>
      </div>
      <div className="admin-shell">
        {open && <button type="button" className="admin-scrim" onClick={() => setOpen(false)} aria-label="Close admin menu" />}
        <aside className={`admin-side${open ? " open" : ""}`} onClick={(e) => e.target === e.currentTarget && setOpen(false)}>
          <Brand to="/admin" />
          {link("/admin", "Overview", <HomeIcon size={19} />)}
          {can(me.role, ["content", "command"]) && <>
            <div className="side-label">Department</div>
            {link("/admin/roster", "Roster", <ListIcon size={19} />)}
            {link("/admin/roster-dividers", "Roster dividers", <ListIcon size={19} />)}
            {link("/admin/divisions", "Divisions", <GridIcon size={19} />)}
            {link("/admin/announcements", "Announcements", <NewsIcon size={19} />)}
            {link("/admin/feedback", "Community inbox", <FileIcon size={19} />)}
          </>}
          {can(me.role, ["content", "command", "training"]) && link("/admin/events", "Calendar events", <GridIcon size={19} />)}
          {can(me.role, "command") && <>
            <div className="side-label">Command</div>
            {link("/admin/personnel", "Personnel requests", <UsersIcon size={19} />)}
            {link("/admin/activity", "Department activity", <ListIcon size={19} />)}
            {link("/admin/broadcast", "Broadcast notification", <NewsIcon size={19} />)}
          </>}
          {can(me.role, ["command", "ia", "training"]) && link("/admin/members", "Personnel files", <UsersIcon size={19} />)}
          {can(me.role, "training") && <>
            <div className="side-label">Training Academy</div>
            {link("/admin/courses", "Training courses", <FileIcon size={19} />)}
            {link("/admin/training-records", "Training records", <ListIcon size={19} />)}
          </>}
          {can(me.role, "content") && (
            <>
              <div className="side-label">Website content</div>
              {link("/admin/leadership", "Leadership", <StarIcon size={19} />)}
              {link("/admin/news", "News", <NewsIcon size={19} />)}
              {link("/admin/documents", "Documents", <FileIcon size={19} />)}
              {link("/admin/pages", "Information pages", <FileIcon size={19} />)}
              {link("/admin/faqs", "Community FAQs", <ListIcon size={19} />)}
            </>
          )}
          {can(me.role, "ia") && (
            <>
              <div className="side-label">Internal Affairs</div>
              {link("/admin/internal-affairs", "Complaints", <GavelIcon size={19} />, openCount > 0 && <span className="count">{openCount}</span>)}
              {link("/admin/internal-affairs/cases", "Cases", <FileIcon size={19} />)}
              {link("/admin/discipline", "Disciplinary records", <FileIcon size={19} />)}
            </>
          )}
          <div className="side-label">Administration</div>
          {can(me.role, "admin") && <>
            {link("/admin/ranks", "Rank structure", <StarIcon size={19} />)}
            {link("/admin/site", "Website configuration", <CogIcon size={19} />)}
            {link("/admin/audit", "Audit log", <ListIcon size={19} />)}
          </>}
          {can(me.role, "owner") && <>
            {link("/admin/accounts", "Accounts", <UsersIcon size={19} />)}
            {link("/admin/roles", "Custom roles", <KeyIcon size={19} />)}
            {link("/admin/settings", "Discord webhooks", <CogIcon size={19} />)}
          </>}
          {link("/admin/password", "Change Password", <KeyIcon size={19} />)}
          {link("/portal", "Employee Portal", <GridIcon size={19} />)}
          <a href="/" className="side-link" target="_blank" rel="noreferrer"><HomeIcon size={19} /> View Website</a>
          <div className="side-foot">
            <div className="who">{me.displayName || me.username}</div>
            <div className="muted">{roleLabel(me.role)}</div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn btn-outline btn-xs" onClick={logout}><LogoutIcon size={16} /> Sign out</button><ModeToggle /></div>
          </div>
        </aside>
        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </Ctx.Provider>
  );
}

export function RequirePerm({ perm, children }: { perm: Permission | Permission[]; children: React.ReactNode }) {
  const me = useMe();
  if (!can(me.role, perm)) return <p className="alert error">Your account doesn't have access to this section.</p>;
  return <>{children}</>;
}

export function AdminTop({ title, text, children }: { title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="admin-top">
      <div>
        <h1>{title}</h1>
        {text && <p>{text}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}
