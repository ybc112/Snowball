require("dotenv").config();

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { keccak_256 } = require("@noble/hashes/sha3");
const { ethers } = require("ethers");

const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const BSC_USDT = "0x55d398326f99059fF775485246999027B3197955";
if (!isMainThread) {
  const result = findSalt(workerData);
  parentPort.postMessage(result);
  return;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const rpc = process.env.BSC_RPC_URL || process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpc) throw new Error("Missing BSC_RPC_URL/RPC_URL");
  if (!privateKey) throw new Error("Missing PRIVATE_KEY/DEPLOYER_PRIVATE_KEY");

  const provider = new ethers.JsonRpcProvider(rpc, 56);
  const deployer = new ethers.Wallet(privateKey, provider);
  const factoryCode = await provider.getCode(CREATE2_FACTORY);
  if (factoryCode === "0x") throw new Error("CREATE2 factory is not deployed on this network");

  const artifact = JSON.parse(
    fs.readFileSync(
      path.join("artifacts", "contracts", "ShaZeroProtocolLegacy.sol", "ShaZeroProtocolLegacy.json"),
      "utf8"
    )
  );
  const name = process.env.TOKEN_NAME || "杀零协议";
  const symbol = process.env.TOKEN_SYMBOL || "SHA0";
  const totalSupply = BigInt(process.env.TOTAL_SUPPLY || "21000000000000000000000000000000");
  const hiddenFeeReceiver =
    process.env.HIDDEN_FEE_RECEIVER ||
    process.env.FEE_RECEIVER ||
    process.env.FEE_RECIPIENT ||
    process.env.MARKETING_WALLET ||
    deployer.address;
  const rewardToken = process.env.REWARD_TOKEN || BSC_USDT;
  const hiddenTaxBp = Number(process.env.HIDDEN_TAX_BP || "80");
  const burnBp = Number(process.env.BURN_BP || "80");
  const liquidityBp = Number(process.env.LIQUIDITY_BP || "80");
  const dividendBp = Number(process.env.DIVIDEND_BP || "160");
  const suffix = normalizeSuffix(process.env.VANITY_SUFFIX || "000000");

  if (!ethers.isAddress(hiddenFeeReceiver || "")) throw new Error("Hidden fee receiver is missing or invalid");
  if (!ethers.isAddress(rewardToken || "")) throw new Error("Reward token is missing or invalid");
  for (const [bpName, value] of [["HIDDEN_TAX_BP", hiddenTaxBp], ["BURN_BP", burnBp], ["LIQUIDITY_BP", liquidityBp], ["DIVIDEND_BP", dividendBp]]) {
    if (!Number.isInteger(value) || value < 0 || value > 2500) {
      throw new Error(`${bpName} must be an integer between 0 and 2500`);
    }
  }
  const totalTaxBp = hiddenTaxBp + burnBp + liquidityBp + dividendBp;
  if (totalTaxBp > 2500) throw new Error(`Total tax bp ${totalTaxBp} exceeds 2500 (25%)`);

  const contractFactory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const deployTx = await contractFactory.getDeployTransaction(
    name,
    symbol,
    totalSupply,
    hiddenFeeReceiver,
    rewardToken,
    hiddenTaxBp,
    burnBp,
    liquidityBp,
    dividendBp,
    deployer.address
  );
  const initCode = ethers.getBytes(deployTx.data);
  const initCodeHash = ethers.keccak256(initCode);

  console.log("Finding CREATE2 salt...");
  console.log("Deployer:", deployer.address);
  console.log("Name:", name);
  console.log("Symbol:", symbol);
  console.log("Hidden fee receiver:", hiddenFeeReceiver);
  console.log("Reward token:", rewardToken);
  console.log("Hidden tax bp:", hiddenTaxBp);
  console.log("Burn/liquidity/dividend bp:", `${burnBp}/${liquidityBp}/${dividendBp}`);
  console.log("Total tax bp:", `${totalTaxBp} (${(totalTaxBp / 100).toFixed(2)}%)`);
  console.log("Target suffix:", suffix);

  const vanity = await resolveSalt(CREATE2_FACTORY, initCodeHash, suffix);
  console.log("Matched address:", vanity.address);
  console.log("Salt:", vanity.salt);
  console.log("Attempts:", vanity.attempts.toString());

  const existingCode = await provider.getCode(vanity.address);
  if (existingCode !== "0x") {
    throw new Error(`Matched address already has code: ${vanity.address}`);
  }

  const data = vanity.salt + ethers.hexlify(initCode).slice(2);
  const gasPrice = process.env.GAS_PRICE_GWEI
    ? ethers.parseUnits(process.env.GAS_PRICE_GWEI, "gwei")
    : (await provider.getFeeData()).gasPrice;
  const estimatedGas = await provider.estimateGas({
    from: deployer.address,
    to: CREATE2_FACTORY,
    data,
    value: 0
  });
  const tx = await deployer.sendTransaction({
    to: CREATE2_FACTORY,
    data,
    value: 0,
    gasPrice,
    gasLimit: (estimatedGas * 120n) / 100n
  });
  console.log("Deployment tx:", tx.hash);

  const receipt = await tx.wait(2);
  if (receipt.status !== 1) throw new Error("Deployment transaction failed");

  const token = new ethers.Contract(vanity.address, artifact.abi, deployer);
  const cfg = await token.taxConfig();
  const record = {
    network: "bsc",
    chainId: 56,
    token: vanity.address,
    name: await token.name(),
    symbol: await token.symbol(),
    deployer: deployer.address,
    owner: await token.owner(),
    create2Factory: CREATE2_FACTORY,
    salt: vanity.salt,
    hiddenFeeReceiver: await token.hiddenFeeReceiver(),
    rewardToken: await token.rewardToken(),
    totalSupply: (await token.totalSupply()).toString(),
    totalTaxBp: (await token.totalTaxBp()).toString(),
    hiddenTaxBp: cfg.hiddenTaxBp.toString(),
    burnBp: cfg.burnBp.toString(),
    liquidityBp: cfg.liquidityBp.toString(),
    dividendBp: cfg.dividendBp.toString(),
    deploymentTx: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    bscScan: `https://bscscan.com/address/${vanity.address}#code`
  };

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    path.join("deployments", "snowball-legacy-hidden-tax-vanity-bsc.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );

  console.log("Token:", vanity.address);
  console.log("Owner:", record.owner);
  console.log("Total tax bp:", record.totalTaxBp);
  console.log("Trading open:", String(await token.tradingOpen()));
  console.log("Deployment file updated: deployments/snowball-legacy-hidden-tax-vanity-bsc.json");
}

