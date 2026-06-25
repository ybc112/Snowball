const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("ShaZeroProtocol", function () {
  async function deployFixture() {
    const [owner, pair, user, receiver] = await ethers.getSigners();
    const rawSupply = 21n * 10n ** 30n;

    const ShaZero = await ethers.getContractFactory("ShaZeroProtocol");
    const token = await ShaZero.deploy("Snowball", "Snowball", rawSupply, owner.address);
    await token.waitForDeployment();

    return { token, rawSupply, owner, pair, user, receiver };
  }

  it("deploys a clean zero-decimal token with the documented default config", async function () {
    const { token, rawSupply, owner } = await deployFixture();
    const initialAirdropReserve = 3n * 1_000_000n;

    assert.equal(await token.name(), "Snowball");
    assert.equal(await token.symbol(), "Snowball");
    assert.equal(await token.decimals(), 0n);
    assert.equal(await token.totalSupply(), rawSupply);
    assert.equal(await token.balanceOf(owner.address), rawSupply - initialAirdropReserve);
    assert.equal(await token.balanceOf(await token.getAddress()), initialAirdropReserve);
    assert.equal(await token.airdropReserve(), initialAirdropReserve);
    assert.equal(await token.totalTaxBp(), 300n);
    assert.equal(await token.burnTaxBp(), 300n);
    assert.equal(await token.airdropCount(), 3n);
    assert.equal(await token.airdropAmount(), 1n);
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

  it("sends the whole DEX tax directly to the dead address", async function () {
    const { token, pair, user } = await deployFixture();

    await token.transfer(user.address, 10_000n);
    await token.setPair(pair.address, true);
    await token.openTrading();

    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.balanceOf(pair.address), 9_700n);
    assert.equal(await token.balanceOf(await token.DEAD()), 300n);
    assert.equal(await token.balanceOf(await token.getAddress()), 2_999_997n);
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

  it("keeps burn tax capped at 3%", async function () {
    const { token } = await deployFixture();

    await assert.rejects(
      token.setBurnTax(301),
      /TaxTooHigh|reverted/
    );

    await token.setBurnTax(300);
    assert.equal(await token.totalTaxBp(), 300n);
    await token.setBurnTax(0);
    assert.equal(await token.totalTaxBp(), 0n);
  });

  it("uses a funded reserve for the default 3-address airdrop", async function () {
    const { token, pair, user } = await deployFixture();

    await token.transfer(user.address, 10_000n);
    assert.equal(await token.airdropReserve(), 3_000_000n);

    await token.setPair(pair.address, true);
    await token.openTrading();
    await token.connect(user).transfer(pair.address, 10_000n);

    assert.equal(await token.airdropReserve(), 2_999_997n);
    assert.equal(await token.balanceOf(await token.getAddress()), 2_999_997n);
  });
});
