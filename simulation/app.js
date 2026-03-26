/* HIP3 Apportionment Layer Simulator — Frontend */

let provider, signer, contract, contractAddr, abi;
let pollInterval = null;
const F_MAX_DEFAULT_BPS = 10; // 0.1%

// ── Initialization ──────────────────────────────────────────────────────

async function init() {
  // Try to load ABI
  try {
    const res = await fetch("abi.json");
    abi = await res.json();
  } catch {
    logMsg("ABI not found. Compile contracts first.", "error");
    return;
  }

  // Try to load deploy-info.json for auto-fill
  try {
    const res = await fetch("deploy-info.json");
    const info = await res.json();
    if (info.proxy) document.getElementById("contractAddr").value = info.proxy;
  } catch {
    // No deploy info — user will enter manually
  }

  // Wire up buttons
  document.getElementById("connectBtn").addEventListener("click", connect);
  document.getElementById("registerBtn").addEventListener("click", doRegister);
  document.getElementById("deregisterBtn").addEventListener("click", doDeregister);
  document.getElementById("payPremiumBtn").addEventListener("click", doPayPremium);
  document.getElementById("withdrawBtn").addEventListener("click", doWithdraw);
  document.getElementById("triggerBtn").addEventListener("click", doTriggerEvent);
  document.getElementById("routePayoutBtn").addEventListener("click", doRoutePayout);
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

    // Use first account as signer (Hardhat local)
    try {
      signer = await provider.getSigner(0);
    } catch {
      // If no signer available (testnet without wallet), use provider read-only
      signer = null;
      logMsg("Read-only mode (no signer available)", "info");
    }

    contract = new ethers.Contract(contractAddr, abi, signer || provider);

    document.getElementById("networkName").textContent =
      network.name === "unknown" ? "localhost" : network.name;
    document.getElementById("chainId").textContent = network.chainId.toString();
    document.getElementById("blockNum").textContent = block;
    document.getElementById("ownerAddr").textContent = await contract.owner();
    document.getElementById("connInfo").style.display = "grid";
    setStatus("Connected", "connected");
    logMsg(`Connected to ${rpcUrl} (chain ${network.chainId})`, "success");

    // Start polling
    if (pollInterval) clearInterval(pollInterval);
    refreshAll();
    pollInterval = setInterval(refreshAll, 5000);
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
    const [vPool, piPool, count, bal, eventActive, block] = await Promise.all([
      contract.V_pool(),
      contract.piPoolWeighted(),
      contract.insuredCount(),
      contract.balance(),
      contract.eventActive(),
      provider.getBlockNumber(),
    ]);

    document.getElementById("vPool").textContent = ethers.formatEther(vPool) + " HYPE";
    document.getElementById("piPool").textContent = piPool.toString() + " bps";
    document.getElementById("insuredCount").textContent = count.toString();
    document.getElementById("contractBal").textContent = ethers.formatEther(bal) + " HYPE";
    document.getElementById("blockNum").textContent = block;

    const isEvent = eventActive;
    document.getElementById("eventActiveFlag").textContent = isEvent ? "YES" : "No";
    document.getElementById("eventActiveFlag").style.color = isEvent ? "#f85149" : "#3fb950";

    // Refresh insured table
    await refreshInsuredTable(count);

    // Refresh event info
    await refreshEventInfo(isEvent);

    // Refresh oracle mock
    await refreshOracle(isEvent);
  } catch (e) {
    console.error("Refresh error:", e);
  }
}

async function refreshInsuredTable(count) {
  const tbody = document.getElementById("insuredBody");
  const rows = [];

  for (let i = 0; i < Number(count); i++) {
    try {
      const addr = await contract.insuredList(i);
      const ins = await contract.getInsured(addr);
      let weight = "0";
      try { weight = (await contract.premiumWeight(addr)).toString(); } catch {}

      rows.push(`<tr>
        <td class="mono">${addr.slice(0,8)}...${addr.slice(-6)}</td>
        <td>${ethers.formatEther(ins.V)}</td>
        <td>${ins.pi.toString()}</td>
        <td>${ethers.formatEther(ins.premiumPaid)}</td>
        <td>${weight}</td>
        <td style="color:${ins.active ? '#3fb950' : '#f85149'}">${ins.active ? 'Yes' : 'No'}</td>
      </tr>`);
    } catch {}
  }

  tbody.innerHTML = rows.length ? rows.join("") : '<tr><td colspan="6" style="text-align:center;color:#8b949e">No insureds registered</td></tr>';
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
  document.getElementById("evtVSnap").textContent = ethers.formatEther(vSnap) + " HYPE";
  document.getElementById("evtOracle").textContent = (Number(oracle) / 1e6).toFixed(6);
  document.getElementById("evtPayout").textContent = ethers.formatEther(payout) + " HYPE";
}

