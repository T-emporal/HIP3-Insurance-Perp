/* HIP3 Apportionment Layer — Static Simulation UI */

const F_MAX_DEFAULT_BPS = 10;
let seedData;

// ── Init ────────────────────────────────────────────────────────────────

function init() {
  seedData = engine.seed();

  document.getElementById("registerBtn").addEventListener("click", doRegister);
  document.getElementById("deregisterBtn").addEventListener("click", doDeregister);
  document.getElementById("triggerBtn").addEventListener("click", doTriggerEvent);
  document.getElementById("routePayoutBtn").addEventListener("click", doRoutePayout);
  document.getElementById("markPriceInput").addEventListener("input", refreshAll);
  document.getElementById("fMaxInput").addEventListener("input", refreshAll);
  document.getElementById("dismissHint").addEventListener("click", () => {
    document.getElementById("walkthrough").style.display = "none";
  });

  refreshAll();
  logMsg("Simulation loaded — 3 validators pre-registered, 500 HYPE payout reserve", "success");
  logMsg("Try: set mark price, then trigger a slash event on any insured", "info");
}

// ── Refresh ─────────────────────────────────────────────────────────────

function refreshAll() {
  const s = engine.state;

  document.getElementById("vPool").textContent = fmt(s.V_pool) + " HYPE";
  document.getElementById("piPool").textContent = Math.round(engine.piPoolWeighted()) + " bps";
  document.getElementById("piVPool").textContent = fmtInt(s.piV_pool);
  document.getElementById("insuredCount").textContent = activeCount();
  document.getElementById("contractBal").textContent = fmt(s.balance) + " HYPE";
  document.getElementById("eventActiveFlag").textContent = s.eventActive ? "YES" : "No";
  document.getElementById("eventActiveFlag").style.color = s.eventActive ? "#f85149" : "#3fb950";

  refreshDropdowns();
  refreshInsuredTable();
  refreshEventInfo();
  refreshFunding();
}

function activeCount() {
  return engine.state.insuredList.filter(a => engine.state.insureds.get(a)?.active).length;
}

function refreshDropdowns() {
  const s = engine.state;
  const active = s.insuredList.filter(a => s.insureds.get(a)?.active);

  const deregSelect = document.getElementById("deregAddr");
  const evtSelect = document.getElementById("evtAddr");
  const prevDeregVal = deregSelect.value;
  const prevEvtVal = evtSelect.value;

  deregSelect.innerHTML = '<option value="">Select insured...</option>' +
    active.map(a => `<option value="${a}">${a}</option>`).join("");
  evtSelect.innerHTML = '<option value="">Select insured...</option>' +
    active.map(a => `<option value="${a}">${a}</option>`).join("");

  if (active.includes(prevDeregVal)) deregSelect.value = prevDeregVal;
  if (active.includes(prevEvtVal)) evtSelect.value = prevEvtVal;
}

