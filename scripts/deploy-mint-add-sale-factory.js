const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const feeReceiver =
    process.env.MINT_SALE_FEE_RECEIVER ||
    process.env.SNOWBALL_FEE_RECEIVER ||
    process.env.FEE_RECEIVER ||
    process.env.PLATFORM_FEE_RECEIVER ||
    deployer.address;

  if (!hre.ethers.isAddress(feeReceiver)) {
    throw new Error("MINT_SALE_FEE_RECEIVER / FEE_RECEIVER is not a valid address");
  }

  const Factory = await hre.ethers.getContractFactory("MintAddSaleFactory");
  const factory = await Factory.deploy(feeReceiver);
  await factory.waitForDeployment();

  const address = await factory.getAddress();
  const deploymentTx = factory.deploymentTransaction();
  const receipt = await deploymentTx.wait();
  const network = await hre.ethers.provider.getNetwork();

  const record = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    factory: address,
    deployer: deployer.address,
    feeReceiver,
    createFee: (await factory.createFee()).toString(),
    deploymentTx: deploymentTx.hash,
    blockNumber: receipt.blockNumber,
    bscScan:
      Number(network.chainId) === 56
        ? `https://bscscan.com/address/${address}#code`
        : `https://testnet.bscscan.com/address/${address}#code`
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `mint-add-sale-factory-${hre.network.name}.json`),
    JSON.stringify(record, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
