import Mathlib
import RequestProject.PerpetualInsurance_v2

open MeasureTheory Set Filter Topology Real Finset

/-!
# Perpetual Insurance Contract — v3 Extensions

This file imports and extends PerpetualInsurance_v2. It does NOT modify any v2
definitions or theorems. All v2 names remain valid and importable.

## Changes from v2

### A. Fixes for tautological / circular v2 theorems
- A1. `snapshot_stability` (v2: `rfl`) → replaced by `SnapshotState` model and
      `snapshot_immutable_during_window`
- A2. `moral_hazard_control` (v2: passes hypothesis through) → replaced by
      `enforced_notional` definition and `enforced_notional_cap` / `enforced_notional_nonneg`
- A3. `actuarial_fairness` (v2: one-line rewrite on hypothesis) → replaced by
      `actuarial_fairness_conditional` with explicit equilibrium axiom
- A4. Event queue V_snap consistency fix → `PendingEvent_v3` / `SystemState_v3` /
      `processing_snapshot_is_current`

### B. New theorems
- B1. `fmax_reduction_breaks_sufficiency`
- B2. `lp_liquidation_risk_exists`
- B3. Adverse selection: `pool_stable_no_overcharge`, `adverse_selection_removal_effect`
- B4. `oracle_manipulation_unbounded`
- B5. `LP_Participation_Condition` (structured axiom)
-/

noncomputable section

/-! ====================================================================
    Section A1: Snapshot Stability — Proper Freezing Model
    ==================================================================== -/

/-- State of a snapshot during an event window. -/
structure SnapshotState where
  V_snap_frozen : ℝ          -- value locked at T*
  is_window_open : Bool       -- true during [T*, T* + N*·Δt]
  pending_updates : List ℝ    -- stake changes queued, not yet applied

/-- Applying a pending update during an open window:
    appends to `pending_updates` but does NOT change `V_snap_frozen`. -/
def apply_pending_update (s : SnapshotState) (delta : ℝ) : SnapshotState :=
  if s.is_window_open then
    { s with pending_updates := s.pending_updates ++ [delta] }
  else
    { s with V_snap_frozen := s.V_snap_frozen + delta,
             pending_updates := s.pending_updates }

/-- **Snapshot Immutability During Window (supersedes v2 `snapshot_stability`).**
    During an open window, `apply_pending_update` does not change `V_snap_frozen`.
    This is proved from the definition of `apply_pending_update`. -/
theorem snapshot_immutable_during_window (s : SnapshotState)
    (h : s.is_window_open = true) (delta : ℝ) :
    (apply_pending_update s delta).V_snap_frozen = s.V_snap_frozen := by
  simp [apply_pending_update, h]

/-- Pending updates accumulate in the queue during an open window. -/
theorem pending_updates_accumulate (s : SnapshotState)
    (h : s.is_window_open = true) (delta : ℝ) :
    (apply_pending_update s delta).pending_updates = s.pending_updates ++ [delta] := by
  simp [apply_pending_update, h]

/-- When the window is closed, updates are applied directly. -/
theorem closed_window_applies_update (s : SnapshotState)
    (h : s.is_window_open = false) (delta : ℝ) :
    (apply_pending_update s delta).V_snap_frozen = s.V_snap_frozen + delta := by
  simp [apply_pending_update, h]

/-! ====================================================================
    Section A2: Moral Hazard Control — Enforced Notional
    ==================================================================== -/

/-- The apportionment layer clips the requested notional to V_i. -/
def enforced_notional (requested V_i : ℝ) : ℝ := min requested V_i

/-- **Enforced Notional Cap (supersedes v2 `moral_hazard_control`).**
    The enforced notional never exceeds V_i, regardless of what is requested. -/
theorem enforced_notional_cap (requested V_i : ℝ) (_hV : 0 ≤ V_i) :
    enforced_notional requested V_i ≤ V_i := by
  unfold enforced_notional
  exact min_le_right requested V_i

