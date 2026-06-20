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
    assert.equal(await token.rewardToken(), await fixture.launchpad.BSC_USDT());
    assert.equal(await token.totalTaxBp(), 1500n);
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

  it("applies the default 15% hidden tax template on DEX transfers", async function () {
    const fixture = await deployFixture();
    const { token } = await createSnowballToken(fixture);

    await token.connect(fixture.creator).transfer(fixture.buyer.address, 10_000n);
    await token.connect(fixture.creator).setPair(fixture.pair.address, true);
    await token.connect(fixture.creator).openTrading();
    await token.connect(fixture.buyer).transfer(fixture.pair.address, 10_000n);

    assert.equal(await token.balanceOf(fixture.pair.address), 8500n);
    assert.equal(await token.pendingHiddenFeeTokens(), 1500n);
    assert.equal(await token.pendingLiquidityTokens(), 0n);
    assert.equal(await token.pendingDividendTokens(), 0n);
  });

  it("caps launchpad defaults at 15% total tax", async function () {
    const fixture = await deployFixture();

    await assert.rejects(
      fixture.launchpad.setDefaultTaxConfig(1501, 0, 0, 0),
      /InvalidInput|reverted/
    );

    await fixture.launchpad.setDefaultTaxConfig(1400, 50, 50, 0);
    const cfg = await fixture.launchpad.defaultTaxConfig();
    assert.equal(cfg.hiddenTaxBp, 1400n);
    assert.equal(cfg.burnBp, 50n);
    assert.equal(cfg.liquidityBp, 50n);
    assert.equal(cfg.dividendBp, 0n);
  });
});
