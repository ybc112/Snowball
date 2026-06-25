const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN_ABI = [
  "function tradingOpen() view returns (bool)",
  "function isPair(address) view returns (bool)",
  "function ordinaryWhitelist(address) view returns (bool)",
  "function taxExempt(address) view returns (bool)",
  "function dividendExempt(address) view returns (bool)",
  "function pendingHiddenFeeTokens() view returns (uint256)",
  "function pendingLiquidityTokens() view returns (uint256)",
  "function pendingDividendTokens() view returns (uint256)",
  "function autoProcessEnabled() view returns (bool)",
  "function autoProcessThreshold() view returns (uint256)",
  "function autoProcessMaxAmount() view returns (uint256)",
  "function airdropCount() view returns (uint8)",
  "function airdropAmount() view returns (uint256)",
  "function airdropReserve() view returns (uint256)",
  "function airdropNonce() view returns (uint256)",
  "function hiddenFeeReceiver() view returns (address)",
  "function rewardToken() view returns (address)",
  "function router() view returns (address)",
  "function taxConfig() view returns (uint16 hiddenTaxBp, uint16 burnBp, uint16 liquidityBp, uint16 dividendBp)",
  "function totalTaxBp() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function owner() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event TaxConfigUpdated(uint16,uint16,uint16,uint16)",
  "event PairUpdated(address indexed pair, bool enabled)",
  "event TradingOpened(uint256 timestamp)",
  "event AutoProcessAttempted(uint256,uint256,uint256,bool)",
  "event HiddenFeesProcessed(address indexed receiver, uint256 tokenAmount, uint256 bnbAmount)",
  "event AirdropConfigUpdated(uint8,uint256)",
  "event AirdropReserveFunded(uint256)"
];

const PAIR = "0xf5264961D51cB8fe9d67afB1e8C72D84069832a6";
const TOKEN = "0x4B9dB627D55a665913D22a78a41c225B7B000000";
const OWNER = "0x055fc4F2c70c4c750CFcB6175E7134a33c255a45";
const HIDDEN = "0x8Cdbe71f6A426FD80Ef51b14c52B8aA6ff6313cc";
const DEAD = "0x000000000000000000000000000000000000dEaD";

