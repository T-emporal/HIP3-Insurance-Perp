const { ethers, upgrades } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const signers = await ethers.getSigners();
  const owner = signers[0];
  const insuredA = signers[1];
  const insuredB = signers[2];
  const insuredC = signers[3];

  console.log("=== Deploying ApportionmentLayer (local) ===");
  console.log("Owner:    ", owner.address);

  const AL = await ethers.getContractFactory("ApportionmentLayer");
  const proxy = await upgrades.deployProxy(AL, [], {
    initializer: "initialize",
    kind: "uups",
  });
  await proxy.waitForDeployment();
  const proxyAddr = await proxy.getAddress();
  const implAddr = await upgrades.erc1967.getImplementationAddress(proxyAddr);

  console.log("Proxy:    ", proxyAddr);
  console.log("Impl:     ", implAddr);

  // --- Seed with test data ---
  console.log("\n=== Seeding test data ===");

  // Register 3 insured entities with varied risk profiles
  const insureds = [
    { signer: insuredA, V: ethers.parseEther("100"), pi: 300n, label: "LowRisk-Validator" },
    { signer: insuredB, V: ethers.parseEther("250"), pi: 750n, label: "MidRisk-Validator" },
    { signer: insuredC, V: ethers.parseEther("50"),  pi: 1500n, label: "HighRisk-Validator" },
  ];

  for (const ins of insureds) {
    await proxy.register(ins.signer.address, ins.V, ins.pi);
    console.log(`  Registered ${ins.label}: ${ins.signer.address} | V=${ethers.formatEther(ins.V)} HYPE | pi=${ins.pi} bps`);
  }

  // Pay some premiums
  for (const ins of insureds) {
    const premiumAmount = ins.V / 100n; // 1% of V as initial premium
    await proxy.connect(ins.signer).payPremium({ value: premiumAmount });
    console.log(`  Premium paid by ${ins.label}: ${ethers.formatEther(premiumAmount)} HYPE`);
  }

  // Fund contract with extra balance (simulates funding inflows from perp)
  await owner.sendTransaction({ to: proxyAddr, value: ethers.parseEther("500") });
  console.log("  Funded contract with 500 HYPE (simulated reinsurance pool)");

  const vPool = await proxy.V_pool();
  const piPool = await proxy.piPoolWeighted();
  const bal = await proxy.balance();
  console.log(`\n  Pool: V_pool=${ethers.formatEther(vPool)} HYPE | pi_pool=${piPool} bps | balance=${ethers.formatEther(bal)} HYPE`);

  // --- Write deployment + seed info ---
  const deployInfo = {
    network: "localhost",
    chainId: 31337,
    proxy: proxyAddr,
    implementation: implAddr,
    owner: owner.address,
    deployedAt: new Date().toISOString(),
    seedData: {
      insureds: insureds.map((ins, i) => ({
        label: ins.label,
        address: ins.signer.address,
        V: ethers.formatEther(ins.V),
        pi: Number(ins.pi),
        signerIndex: i + 1,
      })),
      note: "Hardhat accounts 0=owner, 1-3=insured. Use the UI to trigger events and test payouts.",
    },
  };

  const outDir = path.join(__dirname, "..", "..", "simulation");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deploy-info.json"), JSON.stringify(deployInfo, null, 2));

  const artifact = await artifacts.readArtifact("ApportionmentLayer");
  fs.writeFileSync(path.join(outDir, "abi.json"), JSON.stringify(artifact.abi, null, 2));

  console.log("\n=== Ready ===");
  console.log("Open http://localhost:3000 and click Connect");
  console.log("Contract is pre-loaded with 3 insured entities and 500 HYPE balance.");
  console.log("\nTry: Trigger a slash event on any insured, then route the payout.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
