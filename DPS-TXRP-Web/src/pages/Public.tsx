import { Link, useParams } from "react-router-dom";
import { useApi } from "../useApi";
import { DEPARTMENT_STATUSES, fileUrl, formatDate, type Announcement, type CalEvent, type Division, type Leader, type NewsPost, type RosterMember } from "../api";
import { ArrowRight, BriefcaseIcon, GridIcon, LockIcon, NewsIcon, ShieldIcon, UsersIcon } from "../components/Icons";
import { AnnouncementRow, Collection, EventRow, PageHero, Panel } from "../components/Workflow";
import { useSite } from "../site";
import { AboutResources } from "./Community";

const EMPTY_NEWS = "The TXDPS Public Information Office has no press releases at this time.";

export function DivisionCard({ d }: { d: Division }) {
  return (
    <Link
      to={`/divisions/${d.id}`}
      className={`division-card${d.imageKey ? "" : " placeholder-art"}`}
      style={d.imageKey ? { backgroundImage: `url(${fileUrl(d.imageKey)})` } : undefined}
    >
      <div className="inner">
        {d.code && <p className="eyebrow">{d.code}</p>}
        <h3>{d.name}</h3>
        {d.summary && <p>{d.summary}</p>}
      </div>
    </Link>
  );
}

export function NewsCard({ n }: { n: NewsPost }) {
  return (
    <Link to={`/news/${n.id}`} className="news-card">
      <div
        className={`thumb${n.imageKey ? "" : " placeholder-art"}`}
        style={n.imageKey ? { backgroundImage: `url(${fileUrl(n.imageKey)})` } : undefined}
      />
      <div className="body">
        <span className="meta">
          {n.category} · {formatDate(n.publishedAt)}
        </span>
        <h3>{n.title}</h3>
        {n.summary && <p>{n.summary}</p>}
      </div>
    </Link>
  );
}

export function LeaderCard({ l }: { l: Leader }) {
  return (
    <div className="leader-card">
      <div className="portrait" style={l.imageKey ? { backgroundImage: `url(${fileUrl(l.imageKey)})` } : undefined}>
        {!l.imageKey && <img className="badge" src="/badge.png" alt="" />}
      </div>
      <div className="body">
        <h3>{l.name}</h3>
        <div className="title">{l.title}</div>
        {l.bio && <p>{l.bio}</p>}
      </div>
    </div>
  );
}

/* ------------------------------ Home ------------------------------ */

