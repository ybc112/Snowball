const ethers = window.ethers?.ethers || window.ethers;

const ARTIFACTS = window.SNOWBALL_ARTIFACTS || {};
const LAUNCHPAD_ABI = ARTIFACTS.launchpad?.abi || [];
const TOKEN_ABI = ARTIFACTS.token?.abi || [];
const MINT_SALE_FACTORY_ABI = ARTIFACTS.mintSaleFactory?.abi || [];
const MINT_SALE_ABI = ARTIFACTS.mintSale?.abi || [];
const DEFAULT_DEPLOYMENT = ARTIFACTS.deployment || null;
const MINT_SALE_DEPLOYMENT = ARTIFACTS.mintSaleDeployment || null;

const PANCAKE_ROUTER = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_TOTAL_TAX_BP = 2500;

const ROUTER_ABI = [
  "function WETH() view returns (address)",
  "function factory() view returns (address)",
  "function addLiquidityETH(address token,uint256 amountTokenDesired,uint256 amountTokenMin,uint256 amountETHMin,address to,uint256 deadline) payable returns (uint256 amountToken,uint256 amountETH,uint256 liquidity)"
];

const FACTORY_ABI = [
  "function getPair(address tokenA,address tokenB) view returns (address pair)"
];

const ERC20_ABI = [
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)"
];

let provider;
let signer;
let account = "";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function setStatus(message, type = "info") {
  const box = $("[data-status]");
  if (!box) return;
  box.textContent = message;
  box.dataset.type = type;
}

function shortAddress(address) {
  if (!address || !ethers.isAddress(address)) return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function prettyError(error, fallback = "操作失败") {
  return error?.shortMessage || error?.reason || error?.message || fallback;
}

function requireAddress(value, label) {
  const raw = String(value || "").trim();
  if (!ethers.isAddress(raw)) throw new Error(`${label}地址不正确`);
  return ethers.getAddress(raw);
}

function optionalAddress(value, fallback = ZERO) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!ethers.isAddress(raw)) throw new Error("地址格式不正确");
  return ethers.getAddress(raw);
}

function parseRawAmount(value, label) {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw)) throw new Error(`${label}必须是整数`);
  const amount = BigInt(raw);
  if (amount < 0n) throw new Error(`${label}不能小于 0`);
  return amount;
}

function parsePositiveRawAmount(value, label) {
  const amount = parseRawAmount(value, label);
  if (amount <= 0n) throw new Error(`${label}必须大于 0`);
  return amount;
}

function parseBps(value, label) {
  const num = Number(String(value || "0").trim());
  if (!Number.isFinite(num) || num < 0) throw new Error(`${label}不能小于 0`);
  if (num > 100) throw new Error(`${label}不能大于 100%`);
  return Math.round(num * 100);
}

function validateTaxGroup(values, label) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total > MAX_TOTAL_TAX_BP) throw new Error(`${label}手续费超过合约允许上限`);
}

function parseRatioBps(value, label) {
  const num = Number(String(value || "0").trim());
  if (!Number.isFinite(num) || num < 0) throw new Error(`${label}不能小于 0`);
  if (num > 100) throw new Error(`${label}不能大于 100%`);
  return Math.round(num * 100);
}

function bpsToPercent(value) {
  return (Number(value) / 100).toString();
}

function parseAddressList(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => requireAddress(item, "白名单"));
}

function parseLimitList(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const accounts = [];
  const quotas = [];

  for (const line of lines) {
    const [address, quota] = line.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!address || !quota) throw new Error("限购名单格式应为：地址,额度");
    accounts.push(requireAddress(address, "限购名单"));
    quotas.push(parseRawAmount(quota, "限购额度"));
  }

  return { accounts, quotas };
}

function parseShareList(value, label = "白名单份额") {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const accounts = [];
  const quotas = [];

  for (const line of lines) {
    const [address, quota] = line.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!address || !quota) throw new Error(`${label}格式应为：地址,份额`);
    accounts.push(requireAddress(address, label));
    quotas.push(parseRawAmount(quota, label));
  }

  return { accounts, quotas };
}

function syncTokenInputs(address) {
  $$("[data-token-address]").forEach((input) => {
    input.value = address;
  });
}

function syncLaunchpadInputs(address) {
  $$("[data-launchpad-address]").forEach((input) => {
    input.value = address || "";
  });
}

