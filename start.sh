#!/usr/bin/env bash
# HIP3 Insurance — Local Simulation
# Starts Hardhat node, deploys contract, serves UI
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/apportionment-layer"
SIM_DIR="$SCRIPT_DIR/simulation"

echo "=== HIP3 Perpetual Insurance — Local Simulation ==="
echo ""

# 1. Install dependencies if needed
if [ ! -d "$CONTRACT_DIR/node_modules" ]; then
  echo "[1/4] Installing dependencies..."
  cd "$CONTRACT_DIR" && npm install
else
  echo "[1/4] Dependencies already installed."
fi

# 2. Compile contracts
echo "[2/4] Compiling contracts..."
cd "$CONTRACT_DIR" && npx hardhat compile --quiet

# 3. Start Hardhat node in background
echo "[3/4] Starting Hardhat local node on port 8545..."
cd "$CONTRACT_DIR" && npx hardhat node &
HH_PID=$!

# Wait for node to be ready
for i in $(seq 1 30); do
  if curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# 4. Deploy contract
echo "[4/4] Deploying ApportionmentLayer..."
cd "$CONTRACT_DIR" && npx hardhat run scripts/deploy.js --network localhost

echo ""
echo "=== Ready ==="
echo "  Hardhat node:  http://127.0.0.1:8545  (PID: $HH_PID)"
echo "  Contract:      $(cat "$SIM_DIR/deploy-info.json" 2>/dev/null | grep -o '"proxy":"[^"]*"' | cut -d'"' -f4)"
echo ""
echo "Starting UI server..."

# Serve the simulation UI
cd "$SIM_DIR" && npx serve -l 3000 -s .

# Cleanup on exit
trap "kill $HH_PID 2>/dev/null; echo 'Stopped.'" EXIT