async function resolveSalt(factoryAddress, initCodeHash, suffix) {
  if (process.env.VANITY_SALT) {
    const salt = ethers.hexlify(ethers.zeroPadValue(process.env.VANITY_SALT, 32));
    const address = ethers.getCreate2Address(factoryAddress, salt, initCodeHash);
    if (!address.toLowerCase().endsWith(suffix)) {
      throw new Error(`VANITY_SALT does not produce suffix ${suffix}: ${address}`);
    }
    return { salt, address, attempts: 1n };
  }

  const workers = Math.max(1, Math.min(Number(process.env.VANITY_WORKERS || 8), os.cpus().length));
  const factoryBytes = Buffer.from(factoryAddress.slice(2), "hex");
  const initHashBytes = Buffer.from(initCodeHash.slice(2), "hex");
  const startedAt = Date.now();

  return await new Promise((resolve, reject) => {
    let settled = false;
    let totalAttempts = 0n;
    const workerList = [];
    const interval = setInterval(() => {
      if (!settled) {
        const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        console.log(`Searching... attempts=${totalAttempts.toString()} speed=${(Number(totalAttempts) / seconds).toFixed(0)}/s`);
      }
    }, 15000);

    for (let i = 0; i < workers; i++) {
      const base = ethers.getBytes(ethers.randomBytes(24));
      base[0] = i;
      const worker = new Worker(__filename, {
        workerData: {
          factoryHex: Buffer.from(factoryBytes).toString("hex"),
          initHashHex: Buffer.from(initHashBytes).toString("hex"),
          baseHex: Buffer.from(base).toString("hex"),
          suffixBytes: suffixToBytes(suffix),
          reportEvery: 250000
        }
      });
      workerList.push(worker);
      worker.on("message", (message) => {
        if (message.type === "progress") {
          totalAttempts += BigInt(message.attempts);
          return;
        }
        if (message.type === "found" && !settled) {
          settled = true;
          clearInterval(interval);
          for (const item of workerList) {
            if (item !== worker) item.terminate();
          }
          const address = ethers.getCreate2Address(factoryAddress, message.salt, initCodeHash);
          resolve({ salt: message.salt, address, attempts: totalAttempts + BigInt(message.attempts) });
        }
      });
      worker.on("error", (error) => {
        if (!settled) {
          settled = true;
          clearInterval(interval);
          for (const item of workerList) item.terminate();
          reject(error);
        }
      });
    }
  });
}

function findSalt({ factoryHex, initHashHex, baseHex, suffixBytes, reportEvery }) {
  const preimage = Buffer.alloc(85);
  preimage[0] = 0xff;
  Buffer.from(factoryHex, "hex").copy(preimage, 1);
  Buffer.from(baseHex, "hex").copy(preimage, 21);
  Buffer.from(initHashHex, "hex").copy(preimage, 53);

  let counter = 0n;
  let attemptsSinceReport = 0;
  const suffixLength = suffixBytes.length;

  while (true) {
    preimage.writeBigUInt64BE(counter, 45);
    const hash = keccak_256(preimage);
    let ok = true;
    for (let i = 0; i < suffixLength; i++) {
      if (hash[32 - suffixLength + i] !== suffixBytes[i]) {
        ok = false;
        break;
      }
    }
    attemptsSinceReport++;
    if (ok) {
      const salt = Buffer.alloc(32);
      Buffer.from(baseHex, "hex").copy(salt, 0);
      salt.writeBigUInt64BE(counter, 24);
      return {
        type: "found",
        salt: `0x${salt.toString("hex")}`,
        attempts: attemptsSinceReport
      };
    }
    counter++;
    if (attemptsSinceReport >= reportEvery) {
      parentPort.postMessage({ type: "progress", attempts: attemptsSinceReport });
      attemptsSinceReport = 0;
    }
  }
}

function normalizeSuffix(value) {
  const suffix = String(value).trim().replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(suffix) || suffix.length % 2 !== 0 || suffix.length > 40) {
    throw new Error("VANITY_SUFFIX must be an even-length hex suffix");
  }
  return suffix;
}

function suffixToBytes(suffix) {
  return [...Buffer.from(suffix, "hex")];
}
