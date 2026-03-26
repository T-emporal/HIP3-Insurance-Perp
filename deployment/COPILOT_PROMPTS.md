# Sequenced Prompts for VS Code + GitHub Copilot

> **How to use:** Open VS Code with this repo. Open Copilot Chat (Ctrl+Shift+I or Cmd+Shift+I). Paste each prompt one at a time, wait for completion, then move to the next.
>
> **Prerequisites:** Node.js 18+ installed, private key from a funded Hyperliquid testnet wallet.

---

## Prompt 1: Verify Setup

```
Check that this repo has the following structure and all files exist:
- apportionment-layer/contracts/ApportionmentLayer.sol
- apportionment-layer/hardhat.config.js
- apportionment-layer/package.json
- simulation/index.html
- simulation/app.js
- hip3-perp-deployment/deploy.py
- hip3-perp-deployment/oracle_pusher.py
- start.sh
- deploy-testnet.sh

Run `cd apportionment-layer && npm install` to install dependencies.
Then run `npx hardhat compile` and confirm no errors.
Report any missing files or compilation errors.
```

---

## Prompt 2: Run Tests Locally

```
In the apportionment-layer/ directory, run `npx hardhat test`.
All tests should pass. If any fail, diagnose and fix the issue.
Report the test results summary.
```

---

## Prompt 3: Run Local Simulation

```
From the repo root, run `bash start.sh`.
This should:
1. Start a Hardhat local node on port 8545
2. Deploy the ApportionmentLayer contract
3. Serve the simulation UI on port 3000

Verify:
- The Hardhat node is running (check port 8545)
- The contract deployed successfully (address logged)
- The UI is accessible at http://localhost:3000

Report the deployed contract address and confirm the UI loads.
```

---

## Prompt 4: Deploy to HyperEVM Testnet

```
I want to deploy the ApportionmentLayer contract to HyperEVM testnet.

My private key is set as environment variable PRIVATE_KEY.
If not set, ask me for it.

Run:
cd apportionment-layer
npx hardhat run scripts/deploy.js --network hyperevm_testnet

Report:
- The proxy address (this is the permanent contract address)
- The implementation address
- The owner address
- Verify the contract on https://testnet.hyperevmscan.io using the proxy address
```

---

## Prompt 5: Register SLASH Perpetual on HyperCore

```
Now register the SLASH reinsurance perpetual on Hyperliquid testnet.

1. First install Python dependencies:
   cd hip3-perp-deployment
   pip install -r requirements.txt

2. Create config.json from config.json.example:
   - Set secret_key to the same private key used for contract deployment
   - Leave account_address empty unless using an API wallet

3. Run: python deploy.py

Report the output. If there's an auction or registration process,
explain what happened and what to do next.
```

---

## Prompt 6: Start Oracle Feed

```
Start the oracle pusher that reads from the ApportionmentLayer contract
and pushes oracle prices to HyperCore.

1. First, update CONTRACT_ADDRESS in hip3-perp-deployment/oracle_pusher.py
   with the proxy address from Prompt 4.

2. Run: python oracle_pusher.py

It should print "NORMAL push" messages every 3 seconds with oracle price 0.0001.
Confirm it's running and pushing successfully.

Note: Keep this running in a terminal. It needs to stay alive for the
perpetual to function.
```

---

## Prompt 7: Point Simulation UI to Testnet

```
The simulation UI at simulation/index.html needs to point to the testnet.

1. Open simulation/app.js
2. Find the RPC_URL or network configuration
3. Change it from localhost:8545 to the HyperEVM testnet RPC:
   https://rpc.hyperliquid-testnet.xyz/evm
4. Update the contract address to the proxy address from Prompt 4

Then serve the UI:
   npx serve simulation/ -l 3000

Open http://localhost:3000 in browser and confirm it connects to testnet
and shows the contract state (0 insured entities, owner address matches).
```

---

## Prompt 8: Test Full Lifecycle on Testnet

```
Using the simulation UI (or via Hardhat console), perform a full lifecycle test:

1. Register an insured entity:
   - Address: any testnet address (can use owner address)
   - V_i: 1000000000000000000 (1 HYPE in wei)
   - π_i: 500 (5% risk in basis points)

2. Pay premium: send 0.01 HYPE as premium

3. Trigger a slash event:
   - insured: the address from step 1
   - λ_i: 5000 (50% loss in basis points)

4. Check oracle value: should show O(T*) = V_i * λ_i / V_snap

5. Route payout: call routePayout()

6. Verify the insured received the payout

Report each step's transaction hash and result.
```

---

## Prompt 9: Upgrade Contract (when needed)

```
I want to upgrade the ApportionmentLayer contract to a new version.

1. Make your changes to the contract in
   apportionment-layer/contracts/ApportionmentLayer.sol
   (or create a new ApportionmentLayerVN.sol)

2. Update the contract name in scripts/upgrade.js if using a new file

3. Run:
   cd apportionment-layer
   npx hardhat run scripts/upgrade.js --network hyperevm_testnet

4. Verify:
   - Proxy address unchanged
   - New implementation deployed
   - Existing state preserved (insured entities still registered)
   - New functionality works

Report the new implementation address and confirm state preservation.
```

---

## Troubleshooting Prompts

### If deployment fails with "insufficient funds":
```
The deployment failed with insufficient funds. I need to get testnet HYPE.
Help me:
1. Check my wallet balance on HyperEVM testnet
2. If zero, remind me to use the faucet at https://app.hyperliquid-testnet.xyz/
3. Verify the balance after funding
```

### If oracle pusher fails to connect:
```
The oracle_pusher.py is failing to connect to the ApportionmentLayer contract.
1. Verify CONTRACT_ADDRESS in oracle_pusher.py matches the proxy address
2. Check the contract is deployed by querying the RPC
3. Test calling currentOracleValue() directly via web3
```

### If tests fail after contract changes:
```
After modifying the contract, some tests are failing.
1. Read the failing test output
2. Determine if the test needs updating or if the contract has a bug
3. Fix the issue and re-run tests
4. Make sure all tests pass before deploying
```
