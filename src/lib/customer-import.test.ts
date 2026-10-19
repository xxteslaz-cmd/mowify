import { describe, expect, it } from "vitest";
import { IMPORT_TEMPLATE, nextWeekday, parseCsv, parseImportCsv } from "./customer-import";
import { parseISODate, toISODate } from "./date";

describe("customer CSV import", () => {
  it("parses quoted fields, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ]);
  });

  it("accepts the downloadable template as-is", () => {
    const { rows, errors } = parseImportCsv(IMPORT_TEMPLATE);
    expect(errors).toEqual([]);
    expect(rows).toMatchObject([
      { name: "Jane Smith", address: "12 Oak St, Springfield", mowDay: 2, mowFrequency: "WEEKLY", priceCents: 4500 },
      { name: "Bob Lee", phone: null, mowDay: 5, mowFrequency: "BIWEEKLY", priceCents: 6000 },
    ]);
  });

  it("reports bad rows by spreadsheet line and keeps the good ones", () => {
    const { rows, errors } = parseImportCsv(
      "Name,Address,Mow_Day,Frequency,Price\n,1 A St,,,\nAl,2 B St,Funday,daily,abc\nOk,3 C St,sat,,\n",
    );
    expect(errors).toEqual([
      "Row 2: missing name",
      'Row 3: unknown mow day "Funday", unknown frequency "daily" (use weekly, biweekly or monthly), price "abc" is not a number',
    ]);
    expect(rows).toMatchObject([{ line: 4, name: "Ok", mowDay: 6, mowFrequency: "WEEKLY" }]);
  });

  it("rejects a file without name and address headers", () => {
    expect(parseImportCsv("foo,bar\n1,2").errors).toHaveLength(1);
  });

  it("nextWeekday is inclusive of today", () => {
    const mon = parseISODate("2026-10-19");
    expect(toISODate(nextWeekday(mon, 1))).toBe("2026-10-19");
    expect(toISODate(nextWeekday(mon, 0))).toBe("2026-10-25");
  });
});
