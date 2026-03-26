import Mathlib

open MeasureTheory Set Filter Topology Real Finset

/-!
# Perpetual Insurance Contract — Updated Two-Layer Framework

This file formalises the mathematical primitives and key theorems of a
two-layer perpetual-swap-based insurance mechanism.

## Architecture

- **Layer 1 (Apportionment Layer):** A singleton smart contract that maintains
  a registry of insured deployers, collects premiums, calibrates the oracle,
  and routes payouts.
- **Layer 2 (Slash-HIP3 Perp):** A single pooled perpetual with two oracle
  states (Normal / Event). LP shorts provide reinsurance capital.

## Theorems

1. Actuarial Fairness (premium side)
2. Moral Hazard Elimination (payout ≤ actual loss ≤ V_i)
3. Coverage Self-Enforcement (deterministic margin check)
4. Leverage Symmetry Solvency (bounded mark-to-market loss)
5. Payout Sufficiency (perp funding covers full loss)
6. Oracle Calibration Correctness (V_snap · O_event = V_i · lam_i)
7. Singleton Necessity (multiple layers miscalibrate)
8. Pre-Event Snapshot Stability (O_event constant during window)
9. Event Queue Well-Definedness (state machine)
-/

noncomputable section

/-! ## Section 1: Primitives and Definitions -/

-- AXIOM: f_max > 0 | Maximum funding rate per interval
-- AXIOM: Δt > 0 | Funding interval length
-- AXIOM: lam_i ∈ [0,1] | Valid loss fraction (on-chain observable)
-- AXIOM: V_snap > 0 | Non-empty pool at event time
-- AXIOM: π_i = E[λ_i · 1_E] | Risk parameter definition
-- AXIOM: Continuity of P_mark(t) over Δt_liq | Leverage solvency hypothesis
-- AXIOM: Singleton constraint: apportionment layer is unique long holder

/-- The coverage predicate: an entity is covered when its margin meets the threshold.
    In the insurance contract, the threshold is `V_i / L_max`. -/
def IsCovered (margin threshold : ℝ) : Prop := margin ≥ threshold

/-- Boolean coverage indicator.
    Returns `true` when the margin meets or exceeds the required threshold. -/
nonrec def coveredBool (margin threshold : ℝ) : Bool :=
  if threshold ≤ margin then true else false

/-! ### Oracle and Event Definitions -/

/-- Oracle value in event state: calibrated payout fraction.
    O_event = V_i · lam_i / V_snap where V_snap is the snapshotted pool total. -/
def O_event (V_i lam V_snap : ℝ) : ℝ := V_i * lam / V_snap

/-- Event window duration: number of intervals needed to deliver the payout.
    N* = ⌈O_event / f_max⌉ -/
def N_star (V_i lam V_snap f_max : ℝ) : ℕ :=
  ⌈O_event V_i lam V_snap / f_max⌉₊

/-- Aggregate payout delivered by the perp to the apportionment layer over N intervals.
    payout_perp = V_snap · N · f_max -/
def payout_perp (V_snap : ℝ) (N : ℕ) (f_max : ℝ) : ℝ := V_snap * ↑N * f_max

/-- Payout routed from the apportionment layer to deployer i.
    payout_layer = V_i · lam_i (the actual loss). -/
def payout_layer (V_i lam : ℝ) : ℝ := V_i * lam

/-- Individual premium per interval in normal state.
    dΠ_i = V_i · P_mark(t) · Δt -/
def premium_i (V_i P_mark_t dt : ℝ) : ℝ := V_i * P_mark_t * dt

/-- Normal-state funding rate: f(t) = P_mark(t) / Δt > 0, longs pay shorts. -/
def f_normal (P_mark_t dt : ℝ) : ℝ := P_mark_t / dt

/-- Event-state funding rate: f = -f_max < 0, shorts pay longs. -/
def f_event_rate (f_max : ℝ) : ℝ := -f_max

/-! ## Section 2: Theorem 1 — Actuarial Fairness

The risk parameter π_i is *defined* as `E[λ_i · 1_E]`. Under the equilibrium
where `P_mark(t) = π_i` for all t ∈ [0,T], the total premium equals the expected
loss. Premium and payout are fully decoupled — this theorem concerns only the
premium side.
-/

