const hre = require("hardhat");

async function main() {
  const tokenFilter = process.env.TOKEN_ADDRESS ? hre.ethers.getAddress(process.env.TOKEN_ADDRESS) : "";
  const createTx = process.env.CREATE_TX || process.env.DEPLOY_TX || "";
  if (!createTx) {
    throw new Error("Set CREATE_TX to the SnowballLaunchpad createToken transaction hash");
  }

  const receipt = await hre.ethers.provider.getTransactionReceipt(createTx);
  if (!receipt) throw new Error("Create transaction receipt not found");

  const Launchpad = await hre.ethers.getContractFactory("SnowballLaunchpad");
  let verifyArgs;
  let tokenAddress;

  for (const log of receipt.logs) {
    try {
      const parsed = Launchpad.interface.parseLog(log);
      if (parsed?.name !== "TokenVerificationData") continue;
      const eventToken = hre.ethers.getAddress(parsed.args.token);
      if (tokenFilter && eventToken !== tokenFilter) continue;

      tokenAddress = eventToken;
      verifyArgs = [
        parsed.args.name,
        parsed.args.symbol,
        parsed.args.totalSupply,
        parsed.args.hiddenFeeReceiver,
        parsed.args.rewardToken,
        [
          parsed.args.hiddenTaxBp,
          parsed.args.burnBp,
          parsed.args.liquidityBp,
          parsed.args.dividendBp
        ],
        parsed.args.initialOwner,
        Array.from(parsed.args.ordinaryWhitelist),
        Array.from(parsed.args.limitAccounts),
        Array.from(parsed.args.limitQuotas),
        parsed.args.limitModeEnabled
      ];
      break;
    } catch {}
  }

  if (!verifyArgs || !tokenAddress) {
    throw new Error("TokenVerificationData event not found in CREATE_TX");
  }

  await hre.run("verify:verify", {
    address: tokenAddress,
    constructorArguments: verifyArgs,
    contract: "contracts/SnowballToken.sol:SnowballToken"
  });

  console.log(`Verified SnowballToken ${tokenAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
