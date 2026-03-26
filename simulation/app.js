/* HIP3 Apportionment Layer — Static Simulation UI */

const F_MAX_DEFAULT_PCT = 0.1; // 0.1% = 10 bps
let slashTarget = null;

// ── Init ────────────────────────────────────────────────────────────────

function init() {
  engine.seed();

  // Editable inputs that trigger recalc
  for (const id of ["markPriceInput", "fMaxInput"]) {
    document.getElementById(id).addEventListener("input", refreshAll);
  }

  document.getElementById("addBtn").addEventListener("click", doAdd);
  document.getElementById("routePayoutBtn").addEventListener("click", doRoutePayout);
  document.getElementById("slashConfirmBtn").addEventListener("click", doSlashConfirm);
  document.getElementById("slashCancelBtn").addEventListener("click", closeSlashModal);
  document.getElementById("dismissHint").addEventListener("click", () => {
    document.getElementById("walkthrough").style.display = "none";
  });

  // Enter key in add row
  for (const id of ["addName", "addV", "addPi"]) {
    document.getElementById(id).addEventListener("keydown", e => { if (e.key === "Enter") doAdd(); });
  }

  refreshAll();
  logMsg("3 validators pre-loaded, 500 HYPE reserve. Try slashing one.", "success");
}

// ── Refresh ─────────────────────────────────────────────────────────────

function refreshAll() {
  const s = engine.state;

  document.getElementById("vPool").textContent = fmt(s.V_pool) + " HYPE";
  document.getElementById("piPool").textContent = bpsToP(engine.piPoolWeighted()) + "%";
  document.getElementById("piVPool").textContent = fmtInt(s.piV_pool);
  document.getElementById("insuredCount").textContent = activeCount();
  document.getElementById("eventActiveFlag").textContent = s.eventActive ? "YES" : "No";
  document.getElementById("eventActiveFlag").style.color = s.eventActive ? "#f85149" : "#3fb950";

  refreshInsuredTable();
  refreshEventBar();
  refreshFunding();
}

function activeCount() {
  return engine.state.insuredList.filter(a => engine.state.insureds.get(a)?.active).length;
}

// ── Insured Table (inline controls) ─────────────────────────────────────

