/* ============================================================
   app.js — The app itself: navigation, screens, and all the
   on-screen behavior. Plain vanilla JavaScript, no framework.
   ============================================================ */

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada",
  "New Hampshire","New Jersey","New Mexico","New York","North Carolina",
  "North Dakota","Ohio","Oklahoma","Oregon","Pennsylvania","Rhode Island",
  "South Carolina","South Dakota","Tennessee","Texas","Utah","Vermont",
  "Virginia","Washington","West Virginia","Wisconsin","Wyoming",
  "District of Columbia",
];

const LIST_TYPES = ["Surplus Funds", "Excess Funds", "Overbid", "Excess Proceeds", "Other"];

const STATE_CODES = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO",
  "Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID",
  "Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA",
  "Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS",
  "Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
  "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD",
  "Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA",
  "West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC",
};

const STATUSES = [
  "New", "Researching", "Skip Tracing", "Attempting Contact", "Contact Made",
  "Docs Sent", "Awaiting Signature", "Notary Scheduled", "Signed",
  "Submitted to County", "Follow-Up Needed", "Check Received",
  "Check Sent to Claimant", "Closed - Paid", "Bad Lead",
];

const STATUS_BADGE_CLASS = {
  "New": "badge-gray",
  "Researching": "badge-blue",
  "Skip Tracing": "badge-blue",
  "Attempting Contact": "badge-blue",
  "Contact Made": "badge-blue",
  "Docs Sent": "badge-amber",
  "Awaiting Signature": "badge-amber",
  "Notary Scheduled": "badge-amber",
  "Signed": "badge-amber",
  "Submitted to County": "badge-amber",
  "Follow-Up Needed": "badge-amber",
  "Check Received": "badge-green",
  "Check Sent to Claimant": "badge-green",
  "Closed - Paid": "badge-green",
  "Bad Lead": "badge-red",
};

const ACTIVITY_TYPES = [
  "Contact Attempt", "Letter Sent", "Comm with County",
  "Follow-up w/ County", "Follow-up w/ Claimant", "Note",
];

const FORM_TYPES = [
  "Claim Form", "W-9", "Notarized Affidavit", "Letter Template",
  "Power of Attorney", "Assignment of Rights", "County Instructions", "Other",
];

const BAD_LEAD_REASONS = [
  "Owner Deceased - No Heirs Found",
  "Cannot Locate Owner / Claimant",
  "County Says No Funds Owed",
  "Amount Not Worth Pursuing",
  "Owner Already Claimed Directly",
  "Too Much Competition",
  "Owner Uncooperative / Declined",
  "Other",
];

const DEFAULT_SETTINGS = {
  minAmount: 1000,
  minAgeMonths: 6,
  maxAgeYears: 5,
  commissionPctUnder: 0, // % of overage when amount is under $100k
  commissionPctOver: 0,  // % of overage when amount is $100k or more
};

const COMMISSION_THRESHOLD = 100000;

// Statuses where the money has actually come in.
const RECEIVED_STATUSES = ["Check Received", "Check Sent to Claimant", "Closed - Paid"];

// Commission for one lead: the whole overage earns one rate, picked by
// which side of the $100k line the amount falls on.
function commissionFor(lead) {
  const amt = Number(lead.overageAmount) || 0;
  const pct = amt >= COMMISSION_THRESHOLD
    ? (App.settings.commissionPctOver || 0)
    : (App.settings.commissionPctUnder || 0);
  return amt * (pct / 100);
}

const NAV_ITEMS = [
  { route: "dashboard", label: "Dashboard", icon: "▦" },
  { route: "upload", label: "Upload List", icon: "⬆" },
  { route: "leads", label: "Leads", icon: "☰" },
  { route: "archived", label: "Archived / Out of Range", icon: "\u{1F5C4}" },
  { route: "resources", label: "Resource Library", icon: "\u{1F4C1}" },
  { route: "settings", label: "Settings", icon: "⚙" },
];