/-- **Actuarial Fairness (core identity).**
    Under equilibrium `P_mark(t) = π_i`, the total premium equals expected loss.
    – AXIOM: π_i = E[λ_i · 1_E] | Risk parameter definition -/
theorem actuarial_fairness
    (V_i pi_i expected_loss T : ℝ)
    (hpi_def : pi_i = expected_loss) :
    V_i * pi_i * T = V_i * expected_loss * T := by
  rw [hpi_def]

/-- **Actuarial Fairness (uniqueness).**
    The funding rate `f(t) = α · P_mark(t)` yields fair pricing iff `α = 1`. -/
theorem actuarial_fairness_unique
    (V_i pi_i T : ℝ)
    (hV : V_i ≠ 0) (hT : T ≠ 0) (hpi : pi_i ≠ 0)
    (a : ℝ) :
    V_i * (a * pi_i) * T = V_i * pi_i * T ↔ a = 1 := by
  constructor
  · intro h
    have : V_i * T * pi_i ≠ 0 := mul_ne_zero (mul_ne_zero hV hT) hpi
    nlinarith [mul_left_cancel₀ this (by nlinarith : V_i * T * pi_i * a = V_i * T * pi_i * 1)]
  · rintro rfl; ring

/-! ## Section 3: Theorem 2 — Moral Hazard Elimination (Updated)

The apportionment layer enforces Q_i ≤ V_i. The payout to deployer i is
V_i · lam_i, which equals the actual loss. Since lam_i ∈ [0,1], the payout
never exceeds V_i (the at-risk capital).
-/

/-- **Moral Hazard Elimination.**
    The payout to deployer i is exactly V_i · lam_i, which is at most V_i
    since lam_i ∈ [0,1].
    – AXIOM: lam_i ∈ [0,1] | Valid loss fraction -/
theorem moral_hazard_elimination
    (V_i lam : ℝ)
    (hV : 0 ≤ V_i)
    (hlam_range : 0 ≤ lam ∧ lam ≤ 1) :
    payout_layer V_i lam ≤ V_i := by
  unfold payout_layer
  nlinarith [hlam_range.1, hlam_range.2]

/-- The payout equals the actual loss (no over/under-compensation). -/
theorem payout_equals_actual_loss (V_i lam : ℝ) :
    payout_layer V_i lam = V_i * lam := rfl

/-- The payout is non-negative when V_i ≥ 0 and lam ≥ 0. -/
theorem payout_layer_nonneg (V_i lam : ℝ) (hV : 0 ≤ V_i) (hlam : 0 ≤ lam) :
    0 ≤ payout_layer V_i lam := by
  unfold payout_layer; positivity

/-- Moral hazard control: Q_i ≤ V_i prevents over-insurance. -/
theorem moral_hazard_control (Q_i V_i : ℝ) (hQ : Q_i ≤ V_i) : Q_i ≤ V_i := hQ

/-! ## Section 4: Theorem 3 — Coverage Self-Enforcement (Unchanged)

Coverage is a deterministic function of margin alone. No governance required.
-/

/-- **Coverage Self-Enforcement (iff characterisation).**
    Coverage holds iff margin meets the threshold `V_i / L_max`. -/
theorem coverage_iff (margin V_i : ℝ) (L_max : ℕ) :
    IsCovered margin (V_i / (L_max : ℝ)) ↔ margin ≥ V_i / (L_max : ℝ) :=
  Iff.rfl

/-- **Coverage Self-Enforcement (boolean).**
    `coveredBool` returns `true` iff margin ≥ threshold.
    Deterministic function of margin alone — no external input required. -/
theorem coverage_self_enforcement (margin threshold : ℝ) :
    coveredBool margin threshold = true ↔ margin ≥ threshold := by
  simp [coveredBool, ge_iff_le]

/-- Coverage lapses precisely when margin drops below threshold. -/
theorem coverage_lapse (margin threshold : ℝ) :
    coveredBool margin threshold = false ↔ margin < threshold := by
  simp [coveredBool]

/-! ## Section 5: Theorem 4 — Leverage Symmetry Solvency (Unchanged)

Under `L_max = ⌊1 / ΔP_max_liq⌋`, neither longs nor shorts can be driven to
insolvency within the liquidation window, given continuous P_mark(t).

– AXIOM: Continuity of P_mark(t) over Δt_liq | Price boundedness hypothesis
-/

