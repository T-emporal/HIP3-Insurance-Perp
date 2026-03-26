"""
oracle_pusher.py  —  Oracle feed for the SLASH reinsurance perp.

Reads oracle state from the ApportionmentLayer contract on HyperEVM
via eth_call, then pushes the result to HyperCore via setOracle.

Two states, matching the paper exactly:

  Normal state : contract.currentOracleValue() == 0
                 → push NORMAL_ORACLE ("0.0001") to HyperCore

  Event state  : contract.currentOracleValue() == oracleValue6 > 0
                 → push oracleValue6 / 1e6 as the event oracle O(T*)

No manual input required. The apportionment layer contract drives state;
this script is a pure relay.

Usage:
  python oracle_pusher.py

Set CONTRACT_ADDRESS below after deploying ApportionmentLayer.sol.
"""

import json
import sys
import time

import eth_account
from web3 import Web3
from hyperliquid.exchange import Exchange
from hyperliquid.utils import constants

# ── Configuration ─────────────────────────────────────────────────────────────

# Address of the deployed ApportionmentLayer on HyperEVM testnet.
# Set this after running: forge script script/Deploy.s.sol --broadcast
CONTRACT_ADDRESS = "0xYOUR_APPORTIONMENT_LAYER_ADDRESS"

# HyperEVM testnet RPC
HYPEREVM_RPC = "https://rpc.hyperliquid-testnet.xyz/evm"

# HyperCore perp identifiers (must match deploy.py)
DEX_NAME  = "SLP3"
COIN_NAME = "SLASH"

# Nearest-to-zero oracle for normal state (protocol rejects literal 0)
NORMAL_ORACLE = "0.0001"

# Push interval and minimum inter-call gap (from HyperCore docs)
PUSH_INTERVAL_S = 3.0
MIN_INTERVAL_S  = 2.6

# Minimal ABI: only currentOracleValue() is needed
APPORTIONMENT_ABI = [
    {
        "name": "currentOracleValue",
        "type": "function",
        "stateMutability": "view",
        "inputs":  [],
        "outputs": [{"name": "", "type": "uint256"}],
    }
]

# ── Setup ─────────────────────────────────────────────────────────────────────

def load_config(path: str = "config.json") -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"[error] config not found: {path}")


def build_exchange(config: dict) -> Exchange:
    wallet = eth_account.Account.from_key(config["secret_key"])
    account_address = config.get("account_address") or None
    return Exchange(wallet, constants.TESTNET_API_URL, account_address=account_address)


def build_contract(w3: Web3):
    if CONTRACT_ADDRESS == "0xYOUR_APPORTIONMENT_LAYER_ADDRESS":
        sys.exit(
            "[error] CONTRACT_ADDRESS not set.\n"
            "Deploy ApportionmentLayer.sol first, then set the address in oracle_pusher.py."
        )
    return w3.eth.contract(
        address=Web3.to_checksum_address(CONTRACT_ADDRESS),
        abi=APPORTIONMENT_ABI,
    )


# ── Oracle read ───────────────────────────────────────────────────────────────

def read_oracle_value(contract) -> int:
    """
    Read currentOracleValue() from the contract.
    Returns 0 in normal state, oracleValue6 (integer) in event state.
    """
    try:
        return contract.functions.currentOracleValue().call()
    except Exception as e:
        print(f"[contract] read error: {e}")
        return 0   # fall back to normal state on read failure


def oracle_value_to_price_str(oracle_value6: int) -> str:
    """
    Convert oracleValue6 (integer, scale 1e6) to a decimal string for HyperCore.
    e.g. 120_000 → "0.12"
    """
    decimal = oracle_value6 / 1_000_000
    # Format with enough precision; strip trailing zeros
    return f"{decimal:.6f}".rstrip("0").rstrip(".")


# ── Oracle push ───────────────────────────────────────────────────────────────

def push_oracle(exchange: Exchange, oracle_px: str, label: str = "") -> None:
    action = {
        "type": "perpDeploy",
        "setOracle": {
            "dex":             DEX_NAME,
            "oraclePxs":       [[COIN_NAME, oracle_px]],
            "markPxs":         [],
            "externalPerpPxs": [[COIN_NAME, oracle_px]],
        },
    }
    try:
        result = exchange.post_action(action)
        status = result.get("status", "?") if isinstance(result, dict) else str(result)
        print(f"[oracle] {label:8s} px={oracle_px}  →  {status}")
    except Exception as e:
        print(f"[oracle] push error: {e}")


# ── Main loop ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg      = load_config()
    exchange = build_exchange(cfg)
    w3       = Web3(Web3.HTTPProvider(HYPEREVM_RPC))
    contract = build_contract(w3)

    print("SLASH oracle pusher (contract-driven)")
    print(f"  Contract : {CONTRACT_ADDRESS}")
    print(f"  DEX      : {DEX_NAME}:{COIN_NAME}")
    print(f"  Interval : {PUSH_INTERVAL_S}s")
    print(f"  Press Ctrl+C to exit\n")

    last_push   = 0.0
    last_label  = ""

    while True:
        # Enforce minimum inter-call gap
        elapsed = time.time() - last_push
        if elapsed < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - elapsed)

        # Read contract state
        oracle_value6 = read_oracle_value(contract)

        if oracle_value6 == 0:
            px    = NORMAL_ORACLE
            label = "normal"
        else:
            px    = oracle_value_to_price_str(oracle_value6)
            label = "event"

        # Only print state transitions; suppress repeated identical pushes
        # to keep the log readable during long normal-state runs.
        if label != last_label:
            print(f"[state]  {last_label or '—'} → {label}")

        push_oracle(exchange, px, label=label)
        last_push  = time.time()
        last_label = label

        sleep_time = max(0.0, PUSH_INTERVAL_S - (time.time() - last_push))
        time.sleep(sleep_time)