function syncMintSaleFactoryInputs(address) {
  $$("[data-mint-sale-factory-address]").forEach((input) => {
    input.value = address || "";
  });
}

function syncMintSaleInputs(address) {
  $$("[data-mint-sale-address]").forEach((input) => {
    input.value = address || "";
  });
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("没有检测到钱包，请先打开 MetaMask 或 TokenPocket。", "error");
    return false;
  }

  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  account = await signer.getAddress();
  $("[data-connect-wallet]").textContent = shortAddress(account);

  setStatus(`钱包已连接：${shortAddress(account)}`, "success");
  await refreshCreateFee().catch(() => {});
  await refreshMintSaleRequired().catch(() => {});
  return true;
}

async function ensureSigner() {
  if (!signer) {
    const ok = await connectWallet();
    if (!ok) throw new Error("请先连接钱包");
  }
  return signer;
}

async function ensureBscNetwork() {
  if (!provider || !window.ethereum) return;
  const network = await provider.getNetwork();
  if (network.chainId === 56n) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x38" }]
    });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    account = await signer.getAddress();
  } catch {
    throw new Error("请先把钱包切换到 BSC 主网");
  }
}

function getLaunchpadAddress() {
  const input = $("[data-create-form] [name='launchpad']");
  return requireAddress(input.value, "发射台工厂");
}

async function getLaunchpad() {
  await ensureSigner();
  return new ethers.Contract(getLaunchpadAddress(), LAUNCHPAD_ABI, signer);
}

function getMintSaleFactoryAddress() {
  const input = $("[data-mint-sale-form] [name='factory']");
  return requireAddress(input.value, "Mint预售工厂");
}

async function getMintSaleFactory() {
  await ensureSigner();
  return new ethers.Contract(getMintSaleFactoryAddress(), MINT_SALE_FACTORY_ABI, signer);
}

async function getMintSaleContract() {
  await ensureSigner();
  const input = $("[data-mint-buy-form] [name='sale']");
  const saleAddress = requireAddress(input.value, "预售合约");
  return new ethers.Contract(saleAddress, MINT_SALE_ABI, signer);
}

async function getTokenFromForm(rootSelector) {
  await ensureSigner();
  const input = $(`${rootSelector} [name='token']`);
  const tokenAddress = requireAddress(input.value, "Token 合约");
  return new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
}

async function refreshCreateFee() {
  if (!signer) return;
  const feeText = $("[data-create-fee]");
  if (!feeText) return;
  const launchpadAddress = $("[data-create-form] [name='launchpad']").value.trim();
  if (!ethers.isAddress(launchpadAddress)) {
    feeText.textContent = "创建费：0.005 BNB";
    return;
  }
  const launchpad = new ethers.Contract(launchpadAddress, LAUNCHPAD_ABI, signer);
  const fee = await launchpad.createFee();
  feeText.textContent = `创建费：${ethers.formatEther(fee)} BNB`;
}

function getMintSaleRequiredTokens() {
  const form = $("[data-mint-sale-form]");
  const tokensPerShare = parsePositiveRawAmount(form.elements.tokensPerShare.value, "每份数量");
  const totalShares = parsePositiveRawAmount(form.elements.totalShares.value, "总份数");
  return tokensPerShare * totalShares;
}

async function refreshMintSaleRequired() {
  const form = $("[data-mint-sale-form]");
  if (!form) return;

  const required = getMintSaleRequiredTokens();
  form.elements.requiredTokensPreview.value = required.toString();

  const factoryAddress = form.elements.factory.value.trim();
  if (signer && ethers.isAddress(factoryAddress)) {
    const factory = new ethers.Contract(factoryAddress, MINT_SALE_FACTORY_ABI, signer);
    const fee = await factory.createFee();
    form.elements.createFeePreview.value = `${ethers.formatEther(fee)} BNB`;
  } else {
    form.elements.createFeePreview.value = "0.005 BNB";
  }
}

