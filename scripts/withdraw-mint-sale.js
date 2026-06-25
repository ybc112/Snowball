const hre = require("hardhat");
const { ethers } = hre;

const SALE_ADDRESS = "0x8374694a1D5E79c63B6ca61e9B44898df7D32e21";
const OWNER = "0x055fc4F2c70c4c750CFcB6175E7134a33c255a45";

const MINT_SALE_ABI = [
  "function withdrawUnsoldTokens(address to, uint256 amount) external",
  "function withdrawBnb(address to, uint256 amount) external",
  "function saleToken() view returns(address)",
  "function owner() view returns(address)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns(uint256)",
  "function symbol() view returns(string)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("signer:", signer.address);

  const sale = new ethers.Contract(SALE_ADDRESS, MINT_SALE_ABI, signer);
  const owner = await sale.owner();
  console.log("sale owner:", owner);

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("signer is not owner");
  }

  // 1. 取出 token
  const tokenAddr = await sale.saleToken();
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const balance = await token.balanceOf(SALE_ADDRESS);
  const symbol = await token.symbol();
  console.log(`token: ${symbol} (${tokenAddr})`);
  console.log(`sale contract token balance: ${balance.toString()}`);

  if (balance > 0n) {
    console.log(">>> withdrawUnsoldTokens");
    const tx1 = await sale.withdrawUnsoldTokens(OWNER, balance);
    console.log("tx1:", tx1.hash);
    await tx1.wait();
    console.log("tx1 confirmed");
  }

  // 2. 取出 BNB
  const bnbBalance = await ethers.provider.getBalance(SALE_ADDRESS);
  console.log(`sale contract BNB balance: ${ethers.formatEther(bnbBalance)}`);

  if (bnbBalance > 0n) {
    console.log(">>> withdrawBnb");
    const tx2 = await sale.withdrawBnb(OWNER, bnbBalance);
    console.log("tx2:", tx2.hash);
    await tx2.wait();
    console.log("tx2 confirmed");
  }

  // 验证
  const tokenAfter = await token.balanceOf(SALE_ADDRESS);
  const bnbAfter = await ethers.provider.getBalance(SALE_ADDRESS);
  console.log("=== after withdrawal ===");
  console.log("sale token balance:", tokenAfter.toString());
  console.log("sale BNB balance:", ethers.formatEther(bnbAfter));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