function refreshInsuredTable() {
  const s = engine.state;
  const tbody = document.getElementById("insuredBody");
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;
  const fMaxPct = parseFloat(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_PCT;
  const fMax = fMaxPct / 100;
  const normalOracle = engine.currentOracleValue() / 1e6;
  const rate = s.eventActive ? fMax : Math.min(Math.max(markPrice - normalOracle, 0), fMax);
  const rows = [];

  for (const addr of s.insuredList) {
    const ins = s.insureds.get(addr);
    if (!ins) continue;
    const w = Math.round(engine.premiumWeight(addr));
    const viPi = ins.V * ins.pi;
    const premium = ins.active ? ins.V * rate : 0;
    const premSign = s.eventActive ? "+" : "-";
    const premColor = s.eventActive ? "#f85149" : "#3fb950";

    const actions = ins.active
      ? `<button class="btn-icon slash" onclick="openSlashModal('${addr}')" title="Slash this insured">Slash</button>` +
        `<button class="btn-icon remove" onclick="doRemove('${addr}')" title="Deregister">&minus;</button>`
      : '<span style="color:#8b949e">removed</span>';

    rows.push(`<tr class="${!ins.active ? 'row-inactive' : ''}">
      <td class="mono"><span class="tag">${addr}</span></td>
      <td>${fmt(ins.V)}</td>
      <td>${bpsToP(ins.pi)}%</td>
      <td>${fmtInt(viPi)}</td>
      <td>${bpsToP(w)}%</td>
      <td style="color:${ins.active ? premColor : '#8b949e'}">${ins.active ? premSign + fmt(premium) + ' /hr' : '—'}</td>
      <td>${actions}</td>
    </tr>`);
  }

  try {
    tbody.innerHTML = rows.length ? rows.join("") :
      '<tr><td colspan="7" style="text-align:center;color:#8b949e">No insureds — add one below</td></tr>';
  } catch (e) {
    console.error("Table render error:", e, "rows:", rows.length);
  }
}

// ── Event Bar ───────────────────────────────────────────────────────────

function refreshEventBar() {
  const s = engine.state;
  const el = document.getElementById("eventBar");

  if (!s.eventActive) {
    el.style.display = "none";
    return;
  }
  el.style.display = "block";

  document.getElementById("evtInsured").textContent = s.eventInsured;
  document.getElementById("evtLambdaVal").textContent = bpsToP(s.eventLambdaBps);
  document.getElementById("evtVSnap").textContent = fmt(s.V_snap) + " HYPE";
  document.getElementById("evtOracle").textContent = (s.oracleValue6 / 1e6).toFixed(6);
  document.getElementById("evtPayout").textContent = fmt(s.pendingPayout) + " HYPE";
}

// ── Slash Modal ─────────────────────────────────────────────────────────

function openSlashModal(addr) {
  if (engine.state.eventActive) {
    logMsg("Cannot slash — another event is active. Route payout first.", "error");
    return;
  }
  slashTarget = addr;
  document.getElementById("slashTarget").textContent = addr;
  document.getElementById("slashLambda").value = "";
  document.getElementById("slashModal").style.display = "flex";
  document.getElementById("slashLambda").focus();
}

function closeSlashModal() {
  document.getElementById("slashModal").style.display = "none";
  slashTarget = null;
}

function doSlashConfirm() {
  if (!slashTarget) return;
  const lambdaPct = parseFloat(document.getElementById("slashLambda").value);
  if (!lambdaPct) return logMsg("Enter λ_i as a percentage", "error");
  const lambdaBps = Math.round(lambdaPct * 100); // convert % to bps for engine

  try {
    const result = engine.triggerEvent(slashTarget, lambdaBps);
    const oracle = (result.oracleValue6 / 1e6).toFixed(6);
    logMsg(`SLASH: ${slashTarget} | λ=${lambdaPct}% | O(T*)=${oracle} | payout=${fmt(result.pendingPayout)} HYPE`, "success");
    closeSlashModal();
    refreshAll();
  } catch (e) {
    logMsg("Slash failed: " + e.message, "error");
  }
}

// ── Funding ─────────────────────────────────────────────────────────────

function refreshFunding() {
  const s = engine.state;
  const stateEl = document.getElementById("oracleState");
  const priceEl = document.getElementById("oraclePrice");
  const fMaxPct = parseFloat(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_PCT;
  const fMax = fMaxPct / 100;
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;

  const lpNStarRow = document.getElementById("lpNStarRow");
  const lpTotalRow = document.getElementById("lpTotalRow");
  const lpExcessRow = document.getElementById("lpExcessRow");
  const eventFundingEl = document.getElementById("eventFundingInfo");

  if (!s.eventActive) {
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    const normalOracle = engine.currentOracleValue() / 1e6;
    priceEl.textContent = normalOracle.toFixed(6) + " (π_pool)";

    const fundingRate = markPrice - normalOracle;
    const capped = Math.min(Math.max(fundingRate, 0), fMax);
    document.getElementById("fundingRate").textContent =
      (capped * 100).toFixed(4) + "%/hr" + (fundingRate > fMax ? " (capped)" : "");
    document.getElementById("fundingDirection").textContent = "Longs (Insureds) → Shorts (Insurers)";
    document.getElementById("fundingDirection").style.color = "#3fb950";

    document.getElementById("poolPremiumHr").textContent = fmt(s.V_pool * capped) + " HYPE (earned)";

    lpNStarRow.style.display = "none";
    lpTotalRow.style.display = "none";
    lpExcessRow.style.display = "none";
    eventFundingEl.style.display = "none";

    refreshFundingTable(capped, false);
  } else {
    stateEl.textContent = "EVENT";
    stateEl.className = "badge badge-event";

    const oracle = s.oracleValue6 / 1e6;
    priceEl.textContent = oracle.toFixed(6);

    document.getElementById("fundingRate").textContent =
      (-fMax * 100).toFixed(4) + "%/hr (at -f_max)";
    document.getElementById("fundingDirection").textContent = "Shorts (Insurers) → Longs (Insureds)";
    document.getElementById("fundingDirection").style.color = "#f85149";

    const perInterval = s.V_snap * fMax;
    document.getElementById("poolPremiumHr").textContent = fmt(perInterval) + " HYPE/hr (paying out)";

    const nStar = Math.ceil(oracle / fMax);
    const totalFromLPs = perInterval * nStar;
    const excess = totalFromLPs - s.pendingPayout;

    lpNStarRow.style.display = "flex";
    lpTotalRow.style.display = "flex";
    lpExcessRow.style.display = "flex";
    document.getElementById("oracleNStar").textContent = nStar + " hours";
    document.getElementById("totalFromLPs").textContent = fmt(totalFromLPs) + " HYPE";
    document.getElementById("ceilingExcess").textContent = fmt(excess) + " HYPE";

    eventFundingEl.style.display = "block";
    const pct = Math.min(100, (totalFromLPs / Math.max(s.pendingPayout, 0.0001)) * 100);
    document.getElementById("fundingProgress").style.width = pct + "%";
    document.getElementById("fundingLabel").textContent =
      `${fmt(perInterval)}/hr x ${nStar}hr = ${fmt(totalFromLPs)} HYPE delivers ${fmt(s.pendingPayout)} payout`;

    refreshFundingTable(fMax, true);
  }
}

function refreshFundingTable(rate, isEvent) {
  const s = engine.state;
  const tbody = document.getElementById("fundingBody");
  const rows = [];

  for (const addr of s.insuredList) {
    const ins = s.insureds.get(addr);
    if (!ins || !ins.active) continue;
    const flow = ins.V * rate;
    const w = Math.round(engine.premiumWeight(addr));
    const sign = isEvent ? "+" : "-";
    const color = isEvent ? "#f85149" : "#3fb950";

    rows.push(`<tr>
      <td class="mono">${addr}</td>
      <td>${fmt(ins.V)}</td>
      <td style="color:${color}">${sign}${fmt(flow)}</td>
      <td>${bpsToP(w)}%</td>
    </tr>`);
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="4" style="text-align:center;color:#8b949e">No active insureds</td></tr>';
}

// ── Actions ─────────────────────────────────────────────────────────────

function doAdd() {
  const addr = document.getElementById("addName").value.trim();
  const V = parseFloat(document.getElementById("addV").value);
  const piPct = parseFloat(document.getElementById("addPi").value);

  if (!addr || !V || !piPct) return logMsg("Fill name, V_i, and π_i to add", "error");
  const piBps = Math.round(piPct * 100); // convert % to bps for engine

  try {
    engine.register(addr, V, piBps);
    logMsg(`+ ${addr} | V=${V} HYPE | π=${piPct}%`, "success");
    document.getElementById("addName").value = "";
    document.getElementById("addV").value = "";
    document.getElementById("addPi").value = "";
    refreshAll();
  } catch (e) {
    logMsg("Add failed: " + e.message, "error");
  }
}

// Global — called from inline onclick
function doRemove(addr) {
  try {
    engine.deregister(addr);
    logMsg(`− ${addr} removed`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Remove failed: " + e.message, "error");
  }
}

function doRoutePayout() {
  try {
    const result = engine.routePayout();
    logMsg(`Payout: ${fmt(result.amount)} HYPE → ${result.target}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Route payout failed: " + e.message, "error");
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function logMsg(msg, type) {
  const el = document.getElementById("logEntries");
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = "log-entry " + (type || "info");
  entry.innerHTML = `<span class="time">${time}</span>${msg}`;
  el.insertBefore(entry, el.firstChild);
  while (el.children.length > 100) el.removeChild(el.lastChild);
}

function fmt(n) { return Number(n).toFixed(4); }
function fmtInt(n) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 }); }
function bpsToP(bps) { return (bps / 100).toFixed(2); }

// ── Start ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
