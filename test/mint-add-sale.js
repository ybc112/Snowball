const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("MintAddSaleFactory", function () {
  async function deployFixture() {
    const [deployer, feeReceiver, creator, buyer, whitelisted] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("Sale Token", "SALE");
    await token.waitForDeployment();
    await token.mint(creator.address, 1_000_000n);

    const Weth = await ethers.getContractFactory("MockERC20");
    const weth = await Weth.deploy("Wrapped BNB", "WBNB");
    await weth.waitForDeployment();

    const Router = await ethers.getContractFactory("MockRouter");
    const router = await Router.deploy(await weth.getAddress());
    await router.waitForDeployment();

    const Factory = await ethers.getContractFactory("MintAddSaleFactory");
    const factory = await Factory.deploy(feeReceiver.address);
    await factory.waitForDeployment();

    return { deployer, feeReceiver, creator, buyer, whitelisted, token, weth, router, factory };
  }

  function saleParams(fixture, overrides = {}) {
    return {
      saleName: "Good Luck Token",
      token: overrides.token || fixture.token.target,
      router: overrides.router || fixture.router.target,
      fundReceiver: overrides.fundReceiver || fixture.creator.address,
      pricePerShare: overrides.pricePerShare ?? ethers.parseEther("0.001"),
      tokensPerShare: overrides.tokensPerShare ?? 1000n,
      totalShares: overrides.totalShares ?? 100n,
      maxSharesPerBuy: overrides.maxSharesPerBuy ?? 10n,
      maxSharesPerWallet: overrides.maxSharesPerWallet ?? 20n,
      whitelistTotalShares: overrides.whitelistTotalShares ?? 0n,
      bnbLiquidityBp: overrides.bnbLiquidityBp ?? 0,
      tokenLiquidityBp: overrides.tokenLiquidityBp ?? 0,
      whitelistEnabled: overrides.whitelistEnabled ?? false,
      lpBurnEnabled: overrides.lpBurnEnabled ?? false,
      saleOpen: overrides.saleOpen ?? true,
      whitelistAccounts: overrides.whitelistAccounts || [],
      whitelistQuotas: overrides.whitelistQuotas || []
    };
  }

  async function createSale(fixture, params = saleParams(fixture)) {
    const requiredTokens = params.totalShares * params.tokensPerShare;
    await fixture.token.connect(fixture.creator).approve(fixture.factory.target, requiredTokens);

    const fee = await fixture.factory.createFee();
    const beforeFeeReceiver = await ethers.provider.getBalance(fixture.feeReceiver.address);
    const tx = await fixture.factory.connect(fixture.creator).createSale(params, { value: fee });
    const receipt = await tx.wait();
    const [saleAddress] = await fixture.factory.allSalesSlice(0, 1);
    const Sale = await ethers.getContractFactory("MintAddSale");
    const sale = Sale.attach(saleAddress);
    return { sale, saleAddress, receipt, beforeFeeReceiver, fee, requiredTokens };
  }

  it("creates a mint-add sale, pulls tokens, and sends the creation fee", async function () {
    const fixture = await deployFixture();
    const { sale, saleAddress, beforeFeeReceiver, fee, requiredTokens } = await createSale(fixture);

    assert.equal(await fixture.factory.saleCreator(saleAddress), fixture.creator.address);
    assert.deepEqual(Array.from(await fixture.factory.salesOfCreator(fixture.creator.address)), [saleAddress]);
    assert.equal(await ethers.provider.getBalance(fixture.feeReceiver.address), beforeFeeReceiver + fee);
    assert.equal(await fixture.token.balanceOf(saleAddress), requiredTokens);
    assert.equal(await sale.owner(), fixture.creator.address);
    assert.equal(await sale.saleName(), "Good Luck Token");
    assert.equal(await sale.pricePerShare(), ethers.parseEther("0.001"));
    assert.equal(await sale.tokensPerShare(), 1000n);
  });

  it("lets whitelisted buyers mint only within their share quota", async function () {
    const fixture = await deployFixture();
    const params = saleParams(fixture, {
      whitelistEnabled: true,
      whitelistTotalShares: 10n,
      whitelistAccounts: [fixture.whitelisted.address],
      whitelistQuotas: [3n]
    });
    const { sale } = await createSale(fixture, params);

    await assert.rejects(
      sale.connect(fixture.buyer).buy(1n, { value: params.pricePerShare }),
      /WhitelistExceeded|reverted/
    );

    await sale.connect(fixture.whitelisted).buy(2n, { value: params.pricePerShare * 2n });
    assert.equal(await fixture.token.balanceOf(fixture.whitelisted.address), 2000n);
    assert.equal(await sale.whitelistQuota(fixture.whitelisted.address), 1n);
  });

  it("splits a mint into user tokens, BNB receiver funds, and auto LP", async function () {
    const fixture = await deployFixture();
    const params = saleParams(fixture, {
      bnbLiquidityBp: 10_000,
      tokenLiquidityBp: 5_000,
      lpBurnEnabled: true
    });
    const { sale } = await createSale(fixture, params);

    await sale.connect(fixture.buyer).buy(2n, { value: params.pricePerShare * 2n });

    assert.equal(await fixture.token.balanceOf(fixture.buyer.address), 1000n);
    assert.equal(await fixture.router.lastTokenAmount(), 1000n);
    assert.equal(await fixture.router.lastBnbAmount(), params.pricePerShare * 2n);
    assert.equal(await fixture.router.lastLpReceiver(), await sale.DEAD());
    assert.equal(await sale.soldShares(), 2n);
  });

  it("enforces per-buy and per-wallet share limits", async function () {
    const fixture = await deployFixture();
    const params = saleParams(fixture, {
      maxSharesPerBuy: 2n,
      maxSharesPerWallet: 3n
    });
    const { sale } = await createSale(fixture, params);

    await assert.rejects(
      sale.connect(fixture.buyer).buy(3n, { value: params.pricePerShare * 3n }),
      /BuyLimitExceeded|reverted/
    );

    await sale.connect(fixture.buyer).buy(2n, { value: params.pricePerShare * 2n });
    await assert.rejects(
      sale.connect(fixture.buyer).buy(2n, { value: params.pricePerShare * 2n }),
      /WalletLimitExceeded|reverted/
    );
  });
});
