// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/ApportionmentLayer.sol";

/**
 * Deploy the ApportionmentLayer to HyperEVM testnet.
 *
 * Usage:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url hyperevm_testnet \
 *     --private-key $PRIVATE_KEY \
 *     --broadcast \
 *     -vvv
 *
 * The deployer address becomes the contract owner (oracle updater).
 * Record the deployed address; set CONTRACT_ADDRESS in oracle_pusher.py.
 */
contract DeployApportionmentLayer is Script {
    function run() external {
        vm.startBroadcast();
        ApportionmentLayer layer = new ApportionmentLayer();
        console2.log("ApportionmentLayer deployed at:", address(layer));
        console2.log("Owner:", layer.owner());
        vm.stopBroadcast();
    }
}