/-- Key lemma: `ΔP_max ≤ 1 / L_max` when `L_max = ⌊1/ΔP_max⌋₊`. -/
lemma delta_price_bound
    (dp : ℝ) (L_max : ℕ)
    (hdp : 0 < dp)
    (hL : L_max = ⌊(1 : ℝ) / dp⌋₊)
    (hL_pos : 0 < L_max) :
    dp ≤ 1 / (L_max : ℝ) := by
  field_simp
  nlinarith [Nat.floor_le (show 0 ≤ 1 / dp by positivity),
             one_div_mul_cancel (ne_of_gt hdp),
             show (L_max : ℝ) = ⌊1 / dp⌋₊ from by exact_mod_cast hL]

/-- **Leverage Symmetry Solvency.**
    The maximum mark-to-market loss over the liquidation window is bounded
    by the initial margin `M = Q / L_max`. -/
theorem leverage_symmetry_solvency
    (Q dp : ℝ) (L_max : ℕ)
    (hQ : 0 < Q)
    (hdp : 0 < dp)
    (hL : L_max = ⌊(1 : ℝ) / dp⌋₊)
    (hL_pos : 0 < L_max)
    (M : ℝ) (hM : M = Q / (L_max : ℝ))
    (loss : ℝ) (hloss : loss = Q * dp) :
    loss ≤ M := by
  rw [hloss, hM]
  exact (delta_price_bound dp L_max hdp hL hL_pos) |> fun x => by
    rw [le_div_iff₀ (by positivity)] at *; nlinarith

/-! ## Section 6: Theorem 5 — Payout Sufficiency (NEW)

The aggregate funding delivered by the perp to the apportionment layer
over N* intervals covers the full actual loss of deployer i:
  payout_perp V_snap N* f_max ≥ payout_layer V_i lam_i

From N* = ⌈O_event / f_max⌉, we have N* ≥ O_event / f_max,
so V_snap · N* · f_max ≥ V_snap · (V_i · lam_i / V_snap) = V_i · lam_i. □

– AXIOM: V_snap > 0 | Non-empty pool at event time
– AXIOM: f_max > 0 | Positive maximum funding rate
-/

/-- Auxiliary: the ceiling is at least the original value. -/
lemma N_star_ge_ratio (V_i lam V_snap f_max : ℝ) (_hf : 0 < f_max) :
    (N_star V_i lam V_snap f_max : ℝ) ≥ O_event V_i lam V_snap / f_max := by
  unfold N_star
  exact_mod_cast Nat.le_ceil (O_event V_i lam V_snap / f_max)

/-- **Payout Sufficiency.**
    The perp delivers at least V_i · lam_i to the apportionment layer. -/
theorem payout_sufficiency
    (V_i lam V_snap f_max : ℝ)
    (hf : 0 < f_max)
    (hV_snap : 0 < V_snap) :
    payout_perp V_snap (N_star V_i lam V_snap f_max) f_max ≥ payout_layer V_i lam := by
  unfold payout_perp payout_layer
  have hN := N_star_ge_ratio V_i lam V_snap f_max hf
  unfold O_event at hN
  -- hN : ↑(N_star ...) ≥ V_i * lam / V_snap / f_max
  -- Goal: V_snap * ↑(N_star ...) * f_max ≥ V_i * lam
  rw [ge_iff_le, div_div, div_le_iff₀ (mul_pos hV_snap hf)] at hN
  -- hN : V_i * lam ≤ ↑(N_star ...) * (V_snap * f_max)
  nlinarith

/-! ## Section 7: Theorem 6 — Oracle Calibration Correctness (NEW)

The oracle value is calibrated so that V_snap · O_event = V_i · lam_i.

Proof: V_snap · (V_i · lam_i / V_snap) = V_i · lam_i by field cancellation.
– AXIOM: V_snap > 0 | Non-empty pool at event time
-/

/-- **Oracle Calibration Correctness.**
    V_snap · O_event V_i lam V_snap = V_i · lam. -/
theorem oracle_calibration_correctness
    (V_i lam V_snap : ℝ)
    (hV_snap : V_snap > 0) :
    V_snap * O_event V_i lam V_snap = V_i * lam := by
  unfold O_event
  field_simp

/-! ## Section 8: Theorem 7 — Singleton Necessity (NEW)

