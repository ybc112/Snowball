const hre = require("hardhat");

async function main() {
  const name = process.env.TOKEN_NAME || "Good Luck Token";
  const symbol = process.env.TOKEN_SYMBOL || "GLT";
  const totalSupply = BigInt(process.env.TOTAL_SUPPLY || "1000000000000000000000000000000");

  if (totalSupply <= 0n) {
    throw new Error("TOTAL_SUPPLY must be greater than 0");
  }

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying TokenZero with:", await deployer.getAddress());
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Raw total supply:", totalSupply.toString());

  const TokenZero = await hre.ethers.getContractFactory("TokenZero");
  const token = await TokenZero.deploy(name, symbol, totalSupply);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("TokenZero:", tokenAddress);
  console.log("Decimals:", String(await token.decimals()));
  console.log("Total supply:", String(await token.totalSupply()));
  console.log("Owner:", await token.owner());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
