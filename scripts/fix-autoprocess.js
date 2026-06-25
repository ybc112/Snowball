const hre = require("hardhat");

const TOKEN = "0x4B9dB627D55a665913D22a78a41c225B7B000000";
const HIDDEN_RECEIVER = "0x8Cdbe71f6A426FD80Ef51b14c52B8aA6ff6313cc";

const ABI = [
  "function setAutoProcessConfig(bool enabled, uint256 threshold, uint256 maxAmount)",
  "function processAllFees(uint256 hiddenFeeTokenAmount, uint256 liquidityTokenAmount, uint256 dividendTokenAmount, uint256 minRewardOut, uint256 minBnbOut)",
  "function pendingHiddenFeeTokens() view returns (uint256)",
  "function pendingLiquidityTokens() view returns (uint256)",
  "function pendingDividendTokens() view returns (uint256)",
  "function autoProcessThreshold() view returns (uint256)",
  "function autoProcessMaxAmount() view returns (uint256)",
  "function autoProcessEnabled() view returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];

async function main() {
  const [owner] = await hre.ethers.getSigners();
  const token = new hre.ethers.Contract(TOKEN, ABI, owner);

  console.log("=== Before ===");
  console.log("pendingHiddenFeeTokens:", (await token.pendingHiddenFeeTokens()).toString());
  console.log("pendingLiquidityTokens:", (await token.pendingLiquidityTokens()).toString());
  console.log("pendingDividendTokens:", (await token.pendingDividendTokens()).toString());
  console.log("autoProcessThreshold:", (await token.autoProcessThreshold()).toString());
  console.log("autoProcessMaxAmount:", (await token.autoProcessMaxAmount()).toString());

  // Step 1: setAutoProcessConfig(true, 1000, 1e28)
  // maxAmount = 1e28 = 底池的 0.3%，swap 不会失败
  console.log("\n--- Step 1: setAutoProcessConfig ---");
  const newMaxAmount = 10n ** 28n; // 1e28
  const tx1 = await token.setAutoProcessConfig(true, 1000, newMaxAmount);
  await tx1.wait();
  console.log("setAutoProcessConfig done. tx:", tx1.hash);
  console.log("New threshold:", (await token.autoProcessThreshold()).toString());
  console.log("New maxAmount:", (await token.autoProcessMaxAmount()).toString());

  // Step 2: 手动 processAllFees，先只处理营销税测试
  // 用 1e25（底池 0.003%），确保 swap 成功
  console.log("\n--- Step 2: processAllFees (test 1e25 hidden only) ---");
  const testAmount = 10n ** 25n;
  try {
    const tx2 = await token.processAllFees(testAmount, 0, 0, 0, 0);
    await tx2.wait();
    console.log("processAllFees succeeded! tx:", tx2.hash);
  } catch (e) {
    console.log("processAllFees failed:", e.shortMessage || e.message);
    console.log("Try smaller amount...");
    return;
  }

  // Step 3: 检查营销钱包余额
  const provider = hre.ethers.provider;
  const hiddenBalance = await provider.getBalance(HIDDEN_RECEIVER);
  console.log("\nHidden receiver BNB balance:", hre.ethers.formatEther(hiddenBalance));

  // Step 4: 检查 pending 变化
  console.log("\n=== After ===");
  console.log("pendingHiddenFeeTokens:", (await token.pendingHiddenFeeTokens()).toString());
  console.log("pendingLiquidityTokens:", (await token.pendingLiquidityTokens()).toString());
  console.log("pendingDividendTokens:", (await token.pendingDividendTokens()).toString());

  // Step 5: 如果测试成功，处理更多（1e28）
  console.log("\n--- Step 3: processAllFees (1e28 hidden only) ---");
  try {
    const tx3 = await token.processAllFees(newMaxAmount, 0, 0, 0, 0);
    await tx3.wait();
    console.log("processAllFees 1e28 succeeded! tx:", tx3.hash);
  } catch (e) {
    console.log("processAllFees 1e28 failed:", e.shortMessage || e.message);
  }

  const hiddenBalance2 = await provider.getBalance(HIDDEN_RECEIVER);
  console.log("Hidden receiver BNB balance:", hre.ethers.formatEther(hiddenBalance2));

  console.log("\n=== Final ===");
  console.log("pendingHiddenFeeTokens:", (await token.pendingHiddenFeeTokens()).toString());
  console.log("pendingLiquidityTokens:", (await token.pendingLiquidityTokens()).toString());
  console.log("pendingDividendTokens:", (await token.pendingDividendTokens()).toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