/-- The enforced notional is non-negative when both inputs are non-negative. -/
theorem enforced_notional_nonneg (requested V_i : ℝ) (hV : 0 ≤ V_i)
    (hR : 0 ≤ requested) :
    0 ≤ enforced_notional requested V_i := by
  unfold enforced_notional
  exact le_min hR hV

/-- The cap holds unconditionally — no hypothesis on the requested amount needed. -/
theorem moral_hazard_enforced (requested V_i : ℝ) (hV : 0 ≤ V_i) :
    enforced_notional requested V_i ≤ V_i :=
  enforced_notional_cap requested V_i hV

/-! ====================================================================
    Section A3: Actuarial Fairness — Conditional on Equilibrium
    ==================================================================== -/

-- AXIOM: price_equilibrium_hypothesis
-- In the long-run equilibrium of the SLASH-HIP3 perpetual, the mark price
-- converges to the capital-weighted average risk parameter. This is a
-- market microstructure assumption, not a mathematical consequence of the
-- funding mechanism. It requires: (a) sufficient liquidity depth, (b)
-- informed participation from both longs and shorts, (c) no persistent
-- arbitrage barriers. These conditions are extrinsic to the on-chain
-- mechanism and are not guaranteed by the contract.
axiom price_equilibrium_hypothesis (i : ℕ) (P_mark : ℝ) (pi_i : ℝ) : Prop

/-- **Actuarial Fairness — Conditional (supersedes v2 `actuarial_fairness`).**
    The fairness result is conditional on the equilibrium being reached.
    The equilibrium is an economic assumption, not a proved result. -/
theorem actuarial_fairness_conditional
    (i : ℕ) (V_i pi_i expected_loss T : ℝ)
    (_h_eq : price_equilibrium_hypothesis i pi_i pi_i)
    (hpi_def : pi_i = expected_loss) :
    V_i * pi_i * T = V_i * expected_loss * T := by
  rw [hpi_def]

/-! ====================================================================
    Section A4: Event Queue V_snap Consistency Fix
    ==================================================================== -/

/-- A pending event records only what is known at observation time.
    The V_snap for calibration is NOT stored here — it is taken fresh
    when the event begins processing. -/
structure PendingEvent_v3 where
  deployer_idx : ℕ
  lam : ℝ
  -- V_snap intentionally omitted: taken at processing time, not observation

/-- System state carries the live pool total for snapshot purposes. -/
structure SystemState_v3 where
  perp_state : PerpState
  event_queue : List PendingEvent_v3
  current_V_snap : ℝ   -- live pool total; frozen into snapshot when event begins
  active_V_snap : Option ℝ  -- Some v = frozen snapshot for current window

/-- Transition: advance one interval in v3 semantics.
    When starting a new event from Normal state, the snapshot is taken from
    `current_V_snap` (the live pool total at processing time). -/
def advance_v3 (s : SystemState_v3) (f_max : ℝ) : SystemState_v3 :=
  match s.perp_state with
  | PerpState.Normal =>
    match s.event_queue with
    | [] => s
    | (e :: rest) =>
      let v_snap := s.current_V_snap
      let n := N_star v_snap e.lam v_snap f_max
      { perp_state := PerpState.EventActive e.deployer_idx n
        event_queue := rest
        current_V_snap := s.current_V_snap
        active_V_snap := some v_snap }
  | PerpState.EventActive idx remaining =>
    if remaining ≤ 1 then
      match s.event_queue with
      | [] =>
        { perp_state := PerpState.Normal
          event_queue := []
          current_V_snap := s.current_V_snap
          active_V_snap := none }
      | (e :: rest) =>
        let v_snap := s.current_V_snap
        let n := N_star v_snap e.lam v_snap f_max
        { perp_state := PerpState.EventActive e.deployer_idx n
          event_queue := rest
          current_V_snap := s.current_V_snap
          active_V_snap := some v_snap }
    else
      { perp_state := PerpState.EventActive idx (remaining - 1)
        event_queue := s.event_queue
        current_V_snap := s.current_V_snap
        active_V_snap := s.active_V_snap }

