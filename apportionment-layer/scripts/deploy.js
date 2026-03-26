const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const ApportionmentLayer = await ethers.getContractFactory("ApportionmentLayer");
  const proxy = await upgrades.deployProxy(ApportionmentLayer, [], {
    initializer: "initialize",
    kind: "uups",
  });
  await proxy.waitForDeployment();

  const proxyAddr = await proxy.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log("\n=== Deployment Successful ===");
  console.log("Proxy address:         ", proxyAddr);
  console.log("Implementation address:", implAddr);
  console.log("Owner:                 ", await proxy.owner());

  // Write deployment info for simulation UI and oracle_pusher
  const deployInfo = {
    network: (await ethers.provider.getNetwork()).name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    proxy: proxyAddr,
    implementation: implAddr,
    owner: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const outDir = path.join(__dirname, "..", "..", "simulation");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deploy-info.json"), JSON.stringify(deployInfo, null, 2));

  // Copy ABI for simulation UI
  const artifact = await artifacts.readArtifact("ApportionmentLayer");
  fs.writeFileSync(path.join(outDir, "abi.json"), JSON.stringify(artifact.abi, null, 2));

  console.log("\nDeploy info written to simulation/deploy-info.json");
  console.log("ABI written to simulation/abi.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
