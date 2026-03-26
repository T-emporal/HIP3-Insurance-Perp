import Mathlib

open MeasureTheory Set Filter Topology Real Finset

/-!
# Perpetual Insurance Contract — Formal Framework

This file formalises the mathematical primitives and key theorems of a
perpetual-swap-based insurance mechanism built on a funding-rate perpetual swap.

## Overview

- **Theorem 1 (Actuarial Fairness)**: Under the equilibrium condition P(t) = π_i,
  the expected premium equals the expected loss; uniqueness of the fair funding rate.
- **Theorem 2 (Moral Hazard Elimination)**: The payout never exceeds actual loss.
- **Theorem 3 (Coverage Self-Enforcement)**: Coverage is a deterministic function
  of margin alone.
- **Theorem 4 (Leverage Symmetry Solvency)**: Under the leverage cap, no position
  can be driven to insolvency within the liquidation window.
- **Proposition (Reserve Reconstruction Identity)**: Algebraic identity decomposing P(t).
- **Proposition (Reserve Solvency Sufficient Condition)**: When reserve exceeds
  N · V̄, all payouts are fully funded.
-/

noncomputable section

/-! ## Section 1: Primitives and Definitions -/

/-- The coverage predicate: an entity is covered when its margin meets the threshold.

    In the insurance contract, the threshold is `V_i / L_max`, where `V_i` is the
    at-risk capital and `L_max` is the leverage cap. -/
def IsCovered (margin threshold : ℝ) : Prop := margin ≥ threshold

/-- Boolean coverage indicator.
    Returns `true` when the margin meets or exceeds the required threshold. -/
nonrec def coveredBool (margin threshold : ℝ) : Bool :=
  if threshold ≤ margin then true else false

/-- Payout at event time T* for a single entity.

    - `V_i`: at-risk capital of entity i
    - `lossFrac`: realised loss fraction λ_i_actual ∈ [0,1]
    - `R`: reserve available at time T*
    - `cov`: whether the entity is covered at T*

    The payout is `min(V_i · lossFrac, R)` when covered, and `0` otherwise.
    The `min` ensures that the reserve caps the payout (moral hazard elimination). -/
def payout (V_i lossFrac R : ℝ) (cov : Bool) : ℝ :=
  if cov then min (V_i * lossFrac) R else 0

/-! ## Section 2: Theorem 1 — Actuarial Fairness

The risk parameter π_i is *defined* as `E[λ_i · 1_E]`, the probability-weighted
expected loss fraction. Under the equilibrium where the mark price `P(t) = π_i`
for all `t ∈ [0, T]`, the total premium `V_i · ∫₀ᵀ P(t) dt = V_i · π_i · T`
equals the expected total loss `V_i · E[λ_i · 1_E] · T`.

Since `π_i = E[λ_i · 1_E]` by definition, the identity is tautological.
The uniqueness theorem shows that `f(t) = α · P(t)` with `α ≠ 1` breaks fairness.
-/

/-- **Actuarial Fairness (core identity).**
    Under the equilibrium `P(t) = π_i`, the total premium equals the expected loss.
    This is immediate from the definition `π_i = E[λ_i · 1_E]`. -/
theorem actuarial_fairness
    (V_i pi_i expected_loss T : ℝ)
    (hpi_def : pi_i = expected_loss) :
    V_i * pi_i * T = V_i * expected_loss * T := by
  rw [hpi_def]

/-- **Actuarial Fairness (uniqueness).**
    The funding rate `f(t) = α · P(t)` yields fair pricing if and only if `α = 1`.
    Any `α ≠ 1` creates systematic mis-pricing. -/
theorem actuarial_fairness_unique
    (V_i pi_i T : ℝ)
    (hV : V_i ≠ 0) (hT : T ≠ 0) (hpi : pi_i ≠ 0)
    (a : ℝ) :
    V_i * (a * pi_i) * T = V_i * pi_i * T ↔ a = 1 := by
  grind

/-! ## Section 3: Theorem 2 — Moral Hazard Elimination

The insured entity cannot profit from event E: the payout is always at most the
actual loss `V_i · λ_i_actual`. This follows directly from the `min` in the payout
formula, which caps the payout at the lesser of the actual loss and the reserve.
-/

