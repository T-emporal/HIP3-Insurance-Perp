const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // Read existing deployment info
  const infoPath = path.join(__dirname, "..", "..", "simulation", "deploy-info.json");
  if (!fs.existsSync(infoPath)) {
    console.error("No deploy-info.json found. Run deploy.js first.");
    process.exit(1);
  }
  const deployInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));
  const proxyAddr = deployInfo.proxy;

  console.log("Upgrading proxy at:", proxyAddr);

  const ApportionmentLayerV2 = await ethers.getContractFactory("ApportionmentLayerV2");
  const upgraded = await upgrades.upgradeProxy(proxyAddr, ApportionmentLayerV2);
  await upgraded.waitForDeployment();

  const newImplAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log("\n=== Upgrade Successful ===");
  console.log("Proxy address (unchanged):", proxyAddr);
  console.log("New implementation:       ", newImplAddr);
  console.log("Version:                  ", await upgraded.version());

  // Update deployment info
  deployInfo.implementation = newImplAddr;
  deployInfo.upgradedAt = new Date().toISOString();
  deployInfo.version = "2.0.0";
  fs.writeFileSync(infoPath, JSON.stringify(deployInfo, null, 2));

  // Update ABI to V2
  const outDir = path.join(__dirname, "..", "..", "simulation");
  const artifact = await artifacts.readArtifact("ApportionmentLayerV2");
  fs.writeFileSync(path.join(outDir, "abi.json"), JSON.stringify(artifact.abi, null, 2));

  console.log("\nDeploy info updated. ABI updated to V2.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
