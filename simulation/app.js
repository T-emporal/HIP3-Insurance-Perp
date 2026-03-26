/* HIP3 Apportionment Layer Simulator — Frontend */

let provider, signer, contract, contractAddr, abi, deployInfo;
let pollInterval = null;
const F_MAX_DEFAULT_BPS = 10; // 0.1%

// ── Initialization ──────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch("abi.json");
    abi = await res.json();
  } catch {
    logMsg("ABI not found. Run: cd apportionment-layer && npx hardhat compile", "error");
    return;
  }

  try {
    const res = await fetch("deploy-info.json");
    deployInfo = await res.json();
    if (deployInfo.proxy) {
      document.getElementById("contractAddr").value = deployInfo.proxy;
    }
    // Show seed data hints
    if (deployInfo.seedData) {
      const hints = deployInfo.seedData.insureds.map(i =>
        `${i.label}: ${i.address}`
      ).join("\n");
      document.getElementById("seedHints").textContent = hints;
      document.getElementById("seedPanel").style.display = "block";
    }
  } catch {
    // No deploy info
  }

  // Wire up buttons
  document.getElementById("connectBtn").addEventListener("click", connect);
  document.getElementById("registerBtn").addEventListener("click", doRegister);
  document.getElementById("deregisterBtn").addEventListener("click", doDeregister);
  document.getElementById("triggerBtn").addEventListener("click", doTriggerEvent);
  document.getElementById("routePayoutBtn").addEventListener("click", doRoutePayout);

  // Auto-connect if deploy-info exists
  if (deployInfo && deployInfo.proxy) {
    connect();
  }
}

// ── Connection ──────────────────────────────────────────────────────────

async function connect() {
  const rpcUrl = document.getElementById("rpcUrl").value.trim();
  contractAddr = document.getElementById("contractAddr").value.trim();

  if (!rpcUrl || !contractAddr) {
    setStatus("Please enter RPC URL and contract address", "error");
    return;
  }

  try {
    provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const block = await provider.getBlockNumber();

    // Use first account as signer (Hardhat local = owner)
    try {
      signer = await provider.getSigner(0);
    } catch {
      signer = null;
      logMsg("Read-only mode (no signer available)", "info");
    }

    contract = new ethers.Contract(contractAddr, abi, signer || provider);

    // Verify contract exists
    const owner = await contract.owner();

    document.getElementById("networkName").textContent =
      network.name === "unknown" ? "localhost" : network.name;
    document.getElementById("chainId").textContent = network.chainId.toString();
    document.getElementById("blockNum").textContent = block;
    document.getElementById("ownerAddr").textContent = owner;
    document.getElementById("connInfo").style.display = "grid";
    setStatus("Connected", "connected");
    logMsg(`Connected to ${rpcUrl} | contract ${contractAddr.slice(0,10)}...`, "success");

    if (pollInterval) clearInterval(pollInterval);
    refreshAll();
    pollInterval = setInterval(refreshAll, 3000);
  } catch (e) {
    setStatus("Connection failed: " + e.message, "error");
    logMsg("Connection error: " + e.message, "error");
  }
}

function setStatus(msg, cls) {
  const el = document.getElementById("connStatus");
  el.textContent = msg;
  el.className = "status " + (cls || "");
}

// ── Refresh ─────────────────────────────────────────────────────────────

async function refreshAll() {
  if (!contract) return;
  try {
    const [vPool, piPool, count, bal, evtActive, block] = await Promise.all([
      contract.V_pool(),
      contract.piPoolWeighted(),
      contract.insuredCount(),
      contract.balance(),
      contract.eventActive(),
      provider.getBlockNumber(),
    ]);

    document.getElementById("vPool").textContent = fmtEth(vPool) + " HYPE";
    document.getElementById("piPool").textContent = piPool.toString() + " bps";
    document.getElementById("insuredCount").textContent = count.toString();
    document.getElementById("contractBal").textContent = fmtEth(bal) + " HYPE";
    document.getElementById("blockNum").textContent = block;

    document.getElementById("eventActiveFlag").textContent = evtActive ? "YES" : "No";
    document.getElementById("eventActiveFlag").style.color = evtActive ? "#f85149" : "#3fb950";

    await refreshInsuredTable(count);
    await refreshEventInfo(evtActive);
    await refreshOracle(evtActive);
  } catch (e) {
    console.error("Refresh error:", e);
  }
}

