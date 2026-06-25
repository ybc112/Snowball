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

const TOKEN_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function setPair(address pair, bool enabled)",
  "function openTrading()",
  "function tradingOpen() view returns (bool)",
  "function isPair(address) view returns (bool)",
  "function balanceOf(address) view returns (uint256)"
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
  const skipLiquidity = String(process.env.SKIP_LIQUIDITY || "false").toLowerCase() === "true";
  const skipOpen = String(process.env.OPEN_TRADING || "true").toLowerCase() === "false";
  const onlyOpen = process.env.ONLY_OPEN_TRADING === "1";

  const [owner] = await hre.ethers.getSigners();
  const token = new hre.ethers.Contract(tokenAddress, TOKEN_ABI, owner);

  console.log("Token:", tokenAddress);
  console.log("Owner:", owner.address);

  if (onlyOpen) {
    console.log("Only opening trading (skipping LP and setPair)...");
    const tradingOpenBefore = await token.tradingOpen();
    if (tradingOpenBefore) {
      console.log("Trading already open.");
    } else {
      console.log("Opening trading...");
      const openTx = await token.openTrading();
      await openTx.wait();
      console.log("Trading opened. tx:", openTx.hash);
    }
    const tradingOpenAfter = await token.tradingOpen();
    console.log("Final tradingOpen:", tradingOpenAfter);
    return;
  }

  if (!skipLiquidity) {
    if (tokenAmount <= 0n) throw new Error("LP_TOKEN_AMOUNT must be greater than 0");
    if (bnbAmount <= 0n) throw new Error("LP_BNB_AMOUNT must be greater than 0");
  }

  const router = new hre.ethers.Contract(routerAddress, ROUTER_ABI, owner);

  const weth = await router.WETH();
  console.log("Router:", routerAddress);
  console.log("WBNB:", weth);

  const balance = await hre.ethers.provider.getBalance(owner.address);
  console.log("Owner BNB balance:", hre.ethers.formatEther(balance));

  let pairAddress;
  const factory = new hre.ethers.Contract(await router.factory(), FACTORY_ABI, owner);
  pairAddress = await factory.getPair(tokenAddress, weth);

  if (skipLiquidity) {
    console.log("Skip adding liquidity (SKIP_LIQUIDITY=true)");
    console.log("Existing pair from factory:", pairAddress);
    const manualPair = process.env.PAIR_ADDRESS;
    if (manualPair && hre.ethers.isAddress(manualPair)) {
      console.log("Using manual PAIR_ADDRESS:", manualPair);
      pairAddress = hre.ethers.getAddress(manualPair);
    }
  } else {
    console.log("LP token amount:", tokenAmount.toString());
    console.log("LP BNB amount:", hre.ethers.formatEther(bnbAmount));
    console.log("LP receiver:", lpReceiver);

    console.log("Approving router...");
    const approveTx = await token.approve(routerAddress, tokenAmount);
    await approveTx.wait();
    console.log("Approved.");

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
    console.log("Liquidity added. tx:", lpTx.hash);

    pairAddress = await factory.getPair(tokenAddress, weth);
    console.log("Pair created:", pairAddress);
  }

  if (pairAddress === hre.ethers.ZeroAddress) {
    throw new Error("Pair does not exist. Add liquidity first (set SKIP_LIQUIDITY=false).");
  }

  console.log("Marking pair...");
  const isPairAlready = await token.isPair(pairAddress);
  if (!isPairAlready) {
    const setPairTx = await token.setPair(pairAddress, true);
    await setPairTx.wait();
    console.log("Pair marked. tx:", setPairTx.hash);
  } else {
    console.log("Pair already marked.");
  }

  if (!skipOpen) {
    const tradingOpenBefore = await token.tradingOpen();
    if (tradingOpenBefore) {
      console.log("Trading already open.");
    } else {
      console.log("Opening trading...");
      const openTx = await token.openTrading();
      await openTx.wait();
      console.log("Trading opened. tx:", openTx.hash);
    }
  } else {
    console.log("Skip opening trading (OPEN_TRADING=false)");
  }

  const tradingOpenAfter = await token.tradingOpen();
  console.log("Final tradingOpen:", tradingOpenAfter);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