async function refreshOracle(isEvent) {
  const stateEl = document.getElementById("oracleState");
  const priceEl = document.getElementById("oraclePrice");
  const nStarEl = document.getElementById("oracleNStar");
  const fundingBar = document.getElementById("oracleFundingBar");

  if (!isEvent) {
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    priceEl.textContent = "0.0001";
    nStarEl.textContent = "-";
    fundingBar.style.display = "none";
    return;
  }

  stateEl.textContent = "EVENT";
  stateEl.className = "badge badge-event";

  const oracle = Number(await contract.oracleValue6());
  const oracleDecimal = oracle / 1e6;
  priceEl.textContent = oracleDecimal.toFixed(6);

  // Calculate N*
  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const nStar = Math.ceil(oracleDecimal / fMax);
  nStarEl.textContent = nStar.toString();

  // Show funding progress
  fundingBar.style.display = "block";
  const vSnap = Number(ethers.formatEther(await contract.V_snap()));
  const payout = Number(ethers.formatEther(await contract.pendingPayout()));
  const perInterval = vSnap * fMax;
  document.getElementById("fundingLabel").textContent =
    `${perInterval.toFixed(4)} HYPE/interval x ${nStar} intervals = ${(perInterval * nStar).toFixed(4)} HYPE (need ${payout.toFixed(4)})`;
  document.getElementById("fundingProgress").style.width = "0%";
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
    logMsg(`Register tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg(`Registered ${addr} | V=${vHype} HYPE | pi=${pi} bps`, "success");
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
    logMsg(`Deregister tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg(`Deregistered ${addr}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Deregister failed: " + parseError(e), "error");
  }
}

async function doPayPremium() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("premAddr").value.trim();
  const amount = document.getElementById("premAmount").value.trim();
  if (!addr || !amount) return logMsg("Fill premium fields", "error");

  try {
    // Need to pay from the insured's address — on Hardhat local we can impersonate
    const impersonated = await provider.getSigner(addr);
    const c = contract.connect(impersonated);
    const tx = await c.payPremium({ value: ethers.parseEther(amount) });
    logMsg(`Premium tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg(`Premium paid: ${amount} HYPE from ${addr}`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Premium failed: " + parseError(e), "error");
  }
}

async function doWithdraw() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const amount = document.getElementById("withdrawAmount").value.trim();
  if (!amount) return logMsg("Enter withdraw amount", "error");

  try {
    const tx = await contract.withdrawPremiums(ethers.parseEther(amount));
    logMsg(`Withdraw tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg(`Withdrawn ${amount} HYPE`, "success");
    refreshAll();
  } catch (e) {
    logMsg("Withdraw failed: " + parseError(e), "error");
  }
}

async function doTriggerEvent() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("evtAddr").value.trim();
  const lambda = document.getElementById("evtLambda").value.trim();
  if (!addr || !lambda) return logMsg("Fill event fields", "error");

  try {
    const tx = await contract.triggerEvent(addr, BigInt(lambda));
    logMsg(`TriggerEvent tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg(`Event triggered for ${addr} | lambda=${lambda} bps`, "success");
    refreshAll();
  } catch (e) {
    logMsg("TriggerEvent failed: " + parseError(e), "error");
  }
}

async function doRoutePayout() {
  if (!signer) return logMsg("No signer — read-only mode", "error");

  try {
    const tx = await contract.routePayout();
    logMsg(`RoutePayout tx: ${tx.hash}`, "info");
    await tx.wait();
    logMsg("Payout routed successfully", "success");
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
  // Keep max 100 entries
  while (el.children.length > 100) el.removeChild(el.lastChild);
}

function parseError(e) {
  if (e.reason) return e.reason;
  if (e.data?.message) return e.data.message;
  const match = e.message?.match(/reason="([^"]+)"/);
  if (match) return match[1];
  // Try to extract revert reason from error data
  if (e.info?.error?.message) return e.info.error.message;
  return e.message || String(e);
}

// ── Start ───────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