/-- **Moral Hazard Elimination.**
    The payout never exceeds the actual loss `V_i · lossFrac`. -/
theorem moral_hazard_elimination
    (V_i lossFrac R : ℝ) (hV : 0 ≤ V_i)
    (hLF : 0 ≤ lossFrac) (_hR : 0 ≤ R) (cov : Bool) :
    payout V_i lossFrac R cov ≤ V_i * lossFrac := by
  unfold payout; split_ifs <;> simp_all; positivity

/-- The payout is always non-negative. -/
theorem payout_nonneg
    (V_i lossFrac R : ℝ) (hV : 0 ≤ V_i)
    (hLF : 0 ≤ lossFrac) (hR : 0 ≤ R) (cov : Bool) :
    0 ≤ payout V_i lossFrac R cov := by
  unfold payout; split_ifs <;> positivity

/-! ## Section 4: Theorem 3 — Coverage Self-Enforcement

The coverage indicator `covered_i(t)` is a deterministic function of `M_i(t)` and
`V_i / L_max` alone. No external input (oracle, governance vote, etc.) is required.

Coverage lapses at the first `t` where `M_i(t) < V_i / L_max`, and reinstates at
the first subsequent `t` where `M_i(t) ≥ V_i / L_max`. These transitions are
automatic: the `coveredBool` function depends only on `margin` and `threshold`.
-/

/-- **Coverage Self-Enforcement (iff characterisation).**
    Coverage holds iff margin meets the threshold `V_i / L_max`. -/
theorem coverage_iff (margin V_i : ℝ) (L_max : ℕ) :
    IsCovered margin (V_i / (L_max : ℝ)) ↔ margin ≥ V_i / (L_max : ℝ) :=
  Iff.rfl

/-- **Coverage Self-Enforcement (boolean).**
    `coveredBool` returns `true` iff margin ≥ threshold.
    This is a deterministic function of margin alone — no external input required. -/
theorem coverage_self_enforcement (margin threshold : ℝ) :
    coveredBool margin threshold = true ↔ margin ≥ threshold := by
  simp [coveredBool, ge_iff_le]

/-- Coverage lapses precisely when margin drops below threshold. -/
theorem coverage_lapse (margin threshold : ℝ) :
    coveredBool margin threshold = false ↔ margin < threshold := by
  simp [coveredBool]

/-! ## Section 5: Theorem 4 — Leverage Symmetry Solvency

Under `L_max = ⌊1 / ΔP_max_liq⌋`, neither longs nor shorts can be driven to
insolvency within the liquidation window `Δt_liq`.

**Key Hypothesis:** `P(t)` is continuous over `Δt_liq`, which means the price
change is bounded by `ΔP_max_liq = sup_t |P(t + Δt_liq) - P(t)|`. This ensures
the perpetual never settles to 1 instantaneously.

The proof proceeds as:
  `Q · ΔP_max ≤ Q / L_max = M`
since `ΔP_max ≤ 1 / L_max` follows from `L_max = ⌊1/ΔP_max⌋`.
-/

/-- Key lemma: `ΔP_max ≤ 1 / L_max` when `L_max = ⌊1/ΔP_max⌋₊`.
    This encodes the continuity condition on `P(t)`. -/
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

/-
PROBLEM
**Leverage Symmetry Solvency.**
    The maximum mark-to-market loss over the liquidation window is bounded
    by the initial margin `M = Q / L_max`.

    The hypothesis that price changes are bounded by `dp` over `Δt_liq`
    (continuity of `P(t)`) is made explicit via the `loss = Q * dp` parameter.

PROVIDED SOLUTION
Substitute hloss and hM. Need Q * dp ≤ Q / L_max. Use delta_price_bound to get dp ≤ 1 / L_max, then multiply both sides by Q (which is positive). The key issue is that 1/L_max and Q/L_max use real division. Use `have h := delta_price_bound dp L_max hdp hL hL_pos` then `subst hloss; subst hM` and then `exact div_le_div_of_nonneg_left ...` or just `nlinarith` with appropriate lemmas.
-/
theorem leverage_symmetry_solvency
    (Q dp : ℝ) (L_max : ℕ)
    (hQ : 0 < Q)
    (hdp : 0 < dp)
    (hL : L_max = ⌊(1 : ℝ) / dp⌋₊)
    (hL_pos : 0 < L_max)
    (M : ℝ) (hM : M = Q / (L_max : ℝ))
    (loss : ℝ) (hloss : loss = Q * dp) :
    loss ≤ M := by
  -- Substitute hloss and hM into the goal.
  rw [hloss, hM];
  exact ( delta_price_bound dp L_max hdp hL hL_pos ) |> fun x => by rw [ le_div_iff₀ <| by positivity ] at *; nlinarith;