async function createToken(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    await ensureSigner();
    await ensureBscNetwork();

    const launchpad = await getLaunchpad();
    const name = String(form.elements.name.value || "").trim();
    const symbol = String(form.elements.symbol.value || "").trim();
    const totalSupply = parsePositiveRawAmount(form.elements.supply.value, "发行总量");
    if (!name) throw new Error("请填写代币名称");
    if (!symbol) throw new Error("请填写代币符号");

    const hiddenFeeReceiver = optionalAddress(form.elements.hiddenReceiver.value, account || ZERO);
    const rewardToken = optionalAddress(form.elements.rewardToken.value, USDT);
    const buyHiddenTaxBp = parseBps(form.elements.buyHiddenTax.value, "买入营销");
    const buyBurnBp = parseBps(form.elements.buyBurnTax.value, "买入销毁");
    const buyLiquidityBp = parseBps(form.elements.buyLiquidityTax.value, "买入流动性");
    const buyDividendBp = parseBps(form.elements.buyDividendTax.value, "买入分红");
    const sellHiddenTaxBp = parseBps(form.elements.sellHiddenTax.value, "卖出营销");
    const sellBurnBp = parseBps(form.elements.sellBurnTax.value, "卖出销毁");
    const sellLiquidityBp = parseBps(form.elements.sellLiquidityTax.value, "卖出流动性");
    const sellDividendBp = parseBps(form.elements.sellDividendTax.value, "卖出分红");
    validateTaxGroup([buyHiddenTaxBp, buyBurnBp, buyLiquidityBp, buyDividendBp], "买入");
    validateTaxGroup([sellHiddenTaxBp, sellBurnBp, sellLiquidityBp, sellDividendBp], "卖出");
    const ordinaryWhitelist = parseAddressList(form.elements.ordinaryWhitelist.value);
    const { accounts: limitAccounts, quotas: limitQuotas } = parseLimitList(form.elements.limitList.value);
    const createFee = await launchpad.createFee();

    const params = {
      name,
      symbol,
      totalSupply,
      hiddenFeeReceiver,
      rewardToken,
      buyHiddenTaxBp,
      buyBurnBp,
      buyLiquidityBp,
      buyDividendBp,
      sellHiddenTaxBp,
      sellBurnBp,
      sellLiquidityBp,
      sellDividendBp,
      ordinaryWhitelist,
      limitAccounts,
      limitQuotas,
      limitModeEnabled: form.elements.limitMode.checked,
      requestAutoVerify: form.elements.autoVerify.checked
    };

    setStatus("正在创建 Token，请确认钱包弹窗...");
    const tx = await launchpad.createToken(params, { value: createFee });
    const receipt = await tx.wait();

    let tokenAddress = "";
    for (const log of receipt.logs) {
      try {
        const parsed = launchpad.interface.parseLog(log);
        if (parsed?.name === "TokenCreated") {
          tokenAddress = parsed.args.token;
          break;
        }
      } catch {}
    }

    if (!tokenAddress) {
      const mine = await launchpad.tokensOfCreator(account);
      tokenAddress = mine[mine.length - 1];
    }

    syncTokenInputs(tokenAddress);
    setStatus(`创建成功：${tokenAddress}。下一步加池、标记 Pair，再手动开盘。`, "success");
    switchPage("liquidity");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "创建失败"), "error");
  }
}

async function readTokenInfo() {
  try {
    await ensureSigner();
    const token = await getTokenFromForm("[data-manage-form]");
    const [name, symbol, totalSupply, tradingOpen, hiddenReceiver, buyCfg, sellCfg, airdropCount] = await Promise.all([
      token.name(),
      token.symbol(),
      token.totalSupply(),
      token.tradingOpen(),
      token.hiddenFeeReceiver(),
      token.buyTaxConfig(),
      token.sellTaxConfig(),
      token.airdropCount()
    ]);

    let pair = ZERO;
    try {
      pair = await token.getDefaultPair();
    } catch {}

    const info = $$("[data-token-info] strong");
    info[0].textContent = `${name} (${symbol})`;
    info[1].textContent = totalSupply.toString();
    info[2].textContent = tradingOpen ? "已开盘" : "未开盘";
    info[3].textContent = pair === ZERO ? "未创建" : pair;

    const form = $("[data-manage-form]");
    form.elements.hiddenReceiver.value = hiddenReceiver;
    form.elements.buyHiddenTax.value = bpsToPercent(buyCfg.hiddenTaxBp);
    form.elements.buyBurnTax.value = bpsToPercent(buyCfg.burnBp);
    form.elements.buyLiquidityTax.value = bpsToPercent(buyCfg.liquidityBp);
    form.elements.buyDividendTax.value = bpsToPercent(buyCfg.dividendBp);
    form.elements.sellHiddenTax.value = bpsToPercent(sellCfg.hiddenTaxBp);
    form.elements.sellBurnTax.value = bpsToPercent(sellCfg.burnBp);
    form.elements.sellLiquidityTax.value = bpsToPercent(sellCfg.liquidityBp);
    form.elements.sellDividendTax.value = bpsToPercent(sellCfg.dividendBp);
    form.elements.airdropCount.value = Number(airdropCount);
    form.elements.limitMode.checked = await token.limitModeEnabled();

    setStatus("Token 配置已读取。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "读取失败"), "error");
  }
}

async function saveHiddenReceiver() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const wallet = requireAddress(form.elements.hiddenReceiver.value, "营销");
    setStatus("正在保存营销地址，请确认钱包弹窗...");
    const tx = await token.setHiddenFeeReceiver(wallet);
    await tx.wait();
    setStatus("营销地址已保存。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "保存失败"), "error");
  }
}

