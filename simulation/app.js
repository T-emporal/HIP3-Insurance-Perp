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
  document.getElementById("payPremiumBtn").addEventListener("click", doPayPremium);
  document.getElementById("withdrawBtn").addEventListener("click", doWithdraw);
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
        <td>${fmtEth(ins.premiumPaid)}</td>
        <td>${weight}</td>
        <td style="color:${ins.active ? '#3fb950' : '#f85149'}">${ins.active ? 'Yes' : 'No'}</td>
      </tr>`);
    } catch {}
  }

  tbody.innerHTML = rows.length ? rows.join("") :
    '<tr><td colspan="6" style="text-align:center;color:#8b949e">No insureds registered</td></tr>';
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
  const nStarEl = document.getElementById("oracleNStar");
  const fundingBar = document.getElementById("oracleFundingBar");

  if (!isEvent) {
    stateEl.textContent = "NORMAL";
    stateEl.className = "badge badge-normal";
    priceEl.textContent = "0.0001 (keep-alive)";
    nStarEl.textContent = "-";
    fundingBar.style.display = "none";
    return;
  }

  stateEl.textContent = "EVENT";
  stateEl.className = "badge badge-event";

  const oracle = Number(await contract.oracleValue6());
  const oracleDecimal = oracle / 1e6;
  priceEl.textContent = oracleDecimal.toFixed(6);

  const fMaxBps = parseInt(document.getElementById("fMaxInput").value) || F_MAX_DEFAULT_BPS;
  const fMax = fMaxBps / 10000;
  const nStar = Math.ceil(oracleDecimal / fMax);
  nStarEl.textContent = nStar.toString();

  fundingBar.style.display = "block";
  const vSnap = Number(ethers.formatEther(await contract.V_snap()));
  const payout = Number(ethers.formatEther(await contract.pendingPayout()));
  const perInterval = vSnap * fMax;
  const totalFunding = perInterval * nStar;
  const pct = Math.min(100, (totalFunding / payout) * 100);
  document.getElementById("fundingProgress").style.width = pct + "%";
  document.getElementById("fundingLabel").textContent =
    `${perInterval.toFixed(4)} HYPE/interval x ${nStar} = ${totalFunding.toFixed(4)} HYPE (need ${payout.toFixed(4)}) | ceiling excess: ${(totalFunding - payout).toFixed(4)}`;
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

async function doPayPremium() {
  if (!signer) return logMsg("No signer — read-only mode", "error");
  const addr = document.getElementById("premAddr").value.trim();
  const amount = document.getElementById("premAmount").value.trim();
  if (!addr || !amount) return logMsg("Fill premium fields", "error");

  try {
    // Impersonate the insured address (Hardhat local only)
    const impersonated = await provider.getSigner(addr);
    const c = contract.connect(impersonated);
    const tx = await c.payPremium({ value: ethers.parseEther(amount) });
    await tx.wait();
    logMsg(`Premium paid: ${amount} HYPE from ${shortAddr(addr)}`, "success");
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
    await tx.wait();
    logMsg(`Withdrawn ${amount} HYPE to owner`, "success");
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
