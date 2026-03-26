# Testnet Deployment of the SLASH HIP-3 Reinsurance Perpetual

**Rohan Badade**
rohan@temporal.exchange
March 2026

---

## Abstract

We describe the minimal testnet deployment of the SLASH reinsurance perpetual
introduced in *Perpetual Contracts as a General Insurance Mechanism*. The
deployment targets Hyperliquid's HIP-3 permissionless perpetual infrastructure
and consists of two scripts: a one-time registration action and a continuous
oracle feed. The oracle feed implements exactly the two-state design of the
paper — a near-zero keep-alive in the normal state and a manually supplied
event-state value — with no external oracle dependency. This document covers
prerequisites, deployment procedure, the paper-to-API mapping, and the
engineering gaps that remain before a production deployment.

---

## 1. Architecture

HIP-3 operates entirely on HyperCore, the Hyperliquid L1 order-book layer.
There is no EVM contract at this stage. Deployment consists of L1 action
messages of type `perpDeploy`, signed with the deployer's private key and
submitted to the exchange API endpoint. Two action subtypes are required.

**Registration (`registerAsset2`).** Called once. Creates the DEX (named
`SLP3`) and registers the asset `SLASH` with an initial oracle price, margin
table reference, and schema. The deployer address becomes the default oracle
updater.

**Oracle update (`setOracle`).** Called continuously by the deployer. Sets
`oraclePxs`, `markPxs`, and `externalPerpPxs` for the asset. The protocol
requires updates at least every 3 seconds; updates may not be submitted more
frequently than every 2.5 seconds.

The apportionment layer — the HyperEVM singleton contract that holds the long
position, enforces `Qi ≤ Vi`, manages the premium registry, and routes payouts
— is not in scope here and is the subject of the next deployment step.

---

## 2. Prerequisites

Install the Hyperliquid Python SDK:

```
pip install hyperliquid-python-sdk
```

Python ≥ 3.10 is required. A Hyperliquid testnet address is required with
sufficient HYPE staked to meet the current testnet deployer requirement (the
mainnet requirement is 500,000 HYPE; the testnet requirement may differ).
Testnet HYPE and USDC are available from the Hyperliquid testnet faucet at
`https://app.hyperliquid-testnet.xyz/`.

Credentials are supplied via `config.json`:

```json
{
  "secret_key": "0xYOUR_PRIVATE_KEY",
  "account_address": ""
}
```

`account_address` is required only when using an API wallet whose address
differs from the signing key; leave empty otherwise.

---

## 3. Deployment

### 3.1 Registration

```
python deploy.py
```

This submits a single `perpDeploy / registerAsset2` action. On success the
asset is live and tradeable as `SLP3:SLASH`. The action is idempotent in the
sense that re-submission against an existing DEX name will be rejected; it
need only be run once.

If the margin table with ID 1 does not exist on the target testnet, uncomment
the `insert_margin_table` block in `deploy.py` and run it before registration.

### 3.2 Oracle Feed

```
python oracle_pusher.py
```

The script starts a background keep-alive loop immediately, pushing
`oraclePx = 0.0001` every 3 seconds. This implements the normal state of the
paper: `O(t) ≈ 0`, so `f(t) = P(t)/∆t > 0` and longs pay shorts continuously,
constituting the insurance premium.

To push an event-state oracle, type the computed value and press Enter:

```
0.1200
```

The value supplied should equal `Vi * λi / Vsnap` as defined in the paper. The
script enforces the 2.5-second minimum inter-call constraint before submitting
and then resumes the keep-alive loop automatically. Type `q` to exit.

---

## 4. Paper-to-API Mapping

| Paper | API field | Notes |
|---|---|---|
| `O(t) = 0` (normal) | `oraclePxs = "0.0001"` | Protocol does not accept literal zero |
| `O(T*) = Vi*λi/Vsnap` | `oraclePxs = <typed value>` | Supplied manually on slash observation |
| `P(t)` mark price | `markPxs` | Left empty; order-book determined |
| `fmax` | System constant | Read from testnet meta endpoint; required for N* |
| `∆t` funding interval | System constant | Fixed by the protocol |

---

## 5. Engineering Gaps

Three deployment constraints from §9 of the paper remain open at this stage.

**Lambda observability (§9.4).** HIP-3 slashing is currently a validator
committee decision and is not an automatic on-chain state variable. The event
oracle value must be computed and submitted manually or by an off-chain watcher.
This is the primary engineering gap between the mathematical framework and a
fully automated deployment.

**fmax immutability (§9.1).** HIP-3 does not expose a per-deployer immutable
`fmax` parameter. The system-wide maximum funding rate is the effective `fmax`
for Theorem 8.6. Its value must be read from the testnet meta endpoint and
treated as a fixed constant when parameterising the apportionment layer's N*
calculation.

**LP window persistence (§9.3).** Minimum pool size requirements relative to
`Vmax = max_i Vi` are not enforced on-chain. This constraint must be addressed
in the apportionment layer's LP admission logic.

---

## 6. File Reference

| File | Purpose |
|---|---|
| `deploy.py` | One-time DEX and asset registration |
| `oracle_pusher.py` | Continuous two-state oracle feed |
| `config.json.example` | Credentials template |

---

## 7. Next Step

The apportionment layer: a HyperEVM singleton contract that is the sole
counterparty of the `SLP3:SLASH` perpetual, enforces `Qi ≤ Vi`, collects
individual premiums, reads `λi` from HyperCore at `T*`, calibrates the oracle
to `Vi * λi / Vsnap`, and routes payouts to slashed deployers. The singleton
constraint (Theorem 8.9) requires that this contract be the unique entity
permitted to hold a long position and update the oracle.
