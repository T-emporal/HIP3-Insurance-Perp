/-!
# Explicit Axioms — Perpetual Insurance Framework (v2 + v3)

The following are axiomatised as hypotheses rather than derived from Mathlib.
All are flagged in PerpetualInsurance_v2.lean and PerpetualInsurance_v3.lean
with -- AXIOM comments.

## ═══════════════════════════════════════════════════════════════════
## v2 Axioms (Retained)
## ═══════════════════════════════════════════════════════════════════

### Retained from v1

  π_i = E[λ_i · 1_E]
  → Risk parameter definition.
  → Requires: MeasureTheory probability space.
  → Encoded as: `hpi_def : pi_i = expected_loss` in `actuarial_fairness`.

  Continuity of P_mark(t) over Δt_liq
  → Guarantees price moves are bounded by ΔP_max_liq over liquidation window.
  → Requires: Real analysis / Lipschitz continuity of order book dynamics.
  → Encoded as: `loss = Q * dp` hypothesis in `leverage_symmetry_solvency`.

### Removed from v1

  Reserve ODE: dR/dt = ρ · P(t) · Σ V_i   ← ELIMINATED (reserve removed)
  Reserve update: R(T*⁺) = R(T*) - Σ Payout_i  ← ELIMINATED

### Added in v2

  λ_i ∈ [0,1]
  → Valid loss fraction, observable on-chain at T*.
  → Requires: On-chain parametric observability of slashing record.
  → Encoded as: `hlam_range` hypothesis in `moral_hazard_elimination`.

  V_snap > 0
  → Non-empty pool at event time T*.
  → Requires: At least one registered deployer at T*.
  → Encoded as: `hV_snap` hypothesis in `payout_sufficiency`,
    `oracle_calibration_correctness`.

  f_max > 0
  → Positive maximum funding rate per interval.
  → Protocol parameter set by HIP-3 deployer.
  → Encoded as: `hf` hypothesis in `payout_sufficiency`, `N_star_ge_ratio`.

  Singleton constraint
  → Apportionment layer is the unique holder of the aggregate long position.
  → Mathematical requirement: multiple layers miscalibrate oracle (Theorem 7).
  → Encoded as: structural assumption in `singleton_necessity`.

  On-chain observability of λ_i at T*
  → The slashing fraction is parametrically readable from the chain at T*.
  → Requires: HyperCore on-chain state access.
  → Encoded as: implicit in all event-state theorems.

## ═══════════════════════════════════════════════════════════════════
## v3 Axioms (New)
## ═══════════════════════════════════════════════════════════════════

### Deployment Security Axioms

  fmax_immutability_required : Bool
  → Assumes: f_max is immutable after the apportionment layer is deployed.
  → What breaks if it fails: Payout sufficiency (T5) no longer holds. A
    post-registration f_max reduction can cause the perp to deliver less
    than the actual loss V_i · lam_i. See `fmax_reduction_breaks_sufficiency`.
  → Verifiable on-chain: Yes, if the contract is non-upgradeable and f_max
    is stored as an immutable. Otherwise requires off-chain audit of
    upgrade keys / governance.
  → Encoded as: `axiom fmax_immutability_required : Bool` in v3.

  oracle_controller_is_secure : Bool
  → Assumes: The apportionment layer contract (sole oracle writer) is
    bug-free and non-upgradeable.
  → What breaks if it fails: A compromised oracle can extract arbitrary
    value from LP shorts. See `oracle_manipulation_unbounded`.
  → Verifiable on-chain: Partially. Contract immutability is verifiable;
    bug-freedom requires off-chain formal verification / audit.
  → Encoded as: `axiom oracle_controller_is_secure : Bool` in v3.

  lp_full_window_persistence : Bool
  → Assumes: LP short positions are maintained for all N* intervals of
    the event window.
  → What breaks if it fails: Payout delivery is interrupted if LP shorts
    are liquidated mid-window. See `lp_liquidation_risk_exists`.
  → Verifiable on-chain: No. Depends on LP solvency during event-state
    oracle jumps, which is not bounded by leverage_symmetry_solvency (T4)
    since T4 applies only to normal-state price dynamics.
  → Encoded as: `axiom lp_full_window_persistence : Bool` in v3.

### Economic / Market Microstructure Axioms

  price_equilibrium_hypothesis (i : ℕ) (P_mark : ℝ) (pi_i : ℝ) : Prop
  → Assumes: In the long-run equilibrium, the mark price converges to
    the capital-weighted average risk parameter.
  → What breaks if it fails: Actuarial fairness does not hold; deployers
    are either systematically overcharged or undercharged.
  → Requires: (a) sufficient liquidity depth, (b) informed participation
    from both longs and shorts, (c) no persistent arbitrage barriers.
  → Verifiable on-chain: No. This is a market microstructure assumption
    about off-chain participant behavior.
  → Encoded as: `axiom price_equilibrium_hypothesis` in v3.
    Used as explicit hypothesis in `actuarial_fairness_conditional`.

  lp_participation_exists : LP_Participation_Condition
  → Assumes: There exists a configuration where LP participation is
    rational (expected_premium - expected_payout + risk_premium ≥ 0).
  → What breaks if it fails: The reinsurance layer has no stable capital
    base. Without LPs, the perp cannot deliver event-state payouts.
  → Requires: Either (a) risk premium above fair rate (pool overcharges),
    or (b) extrinsic benefits (yield on idle collateral, protocol incentives).
  → Verifiable on-chain: No. Depends on off-chain economic incentives
    and market conditions.
  → Encoded as: `axiom lp_participation_exists` in v3.

### Smart Contract Enforcement Axioms

  (None introduced as axioms in v3.)
  → The snapshot enforcement invariant (`snapshot_immutable_during_window`)
    is proved from the definition of `apply_pending_update`, which models
    the smart contract behavior. The proof is constructive: the function
    definition ensures V_snap_frozen is not modified when is_window_open = true.
  → This is a design-level guarantee, not an axiom. The real-world
    assumption is that the deployed contract matches the model, which is
    covered by `oracle_controller_is_secure`.
-/
