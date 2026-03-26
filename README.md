# HIP3 Perpetual Insurance

**Perpetual Contracts as a General Insurance Mechanism**

A two-layer insurance protocol that converts perpetual derivative funding mechanics into premium collection and loss payout — no reserves, no claims committees, no governance votes. The canonical instantiation applies it to HIP-3 validator slashing risk on Hyperliquid.

---

## How It Works

The protocol has two layers connected by a single funding rate equation: **f(t) = (P(t) - O(t)) / Δt**

### Layer 1: Apportionment Layer (this repo)

A singleton smart contract on HyperEVM that:
- Maintains a registry of insured entities (each with at-risk capital V_i and auditor-certified risk parameter π_i)
- Apportions premium obligations across insureds by risk-adjusted weight
- On a slash event, freezes the pool snapshot and calibrates the oracle
- Routes payouts to slashed entities after the funding window completes

### Layer 2: SLASH-HIP3 Perpetual (on HyperCore)

A pooled perpetual where the apportionment layer is the sole long and LP shorts provide reinsurance capital. The perp's funding mechanism does all the economic work:

| State | Oracle O(t) | Funding | Who pays whom |
|-------|-------------|---------|---------------|
| **Normal** | ≈ 0 | f = P(t) / Δt > 0 | Longs → Shorts (premium) |
| **Event** | V_i · λ_i / V_snap | f = -f_max | Shorts → Longs (payout) |

Premium and payout are fully decoupled — they use the same equation but entirely separate oracle regimes.

---

## Inputs and Outputs

### Inputs

| Input | Who sets it | What it is |
|---|---|---|
| Register (address, V_i, π_i) | Pool operator | Add insured entity — at-risk stake + auditor-certified risk parameter |
| Deregister (address) | Pool operator | Remove insured from pool |
| Mark Price P(t) | Market | Order book consensus on pool risk (simulated in local UI) |
| Trigger Event (address, λ_i) | Pool operator | Slash observed — who was slashed and what fraction they lost |
| Route Payout | Pool operator | Release payout to slashed insured after N* funding intervals |

### Outputs (all derived)

| Output | Formula | Meaning |
|---|---|---|
| V_pool | Σ V_i | Total at-risk capital in pool |
| π_pool | Σ(π_i · V_i) / V_pool | Capital-weighted average risk |
| w_i | V_i · π_i / Σ(V_j · π_j) | Insured's risk-adjusted share of pool premium |
| Premium_i / hr | w_i · V_pool · P(t) | What insured i owes per funding interval |
| f(t) | P(t) - O(t), capped at f_max | Funding rate per interval |
| O(T*) | V_i · λ_i / V_snap | Oracle value during event |
| Payout | V_i · λ_i | Amount owed to slashed insured |
| N* | ⌈O(T*) / f_max⌉ | Funding intervals needed to deliver payout |
| Ceiling excess | V_snap · N* · f_max - V_i · λ_i | Rounding surplus retained as buffer |

---

## Key Design Questions

### How are premiums collected?

Insureds don't make manual payments. The apportionment layer holds a single long position on the perpetual. In normal state, the perp's funding mechanism automatically debits the long's margin (premium) and credits LP shorts. Each insured's fair share is:

```
premium_i = (V_i · π_i / Σ(V_j · π_j)) × V_pool × P(t)
```

The apportionment layer doesn't touch the funds — they flow through the perp directly.

### How much margin does the insurance layer need?

Per insured, the layer must maintain:

```
M_i = V_i / L_max
```

Where L_max = ⌊1 / ΔP_max⌋ is the leverage cap derived from max price movement during the liquidation window. This is a **capital adequacy decision** — the apportionment layer should run at conservative leverage (2-5x), far below what speculators use, because coverage lapse = protocol failure.

If margin drops below V_i / L_max, coverage lapses automatically for that insured. No governance, no grace period — it's a hard binary (Theorem T3).

### What is the ceiling excess?

N* must be a whole number of intervals, but the math rarely divides evenly. The perp always delivers slightly more than needed:

