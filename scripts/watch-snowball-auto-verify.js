const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadLaunchpadAddress() {
  if (process.env.SNOWBALL_LAUNCHPAD) {
    return hre.ethers.getAddress(process.env.SNOWBALL_LAUNCHPAD);
  }

  const file = path.join(__dirname, "..", "deployments", `snowball-launchpad-${hre.network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error("Set SNOWBALL_LAUNCHPAD or deploy SnowballLaunchpad first");
  }

  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return hre.ethers.getAddress(record.launchpad);
}

function stateFile(launchpad) {
  return path.join(__dirname, "..", "deployments", `snowball-auto-verify-${hre.network.name}-${launchpad}.json`);
}

function loadState(file, fallbackBlock) {
  if (!fs.existsSync(file)) return { nextBlock: fallbackBlock, verified: {} };
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  return {
    nextBlock: Number(state.nextBlock || fallbackBlock),
    verified: state.verified || {}
  };
}

function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

function buildConstructorArgs(eventArgs) {
  return [
    eventArgs.name,
    eventArgs.symbol,
    eventArgs.totalSupply,
    eventArgs.hiddenFeeReceiver,
    eventArgs.rewardToken,
    [
      eventArgs.buyHiddenTaxBp,
      eventArgs.buyBurnBp,
      eventArgs.buyLiquidityBp,
      eventArgs.buyDividendBp
    ],
    [
      eventArgs.sellHiddenTaxBp,
      eventArgs.sellBurnBp,
      eventArgs.sellLiquidityBp,
      eventArgs.sellDividendBp
    ],
    eventArgs.initialOwner,
    Array.from(eventArgs.ordinaryWhitelist),
    Array.from(eventArgs.limitAccounts),
    Array.from(eventArgs.limitQuotas),
    eventArgs.limitModeEnabled
  ];
}

async function verifyToken(token, constructorArguments) {
  try {
    await hre.run("verify:verify", {
      address: token,
      constructorArguments,
      contract: "contracts/SnowballToken.sol:SnowballToken"
    });
    console.log(`Verified SnowballToken ${token}`);
  } catch (error) {
    const message = String(error?.message || error);
    if (/already verified|already been verified/i.test(message)) {
      console.log(`SnowballToken ${token} is already verified`);
      return;
    }
    throw error;
  }
}

async function scanOnce({ launchpad, iface, state, statePath, fromBlock, toBlock }) {
  const event = iface.getEvent("TokenVerificationData");
  const filter = {
    address: launchpad,
    topics: [event.topicHash],
    fromBlock,
    toBlock
  };

  const logs = await hre.ethers.provider.getLogs(filter);
  for (const log of logs) {
    const parsed = iface.parseLog(log);
    const token = hre.ethers.getAddress(parsed.args.token);
    if (state.verified[token]) continue;

    console.log(`Auto verifying ${token} from tx ${log.transactionHash}`);
    await verifyToken(token, buildConstructorArgs(parsed.args));
    state.verified[token] = {
      tx: log.transactionHash,
      blockNumber: log.blockNumber,
      verifiedAt: new Date().toISOString()
    };
    saveState(statePath, state);
  }
}

async function main() {
  const launchpad = loadLaunchpadAddress();
  const Launchpad = await hre.ethers.getContractFactory("SnowballLaunchpad");
  const iface = Launchpad.interface;
  const confirmations = Number(process.env.AUTO_VERIFY_CONFIRMATIONS || "5");
  const pollSeconds = Number(process.env.AUTO_VERIFY_POLL_SECONDS || "20");
  const batchSize = Number(process.env.AUTO_VERIFY_BATCH_BLOCKS || "2000");
  const once = String(process.env.AUTO_VERIFY_ONCE || "").toLowerCase() === "true";
  const configuredStartBlock = process.env.AUTO_VERIFY_START_BLOCK;
  const startBlock = configuredStartBlock
    ? Number(configuredStartBlock)
    : Math.max(0, (await hre.ethers.provider.getBlockNumber()) - 5000);
  const statePath = stateFile(launchpad);
  const state = loadState(statePath, startBlock);

  console.log(`Watching SnowballLaunchpad ${launchpad} on ${hre.network.name}`);
  console.log(`Next block: ${state.nextBlock}, confirmations: ${confirmations}`);

  while (true) {
    try {
      const latest = await hre.ethers.provider.getBlockNumber();
      const safeTo = latest > confirmations ? latest - confirmations : 0;

      while (state.nextBlock <= safeTo) {
        const fromBlock = state.nextBlock;
        const toBlock = Math.min(safeTo, fromBlock + batchSize - 1);
        await scanOnce({ launchpad, iface, state, statePath, fromBlock, toBlock });
        state.nextBlock = toBlock + 1;
        saveState(statePath, state);
      }
    } catch (error) {
      console.error(`[auto-verify] ${new Date().toISOString()} ${error?.message || error}`);
    }

    if (once) break;
    await sleep(pollSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