export function Home() {
  const [data, error] = useApi<{ divisions: Division[]; news: NewsPost[]; leaders: Leader[]; rosterCount: number; announcements: Announcement[]; events: CalEvent[]; featured: RosterMember[] }>("/api/home");
  const { config, stats } = useSite();
  const status = DEPARTMENT_STATUSES.find((entry) => entry.key === config.status);

  return (
    <>
      <section className="hero" style={{ backgroundImage: "url(/images/sheriff-office.jpg)" }}>
        <div className="wrap">
          <p className="eyebrow">{config.departmentName}</p>
          <h1>
            {config.heroTitle}
            {config.heroHighlight && <span className="gold">{config.heroHighlight}</span>}
          </h1>
          <p>{config.heroText}</p>
          <div className="hero-actions">
            <Link to="/about" className="btn btn-gold">About the Department</Link>
            <Link to="/divisions" className="btn btn-outline">Explore Divisions</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <div>
            <p className="eyebrow">From the Director</p>
            <h2 className="section-title">Welcome to TXDPS</h2>
            <hr className="rule" />
            <p className="lead preserve">{config.chiefMessage}</p>
            <p><strong>{config.chiefName}</strong> · {config.chiefTitle}</p>
            <p style={{ marginTop: 30 }}>
              <Link to="/about" className="text-link">Our Mission &amp; Values <ArrowRight /></Link>
            </p>
          </div>
          <div className="photo">
            <img src={fileUrl(config.chiefPhotoKey) || "/images/patrol-units.jpg"} alt={config.chiefPhotoKey ? config.chiefName : "TXDPS patrol units"} />
          </div>
        </div>
      </section>

      <section className="section alt"><div className="wrap stack">
        <div className="section-head"><div><p className="eyebrow">Department status</p><h2 className="section-title">Operations at a glance</h2></div>{status && <span className={`pill ${status.tone}`}>{status.label}</span>}</div>
        {config.statusMessage && <p className="preserve">{config.statusMessage}</p>}
        {config.showStats && stats && <div className="stats desk-stats">{[["Personnel", stats.officers], ["On duty", stats.onDuty], ["Specialized units", stats.units], ["Reports filed", stats.reportsFiled]].map(([label, number]) => <div className="stat" key={label}><div className="n">{number}</div><div className="l">{label}</div></div>)}</div>}
        <div className="row"><Link className="btn btn-outline btn-sm" to="/community">Community services</Link><Link className="btn btn-outline btn-sm" to="/admin/login">Employee login</Link></div>
        <div className="desk-grid">
          <Panel title="Department announcements"><Collection data={data?.announcements} error={error} empty="No active public announcements.">{(row) => <AnnouncementRow key={row.id} row={row} />}</Collection></Panel>
          <Panel title="Upcoming public events"><Collection data={data?.events} error={error} empty="No upcoming public events.">{(row) => <EventRow key={row.id} row={row} />}</Collection></Panel>
        </div>
        {!!data?.featured.length && <Panel title="Featured personnel"><div className="directory-grid">{data.featured.map((member) => <div key={member.id} className="desk-row"><img className="deputy-avatar" src={fileUrl(member.photoKey) || "/badge.png"} alt="" /><h3>{member.name}</h3><p className="muted">{[member.rank, member.callsign].filter(Boolean).join(" · ")}</p><p>{member.bio}</p></div>)}</div></Panel>}
      </div></section>

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="eyebrow">Our Divisions</p>
              <h2 className="section-title">Specialized units, one mission</h2>
              <hr className="rule" />
            </div>
            <Link to="/divisions" className="btn btn-dark">All Divisions</Link>
          </div>
          {data && data.divisions.length === 0 && <p className="empty">Divisions will be announced soon.</p>}
          <div className="grid grid-2">
            {data?.divisions.slice(0, 6).map((d) => <DivisionCard key={d.id} d={d} />)}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="eyebrow">Latest News</p>
              <h2 className="section-title">News &amp; Announcements</h2>
              <hr className="rule" />
            </div>
            <Link to="/news" className="btn btn-outline btn-sm">View all news</Link>
          </div>
          {data && data.news.length === 0 && <p className="empty">{EMPTY_NEWS}</p>}
          <div className="grid grid-3">
            {data?.news.map((n) => <NewsCard key={n.id} n={n} />)}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap center">
          <p className="eyebrow">Quick Links</p>
          <h2 className="section-title">How can we help?</h2>
          <hr className="rule" />
          <div className="grid grid-4" style={{ marginTop: 20 }}>
            <Link to="/divisions" className="quick-link"><span className="icon-circle"><GridIcon size={30} /></span>Divisions</Link>
            <Link to="/complaint" className="quick-link"><span className="icon-circle"><BriefcaseIcon size={30} /></span>File a Complaint</Link>
            <Link to="/news" className="quick-link"><span className="icon-circle"><NewsIcon size={30} /></span>News &amp; Updates</Link>
            <Link to="/admin" className="quick-link"><span className="icon-circle"><LockIcon size={30} /></span>Employee Login</Link>
          </div>
          <div className="values">
            <span><ShieldIcon /> Integrity</span>
            <span><UsersIcon /> Community</span>
            <span><ShieldIcon /> Accountability</span>
          </div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ About ------------------------------ */

export function About() {
  const values = [
    { t: "Integrity", d: "We hold ourselves to the highest ethical standards, on and off duty." },
    { t: "Community", d: "We build partnerships with the residents we serve and listen to their concerns." },
    { t: "Accountability", d: "Every trooper answers for their actions. Our Internal Affairs Division reviews every complaint." },
    { t: "Professionalism", d: "Training, discipline and respect guide every interaction." },
  ];
  return (
    <>
      <PageHero
        eyebrow="About TXDPS"
        title="Serving the State of Texas"
        text="An overview of who we are, what we do and the principles that guide every member of the department."
      />
      <section className="section">
        <div className="wrap split">
          <div>
            <p className="eyebrow">Our Mission</p>
            <h2 className="section-title">Protect, serve and uphold the law</h2>
            <hr className="rule" />
            <p className="lead">
              The Texas Department of Public Safety protects life and property, preserves the peace and enforces the law with
              fairness and respect. Our troopers patrol the state, investigate crime, support specialized operations and
              work alongside the communities we serve to keep Texas safe.
            </p>
          </div>
          <div className="photo"><img src="/images/sheriff-office.jpg" alt="Texas Department of Public Safety headquarters" /></div>
        </div>
      </section>
      <section className="section alt">
        <div className="wrap">
          <p className="eyebrow">Core Values</p>
          <h2 className="section-title">What we stand for</h2>
          <hr className="rule" />
          <div className="grid grid-4">
            {values.map((v) => (
              <div className="card" key={v.t}>
                <h3 className="gold">{v.t}</h3>
                <p className="muted" style={{ marginBottom: 0 }}>{v.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <AboutResources />
    </>
  );
}

/* ------------------------------ Divisions ------------------------------ */

export function Divisions() {
  const [divs, error] = useApi<Division[]>("/api/divisions");
  return (
    <>
      <PageHero eyebrow="Our Divisions" title="Specialized units, one mission" text="Each division brings its own training and expertise to the department." />
      <section className="section">
        <div className="wrap">
          {error && <p className="alert error">{error}</p>}
          {!divs && !error && <p className="loading">Loading divisions…</p>}
          {divs?.length === 0 && <p className="empty">Divisions will be announced soon.</p>}
          <div className="grid grid-2">{divs?.map((d) => <DivisionCard key={d.id} d={d} />)}</div>
        </div>
      </section>
    </>
  );
}

export function DivisionDetail() {
  const { id } = useParams();
  const [data, error] = useApi<{ division: Division; members: RosterMember[]; announcements: Announcement[] }>(`/api/divisions/${id}`);
  if (error) return <div className="wrap section"><p className="alert error">{error}</p></div>;
  if (!data) return <div className="wrap section"><p className="loading">Loading…</p></div>;
  const { division: d, members } = data;
  return (
    <>
      <PageHero eyebrow={d.code || "Division"} title={d.name} text={d.summary} image={d.imageKey ? fileUrl(d.imageKey) : undefined} />
      <section className="section">
        <div className="wrap">
          {d.description && <div className="prose"><p>{d.description}</p></div>}
          <div className="desk-grid"><Panel title="Membership requirements"><p className="preserve">{d.requirements || "Requirements have not been published."}</p></Panel>
          <Panel title="Unit leadership"><Collection data={members.filter((member) => member.isLeader)} empty="No unit leaders are listed.">{(member) => <div className="desk-row" key={member.id}><h3>{member.name}</h3><p className="muted">{[member.rank, member.position].filter(Boolean).join(" · ")}</p></div>}</Collection></Panel></div>
          {!!data.announcements.length && <Panel title="Unit announcements"><Collection data={data.announcements} empty="No unit announcements.">{(row) => <AnnouncementRow key={row.id} row={row} />}</Collection></Panel>}
          <h2 className="section-title" style={{ marginTop: 40, fontSize: 38 }}>Division Roster</h2>
          <hr className="rule" />
          {members.length === 0 ? <p className="empty">No members are assigned to this division yet.</p> : <RosterTable members={members} hideDivision />}
          <p style={{ marginTop: 30 }}><Link to="/divisions" className="text-link">All divisions <ArrowRight /></Link></p>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ Roster ------------------------------ */

function statusPill(s: string) {
  const tone = s === "Active" ? "green" : s === "Suspended" || s === "Inactive" ? "red" : s === "LOA" || s === "Reserve" ? "gold" : "";
  return <span className={`pill ${tone}`}>{s}</span>;
}

export function RosterTable({ members, hideDivision }: { members: RosterMember[]; hideDivision?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            <th>Badge</th>
            <th>Name</th>
            <th>Rank</th>
            {!hideDivision && <th>Division</th>}
            <th>Callsign</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td className="gold" style={{ fontWeight: 600 }}>{m.badgeNumber || "—"}</td>
              <td style={{ fontWeight: 600 }}>{m.name}</td>
              <td>{m.rank || "—"}</td>
              {!hideDivision && <td>{m.divisionName || "Unassigned"}</td>}
              <td>{m.callsign || "—"}</td>
              <td>{statusPill(m.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------ Leadership ------------------------------ */

export function Leadership() {
  const [leaders, error] = useApi<Leader[]>("/api/leadership");
  return (
    <>
      <PageHero eyebrow="Command Staff" title="Leadership" text="The people who lead the Texas Department of Public Safety." image="/images/sheriff-office.jpg" />
      <section className="section">
        <div className="wrap">
          {error && <p className="alert error">{error}</p>}
          {!leaders && !error && <p className="loading">Loading…</p>}
          {leaders?.length === 0 && <p className="empty">Command staff will be listed here soon.</p>}
          <div className="grid grid-4">{leaders?.map((l) => <LeaderCard key={l.id} l={l} />)}</div>
        </div>
      </section>
    </>
  );
}

/* ------------------------------ News ------------------------------ */

export function News() {
  const [posts, error] = useApi<NewsPost[]>("/api/news");
  return (
    <>
      <PageHero eyebrow="Public Information Office" title="News & Announcements" text="Press releases and updates from the department." />
      <section className="section">
        <div className="wrap">
          {error && <p className="alert error">{error}</p>}
          {!posts && !error && <p className="loading">Loading news…</p>}
          {posts?.length === 0 && <p className="empty">{EMPTY_NEWS}</p>}
          <div className="grid grid-3">{posts?.map((n) => <NewsCard key={n.id} n={n} />)}</div>
        </div>
      </section>
    </>
  );
}

export function NewsDetail() {
  const { id } = useParams();
  const [post, error] = useApi<NewsPost>(`/api/news/${id}`);
  if (error) return <div className="wrap section"><p className="alert error">{error}</p></div>;
  if (!post) return <div className="wrap section"><p className="loading">Loading…</p></div>;
  return (
    <>
      <PageHero eyebrow={`${post.category} · ${formatDate(post.publishedAt)}`} title={post.title} text={post.summary} image={post.imageKey ? fileUrl(post.imageKey) : undefined} />
      <section className="section">
        <div className="wrap">
          <article className="prose">
            {post.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
          </article>
          <p style={{ marginTop: 30 }}><Link to="/news" className="text-link">All news <ArrowRight /></Link></p>
        </div>
      </section>
    </>
  );
}
