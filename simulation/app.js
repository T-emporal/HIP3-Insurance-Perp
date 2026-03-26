/* HIP3 Apportionment Layer — Static Simulation UI */

const F_MAX_DEFAULT_BPS = 10; // 0.1%
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

  // Show seed hints
  const hints = seedData.map(v => v.label).join("\n");
  document.getElementById("seedHints").textContent = hints;

  refreshAll();
  logMsg("Simulation loaded — 3 validators pre-registered, 500 HYPE pool balance", "success");
}

// ── Refresh ─────────────────────────────────────────────────────────────

function refreshAll() {
  const s = engine.state;

  document.getElementById("vPool").textContent = fmt(s.V_pool) + " HYPE";
  document.getElementById("piPool").textContent = Math.round(engine.piPoolWeighted()) + " bps";
  document.getElementById("piVPool").textContent = fmt(s.piV_pool);
  document.getElementById("insuredCount").textContent = s.insuredList.filter(a => s.insureds.get(a)?.active).length;
  document.getElementById("contractBal").textContent = fmt(s.balance) + " HYPE";
  document.getElementById("eventActiveFlag").textContent = s.eventActive ? "YES" : "No";
  document.getElementById("eventActiveFlag").style.color = s.eventActive ? "#f85149" : "#3fb950";

  refreshInsuredTable();
  refreshEventInfo();
  refreshOracle();
}

function refreshInsuredTable() {
  const s = engine.state;
  const tbody = document.getElementById("insuredBody");
  const rows = [];

  for (const addr of s.insuredList) {
    const ins = s.insureds.get(addr);
    if (!ins) continue;
    const w = Math.round(engine.premiumWeight(addr));

    const viPi = ins.V * ins.pi;

    rows.push(`<tr>
      <td class="mono"><span class="tag">${addr}</span></td>
      <td>${fmt(ins.V)}</td>
      <td>${ins.pi}</td>
      <td>${fmt(viPi)}</td>
      <td>${w}</td>
      <td style="color:${ins.active ? '#3fb950' : '#f85149'}">${ins.active ? 'Yes' : 'No'}</td>
    </tr>`);
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="6" style="text-align:center;color:#8b949e">No insureds registered</td></tr>';
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

function refreshOracle() {
  const s = engine.state;
  const stateEl = document.getElementById("oracleState");
  const priceEl = document.getElementById("oraclePrice");
  const eventFundingEl = document.getElementById("eventFundingInfo");
  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;

  if (!s.eventActive) {
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    const oracleKeepAlive = 0.0001;
    priceEl.textContent = oracleKeepAlive.toFixed(4) + " (keep-alive)";
    eventFundingEl.style.display = "none";

    const fundingRate = markPrice - oracleKeepAlive;
    const capped = Math.min(fundingRate, fMax);
    document.getElementById("fundingRate").textContent =
      (capped * 10000).toFixed(2) + " bps/hr" + (fundingRate > fMax ? " (capped at f_max)" : "");
    document.getElementById("fundingDirection").textContent = "Longs → Shorts (premium)";
    document.getElementById("fundingDirection").style.color = "#58a6ff";

    const poolPremium = s.V_pool * capped;
    document.getElementById("poolPremiumHr").textContent = fmt(poolPremium) + " HYPE";

    refreshFundingTable(capped, false);
  } else {
    stateEl.textContent = "EVENT";
    stateEl.className = "badge badge-event";

    const oracle = s.oracleValue6 / 1e6;
    priceEl.textContent = oracle.toFixed(6);

    document.getElementById("fundingRate").textContent =
      (-fMax * 10000).toFixed(2) + " bps/hr (at -f_max)";
    document.getElementById("fundingDirection").textContent = "Shorts → Longs (payout)";
    document.getElementById("fundingDirection").style.color = "#f85149";

    const perInterval = s.V_snap * fMax;
    document.getElementById("poolPremiumHr").textContent =
      fmt(perInterval) + " HYPE/hr (from LPs)";

    const nStar = Math.ceil(oracle / fMax);
    const totalFromLPs = perInterval * nStar;
    const excess = totalFromLPs - s.pendingPayout;

    eventFundingEl.style.display = "block";
    document.getElementById("oracleNStar").textContent = nStar;
    document.getElementById("payoutTime").textContent = nStar + " hours";
    document.getElementById("totalFromLPs").textContent = fmt(totalFromLPs) + " HYPE";
    document.getElementById("ceilingExcess").textContent = fmt(excess) + " HYPE (buffer)";

    const pct = Math.min(100, (totalFromLPs / Math.max(s.pendingPayout, 0.0001)) * 100);
    document.getElementById("fundingProgress").style.width = pct + "%";
    document.getElementById("fundingLabel").textContent =
      `${fmt(perInterval)}/hr x ${nStar}hr = ${fmt(totalFromLPs)} HYPE → pays ${fmt(s.pendingPayout)} HYPE`;

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
    const premium = ins.V * rate;
    const w = Math.round(engine.premiumWeight(addr));

    rows.push(`<tr>
      <td class="mono">${addr}</td>
      <td>${fmt(ins.V)}</td>
      <td style="color:${isEvent ? '#f85149' : '#3fb950'}">${isEvent ? '+' : '-'}${fmt(premium)} HYPE/hr</td>
      <td>${w} bps</td>
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
    logMsg(`Registered ${addr} | V=${V} HYPE | pi=${pi} bps`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Register failed: " + e.message, "error");
  }
}

function doDeregister() {
  const addr = document.getElementById("deregAddr").value.trim();
  if (!addr) return logMsg("Enter name to deregister", "error");

  try {
    engine.deregister(addr);
    logMsg(`Deregistered ${addr}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Deregister failed: " + e.message, "error");
  }
}

function doTriggerEvent() {
  const addr = document.getElementById("evtAddr").value.trim();
  const lambda = parseInt(document.getElementById("evtLambda").value);
  if (!addr || !lambda) return logMsg("Fill event fields", "error");

  try {
    const result = engine.triggerEvent(addr, lambda);
    const oracle = (result.oracleValue6 / 1e6).toFixed(6);
    logMsg(`SLASH EVENT: ${addr} | lambda=${lambda}bps | O(T*)=${oracle} | payout=${fmt(result.pendingPayout)} HYPE`, "success");
    refreshAll();
  } catch (e) {
    logMsg("TriggerEvent failed: " + e.message, "error");
  }
}

function doRoutePayout() {
  try {
    const result = engine.routePayout();
    logMsg(`Payout routed: ${fmt(result.amount)} HYPE to ${result.target}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("RoutePayout failed: " + e.message, "error");
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

function fmt(n) {
  return Number(n).toFixed(4);
}

// ── Start ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
