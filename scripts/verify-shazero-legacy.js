const hre = require("hardhat");
const path = require("node:path");
const fs = require("node:fs");

async function main() {
  const record = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deployments", "snowball-legacy-hidden-tax-vanity-bsc.json"), "utf8")
  );

  const tokenAddress = process.env.TOKEN_ADDRESS || record.token;
  if (!tokenAddress) throw new Error("Token address missing");

  const constructorArguments = [
    record.name,
    record.symbol,
    BigInt(record.totalSupply).toString(),
    record.hiddenFeeReceiver,
    record.rewardToken,
    Number(record.hiddenTaxBp),
    Number(record.burnBp),
    Number(record.liquidityBp),
    Number(record.dividendBp),
    record.owner
  ];

  console.log("Verifying ShaZeroProtocolLegacy at:", tokenAddress);
  console.log("Constructor arguments:");
  console.log(JSON.stringify(constructorArguments, null, 2));

  await hre.run("verify:verify", {
    address: tokenAddress,
    constructorArguments,
    contract: "contracts/ShaZeroProtocolLegacy.sol:ShaZeroProtocolLegacy"
  });

  console.log(`Verified: https://bscscan.com/address/${tokenAddress}#code`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
