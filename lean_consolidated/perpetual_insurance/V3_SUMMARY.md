# PerpetualInsurance v3 — Summary

## Theorem Summary Table

| # | Name | Statement (one-line) | Proof Method |
|---|------|---------------------|-------------|
| A1a | `snapshot_immutable_during_window` | V_snap_frozen unchanged during open window | Proved (from defn of `apply_pending_update`) |
| A1b | `pending_updates_accumulate` | Updates queue in pending_updates during window | Proved |
| A1c | `closed_window_applies_update` | Updates applied directly when window closed | Proved |
| A2a | `enforced_notional_cap` | `enforced_notional req V_i ≤ V_i` | Proved (`min_le_right`) |
| A2b | `enforced_notional_nonneg` | `0 ≤ enforced_notional req V_i` when inputs ≥ 0 | Proved (`le_min`) |
| A2c | `moral_hazard_enforced` | Cap holds unconditionally | Proved (delegates to `enforced_notional_cap`) |
| A3 | `actuarial_fairness_conditional` | Fair pricing conditional on equilibrium axiom | Conditional on `price_equilibrium_hypothesis` |
| A4 | `processing_snapshot_is_current` | Event processing uses current V_snap, not stale | Proved (from defn of `advance_v3`) |
| B1 | `fmax_reduction_breaks_sufficiency` | ∃ params where reduced fmax breaks payout | Proved (constructive witness) |
| B2 | `lp_liquidation_risk_exists` | ∃ scenario where LP MTM loss > margin | Proved (constructive witness) |
| B3a | `pool_stable_no_overcharge` | No departures ↔ all deployers within delta | Proved (`simp` on `will_depart`) |
| B3b | `adverse_selection_removal_effect` | Removing low-risk deployer: new mark ≥ old - contribution | Proved (sum manipulation) |
| B4 | `oracle_manipulation_unbounded` | Malicious oracle can extract any target amount | Proved (constructive witness) |
| B5 | `lp_participation_exists` | LP rational participation condition exists | Axiom (structured) |

### Axioms Introduced in v3

| Axiom | Category | Type |
|-------|----------|------|
| `price_equilibrium_hypothesis` | Economic / Market Microstructure | `(i : ℕ) → (P_mark : ℝ) → (pi_i : ℝ) → Prop` |
| `fmax_immutability_required` | Deployment Security | `Bool` |
| `lp_full_window_persistence` | Deployment Security | `Bool` |
| `oracle_controller_is_secure` | Deployment Security | `Bool` |
| `lp_participation_exists` | Economic / Market Microstructure | `LP_Participation_Condition` |

## v2 Theorems Superseded by v3

| v2 Theorem | Issue | v3 Replacement |
|------------|-------|----------------|
| `snapshot_stability` | Tautological (`rfl` on identical inputs) | `snapshot_immutable_during_window` — models actual freezing via `SnapshotState` |
| `moral_hazard_control` | Passes hypothesis through (`hQ : Q_i ≤ V_i → Q_i ≤ V_i`) | `enforced_notional_cap` — derives cap from `min` without assuming it |
| `actuarial_fairness` | Entire economic content in hypothesis (`hpi_def`) | `actuarial_fairness_conditional` — makes equilibrium assumption explicit via axiom |

**Note:** v2 theorem names remain valid and importable. v3 introduces new names only; it does not redefine v2 names.

## v2 Theorems Unchanged (not superseded)

All other v2 theorems remain valid and are not modified:
- `actuarial_fairness_unique`
- `moral_hazard_elimination`, `payout_equals_actual_loss`, `payout_layer_nonneg`
- `coverage_iff`, `coverage_self_enforcement`, `coverage_lapse`
- `delta_price_bound`, `leverage_symmetry_solvency`
- `N_star_ge_ratio`, `payout_sufficiency`
- `oracle_calibration_correctness`
- `singleton_double_payout`, `singleton_necessity`, `singleton_oracle_overestimate`
- `oracle_deterministic`
- `enqueue_preserves_state`, `event_queue_sequential_processing`, `normal_empty_stable`, `active_event_decrements`
- `event_rate_negative`, `normal_rate_positive`, `premium_proportional`, `event_buffer_nonneg`

## Build Verification

- `PerpetualInsurance_v3.lean`: **zero sorries**, builds successfully
- All theorems verified with `#print axioms` — only standard axioms (`propext`, `Classical.choice`, `Quot.sound`) plus explicitly declared axioms
- `PerpetualInsurance_v2.lean`: unchanged, still builds
- `PerpetualInsurance_v1.lean`: unchanged, not modified