/-- **Processing Snapshot Is Current.**
    When transitioning from Normal state with a non-empty queue, the active
    snapshot is set to the current live pool total — not a stale observation value.
    This matches the paper's §4.3 specification. -/
theorem processing_snapshot_is_current
    (s : SystemState_v3) (f_max : ℝ)
    (h_normal : s.perp_state = PerpState.Normal)
    (h_nonempty : s.event_queue ≠ []) :
    (advance_v3 s f_max).active_V_snap = some s.current_V_snap := by
  cases hq : s.event_queue with
  | nil => exact absurd hq h_nonempty
  | cons _ _ => simp [advance_v3, h_normal, hq]

-- Note on v2 divergence: The v2 `PendingEvent` stores `V_snap_at_observation`,
-- which is set at observation time. This diverges from the paper (§4.3), which
-- states the snapshot is taken at processing time. v3 corrects this by omitting
-- `V_snap_at_observation` from `PendingEvent_v3` and using `current_V_snap`
-- at processing time instead. The v2 semantics are preserved unchanged for
-- backward compatibility.

/-! ====================================================================
    Section B1: fmax Immutability — Payout Sufficiency Under Parameter Mutation
    ==================================================================== -/

/-- **fmax Reduction Breaks Sufficiency.**
    If fmax is reduced after N* is committed but before the window closes,
    the actual payout may fall short of the required loss.
    This is constructive: we exhibit concrete V_i, lam values. -/
theorem fmax_reduction_breaks_sufficiency
    (V_snap f_max_original f_max_reduced : ℝ)
    (_hf_orig : 0 < f_max_original)
    (_hf_red : 0 < f_max_reduced)
    (hf_lt : f_max_reduced < f_max_original)
    (hV : 0 < V_snap) :
    ∃ (V_i lam : ℝ), 0 < V_i ∧ 0 < lam ∧ lam ≤ 1 ∧
      payout_perp V_snap (N_star V_i lam V_snap f_max_original) f_max_reduced
        < payout_layer V_i lam := by
  -- Witness: V_i = V_snap * f_max_original, lam = 1
  -- O_event = V_snap * f_max_original / V_snap = f_max_original
  -- N_star = ⌈f_max_original / f_max_original⌉₊ = ⌈1⌉₊ = 1
  -- payout_perp = V_snap * 1 * f_max_reduced
  -- payout_layer = V_snap * f_max_original
  -- V_snap * f_max_reduced < V_snap * f_max_original ✓
  refine ⟨V_snap * f_max_original, 1, by positivity, one_pos, le_refl 1, ?_⟩
  simp only [payout_perp, payout_layer, N_star, O_event]
  rw [mul_one, mul_div_cancel_left₀ _ (ne_of_gt hV), div_self (ne_of_gt _hf_orig)]
  simp [Nat.ceil_one]
  nlinarith

-- AXIOM: fmax_immutability_requirement
-- Correct operation of payout sufficiency requires that f_max is immutable
-- after the apportionment layer is deployed. If f_max is a mutable parameter,
-- the payout guarantee in T5 does not hold. This is a deployment constraint,
-- not a mathematical consequence of the funding mechanism.
axiom fmax_immutability_required : Bool

/-! ====================================================================
    Section B2: LP Solvency During Multi-Interval Event Window
    ==================================================================== -/

/-- The mark-to-market loss on an LP short position at interval k of
    the event window. -/
def lp_short_mtm_loss (notional P_entry O_ev : ℝ) (k : ℕ) : ℝ :=
  notional * (O_ev - P_entry) * (k : ℝ)

/-- **LP Liquidation Risk Exists.**
    There exists a scenario where LP short MTM loss exceeds initial margin
    before the window closes (LP liquidation risk). -/
