#!/usr/bin/env bash
# HIP3 Insurance — Testnet Deployment
# Deploys ApportionmentLayer to HyperEVM testnet,
# registers SLASH perp on HyperCore, starts oracle feed, serves UI.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONTRACT_DIR="$SCRIPT_DIR/apportionment-layer"
PERP_DIR="$SCRIPT_DIR/hip3-perp-deployment"
SIM_DIR="$SCRIPT_DIR/simulation"

echo "=== HIP3 Perpetual Insurance — Testnet Deployment ==="
echo ""

# Check PRIVATE_KEY
if [ -z "$PRIVATE_KEY" ]; then
  echo "ERROR: PRIVATE_KEY environment variable not set."
  echo "  export PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE"
  exit 1
fi

# 1. Install Node dependencies
echo "[1/6] Installing Node dependencies..."
cd "$CONTRACT_DIR" && npm install

# 2. Compile contracts
echo "[2/6] Compiling contracts..."
cd "$CONTRACT_DIR" && npx hardhat compile --quiet

# 3. Deploy ApportionmentLayer to HyperEVM testnet
echo "[3/6] Deploying ApportionmentLayer to HyperEVM testnet..."
cd "$CONTRACT_DIR" && npx hardhat run scripts/deploy.js --network hyperevm_testnet

# Extract deployed address
PROXY_ADDR=$(cat "$SIM_DIR/deploy-info.json" | grep -o '"proxy":"[^"]*"' | cut -d'"' -f4)
echo "  Proxy deployed at: $PROXY_ADDR"

# 4. Install Python dependencies and setup config
echo "[4/6] Setting up Python environment..."
cd "$PERP_DIR"
pip3 install -r requirements.txt --quiet 2>/dev/null || pip install -r requirements.txt --quiet

# Create config.json from PRIVATE_KEY
cat > config.json << EOF
{
  "secret_key": "$PRIVATE_KEY",
  "account_address": ""
}
EOF
echo "  config.json created"

# 5. Register SLASH perpetual on HyperCore
echo "[5/6] Registering SLASH perpetual on HyperCore..."
cd "$PERP_DIR" && python3 deploy.py || {
  echo "  NOTE: Perp registration may require staked HYPE or an auction slot."
  echo "  Check the output above and retry if needed."
}

# 6. Update oracle_pusher with deployed address and start
echo "[6/6] Starting oracle feed..."
cd "$PERP_DIR"
# Update CONTRACT_ADDRESS in oracle_pusher.py
sed -i "s|CONTRACT_ADDRESS = \"0x[^\"]*\"|CONTRACT_ADDRESS = \"$PROXY_ADDR\"|" oracle_pusher.py
echo "  Oracle pusher pointed at $PROXY_ADDR"
python3 oracle_pusher.py &
ORACLE_PID=$!

echo ""
echo "=== Deployment Complete ==="
echo "  Contract (proxy): $PROXY_ADDR"
echo "  Oracle feed PID:  $ORACLE_PID"
echo "  Explorer:         https://testnet.hyperevmscan.io/address/$PROXY_ADDR"
echo ""
echo "Starting UI server..."
echo "  Point browser to http://localhost:3000"
echo "  Set RPC URL to: https://rpc.hyperliquid-testnet.xyz/evm"
echo "  Set Contract to: $PROXY_ADDR"

cd "$SIM_DIR" && npx serve -l 3000 -s .

trap "kill $ORACLE_PID 2>/dev/null; echo 'Stopped.'" EXIT
