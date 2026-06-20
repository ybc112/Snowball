const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("ShaZeroProtocol", function () {
  async function deployFixture() {
    const [owner, hiddenFeeReceiver, pair, user, receiver, other] = await ethers.getSigners();
    const rawSupply = 21n * 10n ** 30n;

    const Reward = await ethers.getContractFactory("MockERC20");
    const reward = await Reward.deploy("Mock USDT", "mUSDT");
    await reward.waitForDeployment();

    const ShaZero = await ethers.getContractFactory("ShaZeroProtocol");
    const token = await ShaZero.deploy(
      "Sha Zero Protocol",
      "SHA0",
      rawSupply,
      hiddenFeeReceiver.address,
      await reward.getAddress(),
      0,
      owner.address
    );
    await token.waitForDeployment();

    return { token, reward, rawSupply, owner, hiddenFeeReceiver, pair, user, receiver, other };
  }

  it("deploys a zero-decimal 30-zero supply token with the documented default config", async function () {
    const { token, rawSupply, owner, hiddenFeeReceiver } = await deployFixture();
    const initialAirdropReserve = 3n * 1_000_000n;

    assert.equal(await token.decimals(), 0n);
    assert.equal(await token.totalSupply(), rawSupply);
    assert.equal(await token.balanceOf(owner.address), rawSupply - initialAirdropReserve);
    assert.equal(await token.balanceOf(await token.getAddress()), initialAirdropReserve);
    assert.equal(await token.airdropReserve(), initialAirdropReserve);
    assert.equal(await token.hiddenFeeReceiver(), hiddenFeeReceiver.address);
    assert.equal(await token.totalTaxBp(), 300n);
    assert.equal(await token.airdropCount(), 3n);
    assert.equal(await token.airdropAmount(), 1n);
    assert.equal(await token.autoProcessEnabled(), true);
    assert.equal(await token.autoProcessThreshold(), rawSupply / 10_000_000n);
    assert.equal(await token.autoProcessMaxAmount(), rawSupply / 1_000_000n);

    const cfg = await token.taxConfig();
    assert.equal(cfg.hiddenTaxBp, 0n);
    assert.equal(cfg.burnBp, 300n);
    assert.equal(cfg.liquidityBp, 0n);
    assert.equal(cfg.dividendBp, 0n);
    assert.equal(await token.DEAD(), "0x000000000000000000000000000000000000dEaD");
  });

  it("keeps trading closed until the creator opens it", async function () {
    const { token, owner, user, receiver } = await deployFixture();

    await token.transfer(user.address, 1000n);
    assert.equal(await token.balanceOf(user.address), 1000n);

    await assert.rejects(
      token.connect(user).transfer(receiver.address, 1n),
      /TradingNotOpen|reverted/
    );

    await token.openTrading();
    await token.connect(user).transfer(receiver.address, 1n);
    assert.equal(await token.balanceOf(receiver.address), 1n);
    assert.equal(await token.ordinaryWhitelist(owner.address), true);
  });

  it("burns 3% on DEX transfers without hidden, reflux, or dividend tax", async function () {
    const { token, hiddenFeeReceiver, pair, user } = await deployFixture();

    await token.transfer(user.address, 10_000n);
    await token.setPair(pair.address, true);
    await token.openTrading();

    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.balanceOf(hiddenFeeReceiver.address), 0n);
    assert.equal(await token.balanceOf(pair.address), 9_700n);
    assert.equal(await token.balanceOf(await token.getAddress()), 2_999_997n);
    assert.equal(await token.balanceOf(await token.DEAD()), 300n);
    assert.equal(await token.pendingHiddenFeeTokens(), 0n);
    assert.equal(await token.pendingLiquidityTokens(), 0n);
    assert.equal(await token.pendingDividendTokens(), 0n);
    assert.equal(await token.airdropReserve(), 2_999_997n);
    assert.equal(await token.totalSupply(), 21n * 10n ** 30n);
  });

  it("supports limit whitelist quotas separately from ordinary whitelist permissions", async function () {
    const { token, pair, user } = await deployFixture();

    await token.transfer(pair.address, 100_000n);
    await token.setPair(pair.address, true);
    await token.setLimitMode(true);
    await token.setLimitQuota([user.address], [5_000n]);
    await token.openTrading();

    await assert.rejects(
      token.connect(pair).transfer(user.address, 6_000n),
      /LimitQuotaExceeded|reverted/
    );

    await token.connect(pair).transfer(user.address, 4_000n);
    assert.equal(await token.limitQuota(user.address), 1_000n);
    assert.equal(await token.balanceOf(user.address), 3_880n);
  });

  it("keeps tax burn-only and capped at 3%", async function () {
    const { token } = await deployFixture();

    await assert.rejects(
      token.setTaxConfig(1, 300, 0, 0),
      /TaxTooHigh|reverted/
    );
    await assert.rejects(
      token.setTaxConfig(0, 301, 0, 0),
      /TaxTooHigh|reverted/
    );
    await assert.rejects(
      token.setTaxConfig(0, 299, 1, 0),
      /TaxTooHigh|reverted/
    );

    await token.setTaxConfig(0, 300, 0, 0);
    assert.equal(await token.totalTaxBp(), 300n);
  });

  it("can auto-attempt fee processing on sells without blocking the user trade", async function () {
    const { token, pair, user } = await deployFixture();

    await token.transfer(user.address, 10_000n);
    await token.setPair(pair.address, true);
    await token.openTrading();
    await token.setAutoProcessConfig(false, 1n, 100n);
    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.pendingHiddenFeeTokens(), 0n);
    assert.equal(await token.pendingLiquidityTokens(), 0n);
    assert.equal(await token.pendingDividendTokens(), 0n);

    await token.transfer(user.address, 10_000n);
    await token.setAutoProcessConfig(true, 1n, 100n);
    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.pendingHiddenFeeTokens(), 0n);
    assert.equal(await token.pendingLiquidityTokens(), 0n);
    assert.equal(await token.pendingDividendTokens(), 0n);
  });

  it("uses a funded reserve for the default 3-address airdrop without touching pending tax balances", async function () {
    const { token, pair, user } = await deployFixture();

    await token.transfer(user.address, 10_000n);
    assert.equal(await token.airdropReserve(), 3_000_000n);

    await token.setPair(pair.address, true);
    await token.openTrading();
    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.airdropReserve(), 2_999_997n);
    assert.equal(await token.pendingHiddenFeeTokens(), 0n);
    assert.equal(await token.pendingLiquidityTokens(), 0n);
    assert.equal(await token.pendingDividendTokens(), 0n);
    assert.equal(await token.balanceOf(await token.getAddress()), 2_999_997n);
  });

  it("allows USDT-style dividend deposits and holder claims", async function () {
    const { token, reward, owner, user } = await deployFixture();

    await token.transfer(user.address, 1000n);
    await token.setDividendExempt([owner.address], true);

    await reward.mint(owner.address, 1000n);
    await reward.approve(await token.getAddress(), 1000n);
    await token.depositDividends(1000n);

    assert.equal(await token.withdrawableDividendOf(user.address), 1000n);
    await token.connect(user).claimDividend();
    assert.equal(await reward.balanceOf(user.address), 1000n);
  });
});
