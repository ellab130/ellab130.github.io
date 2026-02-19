// decision_tool.js
// Loads churn scores from data/churn_scores.csv and computes capacity-based targeting ROI.

const DATA_PATH = "data/churn_scores.csv";

const els = {
  maxContacts: document.getElementById("maxContacts"),
  maxContactsLabel: document.getElementById("maxContactsLabel"),
  dataCountLabel: document.getElementById("dataCountLabel"),

  contactCost: document.getElementById("contactCost"),
  churnLoss: document.getElementById("churnLoss"),
  saveRate: document.getElementById("saveRate"),

  profitValue: document.getElementById("profitValue"),
  contactsValue: document.getElementById("contactsValue"),
  precisionValue: document.getElementById("precisionValue"),
  recallValue: document.getElementById("recallValue"),

  targetsTbody: document.getElementById("targetsTbody"),
  downloadBtn: document.getElementById("downloadBtn"),
};

let rows = []; // full dataset (sorted by churn_probability desc)
let hasActual = false;

function parseCSV(text) {
  // Minimal CSV parser for simple files (no embedded commas/quotes expected here).
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map(h => h.trim());

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(","); // simple split ok for our generated CSV
    const obj = {};
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = (parts[j] ?? "").trim();
    }
    out.push(obj);
  }
  return out;
}

function toNumber(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function computePolicy(topN, contactCost, churnLoss, saveRate) {
  const N = clamp(topN, 0, rows.length);
  const contacts = N;

  // We assume rows are already sorted by churn_probability desc.
  const contacted = rows.slice(0, N);
  const notContacted = rows.slice(N);

  let tp = 0;
  let fp = 0;
  let totalPos = 0;

  if (hasActual) {
    for (const r of rows) {
      if (toNumber(r.actual_churn, 0) === 1) totalPos += 1;
    }
    for (const r of contacted) {
      if (toNumber(r.actual_churn, 0) === 1) tp += 1;
      else fp += 1;
    }
  }

  // Incremental ROI vs "do nothing"
  // profit = TP * (save_rate * churn_loss) - contacts * contact_cost
  // If no actual labels, approximate expected TP as sum(probabilities) among contacted.
  let expectedTP = tp;
  if (!hasActual) {
    expectedTP = contacted.reduce((acc, r) => acc + toNumber(r.churn_probability, 0), 0);
  }

  const profit = expectedTP * (saveRate * churnLoss) - contacts * contactCost;

  let precision = null;
  let recall = null;

  if (hasActual) {
    precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    recall = totalPos > 0 ? tp / totalPos : 0;
  }

  return { profit, contacts, tp, fp, precision, recall, contacted };
}

function render() {
  const topN = toNumber(els.maxContacts.value, 1000);
  els.maxContactsLabel.textContent = String(topN);

  const contactCost = toNumber(els.contactCost.value, 20);
  const churnLoss = toNumber(els.churnLoss.value, 200);
  const saveRate = toNumber(els.saveRate.value, 0.25);

  const res = computePolicy(topN, contactCost, churnLoss, saveRate);

  els.profitValue.textContent = formatMoney(res.profit);
  els.contactsValue.textContent = String(res.contacts);

  if (hasActual) {
    els.precisionValue.textContent = res.precision.toFixed(3);
    els.recallValue.textContent = res.recall.toFixed(3);
  } else {
    els.precisionValue.textContent = "—";
    els.recallValue.textContent = "—";
  }

  // Table preview (top 25 by risk)
  const previewN = Math.min(25, rows.length);
  const contactedSetN = new Set();
  for (let i = 0; i < Math.min(topN, rows.length); i++) contactedSetN.add(i);

  let html = "";
  for (let i = 0; i < previewN; i++) {
    const r = rows[i];
    const cust = r.customer_id ?? r.customer ?? r.id ?? r.row_index ?? `(row ${i})`;
    const prob = toNumber(r.churn_probability, 0);
    const contact = i < topN ? "Yes" : "No";
    const actual = hasActual ? String(toNumber(r.actual_churn, 0)) : "—";

    html += `
      <tr>
        <td class="mono">${escapeHtml(String(cust))}</td>
        <td class="mono">${prob.toFixed(3)}</td>
        <td>${contact}</td>
        <td class="mono">${actual}</td>
      </tr>
    `;
  }
  els.targetsTbody.innerHTML = html || `<tr><td colspan="4">No data</td></tr>`;

  // Download link updates
  els.downloadBtn.onclick = (e) => {
    e.preventDefault();
    downloadTargetsCSV(res.contacted);
  };
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function downloadTargetsCSV(contactedRows) {
  const headers = ["customer_id", "churn_probability"];
  const includeActual = hasActual && contactedRows.length > 0 && ("actual_churn" in contactedRows[0]);
  if (includeActual) headers.push("actual_churn");

  const lines = [headers.join(",")];

  for (const r of contactedRows) {
    const cust = r.customer_id ?? r.customer ?? r.id ?? r.row_index ?? "";
    const prob = toNumber(r.churn_probability, 0);
    const cols = [String(cust), prob.toFixed(6)];
    if (includeActual) cols.push(String(toNumber(r.actual_churn, 0)));
    lines.push(cols.join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "churn_targets.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function init() {
  try {
    els.dataCountLabel.textContent = "Loading data…";

    const resp = await fetch(DATA_PATH, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch ${DATA_PATH}: ${resp.status}`);

    const text = await resp.text();
    const parsed = parseCSV(text);

    // Normalize + convert numeric fields
    rows = parsed.map(r => ({
      customer_id: r.customer_id ?? r.Customer_ID ?? r.customer ?? r.id ?? r.row_index ?? "",
      churn_probability: toNumber(r.churn_probability ?? r.score ?? r.proba ?? r.prob, 0),
      actual_churn: r.actual_churn !== undefined ? toNumber(r.actual_churn, 0) : undefined,
    }));

    // Detect if actual labels exist
    hasActual = rows.some(r => r.actual_churn !== undefined);

    // Sort descending by probability (in case the file isn't already sorted)
    rows.sort((a, b) => b.churn_probability - a.churn_probability);

    // Set slider max to dataset size (up to a reasonable cap unless you want full range)
    els.maxContacts.max = String(rows.length);
    if (toNumber(els.maxContacts.value, 0) > rows.length) els.maxContacts.value = String(Math.min(1000, rows.length));

    els.dataCountLabel.textContent = `${rows.length.toLocaleString()} customers`;

    // Wire inputs
    const rerender = () => render();
    els.maxContacts.addEventListener("input", rerender);
    els.contactCost.addEventListener("input", rerender);
    els.churnLoss.addEventListener("input", rerender);
    els.saveRate.addEventListener("input", rerender);

    render();
  } catch (err) {
    els.dataCountLabel.textContent = "Data load failed";
    els.targetsTbody.innerHTML = `<tr><td colspan="4">Error: ${escapeHtml(String(err.message || err))}</td></tr>`;
    console.error(err);
  }
}

init();
