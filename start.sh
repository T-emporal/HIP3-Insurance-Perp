#!/usr/bin/env bash
# HIP3 Insurance — Local Simulation (no testnet, no wallet needed)
# Starts Hardhat node, deploys contract with seed data, serves UI
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/apportionment-layer"
SIM_DIR="$SCRIPT_DIR/simulation"

echo "============================================"
echo "  HIP3 Perpetual Insurance — Local Simulator"
echo "============================================"
echo ""

# 1. Install dependencies if needed
if [ ! -d "$CONTRACT_DIR/node_modules" ]; then
  echo "[1/4] Installing dependencies..."
  cd "$CONTRACT_DIR" && npm install --quiet
else
  echo "[1/4] Dependencies OK"
fi

# 2. Compile contracts
echo "[2/4] Compiling contracts..."
cd "$CONTRACT_DIR" && npx hardhat compile --quiet 2>/dev/null || npx hardhat compile

# 3. Start Hardhat node in background
echo "[3/4] Starting local blockchain (Hardhat node)..."
cd "$CONTRACT_DIR"
npx hardhat node > /dev/null 2>&1 &
HH_PID=$!

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $HH_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Wait for node to be ready
echo -n "  Waiting for node"
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    echo " ready!"
    break
  fi
  echo -n "."
  sleep 0.5
done

# 4. Deploy contract with seed data
echo "[4/4] Deploying contract + seeding test data..."
cd "$CONTRACT_DIR" && npx hardhat run scripts/deploy-local.js --network localhost

PROXY=$(cat "$SIM_DIR/deploy-info.json" 2>/dev/null | grep -o '"proxy":"[^"]*"' | cut -d'"' -f4)

echo ""
echo "============================================"
echo "  SIMULATION READY"
echo "============================================"
echo ""
echo "  UI:       http://localhost:3000"
echo "  RPC:      http://127.0.0.1:8545"
echo "  Contract: $PROXY"
echo ""
echo "  The contract has 3 pre-registered insured"
echo "  entities and 500 HYPE balance."
echo ""
echo "  Try: trigger a slash event, then route payout."
echo ""
echo "  Press Ctrl+C to stop."
echo "============================================"
echo ""

# Serve the simulation UI (blocking)
cd "$SIM_DIR" && npx serve -l 3000 -s .