// ---------------- App state (in-memory cache) ----------------
const App = {
  leads: [],
  resources: [],
  settings: { ...DEFAULT_SETTINGS },
  leadsFilter: { state: null, county: null, status: "", search: "" },
  resourcesFilter: { state: null, county: null, formType: "" },

  async init() {
    await openDB();
    await Seed.maybeSeed();
    await App.reviveAgedLeads();
    await App.migrateBusinessNames();
    await App.reloadAll();
    App.renderNav();
    window.addEventListener("hashchange", App.route);
    App.route();
  },

  // One-time tidy-up for leads imported before the Business/LLC field
  // existed: if the "owner name" is clearly a business, move it over.
  async migrateBusinessNames() {
    const leads = await DB.getAllLeads();
    for (const lead of leads) {
      if (!lead.businessName && lead.formerOwnerName && Parser.isBusinessEntity(lead.formerOwnerName)) {
        lead.businessName = lead.formerOwnerName;
        lead.formerOwnerName = "";
        if (lead.nextAction === "Begin research") lead.nextAction = "Find LLC owner";
        lead.updatedAt = new Date().toISOString();
        await DB.saveLead(lead);
      }
    }
  },

  async reloadAll() {
    App.leads = await DB.getAllLeads();
    App.resources = await DB.getAllResources();
    const savedSettings = await DB.getSetting("thresholds", null);
    App.settings = savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : { ...DEFAULT_SETTINGS };
  },

  // Leads auto-flagged "too new" at import time should come back on their
  // own once they age past the minimum — "too old" and "too small" never
  // fix themselves, so this only ever revives the "too new" ones.
  async reviveAgedLeads() {
    const savedSettings = await DB.getSetting("thresholds", null);
    const settings = savedSettings ? { ...DEFAULT_SETTINGS, ...savedSettings } : { ...DEFAULT_SETTINGS };
    const leads = await DB.getAllLeads();
    let revivedCount = 0;

    for (const lead of leads) {
      if (!lead.isDisqualified || !lead.disqualifyReasons || lead.disqualifyReasons.length === 0) continue;
      const amount = lead.overageAmount == null || lead.overageAmount === "" ? null : Number(lead.overageAmount);
      const evalResult = Parser.evaluateAgeAndAmount(lead.saleDate || null, amount, settings);
      if (evalResult.inRange) {
        lead.isDisqualified = false;
        lead.disqualifyReasons = [];
        if (!lead.nextAction) lead.nextAction = "Begin research";
        lead.updatedAt = new Date().toISOString();
        await DB.saveLead(lead);
        revivedCount++;
      }
    }
    return revivedCount;
  },

  route() {
    const hash = location.hash.replace(/^#\/?/, "") || "dashboard";
    const [routeName, param] = hash.split("/");
    App.renderNav(routeName);
    const root = document.getElementById("app-root");
    root.innerHTML = "";

    switch (routeName) {
      case "dashboard": Views.dashboard(root); break;
      case "upload": Views.upload(root); break;
      case "leads": Views.leadsList(root); break;
      case "archived": Views.archived(root); break;
      case "lead": Views.leadDetail(root, param); break;
      case "resources": Views.resources(root); break;
      case "settings": Views.settings(root); break;
      default: Views.dashboard(root);
    }
  },

  renderNav(active) {
    const current = active || (location.hash.replace(/^#\/?/, "").split("/")[0] || "dashboard");
    const container = document.getElementById("nav-links");
    container.innerHTML = NAV_ITEMS.map((item) => `
      <div class="nav-link ${item.route === current ? "active" : ""}" data-route="${item.route}">
        <span class="nav-icon">${item.icon}</span> ${item.label}
      </div>
    `).join("") + `
      <div class="nav-link" id="nav-logout-link" style="margin-top:10px;">
        <span class="nav-icon">&#8677;</span> Sign Out
      </div>
    `;
    container.querySelectorAll(".nav-link[data-route]").forEach((el) => {
      el.addEventListener("click", () => { location.hash = "#/" + el.dataset.route; });
    });
    const logoutLink = document.getElementById("nav-logout-link");
    logoutLink.addEventListener("click", () => Auth.logout());
  },

  navigate(route) { location.hash = "#/" + route; },
};

// ---------------- Small helpers ----------------
function esc(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtMoney(n) {
  if (n == null || isNaN(n)) return "—";
  return "$" + Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function todayISO() { return Parser.toISODate(new Date()); }
function daysFromToday(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((d - now) / 86400000);
}
function statusBadge(status) {
  const cls = STATUS_BADGE_CLASS[status] || "badge-gray";
  return `<span class="badge ${cls}">${esc(status)}</span>`;
}
// How to show "who" a lead is: the person if we know them, otherwise
// the business with an LLC tag, otherwise Unknown.
function leadNameHTML(l) {
  if (l.formerOwnerName) return esc(l.formerOwnerName);
  if (l.businessName) return `${esc(l.businessName)} <span class="badge badge-amber">LLC / Business</span>`;
  return "<span class='muted'>Unknown</span>";
}
function leadNameText(l) {
  return l.formerOwnerName || l.businessName || "";
}
function groupLeadsByStateCounty(leads) {
  const tree = {};
  leads.forEach((l) => {
    const st = l.state || "Unspecified";
    const co = l.county || "Unspecified";
    if (!tree[st]) tree[st] = {};
    if (!tree[st][co]) tree[st][co] = [];
    tree[st][co].push(l);
  });
  return tree;
}
async function persistLead(lead) {
  lead.updatedAt = new Date().toISOString();
  await DB.saveLead(lead);
  await App.reloadAll();
}
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ================================================================
// VIEWS
// ================================================================
const Views = {

  // -------------------- DASHBOARD --------------------
  dashboard(root) {
    const active = App.leads.filter((l) => !l.isDisqualified && l.status !== "Bad Lead");
    const disqualified = App.leads.filter((l) => l.isDisqualified);
    const badLeads = App.leads.filter((l) => l.status === "Bad Lead");
    const totalValue = active.reduce((sum, l) => sum + (Number(l.overageAmount) || 0), 0);
    const closedWon = App.leads.filter((l) => l.status === "Closed - Paid");
    const closedValue = closedWon.reduce((sum, l) => sum + (Number(l.overageAmount) || 0), 0);

    // Commission: "received" once the check is in hand (or beyond);
    // everything else still being worked is "potential".
    const receivedLeads = active.filter((l) => RECEIVED_STATUSES.includes(l.status));
    const commissionReceived = receivedLeads.reduce((sum, l) => sum + commissionFor(l), 0);
    const commissionPotential = active
      .filter((l) => !RECEIVED_STATUSES.includes(l.status))
      .reduce((sum, l) => sum + commissionFor(l), 0);
    const commissionConfigured = (App.settings.commissionPctUnder || 0) > 0 || (App.settings.commissionPctOver || 0) > 0;

    const dueItems = [];
    active.forEach((l) => {
      if (l.dueDate) dueItems.push({ lead: l, label: l.nextAction || "Next action", date: l.dueDate, type: "Next Action" });
      if (l.countyFollowUpDate) dueItems.push({ lead: l, label: "Follow up with county", date: l.countyFollowUpDate, type: "County Follow-Up" });
      if (l.claimantFollowUpDate) dueItems.push({ lead: l, label: "Follow up with claimant", date: l.claimantFollowUpDate, type: "Claimant Follow-Up" });
    });
    const dueSoon = dueItems
      .map((item) => ({ ...item, _days: daysFromToday(item.date) }))
      .filter((item) => item._days <= 7)
      .sort((a, b) => a._days - b._days)
      .slice(0, 10);

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Dashboard</h1>
          <p class="subtitle">Overview of everything in your pipeline.</p>
        </div>
        <div class="flex gap-8">
          <button class="btn btn-primary" id="dash-upload-btn">Upload a New List</button>
        </div>
      </div>

      <div id="dash-sample-banner"></div>

      <div class="stat-grid">
        <div class="stat-card"><div class="value">${active.length}</div><div class="label">Active Leads</div></div>
        <div class="stat-card"><div class="value">${fmtMoney(totalValue)}</div><div class="label">Total Overage in Pipeline</div></div>
        <div class="stat-card" style="cursor:pointer;" id="dash-archived-card"><div class="value">${disqualified.length}</div><div class="label">Archived (Out-of-Range)</div></div>
        <div class="stat-card"><div class="value">${badLeads.length}</div><div class="label">Bad Leads</div></div>
        <div class="stat-card"><div class="value">${closedWon.length}</div><div class="label">Closed &amp; Paid</div></div>
        <div class="stat-card"><div class="value">${fmtMoney(closedValue)}</div><div class="label">Total Paid Out Value</div></div>
        <div class="stat-card"><div class="value" style="color:var(--accent-dark);">${fmtMoney(commissionReceived)}</div><div class="label">Commission Received</div></div>
        <div class="stat-card"><div class="value">${fmtMoney(commissionPotential)}</div><div class="label">Potential Commission (Pipeline)</div></div>
      </div>

      ${!commissionConfigured ? `
        <div class="banner banner-info">
          Commission tracking is on, but your rates aren't set yet — enter your percentages in
          <a href="#/settings">Settings → Commission Rules</a> and these numbers will fill in automatically.
        </div>` : ""}

      <div class="two-col">
        <div class="card">
          <h2>Due This Week / Overdue</h2>
          ${dueSoon.length === 0 ? `<div class="empty-state">Nothing due soon.</div>` : `
          <table>
            <thead><tr><th>Lead</th><th>Type</th><th>What</th><th>Due</th><th>Who</th></tr></thead>
            <tbody>
              ${dueSoon.map((item) => `
                <tr class="clickable" data-id="${item.lead.id}">
                  <td>${esc(leadNameText(item.lead) || item.lead.propertyAddress || "Unnamed lead")}<br/><span class="muted">${esc(item.lead.county)}, ${esc(item.lead.state)}</span></td>
                  <td><span class="badge badge-gray">${esc(item.type)}</span></td>
                  <td>${esc(item.label)}</td>
                  <td>${item._days < 0 ? `<span class="badge badge-red">Overdue ${Math.abs(item._days)}d</span>` : item._days === 0 ? `<span class="badge badge-amber">Today</span>` : `${fmtDate(item.date)}`}</td>
                  <td>${esc(item.lead.responsible) || "—"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>`}
        </div>

        <div class="card">
          <h2>Leads by State</h2>
          ${Views._stateBreakdownTable(active)}
        </div>
      </div>
    `;

    document.getElementById("dash-upload-btn").addEventListener("click", () => App.navigate("upload"));
    document.getElementById("dash-archived-card").addEventListener("click", () => App.navigate("archived"));
    root.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => App.navigate("lead/" + tr.dataset.id));
    });

    DB.getSetting("sampleDataLoaded", false).then((isSample) => {
      if (isSample) {
        document.getElementById("dash-sample-banner").innerHTML = `
          <div class="banner banner-info" id="sample-banner">
            This dashboard is showing <strong>sample data</strong> so you can see how everything works.
            Go to <a href="#/settings">Settings</a> to clear it once you're ready to upload real lists.
            <span class="close-x" id="sample-banner-close">&times;</span>
          </div>`;
        document.getElementById("sample-banner-close").addEventListener("click", () => {
          document.getElementById("sample-banner").remove();
        });
      }
    });
  },

  _stateBreakdownTable(active) {
    const byState = {};
    active.forEach((l) => {
      const st = l.state || "Unspecified";
      if (!byState[st]) byState[st] = { count: 0, value: 0 };
      byState[st].count++;
      byState[st].value += Number(l.overageAmount) || 0;
    });
    const rows = Object.entries(byState).sort((a, b) => b[1].value - a[1].value);
    if (rows.length === 0) return `<div class="empty-state">No active leads yet.</div>`;
    return `
      <table>
        <thead><tr><th>State</th><th>Leads</th><th>Value</th></tr></thead>
        <tbody>
          ${rows.map(([st, d]) => `<tr><td>${esc(st)}</td><td>${d.count}</td><td>${fmtMoney(d.value)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  },

  // -------------------- UPLOAD --------------------
  upload(root) {
    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Upload a Fund List</h1>
          <p class="subtitle">Bring in a county or court surplus/excess funds list — Excel, CSV, PDF, or any other file.</p>
        </div>
      </div>

      <div class="banner banner-info">
        This tool is for <strong>surplus funds, excess funds, overbid, or excess proceeds</strong> lists from a
        tax sale (often published by the County Treasurer). It is <strong>not</strong> for general
        "unclaimed property" lists — please don't upload those here.
      </div>

      <div class="card">
        <h3>Step 1 &middot; Where is this list from?</h3>
        <div class="form-grid">
          <div class="form-row">
            <label>State</label>
            <select id="up-state">
              <option value="">Select a state…</option>
              ${US_STATES.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label>County</label>
            <input type="text" id="up-county" placeholder="e.g. Fulton" />
          </div>
          <div class="form-row">
            <label>List Type</label>
            <select id="up-listtype">
              ${LIST_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
            </select>
          </div>
        </div>

        <h3 class="mt-16">Step 2 &middot; Upload the file</h3>
        <div class="field-hint mt-0" style="margin-bottom:10px;">
          Any file type is accepted — Excel, CSV, PDF, and other spreadsheet or text formats are read automatically.
          (Scanned PDFs that are just a photo of a page can't be read — ask the county for a spreadsheet version of those.)
        </div>
        <div class="dropzone" id="dropzone">
          <div class="dz-icon">&#8593;</div>
          <div><strong>Drag &amp; drop your file here</strong>, or click to choose a file.</div>
          <input type="file" id="file-input" />
        </div>
        <div id="upload-file-name" class="field-hint"></div>
      </div>

      <div id="mapping-section"></div>
    `;

    const stateSel = document.getElementById("up-state");
    const countyInput = document.getElementById("up-county");
    const dropzone = document.getElementById("dropzone");
    const fileInput = document.getElementById("file-input");

    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("dragover"); });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files.length) handleFile(fileInput.files[0]);
    });

    function handleFile(file) {
      if (!stateSel.value || !countyInput.value.trim()) {
        alert("Please select a State and enter a County first, so we know where this list belongs.");
        fileInput.value = "";
        return;
      }
      document.getElementById("upload-file-name").textContent = "Reading: " + file.name + "…";

      Views._extractRows(file)
        .then((rows) => {
          if (!rows || rows.length < 2) {
            document.getElementById("upload-file-name").textContent = "Selected: " + file.name;
            alert("We could read this file, but couldn't find a table of data inside it (it needs a header row plus at least one lead). Please check the file and try again.");
            return;
          }
          document.getElementById("upload-file-name").textContent = "Selected: " + file.name;
          Views._renderMapping(file.name, rows, {
            state: stateSel.value,
            county: countyInput.value.trim(),
            listType: document.getElementById("up-listtype").value,
          });
        })
        .catch((err) => {
          console.error("File read failed:", err);
          document.getElementById("upload-file-name").textContent = "Selected: " + file.name;
          alert(
            "Sorry — we couldn't read that file as a list of leads.\n\n" +
            "Files that work best: Excel (.xlsx/.xls), CSV, PDF, or other spreadsheet/text formats.\n\n" +
            "If this is a scanned/photographed PDF (a picture of a page rather than real text), it can't be read automatically — try asking the county for a spreadsheet version."
          );
        });
    }
  },

  // Turn ANY uploaded file into rows of cells, best-effort:
  //   - PDFs: read the text and rebuild the table from word positions
  //   - Spreadsheets (Excel, ODS, etc.): read via the SheetJS library
  //   - Text (CSV/TSV/semicolons): detect the separator and parse
  //   - Anything else: try spreadsheet first, then plain text
  async _extractRows(file) {
    const ext = (file.name.split(".").pop() || "").toLowerCase();

    if (ext === "pdf") return Views._checkReadable(await Views._rowsFromPDF(file));

    const textExts = ["csv", "tsv", "txt"];
    if (textExts.includes(ext)) {
      const text = await file.text();
      return Views._checkReadable(Parser.parseCSV(text, Parser.detectDelimiter(text)));
    }

    // Everything else: let SheetJS try (it reads xlsx, xls, ods, and
    // many older spreadsheet formats). If that fails, try plain text.
    try {
      const buf = await file.arrayBuffer();
      const workbook = XLSX.read(buf, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: "" })
        .map((r) => r.map((cell) => (cell == null ? "" : String(cell))));
      if (rows.length >= 2) return Views._checkReadable(rows);
      throw new Error("No table found via spreadsheet reader");
    } catch (e) {
      const text = await file.text();
      return Views._checkReadable(Parser.parseCSV(text, Parser.detectDelimiter(text)));
    }
  },

  // Sanity check: if the "table" we extracted is mostly unreadable
  // characters, the file was binary junk in disguise — reject it so the
  // user gets a clear error instead of importing garbage leads.
  _checkReadable(rows) {
    const sample = rows.slice(0, 20).flat().join("").slice(0, 3000);
    if (!sample) throw new Error("Empty table");
    const junk = (sample.match(/[\u0000-\u0008\u000E-\u001F\uFFFD]/g) || []).length;
    if (junk / sample.length > 0.05) throw new Error("File content is not readable text");
    return rows;
  },

  // Rebuild table rows from a PDF's text. Words that sit on the same
  // line become one row; a wide horizontal gap between words starts a
  // new column. Best-effort — the preview step lets the user verify.
  async _rowsFromPDF(file) {
    if (!window.pdfjsLib) throw new Error("PDF library not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const allRows = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();

      // Group text pieces into lines by their vertical position.
      const lines = [];
      content.items.forEach((item) => {
        if (!item.str || !item.str.trim()) return;
        const x = item.transform[4];
        const y = item.transform[5];
        let line = lines.find((l) => Math.abs(l.y - y) <= 3);
        if (!line) { line = { y, items: [] }; lines.push(line); }
        line.items.push({ x, width: item.width || 0, str: item.str });
      });

      // Within each line, merge words separated by small gaps into cells.
      lines.sort((a, b) => b.y - a.y);
      const pageLines = [];
      lines.forEach((line) => {
        line.items.sort((a, b) => a.x - b.x);
        const cells = [];
        let current = null;
        line.items.forEach((it) => {
          if (current !== null && it.x - (current.x + current.width) < 10) {
            const joiner = current.str.endsWith(" ") || it.str.startsWith(" ") ? "" : " ";
            current.str += joiner + it.str;
            current.width = it.x + it.width - current.x;
          } else {
            if (current !== null) cells.push(current);
            current = { x: it.x, width: it.width, str: it.str };
          }
        });
        if (current !== null) cells.push(current);
        if (cells.length > 0) pageLines.push(cells);
      });

      // Work out where the table's columns actually sit on the page by
      // clustering the left edges of all cells. A cell then lands in the
      // column whose position it matches — so a row with an empty cell
      // no longer shifts everything after it into the wrong column.
      const starts = [];
      pageLines.forEach((cells) => cells.forEach((c) => starts.push(c.x)));
      starts.sort((a, b) => a - b);
      const clusters = [];
      starts.forEach((x) => {
        const cluster = clusters.find((cl) => Math.abs(cl.center - x) <= 12);
        if (cluster) {
          cluster.count++;
          cluster.center += (x - cluster.center) / cluster.count;
        } else {
          clusters.push({ center: x, count: 1 });
        }
      });
      const minCount = Math.max(3, Math.floor(pageLines.length * 0.15));
      let columns = clusters.filter((cl) => cl.count >= minCount).map((cl) => cl.center).sort((a, b) => a - b);
      if (columns.length < 2) columns = clusters.map((cl) => cl.center).sort((a, b) => a - b);

      pageLines.forEach((cells) => {
        const row = new Array(columns.length).fill("");
        cells.forEach((c) => {
          let best = 0;
          let bestDist = Infinity;
          columns.forEach((center, i) => {
            const dist = Math.abs(center - c.x);
            if (dist < bestDist) { bestDist = dist; best = i; }
          });
          row[best] = row[best] ? row[best] + " " + c.str.trim() : c.str.trim();
        });
        if (row.some((cell) => cell !== "")) allRows.push(row);
      });
    }

    // Keep only rows that look like table rows (2+ filled columns), and
    // pad them all to the same width so the mapping screen lines up.
    const tableRows = allRows.filter((r) => r.filter((c) => c !== "").length >= 2);
    if (tableRows.length < 2) throw new Error("No table structure found in PDF");
    const width = Math.max(...tableRows.map((r) => r.length));
    let grid = tableRows.map((r) => {
      while (r.length < width) r.push("");
      return r;
    });

    // Merge adjacent columns that are (almost) never filled on the same
    // row — usually a header sitting slightly offset from its data.
    let didMerge = true;
    while (didMerge) {
      didMerge = false;
      const w = grid[0].length;
      for (let i = 0; i < w - 1; i++) {
        const bothFilled = grid.filter((r) => r[i] !== "" && r[i + 1] !== "").length;
        const leftFilled = grid.filter((r) => r[i] !== "").length;
        const rightFilled = grid.filter((r) => r[i + 1] !== "").length;
        if (leftFilled > 0 && rightFilled > 0 && bothFilled <= Math.max(1, Math.floor(grid.length * 0.02))) {
          grid = grid.map((r) => {
            const mergedCell = r[i] && r[i + 1] ? r[i] + " " + r[i + 1] : (r[i] || r[i + 1]);
            const copy = r.slice();
            copy.splice(i, 2, mergedCell);
            return copy;
          });
          didMerge = true;
          break;
        }
      }
    }

    // Drop columns that ended up empty in every row.
    const keep = [];
    for (let i = 0; i < grid[0].length; i++) {
      if (grid.some((r) => r[i] !== "")) keep.push(i);
    }
    return grid.map((r) => keep.map((i) => r[i]));
  },

  _renderMapping(filename, rows, ctx) {
    const headers = rows[0].map((h) => String(h).trim());
    const dataRows = rows.slice(1);
    const guessed = Parser.guessMapping(headers);
    const warnings = Parser.detectListWarnings(filename, headers);

    const section = document.getElementById("mapping-section");
    section.innerHTML = `
      <div class="card mt-16">
        <h3>Step 3 &middot; Match up the columns</h3>
        <p class="field-hint mt-0">We took our best guess at what each column is. Fix any that look wrong.</p>

        ${warnings.map((w) => `<div class="banner banner-warn">${esc(w)}</div>`).join("")}

        <table class="mapping-table">
          <thead><tr><th>We need</th><th>Use this column from your file</th></tr></thead>
          <tbody>
            ${Parser.TARGET_FIELDS.map((f) => {
              // Some counties split the owner's name across several
              // columns (First / Middle / Last) — offer extra dropdowns
              // for the name so the pieces get joined back together.
              let extraSelects = "";
              if (f.key === "formerOwnerName") {
                const guessMiddle = headers.find((h) => /middle/i.test(h)) || "";
                const guessLast = headers.find((h) => /last\s*name/i.test(h)) || "";
                const nameAppendSelect = (n, guess) => `
                  <select data-append="${n}" class="map-append" style="margin-top:6px;">
                    <option value="">— No extra name column —</option>
                    ${headers.map((h) => `<option value="${esc(h)}" ${guess === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
                  </select>`;
                const showExtras = /first/i.test(guessed[f.key] || "") || guessMiddle || guessLast;
                extraSelects = showExtras
                  ? nameAppendSelect(1, guessMiddle) + nameAppendSelect(2, guessLast) +
                    `<div class="field-hint">If the name is split across columns (First / Middle / Last), pick the extra pieces here and they'll be joined together.</div>`
                  : "";
              }
              return `
              <tr>
                <td>${esc(f.label)}${f.required ? " <span style='color:#c0392b'>*</span>" : ""}</td>
                <td>
                  <select data-field="${f.key}" class="map-select">
                    <option value="">— Not in this file —</option>
                    ${headers.map((h) => `<option value="${esc(h)}" ${guessed[f.key] === h ? "selected" : ""}>${esc(h)}</option>`).join("")}
                  </select>
                  ${extraSelects}
                </td>
              </tr>
            `;}).join("")}
          </tbody>
        </table>

        <h3 class="mt-16">Preview (first 5 rows)</h3>
        <div style="overflow-x:auto;">
        <table>
          <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>
            ${dataRows.slice(0, 5).map((r) => `<tr>${headers.map((_, i) => `<td>${esc(r[i])}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
        </div>

        <div class="flex gap-8 mt-16">
          <button class="btn btn-primary" id="do-import">Import ${dataRows.length} Row(s)</button>
          <span class="muted" style="align-self:center;">Importing into: <strong>${esc(ctx.county)}, ${esc(ctx.state)}</strong> — ${esc(ctx.listType)}</span>
        </div>
        <div id="import-result" class="mt-16"></div>
      </div>
    `;

    document.getElementById("do-import").addEventListener("click", async () => {
      const mapping = {};
      section.querySelectorAll(".map-select").forEach((sel) => {
        mapping[sel.dataset.field] = sel.value;
      });
      const nameAppends = [];
      section.querySelectorAll(".map-append").forEach((sel) => {
        if (sel.value && sel.value !== mapping.formerOwnerName) nameAppends.push(sel.value);
      });

      const missingRequired = Parser.TARGET_FIELDS.filter((f) => f.required && !mapping[f.key]);
      if (missingRequired.length) {
        alert("Please map these required fields before importing: " + missingRequired.map((f) => f.label).join(", "));
        return;
      }

      const headerIndex = {};
      headers.forEach((h, i) => (headerIndex[h] = i));

      // Safety net: dry-run the whole file first. If most rows have no
      // readable sale date AND no readable amount, something is wrong
      // with the file or the column mapping — stop and say so instead
      // of importing garbage that all lands in the archive.
      let unreadableCount = 0;
      for (const r of dataRows) {
        const get = (key) => (mapping[key] ? r[headerIndex[mapping[key]]] : "");
        const d = Parser.parseDate(get("saleDate"));
        const a = Parser.parseAmount(get("overageAmount"));
        if (d === null && a === null) unreadableCount++;
      }
      if (dataRows.length >= 3 && unreadableCount / dataRows.length > 0.6) {
        alert(
          "Import stopped — nothing was imported.\n\n" +
          `We couldn't read a sale date or dollar amount on ${unreadableCount} of ${dataRows.length} rows. ` +
          "That usually means the wrong columns are selected in Step 3, or the file didn't read correctly.\n\n" +
          "Check the column dropdowns and the preview table, then try Import again."
        );
        return;
      }

      let imported = 0, disqualifiedCount = 0;
      const reasonCounts = {};

      for (const r of dataRows) {
        const get = (key) => (mapping[key] ? r[headerIndex[mapping[key]]] : "");
        const saleDateISO = Parser.parseDate(get("saleDate"));
        const amount = Parser.parseAmount(get("overageAmount"));
        const sourceOffice = get("sourceOffice") || ctx.sourceOffice || "";

        const evalResult = Parser.evaluateAgeAndAmount(saleDateISO, amount, App.settings);
        const reasons = [...evalResult.reasons];

        if (sourceOffice && !/treasurer/i.test(sourceOffice)) {
          reasons.push(`Source doesn't mention "Treasurer" — double-check this is a tax sale list (source: "${sourceOffice}")`);
        }

        // Businesses (LLC, Inc, Trust, …) go in their own field — the
        // Former Owner Name field is reserved for actual people.
        const rawName = [get("formerOwnerName"), ...nameAppends.map((h) => r[headerIndex[h]] || "")]
          .map((s) => String(s).trim()).filter(Boolean)
          // skip parts already present (e.g. a Last Name column that
          // repeats a surname the main column already contains)
          .reduce((acc, part) => {
            const seen = acc.join(" ").toUpperCase().split(/\s+/);
            if (!part.split(/\s+/).every((w) => seen.includes(w.toUpperCase()))) acc.push(part);
            return acc;
          }, [])
          .join(" ");
        const isBusiness = Parser.isBusinessEntity(rawName);

        const lead = {
          id: uid("lead"),
          state: ctx.state,
          county: ctx.county,
          listType: ctx.listType,
          sourceOffice,
          propertyAddress: get("propertyAddress"),
          parcelNumber: get("parcelNumber"),
          saleDate: saleDateISO || "",
          overageAmount: amount == null ? 0 : amount,
          formerOwnerName: isBusiness ? "" : rawName,
          businessName: isBusiness ? rawName : "",
          status: "New",
          nextAction: evalResult.inRange ? (isBusiness ? "Find LLC owner" : "Begin research") : "",
          responsible: "",
          dueDate: "",
          countyFollowUpDate: "",
          claimantFollowUpDate: "",
          researchNotes: "",
          skipTraceNotes: "",
          badLeadReason: "",
          badLeadNotes: "",
          isDisqualified: !evalResult.inRange,
          disqualifyReasons: evalResult.inRange ? [] : evalResult.reasons,
          milestones: {
            notaryHired: { done: false, date: "" },
            signingCompleted: { done: false, date: "" },
            docsReceived: { done: false, date: "" },
            submissionSent: { done: false, date: "" },
            decisionMade: { done: false, date: "", notes: "" },
            checkReceived: { done: false, date: "", amount: "" },
            checkSent: { done: false, date: "" },
          },
          activityLog: [],
          expenses: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await DB.saveLead(lead);
        imported++;
        if (lead.isDisqualified) {
          disqualifiedCount++;
          lead.disqualifyReasons.forEach((reason) => {
            const key = reason.split(" (")[0];
            reasonCounts[key] = (reasonCounts[key] || 0) + 1;
          });
        }
      }

      await DB.setSetting("sampleDataLoaded", false);
      await App.reloadAll();

      document.getElementById("import-result").innerHTML = `
        <div class="banner banner-success">
          Imported ${imported} row(s). ${imported - disqualifiedCount} are active leads,
          ${disqualifiedCount} were flagged out-of-range and moved to the Disqualified list.
        </div>
        ${Object.keys(reasonCounts).length ? `
          <div class="card">
            <h3>Why leads were flagged</h3>
            <ul>${Object.entries(reasonCounts).map(([r, c]) => `<li>${esc(r)}: ${c}</li>`).join("")}</ul>
          </div>` : ""}
        <button class="btn btn-primary mt-16" id="go-to-leads">View These Leads</button>
      `;
      document.getElementById("go-to-leads").addEventListener("click", () => {
        App.leadsFilter = { state: ctx.state, county: ctx.county, status: "", search: "" };
        App.navigate("leads");
      });
    });
  },

  // -------------------- LEADS LIST --------------------
  leadsList(root) {
    const activeLeads = App.leads.filter((l) => !l.isDisqualified);
    const tree = groupLeadsByStateCounty(activeLeads);
    const f = App.leadsFilter;

    let filtered = activeLeads.filter((l) => {
      if (f.state && (l.state || "Unspecified") !== f.state) return false;
      if (f.county && (l.county || "Unspecified") !== f.county) return false;
      if (f.status && l.status !== f.status) return false;
      if (f.search) {
        const s = f.search.toLowerCase();
        const hay = `${l.propertyAddress} ${l.parcelNumber} ${l.formerOwnerName} ${l.businessName || ""} ${l.county} ${l.state}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Leads</h1>
          <p class="subtitle">Browse by state and county, or search across everything. Out-of-range leads live in <a href="#/archived">Archived</a>.</p>
        </div>
        <button class="btn btn-primary" id="new-lead-btn">+ Add Lead Manually</button>
      </div>

      <div class="layout-2col">
        <div class="card" id="tree-panel">
          <h3>By Location</h3>
          <div class="tree" id="tree-container"></div>
        </div>

        <div>
          <div class="card">
            <div class="searchbar">
              <input type="text" id="search-input" placeholder="Search address, owner, parcel #…" value="${esc(f.search)}" />
              <select id="status-filter">
                <option value="">All statuses</option>
                ${STATUSES.map((s) => `<option value="${esc(s)}" ${f.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
              </select>
              ${(f.state || f.county) ? `<button class="btn btn-sm" id="clear-location">Clear location filter</button>` : ""}
            </div>
            <div class="flex-between mt-0" style="margin-bottom:8px;">
              <span class="muted">${filtered.length} lead(s)${f.state ? ` in ${esc(f.county ? f.county + ", " : "")}${esc(f.state)}` : ""}</span>
            </div>
            ${Views._leadsTable(filtered)}
          </div>
        </div>
      </div>
    `;

    Views._renderTree(tree, "tree-container");

    document.getElementById("new-lead-btn").addEventListener("click", () => Views._createBlankLead());
    document.getElementById("search-input").addEventListener("input", (e) => {
      App.leadsFilter.search = e.target.value;
      Views.leadsList(root);
    });
    document.getElementById("status-filter").addEventListener("change", (e) => {
      App.leadsFilter.status = e.target.value;
      Views.leadsList(root);
    });
    const clearBtn = document.getElementById("clear-location");
    if (clearBtn) clearBtn.addEventListener("click", () => {
      App.leadsFilter.state = null; App.leadsFilter.county = null;
      Views.leadsList(root);
    });
    root.querySelectorAll("tr.clickable").forEach((tr) => {
      tr.addEventListener("click", () => App.navigate("lead/" + tr.dataset.id));
    });
  },

  _renderTree(tree, containerId) {
    const container = document.getElementById(containerId);
    const states = Object.keys(tree).sort();
    if (states.length === 0) {
      container.innerHTML = `<div class="empty-state">No leads yet.</div>`;
      return;
    }
    container.innerHTML = states.map((st) => {
      const counties = tree[st];
      const total = Object.values(counties).reduce((sum, arr) => sum + arr.length, 0);
      return `
        <div class="tree-state">
          <div class="tree-state-header" data-state="${esc(st)}">
            <span>${esc(st)}</span><span class="tree-count">${total}</span>
          </div>
          <div class="tree-counties" data-for="${esc(st)}" style="display:${App.leadsFilter.state === st ? "block" : "none"}">
            ${Object.keys(counties).sort().map((co) => `
              <div class="tree-county ${App.leadsFilter.state === st && App.leadsFilter.county === co ? "active" : ""}" data-state="${esc(st)}" data-county="${esc(co)}">
                <span>${esc(co)}</span><span class="tree-count">${counties[co].length}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".tree-state-header").forEach((el) => {
      el.addEventListener("click", () => {
        const sub = container.querySelector(`.tree-counties[data-for="${CSS.escape(el.dataset.state)}"]`);
        const isOpen = sub.style.display !== "none";
        sub.style.display = isOpen ? "none" : "block";
        if (isOpen && App.leadsFilter.state === el.dataset.state) {
          App.leadsFilter.state = null; App.leadsFilter.county = null;
          Views.leadsList(document.getElementById("app-root"));
        } else if (!isOpen) {
          App.leadsFilter.state = el.dataset.state; App.leadsFilter.county = null;
          Views.leadsList(document.getElementById("app-root"));
        }
      });
    });
    container.querySelectorAll(".tree-county").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        App.leadsFilter.state = el.dataset.state;
        App.leadsFilter.county = el.dataset.county;
        Views.leadsList(document.getElementById("app-root"));
      });
    });
  },

  _leadsTable(leads) {
    if (leads.length === 0) return `<div class="empty-state">No leads match these filters.</div>`;
    leads = leads.slice().sort((a, b) => (b.overageAmount || 0) - (a.overageAmount || 0));
    return `
      <table>
        <thead>
          <tr><th>Owner</th><th>Location</th><th>Sale Date</th><th>Amount</th><th>Your Commission</th><th>Status</th><th>Next Action</th></tr>
        </thead>
        <tbody>
          ${leads.map((l) => `
            <tr class="clickable" data-id="${l.id}">
              <td>${leadNameHTML(l)}${l.isDisqualified ? ` <span class="badge badge-red">Out of range</span>` : ""}</td>
              <td>${esc(l.county)}, ${esc(l.state)}</td>
              <td>${fmtDate(l.saleDate)}</td>
              <td>${fmtMoney(l.overageAmount)}</td>
              <td>${commissionFor(l) > 0 ? `<strong>${fmtMoney(commissionFor(l))}</strong>` : "<span class='muted'>—</span>"}</td>
              <td>${statusBadge(l.status)}${l.status === "Bad Lead" && l.badLeadReason ? `<div class="field-hint">${esc(l.badLeadReason)}</div>` : ""}</td>
              <td>${esc(l.nextAction) || "—"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  },

  async _createBlankLead() {
    const state = prompt("State for this lead?");
    if (!state) return;
    const county = prompt("County for this lead?");
    if (!county) return;
    const lead = {
      id: uid("lead"), state, county, listType: "Surplus Funds", sourceOffice: "",
      propertyAddress: "", parcelNumber: "", saleDate: "", overageAmount: 0, formerOwnerName: "", businessName: "",
      status: "New", nextAction: "", responsible: "", dueDate: "", countyFollowUpDate: "", claimantFollowUpDate: "",
      researchNotes: "", skipTraceNotes: "", badLeadReason: "", badLeadNotes: "",
      isDisqualified: false, disqualifyReasons: [],
      milestones: {
        notaryHired: { done: false, date: "" }, signingCompleted: { done: false, date: "" },
        docsReceived: { done: false, date: "" }, submissionSent: { done: false, date: "" },
        decisionMade: { done: false, date: "", notes: "" }, checkReceived: { done: false, date: "", amount: "" },
        checkSent: { done: false, date: "" },
      },
      activityLog: [], expenses: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await DB.saveLead(lead);
    await App.reloadAll();
    App.navigate("lead/" + lead.id);
  },

  // -------------------- ARCHIVED / OUT OF RANGE --------------------
  archived(root) {
    const archivedLeads = App.leads
      .filter((l) => l.isDisqualified)
      .slice()
      .sort((a, b) => (b.overageAmount || 0) - (a.overageAmount || 0));

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Archived / Out of Range</h1>
          <p class="subtitle">Leads that didn't meet your rules (too new, too old, or too small) live here, separate from your active pipeline.</p>
        </div>
        ${archivedLeads.length > 0 ? `<button class="btn btn-danger" id="delete-all-archived">Delete All ${archivedLeads.length} Archived</button>` : ""}
      </div>

      <div class="banner banner-info">
        Leads flagged "too new" move back to your active Leads list automatically once they age past your minimum
        (currently ${App.settings.minAgeMonths} months) — no need to check manually.
        "Too old" and "too small" leads stay archived, since those don't change over time.
      </div>

      <div class="card">
        ${archivedLeads.length === 0 ? `<div class="empty-state">Nothing archived right now.</div>` : `
        <table>
          <thead>
            <tr><th>Owner</th><th>Location</th><th>Sale Date</th><th>Amount</th><th>Why Archived</th><th></th></tr>
          </thead>
          <tbody>
            ${archivedLeads.map((l) => `
              <tr>
                <td class="clickable" data-id="${l.id}">${leadNameHTML(l)}</td>
                <td>${esc(l.county)}, ${esc(l.state)}</td>
                <td>${fmtDate(l.saleDate)}</td>
                <td>${fmtMoney(l.overageAmount)}</td>
                <td>${l.disqualifyReasons.map((r) => `<div class="field-hint" style="margin:0;">${esc(r)}</div>`).join("") || "<span class='muted'>Manually archived</span>"}</td>
                <td><button class="btn btn-sm restore-lead" data-id="${l.id}">Restore to Active</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>`}
      </div>
    `;

    const deleteAllBtn = document.getElementById("delete-all-archived");
    if (deleteAllBtn) deleteAllBtn.addEventListener("click", async () => {
      if (!confirm(`Permanently delete all ${archivedLeads.length} archived leads? This can't be undone.`)) return;
      for (const l of archivedLeads) await DB.deleteLead(l.id);
      await App.reloadAll();
      Views.archived(root);
    });

    root.querySelectorAll("td.clickable").forEach((td) => {
      td.addEventListener("click", () => App.navigate("lead/" + td.dataset.id));
    });
    root.querySelectorAll(".restore-lead").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const lead = App.leads.find((l) => l.id === btn.dataset.id);
        if (!lead) return;
        lead.isDisqualified = false;
        lead.disqualifyReasons = [];
        if (!lead.nextAction) lead.nextAction = "Begin research";
        await persistLead(lead);
        Views.archived(root);
      });
    });
  },

  // -------------------- LEAD DETAIL --------------------
  leadDetail(root, id) {
    const lead = App.leads.find((l) => l.id === id);
    if (!lead) {
      root.innerHTML = `<div class="empty-state">Lead not found. <a href="#/leads">Back to leads</a></div>`;
      return;
    }

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>${esc(leadNameText(lead)) || "Unnamed Lead"}</h1>
          <p class="subtitle">${esc(lead.county)}, ${esc(lead.state)} &middot; ${statusBadge(lead.status)} ${lead.isDisqualified ? `<span class="badge badge-red">Out of range</span>` : ""}</p>
        </div>
        <div class="flex gap-8">
          <a href="${lead.isDisqualified ? "#/archived" : "#/leads"}" class="btn">&larr; Back to ${lead.isDisqualified ? "Archived" : "Leads"}</a>
          <button class="btn btn-danger" id="delete-lead-btn">Delete Lead</button>
        </div>
      </div>

      ${lead.isDisqualified ? `
        <div class="banner banner-warn">
          This lead is archived (out-of-range): ${esc(lead.disqualifyReasons.join("; ") || "manually archived")}.
          You can still edit and work it — uncheck the box below to restore it to your active Leads list.
        </div>` : ""}

      <div class="two-col">
        <div class="section">
          <div class="card">
            <h2>Property / Overage Info</h2>
            <div class="form-grid">
              <div class="form-row"><label>Property Address</label><input type="text" id="f-propertyAddress" value="${esc(lead.propertyAddress)}"/></div>
              <div class="form-row"><label>Parcel #</label><input type="text" id="f-parcelNumber" value="${esc(lead.parcelNumber)}"/></div>
              <div class="form-row"><label>Sale Date</label><input type="date" id="f-saleDate" value="${esc(lead.saleDate)}"/></div>
              <div class="form-row"><label>Overage Amount</label><input type="number" id="f-overageAmount" value="${lead.overageAmount || 0}"/></div>
              <div class="form-row"><label>Former Owner Name (person)</label><input type="text" id="f-formerOwnerName" value="${esc(lead.formerOwnerName)}"/>
                ${lead.businessName && !lead.formerOwnerName ? `<div class="field-hint">Once you find who's behind the LLC, put their name here.</div>` : ""}
              </div>
              <div class="form-row"><label>Business / LLC Name</label><input type="text" id="f-businessName" value="${esc(lead.businessName || "")}"/></div>
              <div class="form-row"><label>Source / Office</label><input type="text" id="f-sourceOffice" value="${esc(lead.sourceOffice)}"/></div>
              <div class="form-row"><label>State</label><input type="text" id="f-state" value="${esc(lead.state)}"/></div>
              <div class="form-row"><label>County</label><input type="text" id="f-county" value="${esc(lead.county)}"/></div>
              <div class="form-row"><label>List Type</label>
                <select id="f-listType">${LIST_TYPES.map((t) => `<option ${lead.listType === t ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
              </div>
            </div>
            ${commissionFor(lead) > 0 ? `
              <div class="banner banner-success" style="margin:10px 0 0 0;">
                Your commission on this lead: <strong>${fmtMoney(commissionFor(lead))}</strong>
                (${(Number(lead.overageAmount) || 0) >= COMMISSION_THRESHOLD ? App.settings.commissionPctOver : App.settings.commissionPctUnder}% of ${fmtMoney(lead.overageAmount)})
              </div>` : ""}
            <label style="display:flex;align-items:center;gap:6px;font-weight:400;color:var(--text);margin-top:10px;">
              <input type="checkbox" id="f-isDisqualified" style="width:auto;" ${lead.isDisqualified ? "checked" : ""}/>
              Mark as disqualified / out of range
            </label>
          </div>

          ${lead.businessName ? Views._llcResearchCardHTML(lead) : ""}

          <div class="card mt-16">
            <h2>Status &amp; Next Steps</h2>
            <div class="form-grid">
              <div class="form-row"><label>Lead Status</label>
                <select id="f-status">${STATUSES.map((s) => `<option ${lead.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
              </div>
              <div class="form-row"><label>What Needs To Be Done Next</label><input type="text" id="f-nextAction" value="${esc(lead.nextAction)}"/></div>
              <div class="form-row"><label>Who's Responsible</label><input type="text" id="f-responsible" value="${esc(lead.responsible)}"/></div>
              <div class="form-row"><label>Due Date</label><input type="date" id="f-dueDate" value="${esc(lead.dueDate)}"/></div>
              <div class="form-row"><label>Next County Follow-Up Due</label><input type="date" id="f-countyFollowUpDate" value="${esc(lead.countyFollowUpDate || "")}"/></div>
              <div class="form-row"><label>Next Claimant Follow-Up Due</label><input type="date" id="f-claimantFollowUpDate" value="${esc(lead.claimantFollowUpDate || "")}"/></div>
            </div>
            ${lead.status === "Bad Lead" ? `
              <div class="form-grid mt-8">
                <div class="form-row">
                  <label>Why Is This a Bad Lead?</label>
                  <select id="f-badLeadReason">
                    <option value="">— Select a reason —</option>
                    ${BAD_LEAD_REASONS.map((r) => `<option value="${esc(r)}" ${lead.badLeadReason === r ? "selected" : ""}>${esc(r)}</option>`).join("")}
                  </select>
                </div>
                <div class="form-row">
                  <label>Additional Detail</label>
                  <input type="text" id="f-badLeadNotes" value="${esc(lead.badLeadNotes || "")}" placeholder="Optional detail"/>
                </div>
              </div>
            ` : ""}
          </div>

          <div class="card mt-16">
            <h2>Research Notes</h2>
            <textarea id="f-researchNotes">${esc(lead.researchNotes)}</textarea>
          </div>

          <div class="card mt-16">
            <h2>Skip Tracing Notes</h2>
            <textarea id="f-skipTraceNotes">${esc(lead.skipTraceNotes)}</textarea>
          </div>
        </div>

        <div class="section">
          <div class="card">
            <h2>Milestones</h2>
            ${Views._milestonesHTML(lead)}
          </div>

          <div class="card mt-16">
            <h2>Expenses</h2>
            <div id="expenses-list">${Views._expensesHTML(lead)}</div>
            <div class="flex gap-8 mt-16 wrap">
              <input type="text" id="exp-desc" placeholder="Description" style="max-width:160px;"/>
              <input type="number" id="exp-amount" placeholder="Amount" style="max-width:100px;"/>
              <input type="date" id="exp-date" value="${todayISO()}" style="max-width:150px;"/>
              <button class="btn btn-sm" id="add-expense-btn">+ Add Expense</button>
            </div>
          </div>

          <div class="card mt-16">
            <h2>Activity Log <span class="muted" style="font-weight:400;">(contact attempts, letters, county comms…)</span></h2>
            <div id="activity-list">${Views._activityHTML(lead)}</div>
            <div class="form-grid mt-16">
              <div class="form-row">
                <label>Type</label>
                <select id="log-type">${ACTIVITY_TYPES.map((t) => `<option>${esc(t)}</option>`).join("")}</select>
              </div>
              <div class="form-row"><label>Who</label><input type="text" id="log-who" placeholder="e.g. You" /></div>
              <div class="form-row"><label>Date</label><input type="date" id="log-date" value="${todayISO()}"/></div>
            </div>
            <div class="form-row"><label>Notes</label><textarea id="log-notes" placeholder="What happened?"></textarea></div>
            <button class="btn btn-sm" id="add-log-btn">+ Add Entry</button>
          </div>
        </div>
      </div>
    `;

    // Auto-save simple fields on change/blur
    const fieldMap = [
      ["f-propertyAddress", "propertyAddress"], ["f-parcelNumber", "parcelNumber"],
      ["f-saleDate", "saleDate"], ["f-overageAmount", "overageAmount"],
      ["f-formerOwnerName", "formerOwnerName"], ["f-businessName", "businessName"], ["f-sourceOffice", "sourceOffice"],
      ["f-state", "state"], ["f-county", "county"], ["f-listType", "listType"],
      ["f-status", "status"], ["f-nextAction", "nextAction"], ["f-responsible", "responsible"],
      ["f-dueDate", "dueDate"], ["f-countyFollowUpDate", "countyFollowUpDate"], ["f-claimantFollowUpDate", "claimantFollowUpDate"],
      ["f-researchNotes", "researchNotes"], ["f-skipTraceNotes", "skipTraceNotes"],
      ["f-badLeadReason", "badLeadReason"], ["f-badLeadNotes", "badLeadNotes"],
    ];
    fieldMap.forEach(([elId, key]) => {
      const el = document.getElementById(elId);
      if (!el) return;
      const evtType = (el.tagName === "SELECT" || el.type === "date") ? "change" : "blur";
      el.addEventListener(evtType, async () => {
        lead[key] = el.type === "number" ? parseFloat(el.value) || 0 : el.value;
        await persistLead(lead);
        if (["f-status", "f-state", "f-county", "f-businessName", "f-overageAmount"].includes(elId)) Views.leadDetail(root, id);
      });
    });

    document.getElementById("f-isDisqualified").addEventListener("change", async (e) => {
      lead.isDisqualified = e.target.checked;
      if (!lead.isDisqualified) lead.disqualifyReasons = [];
      await persistLead(lead);
      Views.leadDetail(root, id);
    });

    document.getElementById("delete-lead-btn").addEventListener("click", async () => {
      if (confirm("Delete this lead permanently? This can't be undone.")) {
        await DB.deleteLead(lead.id);
        await App.reloadAll();
        App.navigate("leads");
      }
    });

    // Milestones
    Object.keys(lead.milestones).forEach((key) => {
      const cb = document.getElementById(`ms-${key}-done`);
      const dt = document.getElementById(`ms-${key}-date`);
      if (cb) cb.addEventListener("change", async () => {
        lead.milestones[key].done = cb.checked;
        if (cb.checked && !lead.milestones[key].date) lead.milestones[key].date = todayISO();
        await persistLead(lead);
        Views.leadDetail(root, id);
      });
      if (dt) dt.addEventListener("change", async () => {
        lead.milestones[key].date = dt.value;
        await persistLead(lead);
      });
    });

    // Expenses
    document.getElementById("add-expense-btn").addEventListener("click", async () => {
      const desc = document.getElementById("exp-desc").value.trim();
      const amount = parseFloat(document.getElementById("exp-amount").value);
      const date = document.getElementById("exp-date").value || todayISO();
      if (!desc || isNaN(amount)) { alert("Please enter a description and amount."); return; }
      lead.expenses.push({ id: uid("exp"), date, description: desc, amount });
      await persistLead(lead);
      Views.leadDetail(root, id);
    });
    root.querySelectorAll(".delete-expense").forEach((btn) => {
      btn.addEventListener("click", async () => {
        lead.expenses = lead.expenses.filter((x) => x.id !== btn.dataset.id);
        await persistLead(lead);
        Views.leadDetail(root, id);
      });
    });

    // Activity log
    document.getElementById("add-log-btn").addEventListener("click", async () => {
      const type = document.getElementById("log-type").value;
      const who = document.getElementById("log-who").value.trim() || "You";
      const date = document.getElementById("log-date").value || todayISO();
      const notes = document.getElementById("log-notes").value.trim();
      lead.activityLog.unshift({ id: uid("log"), date, type, who, notes });
      await persistLead(lead);
      Views.leadDetail(root, id);
    });
    root.querySelectorAll(".delete-log").forEach((btn) => {
      btn.addEventListener("click", async () => {
        lead.activityLog = lead.activityLog.filter((x) => x.id !== btn.dataset.id);
        await persistLead(lead);
        Views.leadDetail(root, id);
      });
    });
  },

  // Research links for finding the person behind an LLC. Fully
  // automatic lookup isn't possible for free (OpenCorporates' API needs
  // a paid key and state registries block automated tools), so instead
  // each link opens the right search, pre-filled, in a new tab.
  _llcResearchCardHTML(lead) {
    const name = encodeURIComponent(lead.businessName);
    const code = STATE_CODES[lead.state] || "";
    const jurisdiction = code ? `&jurisdiction_code=us_${code.toLowerCase()}` : "";
    const openCorp = `https://opencorporates.com/companies?q=${name}${jurisdiction}&type=companies`;
    const sosSearch = `https://www.google.com/search?q=${encodeURIComponent(`${lead.state} Secretary of State business search "${lead.businessName}"`)}`;
    const generalSearch = `https://www.google.com/search?q=${encodeURIComponent(`"${lead.businessName}" ${lead.state} owner registered agent`)}`;
    return `
      <div class="card mt-16">
        <h2>Find the LLC's Owner</h2>
        <p class="field-hint mt-0">
          This lead's claimant is a business: <strong>${esc(lead.businessName)}</strong>.
          These searches open pre-filled in a new tab — look for the <em>registered agent</em>,
          <em>organizer</em>, or <em>officers</em> on the state filing. When you find the person,
          enter them under Former Owner Name above.
        </p>
        <div class="flex gap-8 wrap">
          <a class="btn" href="${openCorp}" target="_blank" rel="noopener">Search OpenCorporates</a>
          <a class="btn" href="${sosSearch}" target="_blank" rel="noopener">Find ${esc(lead.state) || "State"} Business Registry</a>
          <a class="btn" href="${generalSearch}" target="_blank" rel="noopener">Google the Owner</a>
        </div>
      </div>
    `;
  },

  _milestonesHTML(lead) {
    const defs = [
      ["notaryHired", "Notary Hired"], ["signingCompleted", "Signing Completed"],
      ["docsReceived", "Docs Received"], ["submissionSent", "Submission File Sent to County"],
      ["decisionMade", "Decision Made"], ["checkReceived", "Check Received"],
      ["checkSent", "Check Sent to Claimant"],
    ];
    return defs.map(([key, label]) => {
      const m = lead.milestones[key] || { done: false, date: "" };
      return `
        <div class="checklist-item">
          <input type="checkbox" id="ms-${key}-done" style="width:auto;" ${m.done ? "checked" : ""}/>
          <span class="cl-label">${esc(label)}</span>
          <input type="date" id="ms-${key}-date" value="${esc(m.date || "")}"/>
        </div>
      `;
    }).join("");
  },

  _expensesHTML(lead) {
    if (!lead.expenses.length) return `<div class="empty-state">No expenses logged.</div>`;
    const total = lead.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return `
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th></th></tr></thead>
        <tbody>
          ${lead.expenses.map((e) => `
            <tr>
              <td>${fmtDate(e.date)}</td><td>${esc(e.description)}</td><td>${fmtMoney(e.amount)}</td>
              <td><button class="btn btn-sm btn-danger delete-expense" data-id="${e.id}">Remove</button></td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot><tr><td colspan="2"><strong>Total</strong></td><td colspan="2"><strong>${fmtMoney(total)}</strong></td></tr></tfoot>
      </table>
    `;
  },

  _activityHTML(lead) {
    if (!lead.activityLog.length) return `<div class="empty-state">No activity logged yet.</div>`;
    return lead.activityLog.map((entry) => `
      <div class="log-entry">
        <div class="log-meta flex-between">
          <span><strong>${esc(entry.type)}</strong> &middot; ${fmtDate(entry.date)} &middot; ${esc(entry.who)}</span>
          <button class="btn btn-sm btn-danger delete-log" data-id="${entry.id}">Remove</button>
        </div>
        <div>${esc(entry.notes) || "<span class='muted'>No notes</span>"}</div>
      </div>
    `).join("");
  },

  // -------------------- RESOURCE LIBRARY --------------------
  resources(root) {
    const tree = {};
    App.resources.forEach((r) => {
      const st = r.state || "Unspecified";
      const co = r.county || "Unspecified";
      if (!tree[st]) tree[st] = {};
      if (!tree[st][co]) tree[st][co] = [];
      tree[st][co].push(r);
    });
    const f = App.resourcesFilter;
    const filteredResources = App.resources.filter((r) => {
      if (f.state && (r.state || "Unspecified") !== f.state) return false;
      if (f.county && (r.county || "Unspecified") !== f.county) return false;
      if (f.formType && r.formType !== f.formType) return false;
      return true;
    });

    root.innerHTML = `
      <div class="page-header">
        <div>
          <h1>Resource Library</h1>
          <p class="subtitle">Forms and documents, organized by state and county.</p>
        </div>
      </div>

      <div class="layout-2col">
        <div class="card">
          <h3>By Location</h3>
          <div class="tree" id="res-tree-container"></div>
        </div>

        <div>
          <div class="card">
            <h3>Upload a Form</h3>
            <div class="form-grid">
              <div class="form-row">
                <label>State</label>
                <select id="res-state">
                  <option value="">Select a state…</option>
                  ${US_STATES.map((s) => `<option value="${esc(s)}" ${f.state === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
                </select>
              </div>
              <div class="form-row"><label>County</label><input type="text" id="res-county" placeholder="e.g. Fulton" value="${esc(f.county || "")}"/></div>
              <div class="form-row">
                <label>Form Type</label>
                <select id="res-formtype">
                  <option value="">Select a type…</option>
                  ${FORM_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join("")}
                </select>
              </div>
            </div>
            <div class="dropzone" id="res-dropzone">
              <div class="dz-icon">&#128193;</div>
              <div><strong>Drag &amp; drop a form here</strong>, or click to choose a file.</div>
              <div class="field-hint">PDF, Word, or any document type.</div>
              <input type="file" id="res-file-input" />
            </div>
          </div>

          <div class="card mt-16">
            <div class="flex-between wrap gap-8">
              <h3 class="mt-0">${f.state ? `${esc(f.county ? f.county + ", " : "")}${esc(f.state)}` : "All Files"}</h3>
              <div class="flex gap-8">
                <select id="res-type-filter">
                  <option value="">All form types</option>
                  ${FORM_TYPES.map((t) => `<option value="${esc(t)}" ${f.formType === t ? "selected" : ""}>${esc(t)}</option>`).join("")}
                </select>
                ${(f.state || f.county || f.formType) ? `<button class="btn btn-sm" id="res-clear">Show all</button>` : ""}
              </div>
            </div>
            ${Views._resourceListHTML(filteredResources)}
          </div>
        </div>
      </div>
    `;

    document.getElementById("res-type-filter").addEventListener("change", (e) => {
      App.resourcesFilter.formType = e.target.value;
      Views.resources(root);
    });

    Views._renderResTree(tree);

    const clearBtn = document.getElementById("res-clear");
    if (clearBtn) clearBtn.addEventListener("click", () => { App.resourcesFilter = { state: null, county: null, formType: "" }; Views.resources(root); });

    const dz = document.getElementById("res-dropzone");
    const fi = document.getElementById("res-file-input");
    dz.addEventListener("click", () => fi.click());
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("dragover"); if (e.dataTransfer.files.length) handleResFile(e.dataTransfer.files[0]); });
    fi.addEventListener("change", () => { if (fi.files.length) handleResFile(fi.files[0]); });

    async function handleResFile(file) {
      const state = document.getElementById("res-state").value;
      const county = document.getElementById("res-county").value.trim();
      const formType = document.getElementById("res-formtype").value;
      if (!state || !county) { alert("Please select a State and enter a County first."); fi.value = ""; return; }
      if (!formType) { alert("Please select a Form Type first."); fi.value = ""; return; }
      if (file.size > 15 * 1024 * 1024) { alert("That file is larger than 15MB — please use a smaller file."); return; }
      const dataUrl = await fileToDataURL(file);
      const resource = {
        id: uid("res"), state, county, formType, filename: file.name, mimeType: file.type || "application/octet-stream",
        size: file.size, dataUrl, uploadedAt: new Date().toISOString(),
      };
      await DB.saveResource(resource);
      await App.reloadAll();
      App.resourcesFilter = { state, county, formType: "" };
      Views.resources(root);
    }

    root.querySelectorAll(".delete-resource").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (confirm("Delete this file?")) {
          await DB.deleteResource(btn.dataset.id);
          await App.reloadAll();
          Views.resources(root);
        }
      });
    });
  },

  _renderResTree(tree) {
    const container = document.getElementById("res-tree-container");
    const states = Object.keys(tree).sort();
    if (states.length === 0) { container.innerHTML = `<div class="empty-state">No files uploaded yet.</div>`; return; }
    container.innerHTML = states.map((st) => {
      const counties = tree[st];
      const total = Object.values(counties).reduce((sum, arr) => sum + arr.length, 0);
      return `
        <div class="tree-state">
          <div class="tree-state-header" data-state="${esc(st)}"><span>${esc(st)}</span><span class="tree-count">${total}</span></div>
          <div class="tree-counties" data-for="${esc(st)}" style="display:${App.resourcesFilter.state === st ? "block" : "none"}">
            ${Object.keys(counties).sort().map((co) => `
              <div class="tree-county ${App.resourcesFilter.state === st && App.resourcesFilter.county === co ? "active" : ""}" data-state="${esc(st)}" data-county="${esc(co)}">
                <span>${esc(co)}</span><span class="tree-count">${counties[co].length}</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".tree-state-header").forEach((el) => {
      el.addEventListener("click", () => {
        const sub = container.querySelector(`.tree-counties[data-for="${CSS.escape(el.dataset.state)}"]`);
        const isOpen = sub.style.display !== "none";
        sub.style.display = isOpen ? "none" : "block";
        if (isOpen && App.resourcesFilter.state === el.dataset.state) {
          App.resourcesFilter = { state: null, county: null, formType: App.resourcesFilter.formType };
        } else {
          App.resourcesFilter = { state: el.dataset.state, county: null, formType: App.resourcesFilter.formType };
        }
        Views.resources(document.getElementById("app-root"));
      });
    });
    container.querySelectorAll(".tree-county").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        App.resourcesFilter = { state: el.dataset.state, county: el.dataset.county, formType: App.resourcesFilter.formType };
        Views.resources(document.getElementById("app-root"));
      });
    });
  },

  _resourceListHTML(resources) {
    if (!resources.length) return `<div class="empty-state">No files here yet. Upload one above.</div>`;
    return `
      <table>
        <thead><tr><th>File</th><th>Type</th><th>Location</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
        <tbody>
          ${resources.map((r) => `
            <tr>
              <td>${esc(r.filename)}</td>
              <td>${r.formType ? `<span class="badge badge-blue">${esc(r.formType)}</span>` : "—"}</td>
              <td>${esc(r.county)}, ${esc(r.state)}</td>
              <td>${(r.size / 1024).toFixed(0)} KB</td>
              <td>${new Date(r.uploadedAt).toLocaleDateString()}</td>
              <td class="flex gap-8">
                <a class="btn btn-sm" href="${r.dataUrl}" download="${esc(r.filename)}">Download</a>
                <button class="btn btn-sm btn-danger delete-resource" data-id="${r.id}">Delete</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  },

  // -------------------- SETTINGS --------------------
  settings(root) {
    root.innerHTML = `
      <div class="page-header"><div><h1>Settings</h1><p class="subtitle">Filters, backups, and account.</p></div></div>

      <div class="card">
        <h2>Lead Filtering Rules</h2>
        <p class="field-hint mt-0">These control which imported leads get auto-flagged as out-of-range.</p>
        <div class="form-grid">
          <div class="form-row"><label>Minimum Overage Amount ($)</label><input type="number" id="s-minAmount" value="${App.settings.minAmount}"/></div>
          <div class="form-row"><label>Minimum Age (months)</label><input type="number" id="s-minAgeMonths" value="${App.settings.minAgeMonths}"/></div>
          <div class="form-row"><label>Maximum Age (years)</label><input type="number" id="s-maxAgeYears" value="${App.settings.maxAgeYears}"/></div>
        </div>
        <button class="btn btn-primary mt-16" id="save-settings-btn">Save Rules</button>
        <span id="settings-saved" class="muted" style="margin-left:10px;"></span>
      </div>

      <div class="card mt-16">
        <h2>Commission Rules</h2>
        <p class="field-hint mt-0">
          Your fee as a percentage of the overage. The whole amount earns one rate,
          based on whether it's under or over $${COMMISSION_THRESHOLD.toLocaleString()}.
          Each lead's commission shows in the Leads list, and totals show on the Dashboard.
        </p>
        <div class="form-grid">
          <div class="form-row">
            <label>Overages UNDER $${COMMISSION_THRESHOLD.toLocaleString()} — your %</label>
            <input type="number" id="s-commissionPctUnder" min="0" max="100" step="0.5" value="${App.settings.commissionPctUnder || 0}"/>
          </div>
          <div class="form-row">
            <label>Overages $${COMMISSION_THRESHOLD.toLocaleString()} AND OVER — your %</label>
            <input type="number" id="s-commissionPctOver" min="0" max="100" step="0.5" value="${App.settings.commissionPctOver || 0}"/>
          </div>
        </div>
        <button class="btn btn-primary mt-16" id="save-commission-btn">Save Commission Rules</button>
        <span id="commission-saved" class="muted" style="margin-left:10px;"></span>
      </div>

      <div class="card mt-16">
        <h2>Backup Your Data</h2>
        <p class="field-hint mt-0">
          This app stores everything in this browser only. Download a backup regularly — especially before
          clearing browser data or switching computers.
        </p>
        <div class="flex gap-8 wrap">
          <button class="btn btn-primary" id="export-btn">Download Backup File</button>
          <button class="btn" id="import-btn">Restore From Backup File</button>
          <input type="file" id="import-file-input" accept=".json" style="display:none;" />
        </div>
      </div>

      <div class="card mt-16" id="login-card">
        <h2>Login</h2>
        <div id="login-status"></div>
      </div>

      <div class="card mt-16">
        <h2>Sample Data</h2>
        <p class="field-hint mt-0">Remove the example leads that came pre-loaded so you can start fresh.</p>
        <button class="btn btn-danger" id="clear-sample-btn">Clear Sample Data</button>
      </div>

      <div class="card mt-16">
        <h2>Danger Zone</h2>
        <p class="field-hint mt-0">Permanently erase everything in this app (leads, files, settings).</p>
        <button class="btn btn-danger" id="wipe-btn">Erase All Data</button>
      </div>
    `;

    document.getElementById("save-settings-btn").addEventListener("click", async () => {
      const thresholds = {
        ...App.settings,
        minAmount: parseFloat(document.getElementById("s-minAmount").value) || 0,
        minAgeMonths: parseFloat(document.getElementById("s-minAgeMonths").value) || 0,
        maxAgeYears: parseFloat(document.getElementById("s-maxAgeYears").value) || 0,
      };
      await DB.setSetting("thresholds", thresholds);
      await App.reloadAll();
      document.getElementById("settings-saved").textContent = "Saved ✓";
      setTimeout(() => { document.getElementById("settings-saved").textContent = ""; }, 2000);
    });

    document.getElementById("save-commission-btn").addEventListener("click", async () => {
      const clampPct = (v) => Math.min(100, Math.max(0, parseFloat(v) || 0));
      const thresholds = {
        ...App.settings,
        commissionPctUnder: clampPct(document.getElementById("s-commissionPctUnder").value),
        commissionPctOver: clampPct(document.getElementById("s-commissionPctOver").value),
      };
      await DB.setSetting("thresholds", thresholds);
      await App.reloadAll();
      document.getElementById("commission-saved").textContent = "Saved ✓";
      setTimeout(() => { document.getElementById("commission-saved").textContent = ""; }, 2000);
    });

    document.getElementById("export-btn").addEventListener("click", async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      downloadBlob(`overage-crm-backup-${todayISO()}.json`, blob);
    });

    const importInput = document.getElementById("import-file-input");
    document.getElementById("import-btn").addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", async () => {
      if (!importInput.files.length) return;
      const file = importInput.files[0];
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const replace = confirm("Replace ALL current data with this backup? Click Cancel to merge instead.");
        await DB.importAll(data, { replace });
        await App.reloadAll();
        alert("Backup restored.");
        App.route();
      } catch (e) {
        alert("Couldn't read that file. Make sure it's a backup file downloaded from this app.");
      }
    });

    document.getElementById("clear-sample-btn").addEventListener("click", async () => {
      if (!confirm("Remove all sample leads?")) return;
      const leads = await DB.getAllLeads();
      for (const l of leads) {
        if (l.id.startsWith("lead_") && l.createdAt && !l.activityLog.length && !l.expenses.length) {
          // heuristic isn't reliable enough; instead track via flag
        }
      }
      // simpler & safer: only clear if flagged as sample-loaded and untouched
      const isSample = await DB.getSetting("sampleDataLoaded", false);
      if (isSample) {
        await DB.clear("leads");
        await DB.setSetting("sampleDataLoaded", false);
        await App.reloadAll();
        App.route();
      } else {
        alert("Sample data has already been cleared or replaced.");
      }
    });

    document.getElementById("wipe-btn").addEventListener("click", async () => {
      if (confirm("This will permanently erase ALL leads, files, and settings in this browser. Are you sure?")) {
        if (confirm("Really sure? This cannot be undone. Consider downloading a backup first.")) {
          await DB.clear("leads");
          await DB.clear("resources");
          await DB.clear("meta");
          location.reload();
        }
      }
    });

    Views._renderLoginStatus();
  },

  async _renderLoginStatus() {
    const el = document.getElementById("login-status");
    if (!el) return;
    el.innerHTML = `
      <p class="field-hint mt-0">
        A login is active for username <strong>${esc(Auth.USERNAME)}</strong>.
        The username and password are built into the app itself, so they work on every device.
        To change them, ask Claude to update the login in <code>js/auth.js</code>.
      </p>
    `;
  },
};

document.addEventListener("DOMContentLoaded", async () => {
  await openDB();
  const configured = await Auth.isConfigured();

  if (configured && !Auth.isLoggedIn()) {
    document.getElementById("login-screen").style.display = "flex";
    document.getElementById("app-shell").style.display = "none";
    document.getElementById("login-submit").addEventListener("click", doLogin);
    document.getElementById("login-password").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  } else {
    startApp();
  }

  async function doLogin() {
    const u = document.getElementById("login-username").value;
    const p = document.getElementById("login-password").value;
    const ok = await Auth.tryLogin(u, p);
    if (ok) {
      document.getElementById("login-screen").style.display = "none";
      startApp();
    } else {
      document.getElementById("login-error").textContent = "Incorrect username or password.";
    }
  }

  function startApp() {
    document.getElementById("app-shell").style.display = "flex";
    App.init();
  }
});
