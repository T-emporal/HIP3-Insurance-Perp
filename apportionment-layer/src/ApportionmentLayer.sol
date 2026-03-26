// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  ApportionmentLayer
 * @notice Generic primary-insurance registry and payout router for the
 *         two-layer perpetual insurance framework described in
 *         "Perpetual Contracts as a General Insurance Mechanism".
 *
 * @dev    This contract is the singleton counterparty of the SLASH-HIP3
 *         reinsurance perpetual on HyperCore. It:
 *           1. Maintains a registry of insured entities (V_i, π_i).
 *           2. Tracks premium deposits, weighted by each insured's
 *              risk-adjusted share of the pool (V_i * π_i / Σ V_j * π_j).
 *           3. On an event, freezes V_snap, computes O(T*) = V_i * λ_i / V_snap,
 *              and exposes it as oracleValue6 (scaled to 1e6).
 *           4. oracle_pusher.py reads oracleValue6 via eth_call and pushes it
 *              to HyperCore setOracle — there is no on-chain precompile write
 *              for perpDeploy actions at this time.
 *           5. After N* funding intervals complete, owner calls routePayout()
 *              to transfer V_i * λ_i HYPE to the slashed insured.
 *
 * Units
 * ─────
 *   V_i          : wei (HYPE, 18 decimals)
 *   π_i          : basis points (1 bps = 0.01%, 10_000 bps = 100%)
 *   λ_i          : basis points
 *   oracleValue6 : integer, divide by 1e6 to get the decimal fraction
 *                  e.g. 120_000 → 0.120000 → push "0.12" to HyperCore
 *
 * Singleton constraint (Theorem 8.9)
 * ───────────────────────────────────
 *   Only one instance of this contract may interact with the reinsurance
 *   perpetual. If two instances each calibrate using their own partial
 *   V_snap, the combined payout would be 2 * V_i * λ_i ≠ V_i * λ_i.
 */