async function refreshInsuredTable(count) {
  const tbody = document.getElementById("insuredBody");
  const rows = [];
  const labels = {};
  if (deployInfo?.seedData?.insureds) {
    deployInfo.seedData.insureds.forEach(i => { labels[i.address.toLowerCase()] = i.label; });
  }

  for (let i = 0; i < Number(count); i++) {
    try {
      const addr = await contract.insuredList(i);
      const ins = await contract.getInsured(addr);
      let weight = "0";
      try { weight = (await contract.premiumWeight(addr)).toString(); } catch {}
      const label = labels[addr.toLowerCase()] || "";

      rows.push(`<tr>
        <td class="mono" title="${addr}">${label ? '<span class="tag">' + label + '</span> ' : ''}${addr.slice(0,8)}...${addr.slice(-6)}</td>
        <td>${fmtEth(ins.V)}</td>
        <td>${ins.pi.toString()}</td>
        <td>${weight}</td>
        <td style="color:${ins.active ? '#3fb950' : '#f85149'}">${ins.active ? 'Yes' : 'No'}</td>
      </tr>`);
    } catch {}
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="5" style="text-align:center;color:#8b949e">No insureds registered</td></tr>';
}

async function refreshEventInfo(isEvent) {
  const el = document.getElementById("eventInfo");
  if (!isEvent) {
    el.style.display = "none";
    return;
  }
  el.style.display = "grid";

  const [insured, lambda, vSnap, oracle, payout] = await Promise.all([
    contract.eventInsured(),
    contract.eventLambdaBps(),
    contract.V_snap(),
    contract.oracleValue6(),
    contract.pendingPayout(),
  ]);

  document.getElementById("evtInsured").textContent = insured;
  document.getElementById("evtLambdaVal").textContent = lambda.toString();
  document.getElementById("evtVSnap").textContent = fmtEth(vSnap) + " HYPE";
  document.getElementById("evtOracle").textContent = (Number(oracle) / 1e6).toFixed(6);
  document.getElementById("evtPayout").textContent = fmtEth(payout) + " HYPE";
}

async function refreshOracle(isEvent) {
  const stateEl = document.getElementById("oracleState");
  const priceEl = document.getElementById("oraclePrice");
  const eventFundingEl = document.getElementById("eventFundingInfo");
  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const markPrice = parseFloat(document.getElementById("markPriceInput").value) || 0;

  if (!isEvent) {
    // ── NORMAL STATE: longs pay shorts, premium collection ──
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    const oracleKeepAlive = 0.0001;
    priceEl.textContent = oracleKeepAlive.toFixed(4) + " (keep-alive)";
    eventFundingEl.style.display = "none";

    // f(t) = (P(t) - O(t)) / Δt — but since Δt=1hr and rates are per-interval:
    // Effective: f = P(t) - O(t) ≈ P(t) when O≈0
    // Premium per hour per unit notional = P(t)
    const fundingRate = markPrice - oracleKeepAlive;
    const capped = Math.min(fundingRate, fMax);
    document.getElementById("fundingRate").textContent =
      (capped * 10000).toFixed(2) + " bps/hr" + (fundingRate > fMax ? " (capped at f_max)" : "");
    document.getElementById("fundingDirection").textContent = "Longs → Shorts (premium)";
    document.getElementById("fundingDirection").style.color = "#58a6ff";

    // Pool premium per hour = V_pool * P(t)
    const vPool = Number(ethers.formatEther(await contract.V_pool()));
    const poolPremium = vPool * capped;
    document.getElementById("poolPremiumHr").textContent = poolPremium.toFixed(4) + " HYPE";

    // Per-insured breakdown
    await refreshFundingTable(capped, false);
  } else {
    // ── EVENT STATE: shorts pay longs at f_max ──
    stateEl.textContent = "EVENT";
    stateEl.className = "badge badge-event";

    const oracle = Number(await contract.oracleValue6()) / 1e6;
    priceEl.textContent = oracle.toFixed(6);

    // During event: f(t) = (P(t) - O(T*)) / Δt → negative (since O >> P)
    // Capped at -f_max, so shorts pay longs f_max per interval
    const fundingRate = -fMax;
    document.getElementById("fundingRate").textContent =
      (fundingRate * 10000).toFixed(2) + " bps/hr (at -f_max)";
    document.getElementById("fundingDirection").textContent = "Shorts → Longs (payout)";
    document.getElementById("fundingDirection").style.color = "#f85149";

    const vSnap = Number(ethers.formatEther(await contract.V_snap()));
    const perInterval = vSnap * fMax;
    document.getElementById("poolPremiumHr").textContent =
      perInterval.toFixed(4) + " HYPE/hr (from LPs)";

    // N* and payout timing
    const nStar = Math.ceil(oracle / fMax);
    const payout = Number(ethers.formatEther(await contract.pendingPayout()));
    const totalFromLPs = perInterval * nStar;
    const excess = totalFromLPs - payout;

    eventFundingEl.style.display = "block";
    document.getElementById("oracleNStar").textContent = nStar;
    document.getElementById("payoutTime").textContent = nStar + " hours";
    document.getElementById("totalFromLPs").textContent = totalFromLPs.toFixed(4) + " HYPE";
    document.getElementById("ceilingExcess").textContent = excess.toFixed(4) + " HYPE (buffer)";

    const pct = Math.min(100, (totalFromLPs / Math.max(payout, 0.0001)) * 100);
    document.getElementById("fundingProgress").style.width = pct + "%";
    document.getElementById("fundingLabel").textContent =
      `${perInterval.toFixed(4)}/hr x ${nStar}hr = ${totalFromLPs.toFixed(4)} HYPE → pays ${payout.toFixed(4)} HYPE`;

    await refreshFundingTable(fMax, true);
  }
}

async function refreshFundingTable(rate, isEvent) {
  const tbody = document.getElementById("fundingBody");
  const count = Number(await contract.insuredCount());
  const rows = [];
  const labels = {};
  if (deployInfo?.seedData?.insureds) {
    deployInfo.seedData.insureds.forEach(i => { labels[i.address.toLowerCase()] = i.label; });
  }

  for (let i = 0; i < count; i++) {
    try {
      const addr = await contract.insuredList(i);
      const ins = await contract.getInsured(addr);
      if (!ins.active) continue;
      const v = Number(ethers.formatEther(ins.V));
      const premium = v * rate;
      let weight = "0";
      try { weight = (await contract.premiumWeight(addr)).toString(); } catch {}
      const label = labels[addr.toLowerCase()] || shortAddr(addr);

      rows.push(`<tr>
        <td class="mono">${label}</td>
        <td>${v.toFixed(1)}</td>
        <td style="color:${isEvent ? '#f85149' : '#3fb950'}">${isEvent ? '+' : '-'}${premium.toFixed(4)} HYPE/hr</td>
        <td>${weight} bps</td>
      </tr>`);
    } catch {}
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="4" style="text-align:center;color:#8b949e">No active insureds</td></tr>';
}

// ── Actions ─────────────────────────────────────────────────────────────

async function doRegister() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("regAddr").value.trim();
  const vHype = document.getElementById("regV").value.trim();
  const pi = document.getElementById("regPi").value.trim();

  if (!addr || !vHype || !pi) return logMsg("Fill all registration fields", "error");

  try {
    const tx = await contract.register(addr, ethers.parseEther(vHype), BigInt(pi));
    logMsg(`Register tx sent...`, "info");
    await tx.wait();
    logMsg(`Registered ${shortAddr(addr)} | V=${vHype} HYPE | pi=${pi} bps`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Register failed: " + parseError(e), "error");
  }
}

async function doDeregister() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("deregAddr").value.trim();
  if (!addr) return logMsg("Enter address to deregister", "error");

  try {
    const tx = await contract.deregister(addr);
    await tx.wait();
    logMsg(`Deregistered ${shortAddr(addr)}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Deregister failed: " + parseError(e), "error");
  }
}

async function doTriggerEvent() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("evtAddr").value.trim();
  const lambda = document.getElementById("evtLambda").value.trim();
  if (!addr || !lambda) return logMsg("Fill event fields", "error");

  try {
    const tx = await contract.triggerEvent(addr, BigInt(lambda));
    await tx.wait();

    // Read computed values
    const oracle = Number(await contract.oracleValue6()) / 1e6;
    const payout = ethers.formatEther(await contract.pendingPayout());
    logMsg(`SLASH EVENT: ${shortAddr(addr)} | lambda=${lambda}bps | O(T*)=${oracle.toFixed(6)} | payout=${payout} HYPE`, "success");
    refreshAll();
  } catch (e) {
    logMsg("TriggerEvent failed: " + parseError(e), "error");
  }
}

async function doRoutePayout() {
  if (!signer) return logMsg("No signer — read-only mode", "error");

  try {
    const target = await contract.eventInsured();
    const amount = ethers.formatEther(await contract.pendingPayout());
    const tx = await contract.routePayout();
    await tx.wait();
    logMsg(`Payout routed: ${amount} HYPE to ${shortAddr(target)}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("RoutePayout failed: " + parseError(e), "error");
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

function parseError(e) {
  if (e.reason) return e.reason;
  if (e.data?.message) return e.data.message;
  const match = e.message?.match(/reason="([^"]+)"/);
  if (match) return match[1];
  if (e.info?.error?.message) return e.info.error.message;
  return e.message || String(e);
}

function shortAddr(addr) {
  return addr.slice(0, 8) + "..." + addr.slice(-6);
}

function fmtEth(wei) {
  return parseFloat(ethers.formatEther(wei)).toFixed(4);
}

// ── Start ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
