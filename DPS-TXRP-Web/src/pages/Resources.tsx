import { useState } from "react";
import { Link } from "react-router-dom";
import { api, COMPLAINT_CATEGORIES } from "../api";

const blank = {
  complainantName: "",
  complainantDiscord: "",
  complainantRoblox: "",
  contact: "",
  officerName: "",
  officerBadge: "",
  incidentDate: "",
  location: "",
  category: "Misconduct",
  description: "",
  evidence: "",
  website: "",
};

export function Complaint() {
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [caseNumber, setCaseNumber] = useState<string>();
  const [trackingCode, setTrackingCode] = useState<string>();
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<{ caseNumber: string; trackingCode: string }>("/api/complaints", { body: form });
      setCaseNumber(res.caseNumber);
      setTrackingCode(res.trackingCode);
      setForm(blank);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="page-hero" style={{ backgroundImage: "url(/images/sheriff-office.jpg)" }}>
        <div className="wrap">
          <p className="eyebrow">Internal Affairs Division</p>
          <h1>File a Complaint</h1>
          <hr className="rule" />
          <p>
            Every complaint is reviewed by the Internal Affairs Division. Tell us what happened and we'll follow up with you.
          </p>
        </div>
      </section>
      <section className="section">
        <div className="wrap" style={{ maxWidth: 860 }}>
          {caseNumber ? (
            <div className="card center" style={{ padding: "48px 32px" }}>
              <p className="eyebrow">Complaint received</p>
              <h2 className="section-title" style={{ fontSize: 44 }}>Case {caseNumber}</h2>
              <hr className="rule" />
              <p className="lead" style={{ marginInline: "auto" }}>
                Thank you. Internal Affairs has your complaint. Keep your case number and private tracking code for reference. An investigator will
                contact you using the details you provided.
              </p>
              {trackingCode && <p>Tracking code: <strong className="reference-code">{trackingCode}</strong></p>}
              <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
                <Link to="/complaint/status" className="btn btn-gold">Check case status</Link>
                <button className="btn btn-outline" onClick={() => setCaseNumber(undefined)}>File another</button>
              </div>
            </div>
          ) : (
            <form className="card stack" onSubmit={submit} style={{ padding: 32 }}>
              <h3 className="gold">Your information</h3>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="c-name">Your name *</label>
                  <input id="c-name" className="input" required maxLength={120} value={form.complainantName} onChange={set("complainantName")} />
                </div>
                <div className="field">
                  <label htmlFor="c-discord">Discord username</label>
                  <input id="c-discord" className="input" maxLength={120} value={form.complainantDiscord} onChange={set("complainantDiscord")} />
                </div>
                <div className="field">
                  <label htmlFor="c-roblox">Roblox username</label>
                  <input id="c-roblox" className="input" maxLength={120} value={form.complainantRoblox} onChange={set("complainantRoblox")} />
                </div>
                <div className="field">
                  <label htmlFor="c-contact">Other contact (email, etc.)</label>
                  <input id="c-contact" className="input" maxLength={200} value={form.contact} onChange={set("contact")} />
                </div>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 15 }}>Provide at least one way for us to reach you.</p>

              <h3 className="gold" style={{ marginTop: 14 }}>Incident details</h3>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="c-officer">Trooper involved</label>
                  <input id="c-officer" className="input" maxLength={120} placeholder="Name, if known" value={form.officerName} onChange={set("officerName")} />
                </div>
                <div className="field">
                  <label htmlFor="c-badge">Badge / callsign</label>
                  <input id="c-badge" className="input" maxLength={40} value={form.officerBadge} onChange={set("officerBadge")} />
                </div>
                <div className="field">
                  <label htmlFor="c-date">Date &amp; time of incident</label>
                  <input id="c-date" className="input" maxLength={60} placeholder="e.g. Nov 22, around 8 PM" value={form.incidentDate} onChange={set("incidentDate")} />
                </div>
                <div className="field">
                  <label htmlFor="c-loc">Location</label>
                  <input id="c-loc" className="input" maxLength={200} value={form.location} onChange={set("location")} />
                </div>
                <div className="field full">
                  <label htmlFor="c-cat">Type of complaint</label>
                  <select id="c-cat" className="input" value={form.category} onChange={set("category")}>
                    {COMPLAINT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field full">
                  <label htmlFor="c-desc">What happened? *</label>
                  <textarea id="c-desc" className="input" required maxLength={6000} rows={7} value={form.description} onChange={set("description")} />
                </div>
                <div className="field full">
                  <label htmlFor="c-ev">Evidence links</label>
                  <textarea id="c-ev" className="input" maxLength={3000} rows={3} placeholder="Links to clips, screenshots, etc. (one per line)" value={form.evidence} onChange={set("evidence")} />
                </div>
              </div>
              <div className="hp" aria-hidden="true">
                <label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} /></label>
              </div>
              {error && <p className="alert error">{error}</p>}
              <div className="row">
                <button className="btn btn-gold" disabled={busy}>{busy ? "Submitting…" : "Submit Complaint"}</button>
                <span className="muted" style={{ fontSize: 15 }}>False reports may result in action against the reporter.</span>
              </div>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
