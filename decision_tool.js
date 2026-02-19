// decision_tool.js
// Business-forward churn decision support: capacity targeting, ROI, strategy comparison, and a profit curve chart.

const DATA_PATH = "data/churn_scores.csv";

const els = {
  dataCountBadge: document.getElementById("dataCountBadge"),

  maxContacts: document.getElementById("maxContacts"),
  maxContactsLabel: document.getElementById("maxContactsLabel"),

  contactCost: document.getElementById("contactCost"),
  churnLoss: document.getElementById("churnLoss"),
  saveRate: document.getElementById("saveRate"),

  profitValue: document.getElementById("profitValue"),
  costValue: document.getElementById("costValue"),
  roiValue: document.getElementById("roiValue"),
  breakevenValue: document.getElementById("breakevenValue"),

  execSummary: document.getElementById("execSummary"),
  execSummary2: document.getElementById("execSummary2"),
  execCaveat: document.getElementById("execCaveat"),

  compareTbody: document.getElementById("compareTbody"),
  targetsTbody: document.getElementById("targetsTbody"),
  interpretation: document.getElementById("interpretation"),

  downloadBtn: document.getElementById("downloadBtn"),

  presetSaaS: document.getElementById("presetSaaS"),
  presetTelecom: document.getElementById("presetTelecom"),
  presetBank: document.getElementById("presetBank"),

  profitChart: document.getElementById("profitChart"),
};

let rows = [];         // sorted descending by churn_probability
let hasActual = false; // whether actual_churn exists
let baseRate = null;   // churn rate if labels exist; else mean predicted probability

