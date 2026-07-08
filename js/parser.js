/* ============================================================
   parser.js — Reads the county/court list the user uploads
   (a CSV file, or an Excel file exported as CSV) and turns it
   into rows we can map to lead fields.

   Plain English: this is the "translator." Every county's list
   looks different, so instead of guessing blindly, we read the
   column headers, make our best guess at what each column is,
   and let the user confirm/fix the guesses on screen before
   anything gets imported.
   ============================================================ */

const Parser = {
  // Very small, dependency-free delimited-text parser that handles
  // quoted fields and delimiters/newlines inside quotes. Works for
  // comma, tab, and semicolon separated files.
  parseCSV(text, delimiter = ",") {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const next = text[i + 1];

      if (inQuotes) {
        if (c === '"' && next === '"') {
          field += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === delimiter) {
          row.push(field);
          field = "";
        } else if (c === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else if (c === "\r") {
          // skip, \n handles the line break
        } else {
          field += c;
        }
      }
    }
    // last field/row
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
  },

  // Look at the first few lines and figure out whether the file is
  // separated by commas, tabs, or semicolons.
  detectDelimiter(text) {
    const sample = text.split("\n").slice(0, 5).join("\n");
    const counts = {
      "\t": (sample.match(/\t/g) || []).length,
      ";": (sample.match(/;/g) || []).length,
      ",": (sample.match(/,/g) || []).length,
    };
    let best = ",";
    let bestCount = 0;
    for (const [delim, count] of Object.entries(counts)) {
      if (count > bestCount) { best = delim; bestCount = count; }
    }
    return best;
  },

  // Fields we try to map from the uploaded file to our lead record.
  TARGET_FIELDS: [
    { key: "propertyAddress", label: "Property Address", required: false },
    { key: "parcelNumber", label: "Parcel Number", required: false },
    { key: "saleDate", label: "Tax Sale Date", required: true },
    { key: "overageAmount", label: "Overage / Surplus Amount", required: true },
    { key: "formerOwnerName", label: "Former Owner Name", required: true },
    { key: "sourceOffice", label: "Source / Office (e.g. Treasurer)", required: false },
  ],

  // Guess which uploaded column matches each target field based on
  // common header wording county lists use.
  GUESS_KEYWORDS: {
    propertyAddress: ["address", "property", "situs", "location"],
    parcelNumber: ["parcel", "apn", "pin", "tax id", "account"],
    saleDate: ["sale date", "auction date", "date of sale", "sold date", "sale"],
    overageAmount: [
      "overage",
      "surplus",
      "excess",
      "overbid",
      "proceeds",
      "amount",
      "balance",
    ],
    formerOwnerName: ["owner", "former owner", "defendant", "name", "claimant"],
    sourceOffice: ["office", "source", "department", "dept", "treasurer", "court"],
  },

  guessMapping(headers) {
    const mapping = {};
    const usedHeaders = new Set();

    Parser.TARGET_FIELDS.forEach(({ key }) => {
      const keywords = Parser.GUESS_KEYWORDS[key] || [];
      let bestHeader = null;
      let bestScore = 0;

      headers.forEach((header) => {
        if (usedHeaders.has(header)) return;
        const h = header.toLowerCase();
        keywords.forEach((kw) => {
          if (h.includes(kw)) {
            const score = kw.length; // longer/more specific match wins
            if (score > bestScore) {
              bestScore = score;
              bestHeader = header;
            }
          }
        });
      });

      if (bestHeader) {
        mapping[key] = bestHeader;
        usedHeaders.add(bestHeader);
      } else {
        mapping[key] = "";
      }
    });

    return mapping;
  },

  // Warn the user if the file itself looks like the wrong kind of list.
  detectListWarnings(filename, headers) {
    const warnings = [];
    const haystack = (filename + " " + headers.join(" ")).toLowerCase();
    if (haystack.includes("unclaimed")) {
      warnings.push(
        "This file mentions “unclaimed” — this tool is built for tax sale surplus/excess/overage funds, not general unclaimed property lists. Double-check before importing."
      );
    }
    return warnings;
  },

  parseAmount(raw) {
    if (raw == null) return null;
    const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || cleaned === "-") return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  },

  parseDate(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    if (!str) return null;

    // Try native parsing first (handles ISO and many US formats)
    let d = new Date(str);
    if (!isNaN(d.getTime())) return Parser.toISODate(d);

    // Try MM/DD/YYYY or M-D-YY manually
    const match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (match) {
      let [, m, day, y] = match;
      if (y.length === 2) y = "20" + y;
      d = new Date(`${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`);
      if (!isNaN(d.getTime())) return Parser.toISODate(d);
    }

    return null;
  },

  toISODate(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  },

  // Decide whether a lead is in-range given settings, and why not if not.
  evaluateAgeAndAmount(saleDateISO, amount, settings) {
    const reasons = [];
    const now = new Date();

    if (saleDateISO) {
      const saleDate = new Date(saleDateISO);
      const ageMonths =
        (now.getFullYear() - saleDate.getFullYear()) * 12 +
        (now.getMonth() - saleDate.getMonth());

      if (ageMonths < settings.minAgeMonths) {
        reasons.push(`Too new (sale was ${ageMonths} month(s) ago; minimum is ${settings.minAgeMonths})`);
      }
      if (ageMonths > settings.maxAgeYears * 12) {
        reasons.push(`Too old (sale was over ${settings.maxAgeYears} year(s) ago)`);
      }
    } else {
      reasons.push("Missing/unreadable sale date");
    }

    if (amount == null) {
      reasons.push("Missing/unreadable overage amount");
    } else if (amount < settings.minAmount) {
      reasons.push(`Too small (amount is under $${settings.minAmount.toLocaleString()})`);
    }

    return { inRange: reasons.length === 0, reasons };
  },
};