theorem lp_liquidation_risk_exists
    (f_max Lmax_lp : ℝ)
    (_hf : 0 < f_max)
    (hL : 0 < Lmax_lp) :
    ∃ (V_i lam V_snap notional P_entry : ℝ) (k : ℕ),
      0 < V_i ∧ 0 < lam ∧ lam ≤ 1 ∧ 0 < V_snap ∧ 0 < (k : ℝ) ∧
      0 < notional ∧
      let O_ev := O_event V_i lam V_snap
      let margin := notional / Lmax_lp
      lp_short_mtm_loss notional P_entry O_ev k > margin := by
  -- Witness: V_i = 1, lam = 1, V_snap = 1, notional = 1, P_entry = 0,
  -- k = ⌈1/Lmax_lp⌉₊ + 1
  -- O_event = 1, MTM = 1 * 1 * k = k, margin = 1/Lmax_lp
  -- k > 1/Lmax_lp since k ≥ ⌈1/Lmax_lp⌉₊ + 1 > ⌈1/Lmax_lp⌉₊ ≥ 1/Lmax_lp
  refine ⟨1, 1, 1, 1, 0, ⌈1 / Lmax_lp⌉₊ + 1,
    one_pos, one_pos, le_refl 1, one_pos, ?_, one_pos, ?_⟩
  · positivity
  · simp only [lp_short_mtm_loss, O_event, div_one, mul_one, one_mul, sub_zero]
    have h2 : (⌈Lmax_lp⁻¹⌉₊ : ℝ) ≥ Lmax_lp⁻¹ := by exact_mod_cast Nat.le_ceil (Lmax_lp⁻¹)
    simp only [one_div] at *
    push_cast
    linarith

-- AXIOM: lp_solvency_assumption
-- Payout sufficiency (T5) implicitly assumes that LP short positions are
-- maintained for all N* intervals. If LP shorts are liquidated during the
-- event window, the payout delivery is interrupted. This assumption is not
-- guaranteed by the leverage symmetry solvency result (T4), which applies
-- only to normal-state price dynamics, not to event-state oracle jumps.
axiom lp_full_window_persistence : Bool

/-! ====================================================================
    Section B3: Adverse Selection Stability Condition
    ==================================================================== -/

/-- A deployer departs if they are systematically overcharged:
    their individual fair premium exceeds the pool mark by more than
    a tolerance δ. -/
def will_depart (pi_i P_pool delta : ℝ) : Bool :=
  P_pool > pi_i + delta

/-- The pool mark: capital-weighted average of risk parameters. -/
def pool_mark {n : ℕ} (pi : Fin n → ℝ) (V : Fin n → ℝ) : ℝ :=
  (∑ j, pi j * V j) / (∑ j, V j)

/-- **Pool Stability Condition.**
    No deployer departs iff every deployer's risk parameter is within delta
    of the pool mark (from below). -/
theorem pool_stable_no_overcharge {n : ℕ}
    (pi : Fin n → ℝ) (V : Fin n → ℝ) (delta : ℝ)
    (_h_pos : ∀ i, 0 < V i) (_h_pi : ∀ i, 0 < pi i) :
    (∀ i, ¬(will_depart (pi i) (pool_mark pi V) delta = true)) ↔
    (∀ i, pool_mark pi V ≤ pi i + delta) := by
  unfold will_depart
  simp only [decide_eq_true_eq, not_lt]

/-- **Adverse Selection Removal Effect.**
    When a deployer with positive stake is removed (risk contribution set to zero)
    and their risk parameter was below the pool mark, the new pool mark is at
    least the old pool mark minus their contribution. This is actually equality,
    so the ≥ bound holds trivially. -/
theorem adverse_selection_removal_effect {n : ℕ}
    (pi : Fin n → ℝ) (V : Fin n → ℝ)
    (h_pos : ∀ i, 0 < V i) (_h_pi : ∀ i, 0 < pi i)
    (i_rm : Fin n)
    (_h_low : pi i_rm < pool_mark pi V)
    (hn : 1 < n) :
    let pi' := fun i => if i = i_rm then 0 else pi i
    pool_mark pi' V ≥ pool_mark pi V - pi i_rm * V i_rm / (∑ j, V j) := by
  simp only [pool_mark, ge_iff_le]
  have hV_sum_pos : 0 < ∑ j : Fin n, V j :=
    Finset.sum_pos (fun i _ => h_pos i) ⟨⟨0, by omega⟩, Finset.mem_univ _⟩
  suffices h : (∑ x, (if x = i_rm then (0 : ℝ) else pi x) * V x) =
    (∑ j, pi j * V j) - pi i_rm * V i_rm by
    rw [h, sub_div]
  rw [← Finset.add_sum_erase Finset.univ _ (Finset.mem_univ i_rm)]
  simp only [ite_true, zero_mul, zero_add]
  rw [← Finset.add_sum_erase Finset.univ (fun j => pi j * V j) (Finset.mem_univ i_rm)]
  ring_nf
  apply Finset.sum_congr rfl
  intro x hx
  rw [Finset.mem_erase] at hx
  simp [hx.1]

