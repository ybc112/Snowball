const hre = require("hardhat");

const PANCAKE_V2_ROUTER_BSC = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const DEAD = "0x000000000000000000000000000000000000dEaD";

const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
  "function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)"
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) view returns (address pair)"
];

async function main() {
  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress || !hre.ethers.isAddress(tokenAddress)) {
    throw new Error("TOKEN_ADDRESS is required");
  }

  const routerAddress = process.env.PANCAKE_ROUTER || PANCAKE_V2_ROUTER_BSC;
  const tokenAmount = BigInt(process.env.LP_TOKEN_AMOUNT || "0");
  const bnbAmount = hre.ethers.parseEther(process.env.LP_BNB_AMOUNT || "0");
  const lpReceiver = process.env.LP_RECEIVER && hre.ethers.isAddress(process.env.LP_RECEIVER)
    ? process.env.LP_RECEIVER
    : DEAD;
  const openTrading = String(process.env.OPEN_TRADING || "true").toLowerCase() !== "false";

  if (tokenAmount <= 0n) throw new Error("LP_TOKEN_AMOUNT must be greater than 0");
  if (bnbAmount <= 0n) throw new Error("LP_BNB_AMOUNT must be greater than 0");

  const [owner] = await hre.ethers.getSigners();
  const token = await hre.ethers.getContractAt("TokenZero", tokenAddress, owner);
  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, owner);

  const weth = await router.WETH();
  const fees = {
    buy: BigInt(process.env.BUY_FEE || "33"),
    sell: BigInt(process.env.SELL_FEE || "33"),
    transfer: BigInt(process.env.TRANSFER_FEE || "33"),
    total: BigInt(process.env.FEE_DENOMINATOR || "1000")
  };

  console.log("Token:", tokenAddress);
  console.log("Router:", routerAddress);
  console.log("WBNB:", weth);
  console.log("LP token amount:", tokenAmount.toString());
  console.log("LP BNB amount:", hre.ethers.formatEther(bnbAmount));
  console.log("LP receiver:", lpReceiver);

  console.log("Configuring pair and fees...");
  const configTx = await token.config(weth, weth, fees);
  await configTx.wait();

  const factory = new hre.ethers.Contract(await router.factory(), FACTORY_ABI, owner);
  const pair = await factory.getPair(tokenAddress, weth);
  console.log("Pair:", pair);

  console.log("Approving router...");
  const approveTx = await token.approve(routerAddress, tokenAmount);
  await approveTx.wait();

  console.log("Adding liquidity...");
  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const lpTx = await router.addLiquidityETH(
    tokenAddress,
    tokenAmount,
    0,
    0,
    lpReceiver,
    deadline,
    { value: bnbAmount }
  );
  await lpTx.wait();
  console.log("Liquidity added.");

  if (openTrading) {
    console.log("Opening trading...");
    const openTx = await token.startNow();
    await openTx.wait();
    console.log("Trading opened.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