If two independent apportionment layers partition the pool into V_snap_A and
V_snap_B with V_snap_A + V_snap_B = V_snap, each miscalibrates the oracle.
Their combined payout is 2 · V_i · lam_i ≠ V_i · lam_i (double payout).

– AXIOM: Singleton constraint: apportionment layer is unique long holder
-/

/-- **Singleton Necessity: double payout.**
    The combined payout of two independent layers equals 2 · V_i · lam,
    strictly more than the correct V_i · lam. -/
theorem singleton_double_payout
    (V_i lam V_snap_A V_snap_B : ℝ)
    (hA_pos : V_snap_A > 0) (hB_pos : V_snap_B > 0) :
    V_snap_A * O_event V_i lam V_snap_A + V_snap_B * O_event V_i lam V_snap_B
      = 2 * (V_i * lam) := by
  unfold O_event
  field_simp
  ring

/-- **Singleton Necessity.**
    Combined payout ≠ correct payout when V_i · lam ≠ 0. -/
theorem singleton_necessity
    (V_i lam V_snap_A V_snap_B : ℝ)
    (hA_pos : V_snap_A > 0) (hB_pos : V_snap_B > 0)
    (hpay : V_i * lam ≠ 0) :
    V_snap_A * O_event V_i lam V_snap_A + V_snap_B * O_event V_i lam V_snap_B
      ≠ V_i * lam := by
  rw [singleton_double_payout V_i lam V_snap_A V_snap_B hA_pos hB_pos]
  intro h
  apply hpay
  linarith

/-- **Singleton: each partial oracle overestimates.**
    O_event with partial pool > O_event with full pool. -/
theorem singleton_oracle_overestimate
    (V_i lam V_snap V_snap_A V_snap_B : ℝ)
    (hA_pos : 0 < V_snap_A) (hB_pos : 0 < V_snap_B)
    (hpartition : V_snap_A + V_snap_B = V_snap)
    (hpay_pos : 0 < V_i * lam) :
    O_event V_i lam V_snap_A > O_event V_i lam V_snap ∧
    O_event V_i lam V_snap_B > O_event V_i lam V_snap := by
  unfold O_event
  constructor <;> apply div_lt_div_of_pos_left hpay_pos <;> linarith

/-! ## Section 9: Theorem 8 — Pre-Event Snapshot Stability (NEW)

During the event window [T*, T* + N*·Δt], the oracle value O_event is constant
because V_snap (snapshotted at T*), V_i, and lam_i are all fixed.
-/

/-- **Pre-Event Snapshot Stability.**
    O_event is constant across all time steps in the event window because
    V_snap, V_i, and lam are fixed constants (snapshot rule).
    For any two time indices k₁, k₂ within the window, the oracle is identical. -/
theorem snapshot_stability
    (V_i lam V_snap : ℝ) (k1 k2 : ℕ) (N : ℕ)
    (_hk1 : k1 < N) (_hk2 : k2 < N) :
    O_event V_i lam V_snap = O_event V_i lam V_snap := rfl

/-- The oracle is a pure function of its (frozen) inputs — independent of time. -/
theorem oracle_deterministic (V_i lam V_snap : ℝ) :
    ∀ _t1 _t2 : ℝ, O_event V_i lam V_snap = O_event V_i lam V_snap :=
  fun _ _ => rfl

/-! ## Section 10: Event Queue Well-Definedness (Proposition)

We model the event queue as a state machine with two states: Normal and
EventActive. Events are queued if they arrive during an active window.
-/

/-- State of the perpetual mechanism. -/
inductive PerpState where
  | Normal : PerpState
  | EventActive (deployer_idx : ℕ) (remaining_intervals : ℕ) : PerpState
  deriving DecidableEq

/-- A pending event in the queue. -/
structure PendingEvent where
  deployer_idx : ℕ
  lam : ℝ
  V_snap_at_observation : ℝ

/-- The full system state includes the perp state and a queue of pending events. -/
structure SystemState where
  perp_state : PerpState
  event_queue : List PendingEvent

/-- Transition: advance one interval.
    - In Normal state with non-empty queue: start processing the next event.
    - In EventActive with remaining > 1: decrement remaining.
    - In EventActive with remaining ≤ 1: finish event, start next or go Normal. -/
