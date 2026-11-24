import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, FEEDBACK_KINDS, formatDate, PAGE_SLUGS, Pill, type CalEvent, type Faq, type Page, type Rank, type RosterMember } from "../api";
import { Collection, EventRow, Field, PageHero, Panel, WorkflowForm } from "../components/Workflow";
import { useSite } from "../site";
import { useApi } from "../useApi";

function PublishedPage({ slug }: { slug: string }) {
  const [page, error] = useApi<Page>(`/api/pages/${slug}`);
  const title = PAGE_SLUGS.find((entry) => entry.slug === slug)?.title ?? slug;
  return <Panel title={page?.title ?? title}>
    {error ? <p className="alert error" role="alert">{error}</p> : page ? <p className="preserve">{page.body}</p> : <p className="loading">Loading…</p>}
  </Panel>;
}

export function AboutResources() {
  const [chart, error] = useApi<{ ranks: (Rank & { members: RosterMember[] })[]; unranked: RosterMember[]; units: { id: number; name: string; size: number; leaders: RosterMember[] }[] }>("/api/org-chart");
  return <section className="section alt"><div className="wrap stack">
    <div className="desk-grid">{PAGE_SLUGS.filter((entry) => entry.group === "about").map((entry) => <PublishedPage key={entry.slug} slug={entry.slug} />)}</div>
    <div className="row">{PAGE_SLUGS.filter((entry) => entry.group === "policy").map((entry) => <Link key={entry.slug} className="btn btn-outline btn-sm" to={`/policies/${entry.slug}`}>{entry.title}</Link>)}</div>
    <div className="desk-grid" id="command">
      <Panel title="Chain of command" kicker="Rank structure">
        <Collection data={chart?.ranks} error={error} empty="No ranks published.">{(rank) => <div className="desk-row" key={rank.id}><div className="row"><h3>{rank.name}</h3><Pill s={rank.tier} /></div>{rank.description && <p>{rank.description}</p>}{rank.members.length > 0 && <p className="muted">{rank.members.map((member) => member.name).join(" · ")}</p>}</div>}</Collection>
        {!!chart?.unranked.length && <p className="muted">Other personnel: {chart.unranked.map((member) => member.name).join(" · ")}</p>}
      </Panel>
      <Panel title="Unit leadership" kicker="Specialized units">
        <Collection data={chart?.units} error={error} empty="No units published.">{(unit) => <div className="desk-row" key={unit.id}><h3><Link to={`/divisions/${unit.id}`}>{unit.name}</Link></h3><p className="muted">{unit.size} assigned · {unit.leaders.map((leader) => `${leader.name}${leader.position ? ` (${leader.position})` : ""}`).join(", ") || "Leadership not listed"}</p></div>}</Collection>
      </Panel>
    </div>
  </div></section>;
}

export function Policy() {
  const { slug } = useParams();
  const entry = PAGE_SLUGS.find((page) => page.slug === slug && page.group === "policy");
  return <><PageHero eyebrow="TXDPS · Policy Library" title={entry?.title ?? "Policy Library"} /><section className="section"><div className="wrap stack">
    <div className="row">{PAGE_SLUGS.filter((page) => page.group === "policy").map((page) => <Link key={page.slug} className="btn btn-outline btn-sm" to={`/policies/${page.slug}`}>{page.title}</Link>)}</div>
    {entry && <PublishedPage slug={entry.slug} />}
  </div></section></>;
}

type Tracking = { caseNumber?: string; status: string; category?: string; updatedAt: string };

export function TrackingPage() {
  const [result, setResult] = useState<Tracking>();
  return <><PageHero eyebrow="TXDPS · Internal Affairs" title="Complaint Status" /><section className="section"><div className="wrap workflow-width stack">
    <Panel title="Find your case">
      <WorkflowForm label="Check status" success="" submit={async (values) => {
        setResult(undefined);
        setResult(await api<Tracking>(`/api/complaints/status?${new URLSearchParams(values)}`));
      }}>
        <Field name="case" label="Case number" required maxLength={40} placeholder="IA-YYYY-0000" />
        <Field name="code" label="Private tracking code" required maxLength={20} />
      </WorkflowForm>
    </Panel>
    {result && <Panel title={result.caseNumber ?? "Status"}>
      <div className="row"><Pill s={result.status} /><span>{result.category}</span></div>
      <p className="muted">Updated {formatDate(result.updatedAt, true)}</p>
    </Panel>}
  </div></section></>;
}

export function Community() {
  const [faqs, faqError] = useApi<Faq[]>("/api/faqs");
  const [events, eventError] = useApi<CalEvent[]>("/api/events");
  return <><PageHero eyebrow="TXDPS · Public Information" title="Community" text="Stay informed, take part, and share your feedback." /><section className="section"><div className="wrap stack">
    <div className="row"><Link className="btn btn-gold btn-sm" to="/contact">Send feedback</Link><Link className="btn btn-outline btn-sm" to="/complaint">File a complaint</Link><Link className="btn btn-outline btn-sm" to="/news">Public information releases</Link></div>
    <div className="desk-grid">
      <Panel title="Frequently asked questions"><Collection data={faqs} error={faqError} empty="No questions have been published yet.">{(faq) => <details className="desk-row" key={faq.id}><summary>{faq.question}</summary><p className="preserve">{faq.answer}</p></details>}</Collection></Panel>
      <Panel title="Community calendar"><Collection data={events} error={eventError} empty="No upcoming public events.">{(event) => <EventRow key={event.id} row={event} />}</Collection></Panel>
    </div>
    <PublishedPage slug="guidelines" />
  </div></section></>;
}

export function Contact() {
  const { config } = useSite();
  return <><PageHero eyebrow="TXDPS · Community Services" title="Contact the Department" text="For questions and feedback about the roleplay community." /><section className="section"><div className="wrap desk-grid">
    <Panel title="Send a message">
      <WorkflowForm label="Send message" reset success="Your message was sent to TXDPS." submit={(body) => api("/api/feedback", { body })}>
        <div className="form-grid"><Field name="kind" label="Topic" options={FEEDBACK_KINDS} initial="Contact" required /><Field name="name" label="Your name" required maxLength={120} /><Field name="contact" label="Reply email or username" maxLength={200} /><Field name="subject" label="Subject" maxLength={200} /></div>
        <Field name="message" label="Message" required multiline maxLength={5000} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="trap-field" />
      </WorkflowForm>
    </Panel>
    <Panel title="Other ways to reach us" kicker="Community contacts">
      {config.contactEmail && <p><a className="text-link" href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a></p>}
      <p>Complaints about a trooper or employee go directly to Internal Affairs.</p><div><Link className="btn btn-outline btn-sm" to="/complaint">File a complaint</Link></div>
      <p className="muted">This website is for a roleplay community. Do not use it to report real incidents or emergencies.</p>
    </Panel>
  </div></section></>;
}