async function saveTaxConfig() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const buyHidden = parseBps(form.elements.buyHiddenTax.value, "买入营销");
    const buyBurn = parseBps(form.elements.buyBurnTax.value, "买入销毁");
    const buyLiquidity = parseBps(form.elements.buyLiquidityTax.value, "买入流动性");
    const buyDividend = parseBps(form.elements.buyDividendTax.value, "买入分红");
    const sellHidden = parseBps(form.elements.sellHiddenTax.value, "卖出营销");
    const sellBurn = parseBps(form.elements.sellBurnTax.value, "卖出销毁");
    const sellLiquidity = parseBps(form.elements.sellLiquidityTax.value, "卖出流动性");
    const sellDividend = parseBps(form.elements.sellDividendTax.value, "卖出分红");
    validateTaxGroup([buyHidden, buyBurn, buyLiquidity, buyDividend], "买入");
    validateTaxGroup([sellHidden, sellBurn, sellLiquidity, sellDividend], "卖出");

    setStatus("正在保存税收配置，请确认钱包弹窗...");
    const tx = await token.setTradeTaxConfig(
      buyHidden,
      buyBurn,
      buyLiquidity,
      buyDividend,
      sellHidden,
      sellBurn,
      sellLiquidity,
      sellDividend
    );
    await tx.wait();
    setStatus("税收配置已保存。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "保存失败"), "error");
  }
}

async function saveAirdropConfig() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const count = Number(form.elements.airdropCount.value || 0);
    if (!Number.isInteger(count) || count < 0 || count > 10) throw new Error("空投数量必须是 0 到 10");
    setStatus("正在保存空投裂变配置，请确认钱包弹窗...");
    const tx = await token.setAirdropConfig(count, 1n);
    await tx.wait();
    setStatus("空投裂变配置已保存。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "保存失败"), "error");
  }
}

async function saveAutoProcessConfig() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const threshold = parsePositiveRawAmount(form.elements.autoThreshold.value, "自动处理阈值");
    const max = parseRawAmount(form.elements.autoMax.value, "单次最大处理");
    setStatus("正在保存自动处理配置，请确认钱包弹窗...");
    const tx = await token.setAutoProcessConfig(true, threshold, max);
    await tx.wait();
    setStatus("自动处理配置已保存。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "保存失败"), "error");
  }
}

async function processFees() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const hidden = parseRawAmount(form.elements.processHidden.value, "处理营销数量");
    const [liquidityRaw = "0", dividendRaw = "0"] = String(form.elements.processOther.value || "0,0").split(/[,\s]+/);
    const liquidity = parseRawAmount(liquidityRaw, "处理回流数量");
    const dividend = parseRawAmount(dividendRaw, "处理分红数量");
    if (hidden + liquidity + dividend === 0n) throw new Error("处理数量不能全为 0");

    setStatus("正在处理税池，请确认钱包弹窗...");
    const tx = await token.processAllFees(hidden, liquidity, dividend, 0, 0);
    await tx.wait();
    setStatus("税池已处理。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "处理失败"), "error");
  }
}

async function updateWhitelist(enabled) {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const accounts = parseAddressList(form.elements.ordinaryWhitelist.value);
    if (!accounts.length) throw new Error("请填写白名单地址");
    setStatus(enabled ? "正在添加白名单..." : "正在移除白名单...");
    const tx = await token.setOrdinaryWhitelist(accounts, enabled);
    await tx.wait();
    setStatus(enabled ? "白名单已添加。" : "白名单已移除。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "白名单操作失败"), "error");
  }
}