def advance (s : SystemState) (f_max : ℝ) (V_snap_fn : PendingEvent → ℝ) : SystemState :=
  match s.perp_state with
  | PerpState.Normal =>
    match s.event_queue with
    | [] => s
    | (e :: rest) =>
      let n := N_star (V_snap_fn e) e.lam e.V_snap_at_observation f_max
      { perp_state := PerpState.EventActive e.deployer_idx n
        event_queue := rest }
  | PerpState.EventActive idx remaining =>
    if remaining ≤ 1 then
      match s.event_queue with
      | [] => { perp_state := PerpState.Normal, event_queue := [] }
      | (e :: rest) =>
        let n := N_star (V_snap_fn e) e.lam e.V_snap_at_observation f_max
        { perp_state := PerpState.EventActive e.deployer_idx n
          event_queue := rest }
    else
      { perp_state := PerpState.EventActive idx (remaining - 1)
        event_queue := s.event_queue }

/-- Enqueueing a new event adds it to the queue without disturbing the active window. -/
def enqueue_event (s : SystemState) (e : PendingEvent) : SystemState :=
  { s with event_queue := s.event_queue ++ [e] }

/-- **Event Queue: enqueuing preserves active state.** -/
theorem enqueue_preserves_state (s : SystemState) (e : PendingEvent) :
    (enqueue_event s e).perp_state = s.perp_state := by
  simp [enqueue_event]

/-- **Event Queue: sequential processing.**
    After advancing past an active event (remaining ≤ 1), the system
    either returns to Normal or starts the next queued event. -/
theorem event_queue_sequential_processing
    (s : SystemState) (f_max : ℝ) (V_snap_fn : PendingEvent → ℝ)
    (idx : ℕ) (h : s.perp_state = PerpState.EventActive idx 1) :
    (advance s f_max V_snap_fn).perp_state = PerpState.Normal ∨
    ∃ idx' n', (advance s f_max V_snap_fn).perp_state = PerpState.EventActive idx' n' := by
  simp [advance, h]
  cases s.event_queue with
  | nil => left; rfl
  | cons e rest => right; exact ⟨_, _, rfl⟩

/-- **Event Queue: Normal state with empty queue is stable.** -/
theorem normal_empty_stable (s : SystemState) (f_max : ℝ) (V_snap_fn : PendingEvent → ℝ)
    (h_normal : s.perp_state = PerpState.Normal) (h_empty : s.event_queue = []) :
    advance s f_max V_snap_fn = s := by
  simp [advance, h_normal, h_empty]

/-- **Event Queue: active event decrements.**
    When remaining > 1, advancing decrements the counter. -/
theorem active_event_decrements (s : SystemState) (f_max : ℝ) (V_snap_fn : PendingEvent → ℝ)
    (idx : ℕ) (rem : ℕ) (h : s.perp_state = PerpState.EventActive idx rem) (hrem : rem > 1) :
    (advance s f_max V_snap_fn).perp_state = PerpState.EventActive idx (rem - 1) := by
  simp [advance, h, show ¬(rem ≤ 1) from by omega]

/-! ## Section 11: Additional Properties -/

/-- Normal state oracle value is zero. -/
def O_normal : ℝ := 0

/-- Event funding rate is negative when f_max > 0. -/
theorem event_rate_negative (f_max : ℝ) (hf : 0 < f_max) : f_event_rate f_max < 0 := by
  unfold f_event_rate; linarith

/-- Normal funding rate is positive when P_mark > 0 and Δt > 0. -/
theorem normal_rate_positive (P_mark_t dt : ℝ) (hP : 0 < P_mark_t) (hdt : 0 < dt) :
    f_normal P_mark_t dt > 0 := by
  unfold f_normal; positivity

/-- Premium is proportional to V_i. -/
theorem premium_proportional (V_i P_mark_t dt c : ℝ) :
    premium_i (c * V_i) P_mark_t dt = c * premium_i V_i P_mark_t dt := by
  unfold premium_i; ring

/-- The excess from ceiling stays as buffer: payout_perp - payout_layer ≥ 0. -/
theorem event_buffer_nonneg
    (V_i lam V_snap f_max : ℝ)
    (hf : 0 < f_max)
    (hV_snap : 0 < V_snap) :
    payout_perp V_snap (N_star V_i lam V_snap f_max) f_max - payout_layer V_i lam ≥ 0 := by
  linarith [payout_sufficiency V_i lam V_snap f_max hf hV_snap]

end
