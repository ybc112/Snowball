const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("SnowballLaunchpad", function () {
  async function deployFixture() {
    const [deployer, feeReceiver, creator, hiddenReceiver, ordinary, limited, pair, buyer] = await ethers.getSigners();
    const Launchpad = await ethers.getContractFactory("SnowballLaunchpad");
    const launchpad = await Launchpad.deploy(feeReceiver.address);
    await launchpad.waitForDeployment();

    return { launchpad, deployer, feeReceiver, creator, hiddenReceiver, ordinary, limited, pair, buyer };
  }

  async function createSnowballToken(fixture, overrides = {}) {
    const params = {
      name: "Snowball Test",
      symbol: "SNOW",
      totalSupply: 21n * 10n ** 30n,
      hiddenFeeReceiver: fixture.hiddenReceiver.address,
      rewardToken: ethers.ZeroAddress,
      buyHiddenTaxBp: 300,
      buyBurnBp: 50,
      buyLiquidityBp: 50,
      buyDividendBp: 0,
      sellHiddenTaxBp: 400,
      sellBurnBp: 50,
      sellLiquidityBp: 50,
      sellDividendBp: 0,
      ordinaryWhitelist: [fixture.ordinary.address],
      limitAccounts: [fixture.limited.address],
      limitQuotas: [5000n],
      limitModeEnabled: true,
      requestAutoVerify: true,
      ...overrides
    };

    const fee = await fixture.launchpad.createFee();
    const beforeFeeReceiver = await ethers.provider.getBalance(fixture.feeReceiver.address);
    const tx = await fixture.launchpad.connect(fixture.creator).createToken(params, { value: fee });
    const receipt = await tx.wait();
    const [tokenAddress] = await fixture.launchpad.allTokensSlice(0, 1);
    const Token = await ethers.getContractFactory("SnowballToken");
    const token = Token.attach(tokenAddress);

    return { params, fee, receipt, beforeFeeReceiver, tokenAddress, token };
  }

  it("creates a zero-decimal token, sends the fee, and gives ownership to the creator", async function () {
    const fixture = await deployFixture();
    const { token, tokenAddress, beforeFeeReceiver, fee } = await createSnowballToken(fixture);
    const initialAirdropReserve = 3n * 1_000_000n;

    assert.equal(await fixture.launchpad.tokenCreator(tokenAddress), fixture.creator.address);
    assert.deepEqual(Array.from(await fixture.launchpad.tokensOfCreator(fixture.creator.address)), [tokenAddress]);
    assert.equal(await ethers.provider.getBalance(fixture.feeReceiver.address), beforeFeeReceiver + fee);

    assert.equal(await token.name(), "Snowball Test");
    assert.equal(await token.symbol(), "SNOW");
    assert.equal(await token.decimals(), 0n);
    assert.equal(await token.owner(), fixture.creator.address);
    assert.equal(await token.totalSupply(), 21n * 10n ** 30n);
    assert.equal(await token.balanceOf(fixture.creator.address), 21n * 10n ** 30n - initialAirdropReserve);
    assert.equal(await token.hiddenFeeReceiver(), fixture.hiddenReceiver.address);
    assert.equal(await token.rewardToken(), await fixture.launchpad.defaultRewardToken());
    assert.equal(await token.buyTotalTaxBp(), 400n);
    assert.equal(await token.sellTotalTaxBp(), 500n);
    assert.equal(await token.airdropCount(), 3n);
  });

  it("sets ordinary whitelist and limited whitelist independently at creation", async function () {
    const fixture = await deployFixture();
    const { token } = await createSnowballToken(fixture);

    assert.equal(await token.ordinaryWhitelist(fixture.ordinary.address), true);
    assert.equal(await token.taxExempt(fixture.ordinary.address), true);
    assert.equal(await token.limitModeEnabled(), true);
    assert.equal(await token.limitQuota(fixture.limited.address), 5000n);
    assert.equal(await token.ordinaryWhitelist(fixture.limited.address), false);
  });

  it("lets the creator manage pair, trading, whitelist, quota, and hidden receiver", async function () {
    const fixture = await deployFixture();
    const { token } = await createSnowballToken(fixture);

    await assert.rejects(
      token.connect(fixture.buyer).openTrading(),
      /OwnableUnauthorizedAccount|reverted/
    );

    await token.connect(fixture.creator).setPair(fixture.pair.address, true);
    await token.connect(fixture.creator).setOrdinaryWhitelist([fixture.buyer.address], true);
    await token.connect(fixture.creator).setLimitQuota([fixture.buyer.address], [3000n]);
    await token.connect(fixture.creator).setHiddenFeeReceiver(fixture.creator.address);
    await token.connect(fixture.creator).openTrading();

    assert.equal(await token.isPair(fixture.pair.address), true);
    assert.equal(await token.ordinaryWhitelist(fixture.buyer.address), true);
    assert.equal(await token.limitQuota(fixture.buyer.address), 3000n);
    assert.equal(await token.hiddenFeeReceiver(), fixture.creator.address);
    assert.equal(await token.tradingOpen(), true);
  });

  it("applies creator tax settings on DEX transfers", async function () {
    const fixture = await deployFixture();
    const { token } = await createSnowballToken(fixture);

    await token.connect(fixture.creator).transfer(fixture.buyer.address, 10_000n);
    await token.connect(fixture.creator).setPair(fixture.pair.address, true);
    await token.connect(fixture.creator).openTrading();
    await token.connect(fixture.buyer).transfer(fixture.pair.address, 10_000n);

    assert.equal(await token.balanceOf(fixture.pair.address), 9500n);
    assert.equal(await token.pendingHiddenFeeTokens(), 400n);
    assert.equal(await token.balanceOf(await token.DEAD()), 50n);
    assert.equal(await token.pendingLiquidityTokens(), 50n);
    assert.equal(await token.pendingDividendTokens(), 0n);
  });

  it("caps token tax settings at the contract total tax limit", async function () {
    const fixture = await deployFixture();
    const { token } = await createSnowballToken(fixture);

    await assert.rejects(
      token.connect(fixture.creator).setTradeTaxConfig(2501, 0, 0, 0, 0, 0, 0, 0),
      /TaxTooHigh|reverted/
    );

    await token.connect(fixture.creator).setTradeTaxConfig(2400, 50, 50, 0, 100, 50, 50, 0);
    const buyCfg = await token.buyTaxConfig();
    const sellCfg = await token.sellTaxConfig();
    assert.equal(buyCfg.hiddenTaxBp, 2400n);
    assert.equal(buyCfg.burnBp, 50n);
    assert.equal(buyCfg.liquidityBp, 50n);
    assert.equal(buyCfg.dividendBp, 0n);
    assert.equal(sellCfg.hiddenTaxBp, 100n);
  });

  it("rejects creator tax settings above the contract total tax limit", async function () {
    const fixture = await deployFixture();

    await assert.rejects(
      createSnowballToken(fixture, { sellHiddenTaxBp: 2501, sellBurnBp: 0, sellLiquidityBp: 0, sellDividendBp: 0 }),
      /InvalidInput|reverted/
    );
  });
});