function parseCSV(text) {
  // Minimal parser: OK for our exported CSV (no embedded commas in values)
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map(h => h.trim());
  const out = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
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

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function formatMoney(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatPct(x) {
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Expected TP:
 * - If labels exist, TP is actual count among contacted.
 * - If no labels, approximate TP as sum(probabilities) among contacted.
 */
function expectedTP(contacted) {
  if (hasActual) {
    let tp = 0;
    for (const r of contacted) tp += (r.actual_churn === 1 ? 1 : 0);
    return tp;
  }
  let sum = 0;
  for (const r of contacted) sum += r.churn_probability;
  return sum;
}

/**
 * Incremental profit relative to "do nothing":
 * profit = expectedTP * (save_rate * churn_loss) - contacts * contact_cost
 */
function profitFor(contactedCount, contactCost, churnLoss, saveRate) {
  const N = clamp(contactedCount, 0, rows.length);
  const contacted = rows.slice(0, N);
  const tpExp = expectedTP(contacted);
  const cost = N * contactCost;
  const profit = tpExp * (saveRate * churnLoss) - cost;
  return { profit, cost, tpExp, contacted };
}

function randomStrategy(contactedCount, contactCost, churnLoss, saveRate) {
  const N = clamp(contactedCount, 0, rows.length);
  // If we have labels, baseRate = empirical churn rate; else mean probability
  const tpExp = N * (baseRate ?? 0);
  const cost = N * contactCost;
  const profit = tpExp * (saveRate * churnLoss) - cost;
  return { profit, cost, tpExp };
}

function doNothingStrategy() {
  return { profit: 0, cost: 0, tpExp: 0 };
}

function roi(profit, cost) {
  if (cost <= 0) return null;
  return profit / cost;
}

function breakEvenSaveRate(tpExp, contacts, churnLoss, contactCost) {
  // Need save_rate such that tpExp*(save_rate*churnLoss) - contacts*contactCost >= 0
  // => save_rate >= contacts*contactCost / (tpExp*churnLoss)
  if (tpExp <= 0 || churnLoss <= 0) return null;
  const sr = (contacts * contactCost) / (tpExp * churnLoss);
  return sr;
}

function computePrecisionRecall(contacted) {
  if (!hasActual) return { precision: null, recall: null, tp: null, fp: null, totalPos: null };
  let tp = 0, fp = 0, totalPos = 0;

  for (const r of rows) totalPos += (r.actual_churn === 1 ? 1 : 0);
  for (const r of contacted) {
    if (r.actual_churn === 1) tp += 1;
    else fp += 1;
  }

  const precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
  const recall = totalPos > 0 ? tp / totalPos : 0;
  return { precision, recall, tp, fp, totalPos };
}

function renderTargetsTable(topN) {
  const previewN = Math.min(25, rows.length);
  let html = "";

  for (let i = 0; i < previewN; i++) {
    const r = rows[i];
    const cust = r.customer_id || `(row ${i})`;
    const prob = r.churn_probability;
    const contact = i < topN ? "Yes" : "No";
    const actual = hasActual ? String(r.actual_churn) : "—";

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
}

function renderComparison(topN, contactCost, churnLoss, saveRate) {
  const model = profitFor(topN, contactCost, churnLoss, saveRate);
  const rnd = randomStrategy(topN, contactCost, churnLoss, saveRate);
  const none = doNothingStrategy();

  const rowsHtml = [
    {
      name: "Model ranking (top-N risk)",
      contacts: topN,
      tp: model.tpExp,
      profit: model.profit
    },
    {
      name: "Random targeting (same capacity)",
      contacts: topN,
      tp: rnd.tpExp,
      profit: rnd.profit
    },
    {
      name: "Do nothing",
      contacts: 0,
      tp: 0,
      profit: 0
    }
  ].map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td class="mono">${r.contacts.toLocaleString()}</td>
      <td class="mono">${r.tp.toFixed(0)}</td>
      <td class="mono">${formatMoney(r.profit)}</td>
    </tr>
  `).join("");

  els.compareTbody.innerHTML = rowsHtml;
}

function renderExecSummary(topN, contactCost, churnLoss, saveRate) {
  const model = profitFor(topN, contactCost, churnLoss, saveRate);
  const pr = computePrecisionRecall(model.contacted);

  const profitStr = formatMoney(model.profit);
  const costStr = formatMoney(model.cost);
  const roiVal = roi(model.profit, model.cost);
  const roiStr = (roiVal === null) ? "—" : `${roiVal.toFixed(2)}×`;

  const breakeven = breakEvenSaveRate(model.tpExp, topN, churnLoss, contactCost);
  const breakevenStr =
    (breakeven === null) ? "—" :
    (breakeven > 10 ? ">1000%" : formatPct(breakeven));

  els.profitValue.textContent = profitStr;
  els.costValue.textContent = costStr;
  els.roiValue.textContent = roiStr;
  els.breakevenValue.textContent = breakevenStr;

  // Business language summary (dynamic)
  els.execSummary.innerHTML = `
    <strong>Recommended action:</strong>
    Contact the <strong>top ${topN.toLocaleString()}</strong> at-risk customers (ranked by churn risk).
  `;

  // Expected churners contacted depends on label availability:
  if (hasActual) {
    els.execSummary2.innerHTML = `
      <strong>Expected retained value:</strong>
      You would contact about <strong>${pr.tp.toLocaleString()}</strong> true churners (precision ${formatPct(pr.precision)}),
      with an estimated <strong>${profitStr}</strong> incremental profit under these assumptions.
    `;
    els.execCaveat.textContent =
      "Note: precision/recall are estimated on a held-out scored dataset (proxy). Real results depend on campaign execution.";
  } else {
    els.execSummary2.innerHTML = `
      <strong>Expected retained value:</strong>
      Among contacted customers, the model predicts about <strong>${model.tpExp.toFixed(0)}</strong> churners (expected),
      with an estimated <strong>${profitStr}</strong> incremental profit under these assumptions.
    `;
    els.execCaveat.textContent =
      "Note: this run estimates impact from predicted probabilities (no ground-truth labels loaded).";
  }
}

function interpretationText(topN, contactCost, churnLoss, saveRate) {
  const step = Math.max(200, Math.floor(rows.length / 50));
  const here = profitFor(topN, contactCost, churnLoss, saveRate);
  const next = profitFor(Math.min(rows.length, topN + step), contactCost, churnLoss, saveRate);
  const delta = next.profit - here.profit;

  const roiHere = roi(here.profit, here.cost);
  const be = breakEvenSaveRate(here.tpExp, topN, churnLoss, contactCost);

  if (here.profit >= 0) {
    const marginal = delta >= 0
      ? `Increasing capacity by ~${step.toLocaleString()} would likely increase profit by about ${formatMoney(delta)} (on this scored data).`
      : `Increasing capacity by ~${step.toLocaleString()} would likely reduce profit by about ${formatMoney(Math.abs(delta))}; marginal contacts look less cost-effective.`;

    const beLine = (be === null) ? "" : ` Break-even save rate at this capacity is ${formatPct(be)}.`;
    const roiLine = (roiHere === null) ? "" : ` Current ROI is about ${(roiHere).toFixed(2)}×.`;

    return `Under these assumptions, the outreach policy is expected to be profitable. ${marginal}${beLine}${roiLine}`;
  }

  // Profit negative:
  const fix1 = "reduce contact cost (cheaper channel)";
  const fix2 = "increase save rate (better offer / messaging)";
  const fix3 = "focus on fewer customers (lower capacity)";

  return `Under these assumptions, the outreach policy is not expected to be profitable at this capacity. Consider: ${fix1}, ${fix2}, or ${fix3}. The chart helps identify a capacity where profit turns positive.`;
}

function downloadTargetsCSV(contactedRows) {
  const headers = ["customer_id", "churn_probability"];
  const includeActual = hasActual && contactedRows.length > 0;
  if (includeActual) headers.push("actual_churn");

  const lines = [headers.join(",")];

  for (const r of contactedRows) {
    const cust = r.customer_id ?? "";
    const prob = r.churn_probability ?? 0;
    const cols = [String(cust), Number(prob).toFixed(6)];
    if (includeActual) cols.push(String(r.actual_churn));
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

function drawProfitChart(points) {
  const canvas = els.profitChart;
  const ctx = canvas.getContext("2d");

  // Handle HiDPI
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  const padding = { l: 46, r: 16, t: 12, b: 30 };
  const W = cssW - padding.l - padding.r;
  const H = cssH - padding.t - padding.b;

  if (!points.length) return;

  const xs = points.map(p => p.capacity);
  const ys = points.map(p => p.profit);

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const yPad = (yMax - yMin) * 0.08 || 1;
  const y0 = yMin - yPad;
  const y1 = yMax + yPad;

  const xToPx = (x) => padding.l + ((x - xMin) / (xMax - xMin || 1)) * W;
  const yToPx = (y) => padding.t + (1 - ((y - y0) / (y1 - y0 || 1))) * H;

  // Axes
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(17,17,17,0.18)";
  ctx.beginPath();
  ctx.moveTo(padding.l, padding.t);
  ctx.lineTo(padding.l, padding.t + H);
  ctx.lineTo(padding.l + W, padding.t + H);
  ctx.stroke();

  // Zero line
  if (y0 < 0 && y1 > 0) {
    const yZero = yToPx(0);
    ctx.strokeStyle = "rgba(45,104,196,0.25)";
    ctx.beginPath();
    ctx.moveTo(padding.l, yZero);
    ctx.lineTo(padding.l + W, yZero);
    ctx.stroke();
  }

  // Line
  ctx.strokeStyle = "rgba(45,104,196,0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xToPx(p.capacity);
    const y = yToPx(p.profit);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Labels
  ctx.fillStyle = "rgba(17,17,17,0.65)";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace";

  // Y labels (min/0/max)
  const yLabels = [yMin, 0, yMax].filter((v, i, arr) => arr.indexOf(v) === i);
  for (const v of yLabels) {
    if (v < y0 || v > y1) continue;
    const yy = yToPx(v);
    ctx.fillText(formatMoney(v), 6, yy + 4);
  }

  // X labels (min/max)
  ctx.fillText(String(xMin), padding.l, padding.t + H + 20);
  ctx.fillText(String(xMax), padding.l + W - 16, padding.t + H + 20);
}

function computeProfitCurve(contactCost, churnLoss, saveRate) {
  const n = rows.length;
  if (n === 0) return [];

  // About ~40 points max
  const steps = 40;
  const step = Math.max(50, Math.floor(n / steps));
  const points = [];

  for (let cap = 0; cap <= n; cap += step) {
    const res = profitFor(cap, contactCost, churnLoss, saveRate);
    points.push({ capacity: cap, profit: res.profit });
  }

  // Ensure last point at n
  if (points[points.length - 1]?.capacity !== n) {
    const res = profitFor(n, contactCost, churnLoss, saveRate);
    points.push({ capacity: n, profit: res.profit });
  }

  return points;
}

function applyPreset(preset) {
  // Presets are just reasonable example numbers for non-technical audiences.
  // (You can tweak these to match your story.)
  if (preset === "saas") {
    els.contactCost.value = 2;     // email / in-app message
    els.churnLoss.value = 120;     // lower LTV
    els.saveRate.value = 0.08;     // lower effect
    els.maxContacts.value = Math.min(Number(els.maxContacts.max || 5000), 5000);
  } else if (preset === "telecom") {
    els.contactCost.value = 20;    // call center / offer
    els.churnLoss.value = 200;     // medium LTV
    els.saveRate.value = 0.25;     // moderate effect
    els.maxContacts.value = Math.min(Number(els.maxContacts.max || 5000), 1000);
  } else if (preset === "bank") {
    els.contactCost.value = 10;    // outreach + retention offer
    els.churnLoss.value = 400;     // higher value relationship
    els.saveRate.value = 0.15;     // moderate effect
    els.maxContacts.value = Math.min(Number(els.maxContacts.max || 5000), 1500);
  }
  render();
}

function render() {
  const topN = toNumber(els.maxContacts.value, 1000);
  els.maxContactsLabel.textContent = String(topN);

  const contactCost = toNumber(els.contactCost.value, 20);
  const churnLoss = toNumber(els.churnLoss.value, 200);
  const saveRate = toNumber(els.saveRate.value, 0.25);

  renderExecSummary(topN, contactCost, churnLoss, saveRate);
  renderComparison(topN, contactCost, churnLoss, saveRate);
  renderTargetsTable(topN);

  // Chart
  const curve = computeProfitCurve(contactCost, churnLoss, saveRate);
  drawProfitChart(curve);

  // Interpretation
  els.interpretation.textContent = interpretationText(topN, contactCost, churnLoss, saveRate);

  // Download behavior
  els.downloadBtn.onclick = (e) => {
    e.preventDefault();
    const model = profitFor(topN, contactCost, churnLoss, saveRate);
    downloadTargetsCSV(model.contacted);
  };
}

async function init() {
  try {
    els.dataCountBadge.textContent = "Loading data…";

    const resp = await fetch(DATA_PATH, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to fetch ${DATA_PATH}: ${resp.status}`);

    const text = await resp.text();
    const parsed = parseCSV(text);

    rows = parsed.map(r => {
      const cid = (r.customer_id ?? r.Customer_ID ?? r.id ?? r.row_index ?? "").trim();
      const prob = toNumber(r.churn_probability ?? r.score ?? r.proba ?? r.prob, 0);
      const actualRaw = r.actual_churn;
      const actual = (actualRaw === undefined || actualRaw === "") ? undefined : toNumber(actualRaw, 0);

      return {
        customer_id: cid || "",
        churn_probability: prob,
        actual_churn: actual,
      };
    });

    hasActual = rows.some(r => r.actual_churn !== undefined);
    if (hasActual) {
      const positives = rows.reduce((acc, r) => acc + (r.actual_churn === 1 ? 1 : 0), 0);
      baseRate = positives / rows.length;
    } else {
      baseRate = rows.reduce((acc, r) => acc + r.churn_probability, 0) / rows.length;
    }

    rows.sort((a, b) => b.churn_probability - a.churn_probability);

    // Set slider range to dataset size (so it always works)
    els.maxContacts.max = String(rows.length);
    if (toNumber(els.maxContacts.value, 0) > rows.length) {
      els.maxContacts.value = String(Math.min(1000, rows.length));
    }

    els.dataCountBadge.textContent =
      `${rows.length.toLocaleString()} customers • base churn ${formatPct(baseRate)}`;

    // Wire inputs
    const rerender = () => render();
    els.maxContacts.addEventListener("input", rerender);
    els.contactCost.addEventListener("input", rerender);
    els.churnLoss.addEventListener("input", rerender);
    els.saveRate.addEventListener("input", rerender);

    // Presets
    els.presetSaaS.addEventListener("click", () => applyPreset("saas"));
    els.presetTelecom.addEventListener("click", () => applyPreset("telecom"));
    els.presetBank.addEventListener("click", () => applyPreset("bank"));

    // Re-draw chart on resize (so it stays crisp)
    window.addEventListener("resize", () => render());

    render();
  } catch (err) {
    els.dataCountBadge.textContent = "Data load failed";
    els.compareTbody.innerHTML = `<tr><td colspan="4">Error: ${escapeHtml(String(err.message || err))}</td></tr>`;
    els.targetsTbody.innerHTML = `<tr><td colspan="4">Error: ${escapeHtml(String(err.message || err))}</td></tr>`;
    console.error(err);
  }
}

init();
