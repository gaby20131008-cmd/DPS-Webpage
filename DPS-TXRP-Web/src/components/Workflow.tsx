import { useState, type FormEvent, type ReactNode } from "react";
import { formatDate, Pill, type Announcement, type CalEvent } from "../api";

export function PageHero({ eyebrow, title, text, image = "/images/patrol-units.jpg" }: { eyebrow: string; title: string; text?: string; image?: string }) {
  return <section className="page-hero" style={{ backgroundImage: `url(${image})` }}><div className="wrap">
    <p className="eyebrow">{eyebrow}</p><h1>{title}</h1><hr className="rule" />{text && <p>{text}</p>}
  </div></section>;
}

type Choice = string | { value: string | number; label: string };

export function Field({ name, label, options, multiline, initial, placeholder, type = "text", required, maxLength, min, max }: {
  name: string; label: string; options?: Choice[]; multiline?: boolean; initial?: string | number | null;
  placeholder?: string; type?: string; required?: boolean; maxLength?: number; min?: number; max?: number;
}) {
  const props = { className: "input", name, required, defaultValue: initial ?? "" };
  return <label className="field"><span>{label}</span>{options ? (
    <select {...props}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((choice) => typeof choice === "string" ? <option key={choice}>{choice}</option> : <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  ) : multiline ? <textarea {...props} rows={4} placeholder={placeholder} maxLength={maxLength} /> : <input {...props} type={type} placeholder={placeholder} maxLength={maxLength} min={min} max={max} />}</label>;
}

export function WorkflowForm({ label, submit, children, reset, success = "Saved." }: {
  label: string; submit: (values: Record<string, string>) => Promise<unknown>; children?: ReactNode; reset?: boolean; success?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const values = Object.fromEntries(Array.from(new FormData(form), ([key, value]) => [key, String(value)]));
      await submit(values);
      if (reset) form.reset();
      setSaved(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The request could not be completed.");
    } finally {
      setBusy(false);
    }
  }
  return <form className="stack" onSubmit={handleSubmit}>
    {children}
    {error && <p role="alert" className="alert error">{error}</p>}
    {saved && success && <p role="status" className="alert success">{success}</p>}
    <div><button className="btn btn-gold btn-sm" disabled={busy}>{busy ? "Please wait…" : label}</button></div>
  </form>;
}

export function Action({ children, run }: { children: ReactNode; run: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div>
    <button type="button" className="btn btn-outline btn-xs" disabled={busy} onClick={async () => {
      setBusy(true);
      setError("");
      try { await run(); } catch (problem) { setError(problem instanceof Error ? problem.message : "The request failed."); } finally { setBusy(false); }
    }}>{busy ? "Please wait…" : children}</button>
    {error && <p className="alert error" role="alert">{error}</p>}
  </div>;
}

export function Panel({ title, kicker, children }: { title: string; kicker?: string; children: ReactNode }) {
  return <section className="card desk-panel stack">
    <header>{kicker && <p className="eyebrow">{kicker}</p>}<h2>{title}</h2></header>
    {children}
  </section>;
}

export function Collection<T>({ data, error, empty, children }: { data?: T[]; error?: string; empty: string; children: (row: T) => ReactNode }) {
  if (error) return <p className="alert error" role="alert">{error}</p>;
  if (!data) return <p className="loading" role="status">Loading…</p>;
  return data.length ? <div className="desk-list">{data.map(children)}</div> : <p className="empty">{empty}</p>;
}

export function AnnouncementRow({ row }: { row: Announcement }) {
  return <article className="desk-row">
    <div className="row"><h3>{row.title}</h3>{row.pinned && <Pill s="Pinned" />}{row.priority !== "Normal" && <Pill s={row.priority} />}</div>
    <p className="muted">{[row.authorName, formatDate(row.createdAt), row.unitName].filter(Boolean).join(" · ")}</p>
    <p className="preserve">{row.body}</p>
  </article>;
}

export function EventRow({ row, children }: { row: CalEvent; children?: ReactNode }) {
  return <article className="desk-row">
    <div className="row"><h3>{row.title}</h3><Pill s={row.kind} /></div>
    <p className="muted">{formatDate(row.startsAt, true)}{row.endsAt ? ` – ${formatDate(row.endsAt, true)}` : ""}{row.location ? ` · ${row.location}` : ""}</p>
    {row.description && <p className="preserve">{row.description}</p>}
    {children}
  </article>;
}

export const localDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
