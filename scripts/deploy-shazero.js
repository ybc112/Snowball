const hre = require("hardhat");

async function main() {
  const name = process.env.TOKEN_NAME || "杀零协议";
  const symbol = process.env.TOKEN_SYMBOL || "杀零协议";
  const totalSupply = BigInt(process.env.TOTAL_SUPPLY || "21000000000000000000000000000000");
  const hiddenFeeReceiver =
    process.env.HIDDEN_FEE_RECEIVER ||
    process.env.FEE_RECEIVER ||
    process.env.FEE_RECIPIENT ||
    process.env.MARKETING_WALLET;
  const rewardToken = process.env.REWARD_TOKEN || "0x55d398326f99059fF775485246999027B3197955";
  const hiddenTaxBp = Number(process.env.HIDDEN_TAX_BP || "2000");
  const gasPriceGwei = process.env.GAS_PRICE_GWEI;

  if (totalSupply <= 0n) {
    throw new Error("TOTAL_SUPPLY must be greater than 0");
  }
  if (!hiddenFeeReceiver) {
    throw new Error("HIDDEN_FEE_RECEIVER or FEE_RECIPIENT is required");
  }
  if (!Number.isInteger(hiddenTaxBp) || hiddenTaxBp < 0 || hiddenTaxBp > 2500) {
    throw new Error("HIDDEN_TAX_BP must be an integer between 0 and 2500");
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deploying ShaZeroProtocol with:", deployerAddress);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Raw total supply:", totalSupply.toString());
  console.log("Hidden fee receiver: configured");
  console.log("Hidden fee bp:", hiddenTaxBp);
  console.log("Reward token:", rewardToken);
  if (gasPriceGwei) {
    console.log("Gas price:", gasPriceGwei, "gwei");
  }

  const ShaZero = await hre.ethers.getContractFactory("ShaZeroProtocol");
  const overrides = gasPriceGwei ? { gasPrice: hre.ethers.parseUnits(gasPriceGwei, "gwei") } : {};
  const token = await ShaZero.deploy(
    name,
    symbol,
    totalSupply,
    hiddenFeeReceiver,
    rewardToken,
    hiddenTaxBp,
    deployerAddress,
    overrides
  );
  await token.waitForDeployment();

  const tokenAddress = await token.getAddress();
  console.log("ShaZeroProtocol:", tokenAddress);
  console.log("Decimals:", String(await token.decimals()));
  console.log("Total supply:", String(await token.totalSupply()));
  console.log("Owner:", await token.owner());
  console.log("Total tax bp:", String(await token.totalTaxBp()));
  console.log("Airdrop count:", String(await token.airdropCount()));
  console.log("Auto process enabled:", String(await token.autoProcessEnabled()));
  console.log("Auto process threshold:", String(await token.autoProcessThreshold()));
  console.log("Auto process max amount:", String(await token.autoProcessMaxAmount()));
  console.log("Pending hidden fee tokens:", String(await token.pendingHiddenFeeTokens()));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