async function main() {
  const provider = new hre.ethers.JsonRpcProvider(process.env.BSC_RPC_URL || "https://bsc-rpc.publicnode.com");
  const token = new hre.ethers.Contract(TOKEN, TOKEN_ABI, provider);

  console.log("=== Contract State ===");
  console.log("Token:", TOKEN);
  console.log("Pair:", PAIR);
  console.log("Owner:", OWNER);
  console.log("Hidden fee receiver:", HIDDEN);
  console.log();

  console.log("--- Trading & Pair ---");
  console.log("tradingOpen:", await token.tradingOpen());
  console.log("isPair[pair]:", await token.isPair(PAIR));
  console.log("owner():", await token.owner());
  console.log();

  console.log("--- Tax config ---");
  const cfg = await token.taxConfig();
  console.log("taxConfig: hidden=", cfg.hiddenTaxBp.toString(), "burn=", cfg.burnBp.toString(), "liq=", cfg.liquidityBp.toString(), "div=", cfg.dividendBp.toString());
  console.log("totalTaxBp:", (await token.totalTaxBp()).toString());
  console.log();

  console.log("--- Whitelist / Tax exempt ---");
  console.log("ordinaryWhitelist[owner]:", await token.ordinaryWhitelist(OWNER));
  console.log("taxExempt[owner]:", await token.taxExempt(OWNER));
  console.log("ordinaryWhitelist[hiddenReceiver]:", await token.ordinaryWhitelist(HIDDEN));
  console.log("taxExempt[hiddenReceiver]:", await token.taxExempt(HIDDEN));
  console.log("taxExempt[pair]:", await token.taxExempt(PAIR));
  console.log("taxExempt[DEAD]:", await token.taxExempt(DEAD));
  console.log("taxExempt[token]:", await token.taxExempt(TOKEN));
  console.log("dividendExempt[pair]:", await token.dividendExempt(PAIR));
  console.log();

  console.log("--- Pending fee buckets ---");
  console.log("pendingHiddenFeeTokens:", (await token.pendingHiddenFeeTokens()).toString());
  console.log("pendingLiquidityTokens:", (await token.pendingLiquidityTokens()).toString());
  console.log("pendingDividendTokens:", (await token.pendingDividendTokens()).toString());
  console.log();

  console.log("--- Auto process ---");
  console.log("autoProcessEnabled:", await token.autoProcessEnabled());
  console.log("autoProcessThreshold:", (await token.autoProcessThreshold()).toString());
  console.log("autoProcessMaxAmount:", (await token.autoProcessMaxAmount()).toString());
  console.log();

  console.log("--- Airdrop ---");
  console.log("airdropCount:", (await token.airdropCount()).toString());
  console.log("airdropAmount:", (await token.airdropAmount()).toString());
  console.log("airdropReserve:", (await token.airdropReserve()).toString());
  // airdropNonce is private, skip it
  console.log("airdropNonce: (private, cannot read)");
  console.log();

  console.log("--- Balances ---");
  console.log("totalSupply:", (await token.totalSupply()).toString());
  console.log("balanceOf[owner]:", (await token.balanceOf(OWNER)).toString());
  console.log("balanceOf[token]:", (await token.balanceOf(TOKEN)).toString());
  console.log("balanceOf[pair]:", (await token.balanceOf(PAIR)).toString());
  console.log("balanceOf[DEAD]:", (await token.balanceOf(DEAD)).toString());
  console.log("balanceOf[hiddenReceiver]:", (await token.balanceOf(HIDDEN)).toString());
  console.log();

  console.log("--- Recent Transfer events (last 30) ---");
  const currentBlock = await provider.getBlockNumber();
  console.log("Current block:", currentBlock);
  const fromBlock = Math.max(0, currentBlock - 5000);
  const filter = token.filters.Transfer();
  try {
    const events = await token.queryFilter(filter, fromBlock, "latest");
    console.log(`Found ${events.length} Transfer events in last 5000 blocks`);
    const last = events.slice(-30);
    for (const ev of last) {
      const block = await ev.getBlock();
      console.log(`  block=${ev.blockNumber} tx=${ev.transactionHash.slice(0,12)}... from=${ev.args.from.slice(0,10)} to=${ev.args.to.slice(0,10)} value=${ev.args.value.toString()}`);
    }
  } catch (e) {
    console.log("Failed to query Transfer events:", e.message);
  }

  console.log();
  console.log("--- Recent PairUpdated / TradingOpened events ---");
  try {
    const pairEvents = await token.queryFilter(token.filters.PairUpdated(), fromBlock, "latest");
    for (const ev of pairEvents) {
      console.log(`  PairUpdated block=${ev.blockNumber} pair=${ev.args.pair} enabled=${ev.args.enabled}`);
    }
    const tradingEvents = await token.queryFilter(token.filters.TradingOpened(), fromBlock, "latest");
    for (const ev of tradingEvents) {
      console.log(`  TradingOpened block=${ev.blockNumber} timestamp=${ev.args.timestamp}`);
    }
    const autoEvents = await token.queryFilter(token.filters.AutoProcessAttempted(), fromBlock, "latest");
    console.log(`AutoProcessAttempted events: ${autoEvents.length}`);
    for (const ev of autoEvents.slice(-5)) {
      console.log(`  AutoProcessAttempted hidden=${ev.args[0].toString()} liq=${ev.args[1].toString()} div=${ev.args[2].toString()} success=${ev.args[3]}`);
    }
    const hiddenProcessed = await token.queryFilter(token.filters.HiddenFeesProcessed(), fromBlock, "latest");
    console.log(`HiddenFeesProcessed events: ${hiddenProcessed.length}`);
  } catch (e) {
    console.log("Failed:", e.message);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
