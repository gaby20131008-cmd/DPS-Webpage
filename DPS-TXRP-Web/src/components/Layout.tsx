import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { CloseIcon, FileIcon, LockIcon, MailIcon, MenuIcon, MoonIcon, SunIcon } from "./Icons";
import { useSite } from "../site";

export const NAV = [
  { to: "/", label: "Home" },
  { to: "/about", label: "About Us" },
  { to: "/divisions", label: "Divisions" },
  { to: "/news", label: "News" },
  { to: "/community", label: "Community" },
  { to: "/contact", label: "Contact" },
  { to: "/admin/login", label: "Employee Login" },
];

export function Brand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="brand" aria-label="Texas Department of Public Safety home">
      <img src="/badge.png" alt="" width={54} height={54} />
      <div className="brand-text">
        <strong>Texas Department</strong>
        <span>Of Public Safety</span>
      </div>
    </Link>
  );
}

export function ModeToggle({ className = "icon-btn mode-toggle" }: { className?: string }) {
  const { mode, toggleMode } = useSite();
  return (
    <button type="button" className={className} onClick={toggleMode} aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"} title={mode === "dark" ? "Light mode" : "Dark mode"}>
      {mode === "dark" ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </button>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();
  const { config } = useSite();

  useEffect(() => {
    setOpen(false);
    if (!hash) { window.scrollTo(0, 0); return; }
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [pathname, hash]);

  return (
    <>
      <header className="site-header">
        <div className="wrap">
          <Brand />
          <div className="header-right">
            <ModeToggle />
            <button className="menu-toggle" onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
              {open ? <CloseIcon size={30} /> : <MenuIcon size={30} />}
            </button>
          </div>
          <nav className={`main-nav${open ? " open" : ""}`}>
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} className="nav-link">
                {n.label}
              </NavLink>
            ))}
            <div className="nav-actions">
              <ModeToggle className="icon-btn mode-toggle desktop-only" />
              <Link to="/portal" className="btn btn-gold btn-sm">
                <LockIcon size={18} /> Employee Portal
              </Link>
            </div>
          </nav>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="wrap top">
          <div>
            <Brand />
            <p className="tag">{config.tagline}</p>
          </div>
          <div>
            <h4>Explore</h4>
            <ul>
              <li><Link to="/about">About Us</Link></li>
              <li><Link to="/about#command">Chain of Command</Link></li>
              <li><Link to="/divisions">Divisions</Link></li>
              <li><Link to="/news">News &amp; Releases</Link></li>
              <li><Link to="/policies/rules">Rules &amp; Policies</Link></li>
            </ul>
          </div>
          <div>
            <h4>Services</h4>
            <ul>
              <li><Link to="/complaint"><FileIcon size={15} /> File a Complaint</Link></li>
              <li><Link to="/complaint/status">Complaint Status</Link></li>
              <li><Link to="/community">Community &amp; FAQ</Link></li>
              <li><Link to="/admin/login">Employee Login</Link></li>
              <li><Link to="/portal">Employee Portal</Link></li>
            </ul>
          </div>
          <div>
            <h4>Contact</h4>
            {config.contactEmail && (
              <a className="contact-line" href={`mailto:${config.contactEmail}`}>
                <MailIcon /> {config.contactEmail}
              </a>
            )}
            {config.discordInvite && (
              <a className="contact-line" style={{ marginTop: 12 }} href={config.discordInvite} target="_blank" rel="noopener noreferrer">
                <MailIcon /> Join our Discord
              </a>
            )}
            <p style={{ marginTop: 14 }}><Link to="/contact" className="text-link" style={{ fontSize: 15 }}>Contact the Department</Link></p>
          </div>
        </div>
        <div className="wrap bottom">
          <span>© {new Date().getFullYear()} {config.departmentName}.</span>
          <span>A roleplay community department.</span>
        </div>
      </footer>
    </>
  );
}
