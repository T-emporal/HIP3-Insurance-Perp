# Testnet Deployment Guide

## Prerequisites

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **Python 3.9+** — [python.org](https://python.org)
- **A funded Hyperliquid testnet wallet**

## Step 1: Get Testnet Funds

1. Go to https://app.hyperliquid-testnet.xyz/
2. Connect your wallet (MetaMask or similar)
3. Claim testnet HYPE and USDC from the faucet
4. Export your private key from the wallet

## Step 2: Deploy Everything (one command)

```bash
git clone https://github.com/T-emporal/HIP3-Insurance-Perp.git
cd HIP3-Insurance-Perp
export PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
bash deploy-testnet.sh
```

This script will:
1. Install all dependencies (Node + Python)
2. Compile the ApportionmentLayer contract
3. Deploy it to HyperEVM testnet via UUPS proxy
4. Create `config.json` with your key
5. Register the SLASH perpetual on HyperCore
6. Start the oracle feed (runs in background)
7. Serve the simulation UI on http://localhost:3000

## Step 3: Use the Simulation UI

1. Open http://localhost:3000
2. Set RPC URL to `https://rpc.hyperliquid-testnet.xyz/evm`
3. Set Contract Address to the proxy address (printed during deployment)
4. Click **Connect**

## Upgrading the Contract

After making changes to `ApportionmentLayer.sol`:

```bash
cd apportionment-layer
npx hardhat run scripts/upgrade.js --network hyperevm_testnet
```

The proxy address stays the same. No need to reconfigure oracle feed or UI.

## Running Locally (without testnet)

```bash
bash start.sh
```

This runs everything on a local Hardhat node — no private key or testnet funds needed.

## Troubleshooting

**"insufficient funds"** — Get more testnet HYPE from the faucet.

**"nonce too low"** — Reset your wallet nonce in MetaMask (Settings > Advanced > Reset Account).

**Oracle pusher connection error** — Verify `CONTRACT_ADDRESS` in `oracle_pusher.py` matches the proxy address.

**Compilation fails** — Run `cd apportionment-layer && npx hardhat clean && npx hardhat compile`.