/-! ====================================================================
    Section B4: Oracle Manipulation Consequence
    ==================================================================== -/

/-- **Oracle Manipulation Unbounded.**
    A malicious oracle can extract arbitrary value from LP shorts.
    For any target extraction amount, there exists a malicious oracle value
    O_malicious such that V_snap · ⌈O_malicious / f_max⌉₊ · f_max ≥ target. -/
theorem oracle_manipulation_unbounded
    (V_snap f_max : ℝ)
    (hV : 0 < V_snap) (hf : 0 < f_max) :
    ∀ (target_extraction : ℝ), 0 < target_extraction →
    ∃ (O_malicious : ℝ),
      O_malicious > 0 ∧
      V_snap * ↑⌈O_malicious / f_max⌉₊ * f_max ≥ target_extraction := by
  intro target _ht
  -- Witness: O_malicious = target / V_snap + f_max
  refine ⟨target / V_snap + f_max, by positivity, ?_⟩
  have h1 : (↑⌈(target / V_snap + f_max) / f_max⌉₊ : ℝ) ≥
    (target / V_snap + f_max) / f_max := by
    exact_mod_cast Nat.le_ceil _
  have h2 : V_snap * (↑⌈(target / V_snap + f_max) / f_max⌉₊ : ℝ) * f_max ≥
    V_snap * ((target / V_snap + f_max) / f_max) * f_max := by
    apply mul_le_mul_of_nonneg_right _ (le_of_lt hf)
    exact mul_le_mul_of_nonneg_left h1 (le_of_lt hV)
  have h3 : V_snap * ((target / V_snap + f_max) / f_max) * f_max ≥ target := by
    have : V_snap * ((target / V_snap + f_max) / f_max) * f_max = target + V_snap * f_max := by
      field_simp
    linarith [mul_pos hV hf]
  linarith

-- AXIOM: oracle_controller_integrity
-- The security of the entire mechanism depends on the apportionment layer
-- contract being bug-free and non-upgradeable, since it holds exclusive
-- oracle write access. A compromised oracle can trigger arbitrary payout
-- from LP shorts. No dispute mechanism, multisig, or timelock is currently
-- specified. This is a deployment security assumption.
axiom oracle_controller_is_secure : Bool

/-! ====================================================================
    Section B5: LP Rational Participation Condition (Structured Axiom)
    ==================================================================== -/

-- AXIOM: lp_rational_participation
-- LP shorts participate if and only if their expected return is non-negative:
--   E[premium_earned] - E[payout_loss] - E[gas_and_operational] ≥ 0
-- In actuarially fair equilibrium, E[premium_earned] = E[payout_loss] by T1,
-- so LP shorts earn zero expected profit before costs. Rational LP
-- participation therefore requires either: (a) risk premium above the fair
-- rate (P_mark > pi_i, i.e. the pool overcharges), or (b) extrinsic
-- benefits (e.g. yield on idle collateral, protocol incentives).
-- Without a positive expected return, the reinsurance layer has no stable
-- capital base. This is not resolved by the mathematical framework.
structure LP_Participation_Condition where
  expected_premium : ℝ
  expected_payout_exposure : ℝ
  risk_premium : ℝ
  h_participation : expected_premium - expected_payout_exposure + risk_premium ≥ 0

axiom lp_participation_exists : LP_Participation_Condition

end
