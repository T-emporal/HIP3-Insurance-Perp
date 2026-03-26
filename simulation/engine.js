/**
 * ApportionmentLayer — Pure JS Engine
 *
 * Replicates the Solidity contract logic entirely in-browser.
 * Same formulas, same validation, same state transitions.
 * No blockchain, no ethers.js, no dependencies.
 */

const engine = (() => {
  // ── State ───────────────────────────────────────────────────────────

  const state = {
    insureds: new Map(),     // addr → { V, pi, active }
    insuredList: [],          // ordered list of addresses
    V_pool: 0,               // Σ V_i (active only)
    piV_pool: 0,             // Σ π_i * V_i
    eventActive: false,
    eventInsured: null,
    eventLambdaBps: 0,
    V_snap: 0,
    oracleValue6: 0,         // O(T*) * 1e6
    pendingPayout: 0,
    balance: 0,              // simulated contract balance (for payouts)
  };

  // ── Registry ────────────────────────────────────────────────────────

  function register(addr, V, pi) {
    if (!addr) throw new Error("AL: zero address");
    if (state.insureds.has(addr) && state.insureds.get(addr).active)
      throw new Error("AL: already registered");
    if (V <= 0) throw new Error("AL: V must be > 0");
    if (pi <= 0 || pi > 10000) throw new Error("AL: pi must be (0, 10000]");

    state.insureds.set(addr, { V, pi, active: true });
    if (!state.insuredList.includes(addr)) state.insuredList.push(addr);

    state.V_pool += V;
    state.piV_pool += pi * V;

    return { addr, V, pi };
  }

  function deregister(addr) {
    const ins = state.insureds.get(addr);
    if (!ins || !ins.active) throw new Error("AL: not registered");
    if (state.eventActive && state.eventInsured === addr)
      throw new Error("AL: cannot deregister active event insured");

    state.V_pool -= ins.V;
    state.piV_pool -= ins.pi * ins.V;
    ins.active = false;

    return { addr };
  }

  // ── Event ───────────────────────────────────────────────────────────

  function triggerEvent(addr, lambdaBps) {
    if (state.eventActive) throw new Error("AL: event active");
    const ins = state.insureds.get(addr);
    if (!ins || !ins.active) throw new Error("AL: not registered");
    if (lambdaBps <= 0 || lambdaBps > 10000) throw new Error("AL: lambda out of range");
    if (state.V_pool <= 0) throw new Error("AL: empty pool");

    state.eventActive = true;
    state.eventInsured = addr;
    state.eventLambdaBps = lambdaBps;
    state.V_snap = state.V_pool;

    // O(T*) * 1e6 = V_i * λ_i * 100 / V_snap
    state.oracleValue6 = (ins.V * lambdaBps * 100) / state.V_snap;

    // Payout = V_i * λ_i / 10000
    state.pendingPayout = (ins.V * lambdaBps) / 10000;

    return {
      insured: addr,
      lambdaBps,
      V_snap: state.V_snap,
      oracleValue6: state.oracleValue6,
      pendingPayout: state.pendingPayout,
    };
  }

  function routePayout() {
    if (!state.eventActive) throw new Error("AL: no active event");
    if (state.balance < state.pendingPayout) throw new Error("AL: insufficient balance");

    const target = state.eventInsured;
    const amount = state.pendingPayout;

    state.balance -= amount;
    state.eventActive = false;
    state.eventInsured = null;
    state.eventLambdaBps = 0;
    state.oracleValue6 = 0;
    state.pendingPayout = 0;

    return { target, amount };
  }

  // ── Views ───────────────────────────────────────────────────────────

  function currentOracleValue() {
    return state.eventActive ? state.oracleValue6 : 0;
  }

  function premiumWeight(addr) {
    if (state.piV_pool === 0) return 0;
    const ins = state.insureds.get(addr);
    if (!ins || !ins.active) return 0;
    return (ins.V * ins.pi * 10000) / state.piV_pool;
  }

  function piPoolWeighted() {
    if (state.V_pool === 0) return 0;
    return state.piV_pool / state.V_pool;
  }

  // ── Seed ────────────────────────────────────────────────────────────

  function seed() {
    const validators = [
      { addr: "LowRisk-Validator",  V: 100, pi: 300,  label: "LowRisk-Validator" },
      { addr: "MidRisk-Validator",  V: 250, pi: 750,  label: "MidRisk-Validator" },
      { addr: "HighRisk-Validator", V: 50,  pi: 1500, label: "HighRisk-Validator" },
    ];

    for (const v of validators) {
      register(v.addr, v.V, v.pi);
    }

    // Simulated balance (LP funding inflows available for payouts)
    state.balance = 500;

    return validators;
  }

  // ── Public API ──────────────────────────────────────────────────────

  return {
    state,
    register,
    deregister,
    triggerEvent,
    routePayout,
    currentOracleValue,
    premiumWeight,
    piPoolWeighted,
    seed,
  };
})();
