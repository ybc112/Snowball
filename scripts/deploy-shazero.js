const hre = require("hardhat");

async function main() {
  const name = process.env.TOKEN_NAME || "Snowball";
  const symbol = process.env.TOKEN_SYMBOL || "Snowball";
  const totalSupply = BigInt(process.env.TOTAL_SUPPLY || "21000000000000000000000000000000");
  const gasPriceGwei = process.env.GAS_PRICE_GWEI;

  if (totalSupply <= 0n) {
    throw new Error("TOTAL_SUPPLY must be greater than 0");
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deploying ShaZeroProtocol with:", deployerAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Raw total supply:", totalSupply.toString());
  if (gasPriceGwei) {
    console.log("Gas price:", gasPriceGwei, "gwei");
  }

  const ShaZero = await hre.ethers.getContractFactory("ShaZeroProtocol");
  const overrides = gasPriceGwei ? { gasPrice: hre.ethers.parseUnits(gasPriceGwei, "gwei") } : {};
  const token = await ShaZero.deploy(name, symbol, totalSupply, deployerAddress, overrides);
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("ShaZeroProtocol:", tokenAddress);
  console.log("Decimals:", String(await token.decimals()));
  console.log("Total supply:", String(await token.totalSupply()));
  console.log("Owner:", await token.owner());
  console.log("Total tax bp:", String(await token.totalTaxBp()));
  console.log("Burn tax bp:", String(await token.burnTaxBp()));
  console.log("Airdrop count:", String(await token.airdropCount()));
  console.log("Trading open:", String(await token.tradingOpen()));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
