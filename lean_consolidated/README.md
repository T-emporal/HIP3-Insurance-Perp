# Lean 4 Formalisation Repository
**Author:** Rohan Badade — rohan@temporal.exchange
**Toolchain:** `leanprover/lean4:v4.28.0` | **Mathlib4** (pinned in `lake-manifest.json`)
**Status:** Zero `sorry` across all current files | **39 proved results** | **12 axioms**

---

## What This Repository Is

Machine-verified proofs for the paper *Perpetual Contracts as a General
Insurance Mechanism*. Three proof passes, one consolidated folder. All files
compile against Mathlib4. Additional assumptions are explicit axioms, not
`sorry`s — see `Axioms.lean` and the axiom register below.

---

## Folder Structure

```
lean_consolidated/
├── README.md                               ← this file
├── lean-toolchain                          ← Lean version pin
├── lakefile.toml                           ← Lake build config
├── lake-manifest.json                      ← Mathlib dependency pin
└── perpetual_insurance/
    ├── PerpetualInsurance_v1.lean          ← Pass 1 (reserve-based)
    ├── PerpetualInsurance_v2.lean          ← Pass 2 (two-layer, no reserve)
    ├── PerpetualInsurance_v3.lean          ← Pass 3 (strengthened + security)
    ├── Axioms.lean                         ← Full axiom register (v2 + v3)
    └── V3_SUMMARY.md                       ← v3 theorem table and diff vs v2
```

**`PerpetualInsurance_v3.lean` is the canonical current file.**
v1 and v2 are preserved for reference; v3 imports v2 without modifying it.

---

## Architecture (v2/v3)

| Layer | What it is | What it does |
|-------|-----------|-------------|
| **Apportionment layer** | Singleton HyperEVM smart contract | Deployer registry, premium collection, oracle calibration, payout routing |
| **SLASH-HIP3 perp** | Pooled perpetual — the reinsurance layer | Two oracle states; LP shorts provide reinsurance capital |

### Two Oracle States

| State | Oracle `O(t)` | Funding | Direction |
|-------|--------------|---------|-----------|
| Normal | `0` | `P(t)/dt > 0` | Longs pay Shorts (premium) |
| Event | `V_i · λ / V_snap` for `N*` intervals | `-f_max < 0` | Shorts pay Longs (payout) |

Premium and payout are fully decoupled.

---

## Complete Theorem Index

### Retained from v2 (unchanged)

| ID | Lean name | Plain English | Status |
|----|-----------|--------------|--------|
| T1b | `actuarial_fairness_unique` | Only f = P gives actuarially fair pricing | Proved |
| T2a | `moral_hazard_elimination` | Payout is at most at-risk capital V_i | Proved |
| T2b | `payout_equals_actual_loss` | Payout equals V_i times lambda exactly | Proved |
| T2c | `payout_layer_nonneg` | Payout is non-negative | Proved |
| T3a | `coverage_iff` | Coverage holds iff margin meets threshold | Proved |
| T3b | `coverage_self_enforcement` | Coverage validity is a function of margin alone | Proved |
| T3c | `coverage_lapse` | Coverage lapses iff margin drops below threshold | Proved |
| T4a | `delta_price_bound` | Max price move is bounded by 1 over L_max | Proved |
| T4b | `leverage_symmetry_solvency` | Symmetric leverage cap prevents insolvency in normal state | Proved |
| T5 | `payout_sufficiency` | Perp delivers at least V_i times lambda over N* intervals | Proved |
| T5a | `N_star_ge_ratio` | N* is at least O_event divided by f_max | Proved |
| T6 | `oracle_calibration_correctness` | V_snap times O_event equals V_i times lambda | Proved |
| T7a | `singleton_double_payout` | Two independent layers produce double the correct payout | Proved |
| T7b | `singleton_necessity` | Two layers give wrong payout whenever loss is nonzero | Proved |
| T7c | `singleton_oracle_overestimate` | Each partial layer overstates its oracle value | Proved |
| T8b | `oracle_deterministic` | Oracle is a pure function independent of time | Proved |
| Q1 | `enqueue_preserves_state` | Queuing an event does not disturb the active window | Proved |
| Q2 | `event_queue_sequential_processing` | After a window ends, system returns to Normal or starts next event | Proved |
| Q3 | `normal_empty_stable` | Normal state with empty queue is a fixed point | Proved |
| Q4 | `active_event_decrements` | Active event counter decrements each interval | Proved |
| A1 | `event_rate_negative` | Event-state funding is negative (shorts pay longs) | Proved |
| A2 | `normal_rate_positive` | Normal-state funding is positive (longs pay shorts) | Proved |
| A3 | `premium_proportional` | Premium scales linearly with insured capital | Proved |
| A4 | `event_buffer_nonneg` | Ceiling in N* means perp always slightly overpays | Proved |

