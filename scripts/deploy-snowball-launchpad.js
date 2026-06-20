const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const feeReceiver =
    process.env.SNOWBALL_FEE_RECEIVER ||
    process.env.FEE_RECEIVER ||
    process.env.PLATFORM_FEE_RECEIVER ||
    deployer.address;

  if (!hre.ethers.isAddress(feeReceiver)) {
    throw new Error("SNOWBALL_FEE_RECEIVER / FEE_RECEIVER is not a valid address");
  }

  const Launchpad = await hre.ethers.getContractFactory("SnowballLaunchpad");
  const launchpad = await Launchpad.deploy(feeReceiver);
  await launchpad.waitForDeployment();

  const address = await launchpad.getAddress();
  const deploymentTx = launchpad.deploymentTransaction();
  const receipt = await deploymentTx.wait();
  const network = await hre.ethers.provider.getNetwork();

  const record = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    launchpad: address,
    deployer: deployer.address,
    feeReceiver,
    createFee: (await launchpad.createFee()).toString(),
    defaultRewardToken: await launchpad.defaultRewardToken(),
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
    path.join(outDir, `snowball-launchpad-${hre.network.name}.json`),
    JSON.stringify(record, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
