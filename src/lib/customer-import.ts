import type { Frequency } from "@prisma/client";

/**
 * Parses the customer CSV for /customers import. Pure, so the client runs it
 * for the preview and the server action runs it again on the same text —
 * the server never trusts rows the browser already parsed.
 */

export const IMPORT_COLUMNS = ["name", "address", "phone", "mow day", "frequency", "price"] as const;

export const IMPORT_TEMPLATE =
  "name,address,phone,mow day,frequency,price\n" +
  'Jane Smith,"12 Oak St, Springfield",555-0100,Tuesday,weekly,45\n' +
  "Bob Lee,48 Elm Ave,,Friday,biweekly,$60.00\n";

export const MAX_IMPORT_ROWS = 2000;

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const FREQ: Record<string, Frequency> = {
  weekly: "WEEKLY",
  biweekly: "BIWEEKLY",
  "bi-weekly": "BIWEEKLY",
  "every other week": "BIWEEKLY",
  monthly: "MONTHLY",
};

export type ImportRow = {
  line: number;
  name: string;
  address: string;
  phone: string | null;
  mowDay: number | null; // 0 = Sunday … 6 = Saturday
  mowFrequency: Frequency | null;
  priceCents: number | null;
};

export type ImportResult = { rows: ImportRow[]; errors: string[] };

/** RFC 4180-ish: quoted fields, "" escapes, CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") endField();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function parseImportCsv(text: string): ImportResult {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { rows: [], errors: ["The file is empty."] };

  const norm = (s: string) => s.trim().toLowerCase().replace(/[_-]+/g, " ");
  const col = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.map(norm).indexOf(c)]));
  if (col.name < 0 || col.address < 0) {
    return { rows: [], errors: ['The first row must be headers, with at least "name" and "address".'] };
  }
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [`Too many rows (${body.length}). Import at most ${MAX_IMPORT_ROWS} at a time.`] };
  }

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  body.forEach((r, i) => {
    const line = i + 2;
    const get = (c: (typeof IMPORT_COLUMNS)[number]) => (col[c] >= 0 ? (r[col[c]] ?? "").trim() : "");
    const problems: string[] = [];

    const name = get("name");
    const address = get("address");
    if (!name) problems.push("missing name");
    if (!address) problems.push("missing address");

    const dayText = get("mow day").toLowerCase();
    let mowDay: number | null = null;
    if (dayText) {
      const d = DAYS.findIndex((day) => day.startsWith(dayText.slice(0, 3)) && dayText.length >= 3);
      if (d < 0) problems.push(`unknown mow day "${get("mow day")}"`);
      else mowDay = d;
    }

    const freqText = get("frequency").toLowerCase();
    let mowFrequency: Frequency | null = null;
    if (freqText) {
      mowFrequency = FREQ[freqText] ?? null;
      if (!mowFrequency) problems.push(`unknown frequency "${get("frequency")}" (use weekly, biweekly or monthly)`);
    } else if (mowDay !== null) mowFrequency = "WEEKLY";

    const priceText = get("price").replace(/[$,\s]/g, "");
    let priceCents: number | null = null;
    if (priceText) {
      if (!/^\d+(\.\d{1,2})?$/.test(priceText)) problems.push(`price "${get("price")}" is not a number`);
      else priceCents = Math.round(Number(priceText) * 100);
    }

    if (problems.length) errors.push(`Row ${line}: ${problems.join(", ")}`);
    else rows.push({ line, name, address, phone: get("phone") || null, mowDay, mowFrequency, priceCents });
  });
  return { rows, errors };
}

/** First date on or after `from` (UTC midnight) that falls on `weekday`. */
export function nextWeekday(from: Date, weekday: number): Date {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + ((weekday - d.getUTCDay() + 7) % 7));
  return d;
}
