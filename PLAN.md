# HIP3 Insurance Perp — Project Structure

## Quick Start (local simulation, no testnet needed)

```bash
git clone https://github.com/T-emporal/HIP3-Insurance-Perp.git
cd HIP3-Insurance-Perp
bash start.sh
```

Opens http://localhost:3000 with a pre-loaded contract:
- 3 insured entities (LowRisk, MidRisk, HighRisk validators)
- 500 HYPE contract balance (simulated reinsurance pool)
- Full interactive UI: register, pay premiums, trigger slash events, route payouts

No wallet, no testnet funds, no private key required.

## Folder Structure

```
HIP3-Insurance-Perp/
├── apportionment-layer/              # Hardhat project + upgradeable contracts
│   ├── contracts/
│   │   ├── ApportionmentLayer.sol    # UUPS upgradeable (OZ v5)
│   │   └── ApportionmentLayerV2.sol  # example upgrade
│   ├── scripts/
│   │   ├── deploy.js                 # deploy proxy (generic)
│   │   ├── deploy-local.js           # deploy + seed test data
│   │   └── upgrade.js                # upgrade implementation
│   ├── test/
│   │   └── ApportionmentLayer.test.js  # 25 tests
│   ├── src/ApportionmentLayer.sol    # original non-upgradeable (reference)
│   ├── script/Deploy.s.sol           # Foundry deploy script (reference)
│   └── foundry.toml                  # Foundry config (reference)
├── simulation/                       # browser UI
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── abi.json                      # auto-generated on compile
│   └── deploy-info.json              # auto-generated on deploy
├── deployment/                       # testnet deployment (parked)
│   ├── hip3-perp-deployment/
│   │   ├── deploy.py                 # register SLASH perp on HyperCore
│   │   ├── oracle_pusher.py          # continuous oracle feed
│   │   ├── config.json.example       # wallet config template
│   │   └── requirements.txt          # Python deps
│   ├── deploy-testnet.sh             # one-command testnet deploy
│   ├── DEPLOY_TESTNET.md             # testnet guide
│   └── COPILOT_PROMPTS.md            # sequenced prompts for VS Code
├── lean_consolidated/                # Lean4 formal proofs
├── backups/                          # original uploaded zips
├── perpetual insurance v3 3.pdf      # whitepaper
├── start.sh                          # one-command local simulation
└── package.json                      # root orchestration
```

## Architecture

```
┌─────────────────────────────────────┐
│      Simulation Web UI (browser)    │  http://localhost:3000
│  Registry | Premiums | Events       │
│  Oracle Mock | Pool State | Log     │
└───────────────┬─────────────────────┘
                │ ethers.js → JSON-RPC
                ▼
┌─────────────────────────────────────┐
│  ApportionmentLayer (UUPS Proxy)    │  Hardhat local node :8545
│  register / payPremium / trigger    │
│  routePayout / currentOracleValue   │
└─────────────────────────────────────┘
```

For testnet deployment (when feasible): see `deployment/DEPLOY_TESTNET.md`