async function saveLimitList() {
  try {
    const form = $("[data-manage-form]");
    const token = await getTokenFromForm("[data-manage-form]");
    const enabled = form.elements.limitMode.checked;
    const { accounts, quotas } = parseLimitList(form.elements.limitList.value);
    setStatus("正在保存限购设置，请确认钱包弹窗...");
    const modeTx = await token.setLimitMode(enabled);
    await modeTx.wait();
    if (accounts.length) {
      const quotaTx = await token.setLimitQuota(accounts, quotas);
      await quotaTx.wait();
    }
    setStatus("限购设置已保存。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "限购保存失败"), "error");
  }
}

async function queryPair() {
  try {
    await ensureSigner();
    const form = $("[data-liquidity-form]");
    const tokenAddress = requireAddress(form.elements.token.value, "Token 合约");
    const routerAddress = requireAddress(form.elements.router.value || PANCAKE_ROUTER, "Router");
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);
    const factory = new ethers.Contract(await router.factory(), FACTORY_ABI, signer);
    const pair = await factory.getPair(tokenAddress, await router.WETH());
    setStatus(pair === ZERO ? "还没有 Pair，加池时会创建。" : `Pair：${pair}`, "success");
    return pair;
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "查询 Pair 失败"), "error");
    return ZERO;
  }
}

async function createOrMarkPair() {
  try {
    const token = await getTokenFromForm("[data-liquidity-form]");
    setStatus("正在创建/标记 Pair，请确认钱包弹窗...");
    const tx = await token.createDefaultPair();
    await tx.wait();
    const pair = await token.getDefaultPair();
    setStatus(`Pair 已标记：${pair}`, "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "Pair 操作失败"), "error");
  }
}

async function addLiquidity(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    await ensureSigner();
    await ensureBscNetwork();

    const tokenAddress = requireAddress(form.elements.token.value, "Token 合约");
    const routerAddress = requireAddress(form.elements.router.value || PANCAKE_ROUTER, "Router");
    const tokenAmount = parsePositiveRawAmount(form.elements.tokenAmount.value, "加池 Token 数量");
    const bnbAmount = ethers.parseEther(String(form.elements.bnbAmount.value || "0"));
    if (bnbAmount <= 0n) throw new Error("加池 BNB 数量必须大于 0");
    const lpReceiver = optionalAddress(form.elements.lpReceiver.value, DEAD);

    const token = new ethers.Contract(tokenAddress, TOKEN_ABI, signer);
    const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);

    setStatus("正在授权 Router，请确认钱包弹窗...");
    const approveTx = await token.approve(routerAddress, tokenAmount);
    await approveTx.wait();

    setStatus("正在添加 BNB 底池，请确认钱包弹窗...");
    const deadline = Math.floor(Date.now() / 1000) + 1200;
    const tx = await router.addLiquidityETH(tokenAddress, tokenAmount, 0, 0, lpReceiver, deadline, { value: bnbAmount });
    await tx.wait();

    const pair = await queryPair();
    if (form.elements.markPair.checked && pair !== ZERO) {
      setStatus("正在标记 Pair，请确认钱包弹窗...");
      const pairTx = await token.setPair(pair, true);
      await pairTx.wait();
    }

    setStatus(`加池完成，LP 接收地址：${lpReceiver}`, "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "加池失败"), "error");
  }
}

