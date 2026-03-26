const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("ApportionmentLayer", function () {
  let layer, owner, insured1, insured2, other;
  const V1 = ethers.parseEther("10"); // 10 HYPE
  const V2 = ethers.parseEther("20"); // 20 HYPE
  const PI1 = 500n;  // 5% risk
  const PI2 = 1000n; // 10% risk

  beforeEach(async function () {
    [owner, insured1, insured2, other] = await ethers.getSigners();
    const ApportionmentLayer = await ethers.getContractFactory("ApportionmentLayer");
    layer = await upgrades.deployProxy(ApportionmentLayer, [], {
      initializer: "initialize",
      kind: "uups",
    });
    await layer.waitForDeployment();
  });

  describe("Initialization", function () {
    it("sets the deployer as owner", async function () {
      expect(await layer.owner()).to.equal(owner.address);
    });

    it("starts with empty pool", async function () {
      expect(await layer.V_pool()).to.equal(0n);
      expect(await layer.piV_pool()).to.equal(0n);
      expect(await layer.insuredCount()).to.equal(0n);
    });
  });

  describe("Registration", function () {
    it("registers an insured entity", async function () {
      await expect(layer.register(insured1.address, V1, PI1))
        .to.emit(layer, "Registered")
        .withArgs(insured1.address, V1, PI1);

      const ins = await layer.getInsured(insured1.address);
      expect(ins.V).to.equal(V1);
      expect(ins.pi).to.equal(PI1);
      expect(ins.active).to.be.true;
      expect(await layer.V_pool()).to.equal(V1);
      expect(await layer.piV_pool()).to.equal(PI1 * V1);
    });

    it("rejects duplicate registration", async function () {
      await layer.register(insured1.address, V1, PI1);
      await expect(layer.register(insured1.address, V1, PI1))
        .to.be.revertedWith("AL: already registered");
    });

    it("rejects zero address", async function () {
      await expect(layer.register(ethers.ZeroAddress, V1, PI1))
        .to.be.revertedWith("AL: zero address");
    });

    it("rejects zero V", async function () {
      await expect(layer.register(insured1.address, 0n, PI1))
        .to.be.revertedWith("AL: V must be > 0");
    });

    it("rejects pi out of range", async function () {
      await expect(layer.register(insured1.address, V1, 0n))
        .to.be.revertedWith("AL: pi must be (0, 10000]");
      await expect(layer.register(insured1.address, V1, 10001n))
        .to.be.revertedWith("AL: pi must be (0, 10000]");
    });

    it("only owner can register", async function () {
      await expect(layer.connect(other).register(insured1.address, V1, PI1))
        .to.be.revertedWithCustomError(layer, "OwnableUnauthorizedAccount");
    });
  });

  describe("Deregistration", function () {
    beforeEach(async function () {
      await layer.register(insured1.address, V1, PI1);
    });

    it("deregisters and updates pool", async function () {
      await expect(layer.deregister(insured1.address))
        .to.emit(layer, "Deregistered");
      expect(await layer.V_pool()).to.equal(0n);
      const ins = await layer.getInsured(insured1.address);
      expect(ins.active).to.be.false;
    });

    it("rejects deregistering non-registered", async function () {
      await expect(layer.deregister(insured2.address))
        .to.be.revertedWith("AL: not registered");
    });
  });

  describe("Event Trigger + Payout", function () {
    const LAMBDA = 5000n; // 50% loss

    beforeEach(async function () {
      await layer.register(insured1.address, V1, PI1);
      await layer.register(insured2.address, V2, PI2);
      // Fund contract (simulates funding inflows from perp during event)
      await owner.sendTransaction({ to: await layer.getAddress(), value: ethers.parseEther("100") });
    });

    it("triggers event and computes oracle value", async function () {
      const tx = await layer.triggerEvent(insured1.address, LAMBDA);
      await expect(tx).to.emit(layer, "EventTriggered");

      expect(await layer.eventActive()).to.be.true;
      expect(await layer.eventInsured()).to.equal(insured1.address);
      expect(await layer.V_snap()).to.equal(V1 + V2);

      // O(T*) = V1 * 5000 * 100 / (V1 + V2)
      const expectedOracle = (V1 * LAMBDA * 100n) / (V1 + V2);
      expect(await layer.oracleValue6()).to.equal(expectedOracle);

      // Payout = V1 * 5000 / 10000 = 5 HYPE
      expect(await layer.pendingPayout()).to.equal(V1 * LAMBDA / 10_000n);

      expect(await layer.currentOracleValue()).to.equal(expectedOracle);
    });

    it("routes payout and clears event", async function () {
      await layer.triggerEvent(insured1.address, LAMBDA);
      const payout = await layer.pendingPayout();

      const balBefore = await ethers.provider.getBalance(insured1.address);
      await layer.routePayout();
      const balAfter = await ethers.provider.getBalance(insured1.address);

      expect(balAfter - balBefore).to.equal(payout);
      expect(await layer.eventActive()).to.be.false;
      expect(await layer.currentOracleValue()).to.equal(0n);
    });

    it("prevents double trigger", async function () {
      await layer.triggerEvent(insured1.address, LAMBDA);
      await expect(layer.triggerEvent(insured2.address, LAMBDA))
        .to.be.revertedWith("AL: event active");
    });

    it("prevents deregister of event insured", async function () {
      await layer.triggerEvent(insured1.address, LAMBDA);
      await expect(layer.deregister(insured1.address))
        .to.be.revertedWith("AL: cannot deregister active event insured");
      // But can deregister other insured
      await layer.deregister(insured2.address);
    });

    it("rejects payout when balance insufficient", async function () {
      const AL = await ethers.getContractFactory("ApportionmentLayer");
      const fresh = await upgrades.deployProxy(AL, [], { initializer: "initialize", kind: "uups" });
      await fresh.waitForDeployment();
      await fresh.register(insured1.address, V1, PI1);
      await fresh.triggerEvent(insured1.address, LAMBDA);
      await expect(fresh.routePayout()).to.be.revertedWith("AL: insufficient balance");
    });
  });

  describe("Pool Views", function () {
    beforeEach(async function () {
      await layer.register(insured1.address, V1, PI1);
      await layer.register(insured2.address, V2, PI2);
    });

    it("computes piPoolWeighted correctly", async function () {
      const expected = (PI1 * V1 + PI2 * V2) / (V1 + V2);
      expect(await layer.piPoolWeighted()).to.equal(expected);
    });

    it("computes premiumWeight correctly", async function () {
      const piVPool = PI1 * V1 + PI2 * V2;
      const w1 = (V1 * PI1 * 10_000n) / piVPool;
      expect(await layer.premiumWeight(insured1.address)).to.equal(w1);
    });
  });

  describe("UUPS Upgrade", function () {
    it("upgrades to V2 and preserves state", async function () {
      await layer.register(insured1.address, V1, PI1);
      const insBefore = await layer.getInsured(insured1.address);

      const V2Factory = await ethers.getContractFactory("ApportionmentLayerV2");
      const upgraded = await upgrades.upgradeProxy(await layer.getAddress(), V2Factory);

      expect(await upgraded.V_pool()).to.equal(V1);
      const insAfter = await upgraded.getInsured(insured1.address);
      expect(insAfter.V).to.equal(insBefore.V);
      expect(insAfter.pi).to.equal(insBefore.pi);
      expect(insAfter.active).to.equal(insBefore.active);

      expect(await upgraded.version()).to.equal("2.0.0");
      await upgraded.setFMax(10n);
      expect(await upgraded.fMaxBps()).to.equal(10n);
    });

    it("non-owner cannot upgrade", async function () {
      const V2Factory = await ethers.getContractFactory("ApportionmentLayerV2", other);
      await expect(upgrades.upgradeProxy(await layer.getAddress(), V2Factory))
        .to.be.revertedWithCustomError(layer, "OwnableUnauthorizedAccount");
    });

    it("V2 calculateNStar works correctly", async function () {
      await layer.register(insured1.address, V1, PI1);
      await owner.sendTransaction({ to: await layer.getAddress(), value: ethers.parseEther("100") });

      const V2Factory = await ethers.getContractFactory("ApportionmentLayerV2");
      const upgraded = await upgrades.upgradeProxy(await layer.getAddress(), V2Factory);

      await upgraded.setFMax(10n);
      await upgraded.triggerEvent(insured1.address, 5000n);

      const oracle = await upgraded.oracleValue6();
      const nStar = await upgraded.calculateNStar();
      const expected = (oracle + 999n) / 1000n;
      expect(nStar).to.equal(expected);
    });
  });
});