```
Example: payout = 5 HYPE, funding/interval = 0.4 HYPE
  Exact: 5 / 0.4 = 12.5 intervals
  N* = ⌈12.5⌉ = 13
  Delivered: 13 × 0.4 = 5.2 HYPE
  Excess: 0.2 HYPE (stays in contract as buffer)
```

Structurally always non-negative (Theorem T5). Accumulates over events.

### What happens to other insureds during a slash event?

The mark price P(t) doesn't reprice instantly during the event window. Non-slashed insureds keep paying premiums at roughly the pre-event rate P(T⁻) while the payout resolves over N* intervals (typically hours). This is a market microstructure assumption, not enforced on-chain — it holds because the event window is short and order book participants have no reason to drastically reprice during it.

### Why must the apportionment layer be a singleton?

If two independent instances each calibrate using their own partial V_snap, the combined payout doubles: 2 · V_i · λ_i ≠ V_i · λ_i. Proven necessary by constructive counterexample (Theorem T7).

---

## Formal Verification

All core properties are machine-verified in Lean 4 with zero `sorry`s — 39 proved theorems across three proof passes, 12 explicit axioms. Key results:

| Theorem | What it proves |
|---|---|
| T1 (Actuarial Fairness) | In equilibrium (P = π), expected premium = expected loss |
| T2 (Moral Hazard) | Payout never exceeds at-risk capital; equals actual loss exactly |
| T3 (Coverage) | Coverage holds iff margin ≥ V_i / L_max — pure function of margin, self-enforcing |
| T4 (Leverage Solvency) | Symmetric leverage cap prevents insolvency in normal state |
| T5 (Payout Sufficiency) | Perp delivers ≥ V_i · λ_i over N* intervals |
| T6 (Oracle Calibration) | V_snap · O(T*) = V_i · λ_i exactly |
| T7 (Singleton) | Two independent layers produce wrong payout — singleton is necessary |
| T8 (Snapshot Stability) | O(T*) frozen throughout event window |
| B1-B4 (Security) | Constructive proofs of what breaks if deployment constraints are violated |

See `lean_consolidated/README.md` for the full theorem index and axiom register.

---

## Engineering Gaps

The math proves correctness *given* deployment constraints. These constraints are not yet fully enforceable on-chain:

| Gap | Issue | Status |
|---|---|---|
| **Lambda observability** | HIP-3 slashing is a validator committee decision, not automatic on-chain state | Manual trigger required |
| **f_max immutability** | No per-deployer immutable f_max in HIP-3; system-wide constant must be read from meta endpoint | Documented constraint |
| **LP window persistence** | LP shorts must maintain positions for all N* intervals; not enforced on-chain | Pool admission logic needed |
| **Testnet deployment** | Registering a HIP-3 perp requires staking ~500k HYPE | Parked pending foundation support |

---

## Running Locally

```bash
git clone https://github.com/T-emporal/HIP3-Insurance-Perp.git
cd HIP3-Insurance-Perp
bash start.sh
```

Opens http://localhost:3000 with:
- 3 pre-registered insured validators (varied risk profiles)
- 500 HYPE simulated pool balance
- Interactive UI: register entities, set mark price, trigger slash events, observe funding flows and payouts

No wallet, no testnet funds, no private key. Everything runs on a local Hardhat node.

---

## Repository Structure

```
├── apportionment-layer/        Hardhat project — UUPS upgradeable contracts
│   ├── contracts/              ApportionmentLayer.sol + V2 example
│   ├── scripts/                deploy, deploy-local (seeded), upgrade
│   └── test/                   25 tests (lifecycle, access control, upgrade)
├── simulation/                 Browser UI (vanilla HTML/JS/CSS)
├── lean_consolidated/          Lean 4 formal proofs (39 theorems, 0 sorry)
├── deployment/                 Testnet deployment scripts (parked)
├── backups/                    Original uploaded archives
└── perpetual insurance v3 3.pdf   Whitepaper
```

---

## Upgradeability

Contracts use OpenZeppelin UUPS proxy for testnet iteration. Deploy once, upgrade logic without losing state. For production, deploy non-upgradeable per security constraint B3 (proven: upgradeable oracle controller enables unbounded extraction).

---

## Author

Rohan Badade — rohan@temporal.exchange