async function openTrading() {
  try {
    const token = await getTokenFromForm("[data-liquidity-form]");
    setStatus("正在手动开盘，请确认钱包弹窗...");
    const tx = await token.openTrading();
    await tx.wait();
    setStatus("交易已开启。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "开盘失败"), "error");
  }
}

function buildMintSaleParams(form) {
  const bnbLiquidityBp = parseRatioBps(form.elements.bnbLiquidityPercent.value, "BNB加池比例");
  const tokenLiquidityBp = parseRatioBps(form.elements.tokenLiquidityPercent.value, "Token加池比例");
  if ((bnbLiquidityBp === 0) !== (tokenLiquidityBp === 0)) {
    throw new Error("BNB加池比例和Token加池比例要同时为0，或者同时大于0");
  }

  const { accounts: whitelistAccounts, quotas: whitelistQuotas } = parseShareList(form.elements.whitelistList.value);
  const fundReceiver = optionalAddress(form.elements.fundReceiver.value, account || ZERO);

  return {
    saleName: String(form.elements.saleName.value || "").trim(),
    token: requireAddress(form.elements.token.value, "预售代币"),
    router: optionalAddress(form.elements.router.value, PANCAKE_ROUTER),
    fundReceiver,
    pricePerShare: ethers.parseEther(String(form.elements.pricePerShare.value || "0")),
    tokensPerShare: parsePositiveRawAmount(form.elements.tokensPerShare.value, "每份数量"),
    totalShares: parsePositiveRawAmount(form.elements.totalShares.value, "总份数"),
    maxSharesPerBuy: parseRawAmount(form.elements.maxSharesPerBuy.value || "0", "单次最大份数"),
    maxSharesPerWallet: parseRawAmount(form.elements.maxSharesPerWallet.value || "0", "单钱包最大份数"),
    whitelistTotalShares: parseRawAmount(form.elements.whitelistTotalShares.value || "0", "白名单总份数"),
    bnbLiquidityBp,
    tokenLiquidityBp,
    whitelistEnabled: form.elements.whitelistEnabled.checked,
    lpBurnEnabled: form.elements.lpBurnEnabled.checked,
    saleOpen: form.elements.saleOpen.checked,
    whitelistAccounts,
    whitelistQuotas
  };
}

async function approveMintSaleToken() {
  try {
    await ensureSigner();
    await ensureBscNetwork();
    const form = $("[data-mint-sale-form]");
    const factoryAddress = getMintSaleFactoryAddress();
    const tokenAddress = requireAddress(form.elements.token.value, "预售代币");
    const required = getMintSaleRequiredTokens();
    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, signer);

    setStatus("正在授权预售工厂，请确认钱包弹窗...");
    const tx = await erc20.approve(factoryAddress, required);
    await tx.wait();
    setStatus(`授权完成：${required.toString()} Token。`, "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "授权失败"), "error");
  }
}

async function createMintSale(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    await ensureSigner();
    await ensureBscNetwork();
    await refreshMintSaleRequired();

    const factory = await getMintSaleFactory();
    const params = buildMintSaleParams(form);
    if (!params.saleName) throw new Error("请填写预售名称");
    if (params.pricePerShare <= 0n) throw new Error("每份价格必须大于 0");

    const createFee = await factory.createFee();
    setStatus("正在创建 Mint 预售，请确认钱包弹窗...");
    const tx = await factory.createSale(params, { value: createFee });
    const receipt = await tx.wait();

    let saleAddress = "";
    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed?.name === "MintAddSaleCreated") {
          saleAddress = parsed.args.sale;
          break;
        }
      } catch {}
    }
    if (!saleAddress) {
      const mine = await factory.salesOfCreator(account);
      saleAddress = mine[mine.length - 1];
    }

    syncMintSaleInputs(saleAddress);

    let whitelistNote = "";
    try {
      const token = new ethers.Contract(params.token, TOKEN_ABI, signer);
      const whiteTx = await token.setOrdinaryWhitelist([saleAddress], true);
      await whiteTx.wait();
      whitelistNote = "，并已把预售合约加入Token白名单";
    } catch {
      whitelistNote = "。如果Token未开盘，请手动把预售合约加入Token白名单";
    }

    setStatus(`Mint预售创建成功：${saleAddress}${whitelistNote}。`, "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "创建预售失败"), "error");
  }
}

async function readMintSale() {
  try {
    await ensureSigner();
    const sale = await getMintSaleContract();
    const [name, price, tokensPerShare, totalShares, soldShares, bnbBp, tokenBp, open] = await Promise.all([
      sale.saleName(),
      sale.pricePerShare(),
      sale.tokensPerShare(),
      sale.totalShares(),
      sale.soldShares(),
      sale.bnbLiquidityBp(),
      sale.tokenLiquidityBp(),
      sale.saleOpen()
    ]);

    const info = $$("[data-mint-sale-info] strong");
    info[0].textContent = name || "--";
    info[1].textContent = `${soldShares.toString()} / ${totalShares.toString()} ${open ? "开放" : "关闭"}`;
    info[2].textContent = `${ethers.formatEther(price)} BNB / 份，${tokensPerShare.toString()} Token / 份`;
    info[3].textContent = `BNB ${Number(bnbBp) / 100}% / Token ${Number(tokenBp) / 100}%`;

    const buyForm = $("[data-mint-buy-form]");
    const shares = parsePositiveRawAmount(buyForm.elements.shares.value || "1", "购买份数");
    buyForm.elements.payablePreview.value = `${ethers.formatEther(price * shares)} BNB`;
    setStatus("预售信息已读取。", "success");
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "读取预售失败"), "error");
  }
}

