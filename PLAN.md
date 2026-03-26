# HIP3 Insurance Perp — Deployment & Simulation Plan

## Context

The HIP3 perpetual insurance protocol has two layers:
1. **ApportionmentLayer** (Solidity) — singleton contract on HyperEVM managing insured registry, premiums, slash events, and payouts
2. **SLASH perpetual** (HyperCore) — reinsurance perp whose funding mechanism transfers risk, driven by an oracle feed

Contracts are upgradeable (UUPS proxy) for testnet iteration. The simulation UI works locally (Hardhat node) and on testnet (same code, different RPC).

---

## Your To-Do List (everything you do manually — all phone/browser friendly)

### Now: Nothing. Claude builds everything and pushes to the repo.

### When ready to go live (all doable from phone):

**Step 1: Fund a testnet wallet** (phone browser)
1. Open https://app.hyperliquid-testnet.xyz/ in mobile browser
2. Connect MetaMask mobile (or any EVM wallet)
3. Claim testnet HYPE + USDC from faucet
4. Export private key from wallet (MetaMask → Account Details → Export Private Key)

**Step 2: Clone & deploy** (requires a machine with Node.js)
```bash
git clone https://github.com/T-emporal/HIP3-Insurance-Perp.git
cd HIP3-Insurance-Perp
export PRIVATE_KEY=0xYOUR_KEY_HERE
bash deploy-testnet.sh
```
That single script: installs deps, compiles, deploys contract to HyperEVM testnet, registers SLASH perp on HyperCore, starts oracle feed, and serves the simulation UI.

**Step 3: Merge PR** (GitHub mobile app)
- Tap "Merge" on the PR when satisfied

> **No laptop?** Use GitHub Codespaces (browser-based) or ask a team member to run the one command.

---

## Architecture

```
┌────────────────────────────────────────┐
│         Simulation Web UI              │ ← browser (port 3000)
│  Registry | Premiums | Events | Oracle │
└────────────────┬───────────────────────┘
                 │ ethers.js JSON-RPC
                 ▼
┌────────────────────────────────────────┐
│   ApportionmentLayer (UUPS Proxy)      │ ← HyperEVM (or Hardhat local)
│   register / payPremium / triggerEvent │
│   routePayout / currentOracleValue     │
└────────────────┬───────────────────────┘
                 │ oracle_pusher.py reads
                 ▼
┌────────────────────────────────────────┐
│   SLASH-HIP3 Perpetual (HyperCore)     │ ← only on testnet/mainnet
│   setOracle → funding → payout flow    │
└────────────────────────────────────────┘
```

---

## Folder Structure

```
HIP3-Insurance-Perp/
├── backups/                          # original uploaded zips
├── lean_consolidated/                # Lean4 formal proofs
├── perpetual insurance v3 3.pdf      # whitepaper
├── hip3-perp-deployment/             # HyperCore deploy + oracle scripts
│   ├── deploy.py                     # register SLASH perp (one-time)
│   ├── oracle_pusher.py              # continuous oracle feed
│   ├── config.json.example           # wallet config template
│   └── requirements.txt              # Python dependencies
├── apportionment-layer/              # Hardhat project + contracts
│   ├── contracts/
│   │   ├── ApportionmentLayer.sol    # UUPS upgradeable
│   │   └── ApportionmentLayerV2.sol  # example upgrade
│   ├── scripts/
│   │   ├── deploy.js                 # deploy proxy
│   │   └── upgrade.js                # upgrade implementation
│   ├── test/
│   │   └── ApportionmentLayer.test.js
│   ├── hardhat.config.js
│   └── package.json
├── simulation/                       # browser UI
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── abi.json                      # auto-generated
├── start.sh                          # local simulation (one command)
├── deploy-testnet.sh                 # testnet deployment (one command)
├── PLAN.md                           # this file
├── DEPLOY_TESTNET.md                 # detailed testnet guide
└── COPILOT_PROMPTS.md                # sequenced prompts for VS Code
```

---

## Upgrade Workflow

When iterating on the contract:
1. Edit `ApportionmentLayer.sol` (or create V_n)
2. Run `npx hardhat run scripts/upgrade.js --network hyperevm_testnet`
3. Proxy address stays the same — oracle pusher and UI need no changes
4. State preserved across upgrades

**Note:** For production (mainnet), deploy non-upgradeable version per paper's security constraint B3.

---

## Edit Propagation Workflow

When the whitepaper or spec changes:
1. Post updated doc or describe incremental edit in Claude session
2. Claude propagates changes across: contracts, tests, UI, deployment scripts
3. Claude pushes updated branch
4. You merge when satisfied
