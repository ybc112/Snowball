# Snowball 多零直发发射台

这个目录是 Snowball 多零直发持币分红 V3 项目，核心是发射台工厂和模板 Token。

## 合约

- `contracts/SnowballLaunchpad.sol`：发射台工厂，创建费用默认 `0.005 BNB`。
- `contracts/SnowballToken.sol`：模板 Token，`decimals()` 固定为 `0`，支持 30 个 0 这种大整数总量。
- `contracts/MintAddSaleFactory.sol`：加池子 Mint 预售工厂，创建费用默认 `0.005 BNB`。
- `contracts/MintAddSale.sol`：单个 Mint 预售合约，支持白名单、白名单份额、每份价格、每份数量、总份数、单次/单钱包上限、BNB 加池比例、Token 加池比例和 LP 销毁。
- 创建者就是 Token owner，后续白名单、限购、加池、开盘都由创建者钱包管理。
- 默认 Pancake WBNB 底池，买入/卖出手续费由创建者自行设置。
- 普通白名单和限购名单分开，限购名单只控制买入额度。
- 创建时会发出开源请求事件和完整构造参数事件，后台服务可监听后提交区块浏览器验证。

## 常用命令

```bash
npm install
npm run compile
npm test
npm run export:web
```

部署 Snowball 发射台工厂：

```bash
npm run deploy:snowball:bsc
```

部署 Mint 加池预售工厂：

```bash
npm run deploy:mint-sale:bsc
```

如果区块浏览器延迟或后台没有自动处理，可用创建交易补开源：

```bash
set CREATE_TX=创建Token那笔交易哈希
npm run verify:snowball:token:bsc
```

服务器自动监听创建事件并开源：

```bash
set SNOWBALL_LAUNCHPAD=发射台工厂地址
npm run watch:auto-verify:bsc
```

常用可选参数：

- `AUTO_VERIFY_START_BLOCK`：从指定区块开始扫，没填默认从当前区块往前 5000 个区块。
- `AUTO_VERIFY_CONFIRMATIONS`：等待多少个确认后再提交开源，默认 `5`。
- `AUTO_VERIFY_ONCE=true`：只扫一次就退出，适合手动补跑。

`.env` 里建议填写：

```env
BSC_RPC_URL=https://bsc-dataseed.binance.org
PRIVATE_KEY=
SNOWBALL_FEE_RECEIVER=你的创建费收款地址
MINT_SALE_FEE_RECEIVER=你的预售创建费收款地址
BSCSCAN_API_KEY=
```

前端页面：

```text
web/index.html
```

直接打开即可使用；如果已经部署工厂，先运行 `npm run export:web`，页面会自动读取 `deployments/snowball-launchpad-bsc.json` 里的工厂地址。

## 创建和开盘流程

1. 部署 `SnowballLaunchpad`。
2. 打开 `web/index.html`，连接 BSC 钱包。
3. 填写 Token 名称、符号、总量和隐藏收款地址。
4. 按需填写普通白名单、限购名单。
5. 支付 `0.005 BNB` 创建 Token。
6. 授权并添加 BNB 底池，LP 默认可发往黑洞地址。
7. 标记 Pair 后手动开盘。

## Mint 加池预售流程

1. 部署 `MintAddSaleFactory`。
2. 项目方准备要预售的 Token，并给预售工厂授权 `总份数 * 每份数量`。
3. 创建 Mint 预售，填写每份价格、每份数量、总份数、最大份数、白名单和加池比例。
4. 用户参与 Mint 时支付 BNB，合约按 `BNB 加池比例` 和 `Token 加池比例` 自动调用 Pancake 加池。
5. `LP 销毁` 开启时，LP 直接发往黑洞地址；关闭时，LP 发给预售创建者。
6. 如果预售 Token 还没开盘，创建成功后要把预售合约加入 Token 白名单。

## 旧版单币脚本

旧的 `TokenZero`、`ShaZeroProtocol` 脚本仍保留，方便对照和单独测试；Snowball 发射台请优先使用 `SnowballLaunchpad`。