function refreshInsuredTable() {
  const s = engine.state;
  const tbody = document.getElementById("insuredBody");
  const rows = [];
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;
  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const rate = s.eventActive ? fMax : Math.min(markPrice - 0.0001, fMax);

  for (const addr of s.insuredList) {
    const ins = s.insureds.get(addr);
    if (!ins) continue;
    const w = Math.round(engine.premiumWeight(addr));
    const viPi = ins.V * ins.pi;
    const premium = ins.active ? ins.V * rate : 0;
    const premSign = s.eventActive ? "+" : "-";
    const premColor = s.eventActive ? "#f85149" : "#3fb950";

    rows.push(`<tr class="${!ins.active ? 'row-inactive' : ''}">
      <td class="mono"><span class="tag">${addr}</span></td>
      <td>${fmt(ins.V)}</td>
      <td>${ins.pi}</td>
      <td>${fmtInt(viPi)}</td>
      <td>${w}</td>
      <td style="color:${ins.active ? premColor : '#8b949e'}">${ins.active ? premSign + fmt(premium) + ' /hr' : '—'}</td>
      <td style="color:${ins.active ? '#3fb950' : '#f85149'}">${ins.active ? 'Yes' : 'No'}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="7" style="text-align:center;color:#8b949e">No insureds registered</td></tr>';
}

function refreshEventInfo() {
  const s = engine.state;
  const el = document.getElementById("eventInfo");

  if (!s.eventActive) {
    el.style.display = "none";
    return;
  }
  el.style.display = "grid";

  document.getElementById("evtInsured").textContent = s.eventInsured;
  document.getElementById("evtLambdaVal").textContent = s.eventLambdaBps;
  document.getElementById("evtVSnap").textContent = fmt(s.V_snap) + " HYPE";
  document.getElementById("evtOracle").textContent = (s.oracleValue6 / 1e6).toFixed(6);
  document.getElementById("evtPayout").textContent = fmt(s.pendingPayout) + " HYPE";
}

function refreshFunding() {
  const s = engine.state;
  const stateEl = document.getElementById("oracleState");
  const priceEl = document.getElementById("oraclePrice");
  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;

  // LP event-state rows
  const lpNStarRow = document.getElementById("lpNStarRow");
  const lpTotalRow = document.getElementById("lpTotalRow");
  const lpExcessRow = document.getElementById("lpExcessRow");
  const eventFundingEl = document.getElementById("eventFundingInfo");

  if (!s.eventActive) {
    // ── NORMAL STATE ──
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    priceEl.textContent = "0.0001 (keep-alive)";

    const fundingRate = markPrice - 0.0001;
    const capped = Math.min(fundingRate, fMax);
    document.getElementById("fundingRate").textContent =
      (capped * 10000).toFixed(2) + " bps/hr" + (fundingRate > fMax ? " (capped)" : "");
    document.getElementById("fundingDirection").textContent = "Insureds → LP Shorts (premium)";
    document.getElementById("fundingDirection").style.color = "#3fb950";

    const poolPremium = s.V_pool * capped;
    document.getElementById("poolPremiumHr").textContent = fmt(poolPremium) + " HYPE (earned)";

    lpNStarRow.style.display = "none";
    lpTotalRow.style.display = "none";
    lpExcessRow.style.display = "none";
    eventFundingEl.style.display = "none";

    refreshFundingTable(capped, false);
  } else {
    // ── EVENT STATE ──
    stateEl.textContent = "EVENT";
    stateEl.className = "badge badge-event";

    const oracle = s.oracleValue6 / 1e6;
    priceEl.textContent = oracle.toFixed(6);

    document.getElementById("fundingRate").textContent =
      (-fMax * 10000).toFixed(2) + " bps/hr (at -f_max)";
    document.getElementById("fundingDirection").textContent = "LP Shorts → Insureds (payout)";
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
    const label = isEvent ? "pays" : "earns";

    rows.push(`<tr>
      <td class="mono">${addr}</td>
      <td>${fmt(ins.V)}</td>
      <td style="color:${color}" title="LP ${label} this from/to ${addr}">${sign}${fmt(flow)}</td>
      <td>${w}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="4" style="text-align:center;color:#8b949e">No active insureds</td></tr>';
}

// ── Actions ─────────────────────────────────────────────────────────────

function doRegister() {
  const addr = document.getElementById("regAddr").value.trim();
  const V = parseFloat(document.getElementById("regV").value);
  const pi = parseInt(document.getElementById("regPi").value);

  if (!addr || !V || !pi) return logMsg("Fill all registration fields", "error");

  try {
    engine.register(addr, V, pi);
    logMsg(`Registered ${addr} | V=${V} HYPE | π=${pi} bps`, "success");
    document.getElementById("regAddr").value = "";
    document.getElementById("regV").value = "";
    document.getElementById("regPi").value = "";
    refreshAll();
  } catch (e) {
    logMsg("Register failed: " + e.message, "error");
  }
}

function doDeregister() {
  const addr = document.getElementById("deregAddr").value;
  if (!addr) return logMsg("Select an insured to deregister", "error");

  try {
    engine.deregister(addr);
    logMsg(`Deregistered ${addr}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Deregister failed: " + e.message, "error");
  }
}

function doTriggerEvent() {
  const addr = document.getElementById("evtAddr").value;
  const lambda = parseInt(document.getElementById("evtLambda").value);
  if (!addr) return logMsg("Select an insured from the dropdown", "error");
  if (!lambda) return logMsg("Enter lambda (loss fraction in bps)", "error");

  try {
    const result = engine.triggerEvent(addr, lambda);
    const oracle = (result.oracleValue6 / 1e6).toFixed(6);
    logMsg(`SLASH: ${addr} | λ=${lambda}bps | O(T*)=${oracle} | payout=${fmt(result.pendingPayout)} HYPE`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Trigger failed: " + e.message, "error");
  }
}

function doRoutePayout() {
  try {
    const result = engine.routePayout();
    logMsg(`Payout: ${fmt(result.amount)} HYPE sent to ${result.target}`, "success");
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

// ── Start ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