### New or Strengthened in v3

| ID | Lean name | Plain English | Status |
|----|-----------|--------------|--------|
| A1a | `snapshot_immutable_during_window` | V_snap_frozen never changes while window is open — proved from the definition of apply_pending_update | Proved |
| A1b | `pending_updates_accumulate` | Stake changes queue in pending_updates during an open window | Proved |
| A1c | `closed_window_applies_update` | Stake changes are applied directly when no window is active | Proved |
| A2a | `enforced_notional_cap` | min(requested, V_i) is at most V_i — moral hazard via construction not assumption | Proved |
| A2b | `enforced_notional_nonneg` | min(requested, V_i) is non-negative | Proved |
| A2c | `moral_hazard_enforced` | Position cap holds unconditionally | Proved |
| A3 | `actuarial_fairness_conditional` | Fair pricing holds conditional on price equilibrium axiom | Conditional on economic axiom |
| A4 | `processing_snapshot_is_current` | Event processing uses live V_snap, not a stale stored value | Proved |
| B1 | `fmax_reduction_breaks_sufficiency` | Reducing f_max after deployment breaks the payout guarantee — constructive witness | Proved |
| B2 | `lp_liquidation_risk_exists` | LP short mark-to-market loss can exceed margin in thin pools — constructive witness | Proved |
| B3a | `pool_stable_no_overcharge` | Pool is stable iff every deployer is within delta of the pool mark | Proved |
| B3b | `adverse_selection_removal_effect` | Accounting identity: how pool mark shifts when a deployer exits | Proved |
| B4 | `oracle_manipulation_unbounded` | A compromised oracle can extract any target amount from LP shorts — constructive witness | Proved |
| B5 | `lp_participation_exists` | LP rational participation condition exists given a risk premium or extrinsic benefit | Axiom (structured) |

---

## Axiom Register

### Mathematical Axioms (from v1 and v2)

| Axiom | What it assumes | Lean encoding | Mathlib infrastructure needed |
|-------|----------------|---------------|-------------------------------|
| Risk parameter definition | pi_i = E[lambda_i times 1_E] | hpi_def in actuarial_fairness | MeasureTheory probability space |
| Continuity of P_mark | Mark price moves bounded over liquidation window | loss = Q times dp in T4b | Real analysis, Lipschitz continuity |
| lambda_i in [0,1] | Loss fraction is a valid probability | hlam_range in moral_hazard_elimination | On-chain parametric observability |
| V_snap > 0 | Pool is non-empty at event time | hV_snap in T5 and T6 | Registry non-emptiness invariant |
| f_max > 0 | Maximum funding rate is positive | hf in payout_sufficiency | Protocol parameter constraint |
| Singleton | Apportionment layer is unique long holder | Structural assumption in T7 | Proved necessary by singleton_necessity |
| On-chain observability of lambda_i | Slashing fraction readable at T* | Implicit in all event-state theorems | HyperCore state access |

### Deployment Security Axioms (new in v3)

| Axiom | What breaks if violated | On-chain verifiable? |
|-------|------------------------|---------------------|
| `fmax_immutability_required` | Payout sufficiency fails — break proved constructively in B1 | Yes, if contract is non-upgradeable |
| `oracle_controller_is_secure` | Unbounded extraction possible — proved in B4 | Partially: immutability is on-chain verifiable; bug-freedom requires off-chain audit |
| `lp_full_window_persistence` | Payout delivery interrupted mid-window — risk proved in B2 | No — depends on LP solvency under event-state oracle jumps |

### Economic Axioms (new in v3)

| Axiom | What it assumes | On-chain verifiable? |
|-------|----------------|---------------------|
| `price_equilibrium_hypothesis` | Mark price converges to capital-weighted average pi in equilibrium | No — market microstructure assumption |
| `lp_participation_exists` | LP participation is rational given risk premium or extrinsic benefit | No — off-chain economic condition |

---

## v2 to v3 Diff

| v2 theorem | Problem | v3 replacement |
|-----------|---------|---------------|
| `snapshot_stability` | Tautological: rfl on identical inputs proves nothing about freezing | `snapshot_immutable_during_window` models actual freezing via SnapshotState |
| `moral_hazard_control` | Passes hypothesis Q_i <= V_i through unchanged — assumes what it claims to prove | `enforced_notional_cap` derives the cap from min construction |
| `actuarial_fairness` | Entire economic content sits in the hpi_def hypothesis | `actuarial_fairness_conditional` makes the equilibrium assumption an explicit named axiom |

---

## Build

```bash
lake update
lake build
```

---

## Adding Future Passes

1. Add the new Lean file with a version suffix to `perpetual_insurance/`.
2. Update the theorem table (Pending to Proved, Conditional, or Axiom).
3. Update the sorry count and theorem count in the header.
4. For a new paper, add a new top-level section following the same structure.