contract ApportionmentLayer {

    // ── Structs ───────────────────────────────────────────────────────────

    struct Insured {
        uint256 V;            // coverage notional in wei (fixed at registration)
        uint256 pi;           // risk parameter in bps
        uint256 premiumPaid;  // cumulative premium deposited in wei
        bool    active;
    }

    // ── Storage ───────────────────────────────────────────────────────────

    address public owner;

    // Registry
    mapping(address => Insured) public registry;
    address[]                   public insuredList;

    // Pool aggregates
    uint256 public V_pool;       // Σ V_i  (active insureds only)
    uint256 public piV_pool;     // Σ π_i * V_i  (numerator for capital-weighted π)

    // Event state
    bool    public eventActive;
    address public eventInsured;
    uint256 public eventLambdaBps;  // λ_i supplied by owner at event time
    uint256 public V_snap;          // pool total frozen at event trigger (Definition 3.4)
    uint256 public oracleValue6;    // O(T*) = V_i * λ_i / V_snap, scaled * 1e6
    uint256 public pendingPayout;   // V_i * λ_i in wei

    // ── Events ────────────────────────────────────────────────────────────

    event Registered(address indexed insured, uint256 V, uint256 pi);
    event Deregistered(address indexed insured);
    event PremiumPaid(address indexed insured, uint256 amount);
    event EventTriggered(
        address indexed insured,
        uint256 lambdaBps,
        uint256 V_snap,
        uint256 oracleValue6,
        uint256 pendingPayout
    );
    event PayoutRouted(address indexed insured, uint256 amount);
    event EventCleared();
    event PremiumsWithdrawn(uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "AL: not owner");
        _;
    }

    modifier noActiveEvent() {
        require(!eventActive, "AL: event active");
        _;
    }

    // ── Registry management ───────────────────────────────────────────────

    /**
     * @notice Register a new insured entity.
     * @param  _insured  Address of the entity being insured.
     * @param  _V        Coverage notional in wei (V_i). Fixed at registration.
     * @param  _pi       Risk parameter in basis points (π_i). 50 = 0.5%.
     *
     * @dev    π_i is certified by an independent auditor off-chain (§10.2).
     *         Systematic miscertification drives adverse selection; see §10.2.
     */
    function register(address _insured, uint256 _V, uint256 _pi)
        external
        onlyOwner
    {
        require(_insured != address(0),         "AL: zero address");
        require(!registry[_insured].active,     "AL: already registered");
        require(_V  > 0,                        "AL: V must be > 0");
        require(_pi > 0 && _pi <= 10_000,       "AL: pi must be (0, 10000]");

        registry[_insured] = Insured({
            V:           _V,
            pi:          _pi,
            premiumPaid: 0,
            active:      true
        });
        insuredList.push(_insured);

        V_pool   += _V;
        piV_pool += _pi * _V;

        emit Registered(_insured, _V, _pi);
    }

    /**
     * @notice Deregister an insured entity. Cannot deregister the active event insured.
     */
    function deregister(address _insured)
        external
        onlyOwner
    {
        require(registry[_insured].active, "AL: not registered");
        require(
            !eventActive || eventInsured != _insured,
            "AL: cannot deregister active event insured"
        );

        Insured storage ins = registry[_insured];
        V_pool   -= ins.V;
        piV_pool -= ins.pi * ins.V;
        ins.active = false;

        emit Deregistered(_insured);
    }

    // ── Premium collection ────────────────────────────────────────────────

    /**
     * @notice Deposit a premium payment. msg.value is the premium amount in wei.
     *
     * @dev    The correct premium amount for interval [t, t+Δt] is:
     *           dΠ_i = V_i * P(t) * Δt
     *         where P(t) is the current mark price on the reinsurance perpetual.
     *         The contract does not enforce the exact amount; it accepts any
     *         positive deposit and tracks the cumulative total. Coverage validity
     *         (Definition 5.2) is enforced separately via margin requirements on
     *         the long position held by this contract on the perpetual.
     *
     *         The relative premium burden of insured i is:
     *           weight_i = V_i * π_i / Σ_j(V_j * π_j)
     *         available via premiumWeight(). This is the risk-adjusted share
     *         of aggregate pool premium that i should bear.
     */
    function payPremium() external payable {
        require(registry[msg.sender].active, "AL: not registered");
        require(msg.value > 0,               "AL: zero premium");

        registry[msg.sender].premiumPaid += msg.value;
        emit PremiumPaid(msg.sender, msg.value);
    }

    // ── Event state ───────────────────────────────────────────────────────

    /**
     * @notice Trigger an event for insured _insured with loss fraction λ_i.
     * @param  _insured    Address of the slashed / loss entity.
     * @param  _lambdaBps  Loss fraction in basis points. 10000 = 100% loss.
     *
     * @dev    Implements Definition 3.4 (snapshot) and Definition 4.2 (event oracle):
     *           V_snap   ← live V_pool at this moment (not at on-chain observation time)
     *           O(T*)    = V_i * λ_i / V_snap
     *           N*       = ⌈ O(T*) / f_max ⌉  (computed off-chain by oracle_pusher.py)
     *
     *         oracleValue6 = O(T*) * 1e6
     *                      = (V_i * λ_i * 1e6) / (V_snap * 1e4)  [λ in bps]
     *                      = (V_i * λ_i * 100) / V_snap
     */
    function triggerEvent(address _insured, uint256 _lambdaBps)
        external
        onlyOwner
        noActiveEvent
    {
        require(registry[_insured].active,          "AL: not registered");
        require(_lambdaBps > 0 && _lambdaBps <= 10_000, "AL: lambda out of range");
        require(V_pool > 0,                         "AL: empty pool");

        Insured storage ins = registry[_insured];

        eventActive    = true;
        eventInsured   = _insured;
        eventLambdaBps = _lambdaBps;
        V_snap         = V_pool;

        // O(T*) scaled to 1e6
        // = V_i * (λ_i / 1e4) / V_snap * 1e6
        // = V_i * λ_i * 100 / V_snap
        oracleValue6  = (ins.V * _lambdaBps * 100) / V_snap;

        // Payout = V_i * λ_i (wei)
        pendingPayout = (ins.V * _lambdaBps) / 10_000;

        emit EventTriggered(
            _insured, _lambdaBps, V_snap, oracleValue6, pendingPayout
        );
    }

    /**
     * @notice Route the payout to the slashed insured after N* intervals complete.
     * @dev    Owner calls this after confirming N* funding intervals have elapsed
     *         on the reinsurance perpetual and the contract balance has been
     *         replenished by funding inflows (shorts paying longs).
     *
     *         The ceiling excess from Theorem 8.6
     *           (V_snap * N* * f_max − V_i * λ_i ≥ 0)
     *         accumulates in this contract as a buffer.
     */
    function routePayout() external onlyOwner {
        require(eventActive,                              "AL: no active event");
        require(address(this).balance >= pendingPayout,  "AL: insufficient balance");

        address target = eventInsured;
        uint256 amount = pendingPayout;

        // Clear event state before transfer (checks-effects-interactions)
        eventActive    = false;
        eventInsured   = address(0);
        eventLambdaBps = 0;
        oracleValue6   = 0;
        pendingPayout  = 0;

        (bool ok, ) = target.call{value: amount}("");
        require(ok, "AL: payout transfer failed");

        emit PayoutRouted(target, amount);
        emit EventCleared();
    }

    // ── Oracle interface ──────────────────────────────────────────────────

    /**
     * @notice Returns O(T*) * 1e6 during an active event; 0 in normal state.
     * @dev    Read by oracle_pusher.py via eth_call every 3 seconds.
     *         Normal state  → returns 0 → pusher sends NORMAL_ORACLE ("0.0001")
     *         Event state   → returns oracleValue6 → pusher sends oracleValue6 / 1e6
     *
     *         Example: oracleValue6 = 120_000 → pusher sends "0.120000"
     *         which corresponds to O(T*) = 0.12 on HyperCore.
     */
    function currentOracleValue() external view returns (uint256) {
        return eventActive ? oracleValue6 : 0;
    }

    // ── Pool views ────────────────────────────────────────────────────────

    /**
     * @notice Risk-adjusted premium weight of insured i, in bps of pool total.
     *         weight_i = V_i * π_i / Σ_j(V_j * π_j)  ∈ (0, 10000]
     *
     * @dev    This is the fraction of aggregate pool premium that insured i
     *         should bear, calibrated by the relative risk parameter π_i.
     *         An insured with πi < pool_average overpays relative to a fair
     *         per-entity market; this is the accepted cross-subsidy cost of
     *         pooled liquidity (§10.1).
     */
    function premiumWeight(address _insured) external view returns (uint256) {
        if (piV_pool == 0) return 0;
        Insured storage ins = registry[_insured];
        if (!ins.active) return 0;
        return (ins.V * ins.pi * 10_000) / piV_pool;
    }

    /**
     * @notice Capital-weighted average risk parameter of the pool, in bps.
     *         π_pool = Σ(π_i * V_i) / Σ(V_i)
     */
    function piPoolWeighted() external view returns (uint256) {
        if (V_pool == 0) return 0;
        return piV_pool / V_pool;
    }

    /// @notice Number of registered (including deregistered) insureds.
    function insuredCount() external view returns (uint256) {
        return insuredList.length;
    }

    /// @notice Full insured record for address.
    function getInsured(address _insured)
        external view
        returns (uint256 V, uint256 pi, uint256 premiumPaid, bool active)
    {
        Insured storage ins = registry[_insured];
        return (ins.V, ins.pi, ins.premiumPaid, ins.active);
    }

    /// @notice Current contract HYPE balance (premiums + funding inflows).
    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Admin ─────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw accumulated premiums, keeping pendingPayout as reserve.
     * @dev    Only callable when no event is active (the payout reserve is
     *         pendingPayout, which is 0 outside of an event window).
     */
    function withdrawPremiums(uint256 amount)
        external
        onlyOwner
        noActiveEvent
    {
        require(address(this).balance >= amount, "AL: insufficient balance");
        (bool ok, ) = owner.call{value: amount}("");
        require(ok, "AL: withdraw failed");
        emit PremiumsWithdrawn(amount);
    }

    /// @notice Transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "AL: zero address");
        owner = newOwner;
    }

    receive() external payable {}
}