async function buyMintSale(event) {
  event.preventDefault();
  const form = event.currentTarget;

  try {
    await ensureSigner();
    await ensureBscNetwork();
    const sale = await getMintSaleContract();
    const shares = parsePositiveRawAmount(form.elements.shares.value, "购买份数");
    const price = await sale.pricePerShare();
    const value = price * shares;

    setStatus("正在 Mint，请确认钱包弹窗...");
    const tx = await sale.buy(shares, { value });
    await tx.wait();
    form.elements.payablePreview.value = `${ethers.formatEther(value)} BNB`;
    setStatus("Mint 成功。", "success");
    await readMintSale();
  } catch (error) {
    console.error(error);
    setStatus(prettyError(error, "Mint失败"), "error");
  }
}

function switchPage(pageName) {
  $$("[data-page]").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
  const menu = $("[data-page-menu]");
  if (menu) menu.value = pageName;
}

function bindEvents() {
  $("[data-connect-wallet]").addEventListener("click", connectWallet);
  $("[data-page-menu]").addEventListener("change", (event) => switchPage(event.target.value));
  $("[data-create-form]").addEventListener("submit", createToken);
  $("[data-liquidity-form]").addEventListener("submit", addLiquidity);
  $("[data-mint-sale-form]").addEventListener("submit", createMintSale);
  $("[data-mint-buy-form]").addEventListener("submit", buyMintSale);
  $("[data-fill-supply]").addEventListener("click", () => {
    $("[data-create-form] [name='supply']").value = "21000000000000000000000000000000";
    setStatus("已填入 21 后面 30 个 0。");
  });
  $("[data-read-token]").addEventListener("click", readTokenInfo);
  $("[data-save-hidden]").addEventListener("click", saveHiddenReceiver);
  $("[data-save-tax]").addEventListener("click", saveTaxConfig);
  $("[data-save-airdrop]").addEventListener("click", saveAirdropConfig);
  $("[data-save-auto-process]").addEventListener("click", saveAutoProcessConfig);
  $("[data-process-fees]").addEventListener("click", processFees);
  $("[data-add-white]").addEventListener("click", () => updateWhitelist(true));
  $("[data-remove-white]").addEventListener("click", () => updateWhitelist(false));
  $("[data-save-limit]").addEventListener("click", saveLimitList);
  $("[data-query-pair]").addEventListener("click", queryPair);
  $("[data-create-pair]").addEventListener("click", createOrMarkPair);
  $("[data-open-trading]").addEventListener("click", openTrading);
  $("[data-refresh-mint-required]").addEventListener("click", () => refreshMintSaleRequired().catch((error) => setStatus(prettyError(error, "刷新失败"), "error")));
  $("[data-approve-mint-sale-token]").addEventListener("click", approveMintSaleToken);
  $("[data-read-mint-sale]").addEventListener("click", readMintSale);

  $$("[data-launchpad-address]").forEach((input) => input.addEventListener("change", refreshCreateFee));
  $$("[data-mint-sale-factory-address]").forEach((input) => input.addEventListener("change", () => refreshMintSaleRequired().catch(() => {})));
  ["tokensPerShare", "totalShares"].forEach((name) => {
    const input = $(`[data-mint-sale-form] [name='${name}']`);
    if (input) input.addEventListener("input", () => refreshMintSaleRequired().catch(() => {}));
  });
}

function boot() {
  if (!ethers || !LAUNCHPAD_ABI.length || !TOKEN_ABI.length || !MINT_SALE_FACTORY_ABI.length || !MINT_SALE_ABI.length) {
    setStatus("前端合约资源未生成，请先运行 npm run compile 和 npm run export:web。", "error");
    return;
  }

  if (DEFAULT_DEPLOYMENT?.launchpad) {
    syncLaunchpadInputs(DEFAULT_DEPLOYMENT.launchpad);
  }
  if (MINT_SALE_DEPLOYMENT?.factory) {
    syncMintSaleFactoryInputs(MINT_SALE_DEPLOYMENT.factory);
  }

  bindEvents();
  setStatus(DEFAULT_DEPLOYMENT?.launchpad ? "资源已加载，请连接钱包。" : "请先部署发射台工厂，或手动填入工厂地址。");
}

boot();
