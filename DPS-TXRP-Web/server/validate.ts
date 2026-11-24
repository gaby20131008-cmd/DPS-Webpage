type FieldType = "string" | "text" | "int" | "intOrNull" | "stringOrNull" | "bool" | "date" | "dateOrNull" | "json";
export type FieldSpec = Record<string, { type: FieldType; required?: boolean; max?: number; oneOf?: string[] }>;

/** Picks and validates allowed fields from an incoming JSON body. */
export function parseFields(spec: FieldSpec, body: any, partial = false): { data?: Record<string, unknown>; error?: string } {
  if (!body || typeof body !== "object") return { error: "Invalid request body" };
  const data: Record<string, unknown> = {};
  for (const [key, f] of Object.entries(spec)) {
    if (!(key in body)) {
      if (f.required && !partial) return { error: `${key} is required` };
      continue;
    }
    let v = body[key];
    switch (f.type) {
      case "string":
      case "text": {
        v = v == null ? "" : String(v).trim();
        const max = f.max ?? (f.type === "text" ? 20000 : 300);
        if ((v as string).length > max) return { error: `${key} is too long` };
        if (f.required && !v) return { error: `${key} is required` };
        if (f.oneOf && !f.oneOf.includes(v as string)) return { error: `${key} is invalid` };
        break;
      }
      case "stringOrNull":
        v = v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, f.max ?? 2000);
        break;
      case "int":
        v = Number.parseInt(v, 10);
        if (!Number.isFinite(v)) v = 0;
        break;
      case "intOrNull":
        v = v === null || v === "" || v === undefined ? null : Number.parseInt(v, 10);
        if (v !== null && !Number.isFinite(v)) v = null;
        break;
      case "bool":
        v = v === true || v === "true" || v === 1;
        break;
      case "json": {
        if (v === null || typeof v !== "object") return { error: `${key} is invalid` };
        if (JSON.stringify(v).length > (f.max ?? 100000)) return { error: `${key} is too large` };
        break;
      }
      case "dateOrNull": {
        if (v === null || v === "" || v === undefined) {
          v = null;
          break;
        }
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return { error: `${key} is not a valid date` };
        v = d;
        break;
      }
      case "date": {
        const d = v ? new Date(v) : new Date();
        if (Number.isNaN(d.getTime())) return { error: `${key} is not a valid date` };
        v = d;
        break;
      }
    }
    data[key] = v;
  }
  return { data };
}
