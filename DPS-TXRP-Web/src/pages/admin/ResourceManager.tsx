import { useMemo, useState } from "react";
import { api, fileUrl, uploadFile } from "../../api";
import { useApi } from "../../useApi";
import { CloseIcon, PlusIcon } from "../../components/Icons";
import { AdminTop } from "./AdminLayout";

export type Field = {
  key: string;
  label: string;
  type?: "text" | "textarea" | "number" | "select" | "image" | "file" | "checkbox" | "datetime" | "custom";
  render?: (draft: any, update: (k: string, v: unknown) => void) => React.ReactNode;
  options?: { value: string | number | null; label: string }[];
  required?: boolean;
  full?: boolean;
  hint?: string;
  placeholder?: string;
  rows?: number;
};

export type Column<T> = { label: string; render: (row: T) => React.ReactNode; className?: string };

type Props<T> = {
  endpoint: string;
  title: string;
  text?: string;
  singular: string;
  fields: Field[] | ((draft: any) => Field[]);
  columns: Column<T>[];
  defaults: Record<string, unknown>;
  searchText?: (row: T) => string;
  emptyText?: string;
  beforeSave?: (draft: any) => string | void;
  rowActions?: (row: T, reload: () => void) => React.ReactNode;
  toolbar?: React.ReactNode | ((reload: () => void) => React.ReactNode);
  filter?: (row: T) => boolean;
};

const toLocalInput = (v: unknown) => {
  if (!v) return "";
  const d = new Date(v as string);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
};

