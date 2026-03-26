"""
deploy.py  —  One-time deployment of the SLASH reinsurance perp on Hyperliquid testnet.

Steps performed:
  1. Register the DEX + SLASH asset via perpDeploy / registerAsset2

Pre-requisites:
  • hyperliquid-python-sdk installed  (pip install hyperliquid-python-sdk)
  • config.json present (copy config.json.example and fill in your keys)
  • Testnet HYPE staked to your deployer address (500k on mainnet; check current
    testnet requirement — may be lower or waived for testnet)

Run once:
  python deploy.py
"""

import json
import time
import sys

import eth_account
from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants

# ── Configuration ────────────────────────────────────────────────────────────

DEX_NAME   = "SLP3"     # 2–6 characters; identifies your perp DEX
COIN_NAME  = "SLASH"    # asset ticker; referenced later as "SLP3:SLASH"

# Initial oracle price for the asset at registration time.
# In the paper, P(t) ∈ (0,1) and represents the insurance premium fraction.
# Use a small value consistent with a plausible annual slash probability.
# e.g. "0.005" ≈ 0.5% expected loss.  Adjust to your πi estimate.
INITIAL_ORACLE_PX = "0.005"

# Size decimals: 0 means the minimum order size is 1 unit (= 1 HYPE of coverage).
SZ_DECIMALS = 0

# collateralToken index.  0 = USDC on testnet; 1 = HYPE.
# The paper denominates everything in HYPE so use index 1 if available,
# otherwise fall back to 0 for USDC-margined testnet.
COLLATERAL_TOKEN = 0

# Margin table ID.  Must be non-zero.  Use 1 if you have not yet inserted a
# custom table; see the commented section below to insert one first.
MARGIN_TABLE_ID = 1

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_config(path: str = "config.json") -> dict:
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"[error] config file not found: {path}\n"
                 "Copy config.json.example → config.json and fill in your keys.")


def build_exchange(config: dict) -> Exchange:
    wallet = eth_account.Account.from_key(config["secret_key"])
    # account_address only needed when using an API/agent wallet whose address
    # differs from the signing key.
    account_address = config.get("account_address") or None
    return Exchange(
        wallet,
        constants.TESTNET_API_URL,
        account_address=account_address,
    )


# ── Optional: insert a margin table before registering the asset ──────────────
# Uncomment and run this block first if marginTableId=1 does not exist on testnet.
#
# def insert_margin_table(exchange: Exchange) -> None:
#     """
#     Insert a simple two-tier margin table (table ID assigned by the protocol).
#     Adjust lowerBound / maxLeverage to suit your risk parameters.
#     """
#     action = {
#         "type": "perpDeploy",
#         "insertMarginTable": {
#             "dex": DEX_NAME,
#             "marginTable": {
#                 "description": "SLASH insurance margin table",
#                 "marginTiers": [
#                     {"lowerBound": 0,       "maxLeverage": 10},
#                     {"lowerBound": 100_000, "maxLeverage": 5},
#                 ],
#             },
#         },
#     }
#     result = exchange.post_action(action)
#     print("[margin table]", result)


# ── Main deployment ───────────────────────────────────────────────────────────

def deploy(exchange: Exchange) -> None:
    """
    Register the DEX and the SLASH asset in a single registerAsset2 action.
    This is a one-time call.  Re-running will fail if the DEX already exists.
    """

    action = {
        "type": "perpDeploy",
        "registerAsset2": {
            # maxGas omitted → uses current auction price.
            # Set maxGas=0 to use a reserve deployment slot (7 available).
            "dex": DEX_NAME,
            "assetRequest": {
                "coin":          COIN_NAME,
                "szDecimals":    SZ_DECIMALS,
                "oraclePx":      INITIAL_ORACLE_PX,
                "marginTableId": MARGIN_TABLE_ID,
                # strictIsolated: isolated only, no withdrawal of margin
                # from open positions.  HIP-3 currently requires isolated.
                "marginMode": "strictIsolated",
            },
            "schema": {
                "fullName":       "SLASH HIP-3 Reinsurance Perp",
                "collateralToken": COLLATERAL_TOKEN,
                # oracleUpdater omitted → deployer address is the oracle updater.
            },
        },
    }

    print(f"[deploy] Sending perpDeploy/registerAsset2 for DEX={DEX_NAME} COIN={COIN_NAME} ...")
    result = exchange.post_action(action)
    print(f"[deploy] Result: {result}")

    if isinstance(result, dict) and result.get("status") == "ok":
        print("\n✓ Deployment successful.")
        print(f"  Asset identifier for trading: {DEX_NAME}:{COIN_NAME}")
        print(f"  Next step: run oracle_pusher.py to keep the mark price fed.")
    else:
        print("\n✗ Deployment may have failed — inspect result above.")
        print("  Common causes:")
        print("  • DEX name already taken (try a different DEX_NAME)")
        print("  • Insufficient staked HYPE")
        print("  • marginTableId not found (uncomment insertMarginTable above)")


# ── Query helpers ─────────────────────────────────────────────────────────────

def check_auction_status(info: Info) -> None:
    """Print current deploy auction status before spending gas."""
    try:
        status = info.post("/info", {"type": "perpDeployAuctionStatus"})
        print(f"[auction] Current perp deploy auction status: {status}")
    except Exception as e:
        print(f"[auction] Could not fetch auction status: {e}")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cfg      = load_config()
    exchange = build_exchange(cfg)
    info     = Info(constants.TESTNET_API_URL, skip_ws=True)

    check_auction_status(info)

    confirm = input("\nProceed with deployment? [y/N] ").strip().lower()
    if confirm != "y":
        print("Aborted.")
        sys.exit(0)

    deploy(exchange)