/-! ## Section 6: Proposition — Reserve Reconstruction Identity

The mark price decomposes as:
  `P(t) = f_LP(t) + (dR/dt) / (Σ_i V_i · [covered_i(t)])`
where:
  - `f_LP(t) = (1 - ρ) · P(t)` is the net funding rate to LPs
  - `dR/dt = ρ · P(t) · Σ_i V_i · [covered_i(t)]` is the reserve accrual rate
-/

/-- **Reserve Reconstruction Identity.**
    `P(t) = f_LP(t) + (dR/dt) / total_covered_value`
    follows by direct substitution of the reserve accrual equation. -/
theorem reserve_reconstruction_identity
    (P_t rho total_covered_value : ℝ)
    (_hrho_pos : 0 < rho) (_hrho_lt : rho < 1)
    (htcv : 0 < total_covered_value)
    (f_LP : ℝ) (hf_LP : f_LP = (1 - rho) * P_t)
    (dRdt : ℝ) (hdR : dRdt = rho * P_t * total_covered_value) :
    P_t = f_LP + dRdt / total_covered_value := by
  rw [hf_LP, hdR]
  field_simp
  ring

/-! ## Section 7: Proposition — Reserve Solvency Sufficient Condition

If the reserve `R(T*) ≥ N · V̄` (where `V̄ = max_i V_i` and `N` is the number
of entities), then every entity's payout equals its full actual loss. The `min`
in the payout formula is non-binding because `V_i · λ_actual ≤ V̄ ≤ R`.
-/

/-- **Reserve Solvency Sufficient Condition.**
    When `R ≥ N · V̄`, the min in the payout is non-binding:
    `min(V_i · lossFrac, R) = V_i · lossFrac`. -/
theorem reserve_solvency_sufficient
    (V_i V_bar lossFrac R : ℝ) (N : ℕ)
    (hV_pos : 0 ≤ V_i)
    (hLF_range : 0 ≤ lossFrac ∧ lossFrac ≤ 1)
    (hV_bar : V_i ≤ V_bar)
    (hR : R ≥ ↑N * V_bar)
    (hN : 1 ≤ N) :
    min (V_i * lossFrac) R = V_i * lossFrac := by
  apply min_eq_left
  have hN_real : (N : ℝ) ≥ 1 := by exact_mod_cast hN
  nlinarith [hLF_range.1, hLF_range.2]

/-- When covered and the reserve is sufficient, the payout equals the actual loss. -/
theorem payout_equals_loss_when_solvent
    (V_i V_bar lossFrac R : ℝ) (N : ℕ)
    (hV_pos : 0 ≤ V_i)
    (hLF_range : 0 ≤ lossFrac ∧ lossFrac ≤ 1)
    (hV_bar : V_i ≤ V_bar)
    (hR : R ≥ ↑N * V_bar)
    (hN : 1 ≤ N) :
    payout V_i lossFrac R true = V_i * lossFrac := by
  simp [payout, reserve_solvency_sufficient V_i V_bar lossFrac R N hV_pos hLF_range hV_bar hR hN]

/-! ## Section 8: Reserve Dynamics (Axiomatised)

The reserve evolves according to the ODE:
```
  dR/dt = ρ · P(t) · Σ_i (V_i · [covered_i(t)])
```
and is updated at event time T* by:
```
  R(T*⁺) = R(T*) - Σ_i Payout_i
```

We axiomatise these as hypotheses rather than using Mathlib's ODE infrastructure,
since the relevant results only depend on the solution's properties.
-/

/-- Reserve update: after paying out claims, the reserve remains non-negative
    provided total payouts do not exceed the reserve. -/
theorem reserve_update_nonneg
    (R_before total_payout : ℝ)
    (_hR : 0 ≤ R_before)
    (hsolvent : total_payout ≤ R_before) :
    0 ≤ R_before - total_payout := by
  linarith

end