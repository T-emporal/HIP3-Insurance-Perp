// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/**
 * @title  ApportionmentLayer
 * @notice Singleton registry and payout router for the two-layer perpetual
 *         insurance framework. This contract is the sole long counterparty
 *         of the SLASH-HIP3 reinsurance perpetual on HyperCore.
 *
 * @dev    UUPS-upgradeable for testnet iteration. For production, deploy
 *         non-upgradeable per security constraint B3.
 *
 *         The contract:
 *           1. Maintains a registry of insured entities (V_i, π_i).
 *           2. Exposes risk-adjusted premium weights for off-chain apportionment.
 *           3. On an event, freezes V_snap, computes O(T*) = V_i * λ_i / V_snap,
 *              and exposes it as oracleValue6 (scaled to 1e6).
 *           4. After N* funding intervals, owner calls routePayout() to transfer
 *              V_i * λ_i to the slashed insured.
 *
 *         Premiums are NOT collected by this contract. They flow through the
 *         perpetual's funding mechanism: the layer holds the long position,
 *         funding debits the long's margin, and LP shorts receive it directly.
 *         Each insured's fair share is: w_i * V_pool * P(t) per interval,
 *         where w_i = V_i * π_i / Σ(V_j * π_j).
 *
 * Units
 * ─────
 *   V_i          : wei (HYPE, 18 decimals)
 *   π_i          : basis points (1 bps = 0.01%, 10_000 bps = 100%)
 *   λ_i          : basis points
 *   oracleValue6 : integer, divide by 1e6 to get the decimal fraction
 *
 * Singleton constraint (Theorem 8.9)
 * ───────────────────────────────────
 *   Only one instance of this contract may interact with the reinsurance
 *   perpetual. Two instances produce 2 * V_i * λ_i ≠ V_i * λ_i.
 */
contract ApportionmentLayer is Initializable, UUPSUpgradeable, OwnableUpgradeable {

    // ── Structs ───────────────────────────────────────────────────────────

    struct Insured {
        uint256 V;            // coverage notional in wei (fixed at registration)
        uint256 pi;           // risk parameter in bps
        bool    active;
    }

    // ── Storage ───────────────────────────────────────────────────────────

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
    uint256 public V_snap;          // pool total frozen at event trigger
    uint256 public oracleValue6;    // O(T*) = V_i * λ_i / V_snap, scaled * 1e6
    uint256 public pendingPayout;   // V_i * λ_i in wei

    // ── Events ────────────────────────────────────────────────────────────

    event Registered(address indexed insured, uint256 V, uint256 pi);
    event Deregistered(address indexed insured);
    event EventTriggered(
        address indexed insured,
        uint256 lambdaBps,
        uint256 V_snap_,
        uint256 oracleValue6_,
        uint256 pendingPayout_
    );
    event PayoutRouted(address indexed insured, uint256 amount);
    event EventCleared();

    // ── Initializer ─────────────────────────────────────────────────────

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Ownable_init(msg.sender);
    }

    // ── UUPS authorization ──────────────────────────────────────────────

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ── Modifiers ─────────────────────────────────────────────────────────

    modifier noActiveEvent() {
        require(!eventActive, "AL: event active");
        _;
    }

    // ── Registry management ───────────────────────────────────────────────

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
            active:      true
        });
        insuredList.push(_insured);

        V_pool   += _V;
        piV_pool += _pi * _V;

        emit Registered(_insured, _V, _pi);
    }

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

    // ── Event state ───────────────────────────────────────────────────────

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

        oracleValue6  = (ins.V * _lambdaBps * 100) / V_snap;
        pendingPayout = (ins.V * _lambdaBps) / 10_000;

        emit EventTriggered(
            _insured, _lambdaBps, V_snap, oracleValue6, pendingPayout
        );
    }

    function routePayout() external onlyOwner {
        require(eventActive,                              "AL: no active event");
        require(address(this).balance >= pendingPayout,  "AL: insufficient balance");

        address target = eventInsured;
        uint256 amount = pendingPayout;

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

    function currentOracleValue() external view returns (uint256) {
        return eventActive ? oracleValue6 : 0;
    }

    // ── Pool views ────────────────────────────────────────────────────────

    /// @notice Risk-adjusted premium weight of insured i, in bps of pool total.
    ///         w_i = V_i * π_i / Σ(V_j * π_j)
    ///         Premium per interval = w_i * V_pool * P(t)
    function premiumWeight(address _insured) external view returns (uint256) {
        if (piV_pool == 0) return 0;
        Insured storage ins = registry[_insured];
        if (!ins.active) return 0;
        return (ins.V * ins.pi * 10_000) / piV_pool;
    }

    function piPoolWeighted() external view returns (uint256) {
        if (V_pool == 0) return 0;
        return piV_pool / V_pool;
    }

    function insuredCount() external view returns (uint256) {
        return insuredList.length;
    }

    function getInsured(address _insured)
        external view
        returns (uint256 V, uint256 pi, bool active)
    {
        Insured storage ins = registry[_insured];
        return (ins.V, ins.pi, ins.active);
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }

    // ── Receive (for funding inflows during event state) ────────────────

    receive() external payable {}
}
