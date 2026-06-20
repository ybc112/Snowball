const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("TokenZero", function () {
  it("deploys a 30-zero raw supply token with zero decimals", async function () {
    const [owner, user, receiver] = await ethers.getSigners();
    const rawSupply = 10n ** 30n;

    const TokenZero = await ethers.getContractFactory("TokenZero");
    const token = await TokenZero.deploy("Good Luck Token", "GLT", rawSupply);
    await token.waitForDeployment();

    assert.equal(await token.decimals(), 0n);
    assert.equal(await token.totalSupply(), rawSupply);
    assert.equal(await token.balanceOf(owner.address), rawSupply);

    await token.transfer(user.address, 1000n);
    assert.equal(await token.balanceOf(user.address), 1000n);

    await assert.rejects(
      token.connect(user).transfer(receiver.address, 1n),
      /InStatusError|reverted/
    );

    await token.startNow();
    await token.connect(user).transfer(receiver.address, 1n);
    assert.equal(await token.balanceOf(receiver.address), 1n);
  });
});