export function ResourceManager<T extends { id: number }>(props: Props<T>) {
  const [rows, error, reload] = useApi<T[]>(props.endpoint);
  const [draft, setDraft] = useState<any | null>(null);
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    if (!rows) return rows;
    const base = props.filter ? rows.filter(props.filter) : rows;
    if (!q || !props.searchText) return base;
    return base.filter((r) => props.searchText!(r).toLowerCase().includes(q.toLowerCase()));
  }, [rows, q, props.searchText, props.filter]);

  async function remove(row: T) {
    if (!confirm(`Delete this ${props.singular.toLowerCase()}? This can't be undone.`)) return;
    try {
      await api(`${props.endpoint}/${row.id}`, { method: "DELETE" });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <>
      <AdminTop title={props.title} text={props.text}>
        <button className="btn btn-gold btn-sm" onClick={() => setDraft({ ...props.defaults })}>
          <PlusIcon size={18} /> Add {props.singular}
        </button>
      </AdminTop>
      {(props.searchText || props.toolbar) && (
        <div className="toolbar">
          {props.searchText && <input className="input search" placeholder={`Search ${props.title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} />}
          {typeof props.toolbar === "function" ? props.toolbar(reload) : props.toolbar}
        </div>
      )}
      {error && <p className="alert error">{error}</p>}
      {!rows && !error && <p className="loading">Loading…</p>}
      {rows && rows.length === 0 && (
        <div className="card center">
          <p className="muted" style={{ marginTop: 0 }}>{props.emptyText ?? `No ${props.title.toLowerCase()} yet.`}</p>
          <button className="btn btn-gold btn-sm" onClick={() => setDraft({ ...props.defaults })}><PlusIcon size={18} /> Add the first one</button>
        </div>
      )}
      {visible && visible.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {props.columns.map((c) => <th key={c.label}>{c.label}</th>)}
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id}>
                  {props.columns.map((c) => <td key={c.label} className={c.className}>{c.render(r)}</td>)}
                  <td className="actions">
                    {props.rowActions?.(r, reload)}
                    <button className="btn btn-outline btn-xs" onClick={() => setDraft({ ...r })}>Edit</button>
                    <button className="btn btn-danger btn-xs" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <EditModal
          {...props}
          draft={draft}
          setDraft={setDraft}
          onSaved={() => {
            setDraft(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function EditModal<T>({
  endpoint, singular, fields, draft, setDraft, onSaved, beforeSave,
}: Props<T> & { draft: any; setDraft: (d: any) => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const list = typeof fields === "function" ? fields(draft) : fields;
  const isNew = !draft.id;
  const update = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });

  async function onFile(f: Field, file: File | undefined) {
    if (!file) return;
    setUploading(f.key);
    setError(undefined);
    try {
      const res = await uploadFile(file, { image: f.type === "image", internal: f.type === "file" });
      setDraft({ ...draft, [f.key]: res.key, [`${f.key}__name`]: res.filename });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const problem = beforeSave?.(draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    const body: Record<string, unknown> = {};
    for (const f of list) if (f.key && !f.key.startsWith("_")) body[f.key] = draft[f.key];
    try {
      await api(isNew ? endpoint : `${endpoint}/${draft.id}`, { method: isNew ? "POST" : "PUT", body });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setDraft(null)}>
      <form className="modal" onSubmit={save}>
        <div className="modal-head">
          <h2>{isNew ? `Add ${singular}` : `Edit ${singular}`}</h2>
          <button type="button" className="icon-btn" onClick={() => setDraft(null)} aria-label="Close"><CloseIcon /></button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            {list.map((f) => {
              const id = `f-${f.key}`;
              const v = draft[f.key];
              const full = f.full || f.type === "textarea" || f.type === "image" || f.type === "file" || f.type === "custom";
              if (f.type === "custom")
                return <div key={f.key} className="field full"><label>{f.label}</label>{f.render?.(draft, update)}{f.hint && <span className="hint">{f.hint}</span>}</div>;
              if (f.type === "checkbox")
                return (
                  <label key={f.key} className={`checkbox${full ? " full" : ""}`} style={{ alignSelf: "end", paddingBottom: 10 }}>
                    <input type="checkbox" checked={Boolean(v)} onChange={(e) => update(f.key, e.target.checked)} /> {f.label}
                  </label>
                );
              return (
                <div key={f.key} className={`field${full ? " full" : ""}`}>
                  <label htmlFor={id}>{f.label}{f.required ? " *" : ""}</label>
                  {f.type === "textarea" ? (
                    <textarea id={id} className="input" rows={f.rows ?? 5} required={f.required} placeholder={f.placeholder} value={v ?? ""} onChange={(e) => update(f.key, e.target.value)} />
                  ) : f.type === "select" ? (
                    <select id={id} className="input" value={v ?? ""} onChange={(e) => update(f.key, e.target.value === "" ? null : e.target.value)}>
                      {f.options?.map((o) => <option key={String(o.value)} value={o.value ?? ""}>{o.label}</option>)}
                    </select>
                  ) : f.type === "image" || f.type === "file" ? (
                    <div className="upload-box">
                      {f.type === "image" && <div className="preview" style={v ? { backgroundImage: `url(${fileUrl(v)})` } : undefined} />}
                      {f.type === "file" && v && <span className="file-name">{draft[`${f.key}__name`] || "File attached"}</span>}
                      <label className="btn btn-outline btn-xs" style={{ cursor: "pointer" }}>
                        {uploading === f.key ? "Uploading…" : v ? "Replace" : "Upload"}
                        <input id={id} type="file" hidden accept={f.type === "image" ? "image/png,image/jpeg,image/gif,image/webp" : undefined} onChange={(e) => onFile(f, e.target.files?.[0])} />
                      </label>
                      {v && <button type="button" className="btn btn-danger btn-xs" onClick={() => update(f.key, null)}>Remove</button>}
                    </div>
                  ) : f.type === "datetime" ? (
                    <input id={id} className="input" type="datetime-local" value={toLocalInput(v)} onChange={(e) => update(f.key, e.target.value ? new Date(e.target.value).toISOString() : null)} />
                  ) : (
                    <input id={id} className="input" type={f.type === "number" ? "number" : "text"} required={f.required} placeholder={f.placeholder} value={v ?? ""} onChange={(e) => update(f.key, e.target.value)} />
                  )}
                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              );
            })}
          </div>
          {error && <p className="alert error" style={{ margin: 0 }}>{error}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          <button className="btn btn-gold btn-sm" disabled={busy || Boolean(uploading)}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
