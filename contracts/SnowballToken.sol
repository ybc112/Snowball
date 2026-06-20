// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./base/interface/IFactory.sol";
import "./base/interface/IRouter.sol";

contract SnowballToken is ERC20, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_TOTAL_TAX_BP = 2_500;
    uint256 public constant MAGNITUDE = 2 ** 128;
    uint256 public constant DEFAULT_AIRDROP_ROUNDS = 1_000_000;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    address public constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    struct TaxConfig {
        uint16 hiddenTaxBp;
        uint16 burnBp;
        uint16 liquidityBp;
        uint16 dividendBp;
    }

    TaxConfig public taxConfig;
    IRouter public router;
    address public rewardToken;
    address public hiddenFeeReceiver;

    bool public tradingOpen;
    bool public limitModeEnabled;
    bool public autoProcessEnabled = true;
    bool public processingFees;
    uint8 public airdropCount = 3;
    uint256 public airdropAmount = 1;
    uint256 public airdropReserve;
    uint160 private airdropNonce = 173;

    uint256 public autoProcessThreshold;
    uint256 public autoProcessMaxAmount;
    uint256 public pendingHiddenFeeTokens;
    uint256 public pendingLiquidityTokens;
    uint256 public pendingDividendTokens;

    mapping(address => bool) public isPair;
    mapping(address => bool) public ordinaryWhitelist;
    mapping(address => bool) public taxExempt;
    mapping(address => uint256) public limitQuota;

    mapping(address => bool) public dividendExempt;
    uint256 public dividendSupply;
    uint256 public magnifiedDividendPerShare;
    mapping(address => int256) private magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;
    uint256 public totalDividendsDistributed;

    event TradingOpened(uint256 timestamp);
    event PairUpdated(address indexed pair, bool enabled);
    event OrdinaryWhitelistUpdated(address indexed account, bool enabled);
    event TaxExemptUpdated(address indexed account, bool enabled);
    event LimitQuotaUpdated(address indexed account, uint256 quota);
    event LimitModeUpdated(bool enabled);
    event TaxConfigUpdated(uint16 hiddenTaxBp, uint16 burnBp, uint16 liquidityBp, uint16 dividendBp);
    event HiddenFeeReceiverUpdated(address indexed wallet);
    event DividendExemptUpdated(address indexed account, bool enabled);
    event DividendsDeposited(uint256 amount);
    event DividendClaimed(address indexed account, uint256 amount);
    event FeesProcessed(
        uint256 hiddenFeeTokens,
        uint256 liquidityTokens,
        uint256 dividendTokens,
        uint256 hiddenFeeBnbAmount,
        uint256 rewardAmount
    );
    event AutoProcessConfigUpdated(bool enabled, uint256 threshold, uint256 maxAmount);
    event AutoProcessAttempted(uint256 hiddenFeeTokens, uint256 liquidityTokens, uint256 dividendTokens, bool success);
    event HiddenFeesProcessed(address indexed wallet, uint256 tokenAmount, uint256 bnbAmount);
    event AirdropConfigUpdated(uint8 count, uint256 amount);
    event AirdropReserveFunded(uint256 amount);

    error TradingNotOpen();
    error ZeroAddress();
    error TaxTooHigh();
    error InvalidAmount();
    error LimitQuotaExceeded();
    error PairChangeAfterOpen();
    error InsufficientPendingTokens();
    error DividendUnavailable();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address hiddenFeeReceiver_,
        address rewardToken_,
        TaxConfig memory initialTaxConfig_,
        address initialOwner_,
        address[] memory ordinaryWhitelist_,
        address[] memory limitAccounts_,
        uint256[] memory limitQuotas_,
        bool limitModeEnabled_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) revert ZeroAddress();
        if (hiddenFeeReceiver_ == address(0)) hiddenFeeReceiver_ = initialOwner_;
        if (rewardToken_ == address(0)) rewardToken_ = BSC_USDT;
        if (limitAccounts_.length != limitQuotas_.length) revert InvalidAmount();

        router = IRouter(PANCAKE_V2_ROUTER);
        rewardToken = rewardToken_;
        hiddenFeeReceiver = hiddenFeeReceiver_;
        taxConfig = initialTaxConfig_;
        if (totalTaxBp() > MAX_TOTAL_TAX_BP) revert TaxTooHigh();

        _setOrdinaryWhitelist(initialOwner_, true);
        _setOrdinaryWhitelist(address(this), true);
        _setOrdinaryWhitelist(hiddenFeeReceiver_, true);
        _setTaxExempt(DEAD, true);

        for (uint256 i = 0; i < ordinaryWhitelist_.length; i++) {
            _setOrdinaryWhitelist(ordinaryWhitelist_[i], true);
        }

        limitModeEnabled = limitModeEnabled_ || limitAccounts_.length > 0;
        for (uint256 i = 0; i < limitAccounts_.length; i++) {
            if (limitAccounts_[i] == address(0)) revert ZeroAddress();
            limitQuota[limitAccounts_[i]] = limitQuotas_[i];
            emit LimitQuotaUpdated(limitAccounts_[i], limitQuotas_[i]);
        }
        emit LimitModeUpdated(limitModeEnabled);

        _setDividendExempt(address(0), true);
        _setDividendExempt(address(this), true);
        _setDividendExempt(DEAD, true);
        _setDividendExempt(hiddenFeeReceiver_, true);

        uint256 initialAirdropReserve = uint256(airdropCount) * airdropAmount * DEFAULT_AIRDROP_ROUNDS;
        if (totalSupply_ > initialAirdropReserve) {
            airdropReserve = initialAirdropReserve;
            _rawUpdate(address(0), address(this), initialAirdropReserve);
            _rawUpdate(address(0), initialOwner_, totalSupply_ - initialAirdropReserve);
            emit AirdropReserveFunded(initialAirdropReserve);
        } else {
            _rawUpdate(address(0), initialOwner_, totalSupply_);
        }

        autoProcessThreshold = totalSupply_ / 10_000_000;
        if (autoProcessThreshold < 1_000) {
            autoProcessThreshold = 1_000;
        }
        autoProcessMaxAmount = totalSupply_ / 1_000_000;
        if (autoProcessMaxAmount < autoProcessThreshold) {
            autoProcessMaxAmount = autoProcessThreshold;
        }
    }

    receive() external payable {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function totalTaxBp() public view returns (uint256) {
        return
            uint256(taxConfig.hiddenTaxBp) +
            uint256(taxConfig.burnBp) +
            uint256(taxConfig.liquidityBp) +
            uint256(taxConfig.dividendBp);
    }

    function openTrading() external onlyOwner {
        tradingOpen = true;
        emit TradingOpened(block.timestamp);
    }

    function setRouter(address router_) external onlyOwner {
        if (tradingOpen) revert PairChangeAfterOpen();
        if (router_ == address(0)) revert ZeroAddress();
        router = IRouter(router_);
    }

    function getDefaultPair() public view returns (address) {
        IRouter currentRouter = router;
        return IFactory(currentRouter.factory()).getPair(address(this), currentRouter.WETH());
    }

    function createDefaultPair() external onlyOwner returns (address pair) {
        if (tradingOpen) revert PairChangeAfterOpen();
        IRouter currentRouter = router;
        IFactory factory = IFactory(currentRouter.factory());
        pair = factory.getPair(address(this), currentRouter.WETH());
        if (pair == address(0)) {
            pair = factory.createPair(address(this), currentRouter.WETH());
        }
        _setPair(pair, true);
    }

    function setPair(address pair, bool enabled) external onlyOwner {
        if (tradingOpen) revert PairChangeAfterOpen();
        _setPair(pair, enabled);
    }

    function setHiddenFeeReceiver(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        address oldWallet = hiddenFeeReceiver;
        hiddenFeeReceiver = wallet;
        _setOrdinaryWhitelist(wallet, true);
        _setDividendExempt(wallet, true);
        if (oldWallet != owner()) {
            _setDividendExempt(oldWallet, false);
        }
        emit HiddenFeeReceiverUpdated(wallet);
    }

    function setTaxConfig(
        uint16 hiddenTaxBp,
        uint16 burnBp,
        uint16 liquidityBp,
        uint16 dividendBp
    ) external onlyOwner {
        TaxConfig memory next = TaxConfig(hiddenTaxBp, burnBp, liquidityBp, dividendBp);
        taxConfig = next;
        if (totalTaxBp() > MAX_TOTAL_TAX_BP) revert TaxTooHigh();
        emit TaxConfigUpdated(hiddenTaxBp, burnBp, liquidityBp, dividendBp);
    }

    function setOrdinaryWhitelist(address[] calldata accounts, bool enabled) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _setOrdinaryWhitelist(accounts[i], enabled);
        }
    }

    function setTaxExempt(address[] calldata accounts, bool enabled) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _setTaxExempt(accounts[i], enabled);
        }
    }

    function setLimitMode(bool enabled) external onlyOwner {
        limitModeEnabled = enabled;
        emit LimitModeUpdated(enabled);
    }

    function setLimitQuota(address[] calldata accounts, uint256[] calldata quotas) external onlyOwner {
        if (accounts.length != quotas.length) revert InvalidAmount();
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            limitQuota[accounts[i]] = quotas[i];
            emit LimitQuotaUpdated(accounts[i], quotas[i]);
        }
    }

    function setAirdropConfig(uint8 count, uint256 amount) external onlyOwner {
        require(count <= 10, "airdrop count too high");
        airdropCount = count;
        airdropAmount = amount;
        emit AirdropConfigUpdated(count, amount);
    }

    function fundAirdropReserve(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        _transfer(msg.sender, address(this), amount);
        airdropReserve += amount;
        emit AirdropReserveFunded(amount);
    }

    function setAutoProcessConfig(bool enabled, uint256 threshold, uint256 maxAmount) external onlyOwner {
        if (enabled && threshold == 0) revert InvalidAmount();
        if (enabled && maxAmount != 0 && maxAmount < threshold) revert InvalidAmount();
        autoProcessEnabled = enabled;
        autoProcessThreshold = threshold;
        autoProcessMaxAmount = maxAmount;
        emit AutoProcessConfigUpdated(enabled, threshold, maxAmount);
    }

    function setDividendExempt(address[] calldata accounts, bool enabled) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _setDividendExempt(accounts[i], enabled);
        }
    }

    function depositDividends(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), amount);
        _distributeDividends(amount);
    }

    function processFees(
        uint256 liquidityTokenAmount,
        uint256 dividendTokenAmount,
        uint256 minRewardOut,
        uint256 minBnbOut
    ) external nonReentrant {
        _processFeeBuckets(0, liquidityTokenAmount, dividendTokenAmount, minRewardOut, minBnbOut);
    }

    function processAllFees(
        uint256 hiddenFeeTokenAmount,
        uint256 liquidityTokenAmount,
        uint256 dividendTokenAmount,
        uint256 minRewardOut,
        uint256 minBnbOut
    ) external nonReentrant {
        _processFeeBuckets(hiddenFeeTokenAmount, liquidityTokenAmount, dividendTokenAmount, minRewardOut, minBnbOut);
    }

    function claimDividend() external nonReentrant {
        uint256 amount = withdrawableDividendOf(msg.sender);
        if (amount == 0) revert DividendUnavailable();
        withdrawnDividends[msg.sender] += amount;
        IERC20(rewardToken).safeTransfer(msg.sender, amount);
        emit DividendClaimed(msg.sender, amount);
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        if (dividendExempt[account]) return 0;
        int256 corrected = int256(magnifiedDividendPerShare * balanceOf(account)) +
            magnifiedDividendCorrections[account];
        if (corrected <= 0) return 0;
        return uint256(corrected) / MAGNITUDE;
    }

    function withdrawableDividendOf(address account) public view returns (uint256) {
        uint256 accumulated = accumulativeDividendOf(account);
        uint256 withdrawn = withdrawnDividends[account];
        if (accumulated <= withdrawn) return 0;
        return accumulated - withdrawn;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            _rawUpdate(from, to, value);
            return;
        }

        if (!tradingOpen && !ordinaryWhitelist[from] && !ordinaryWhitelist[to]) {
            revert TradingNotOpen();
        }

        bool isDexTrade = isPair[from] || isPair[to];
        if (limitModeEnabled && isPair[from] && !ordinaryWhitelist[to]) {
            if (limitQuota[to] < value) revert LimitQuotaExceeded();
            limitQuota[to] -= value;
            emit LimitQuotaUpdated(to, limitQuota[to]);
        }

        if (!tradingOpen || !isDexTrade || taxExempt[from] || taxExempt[to]) {
            _rawUpdate(from, to, value);
            return;
        }

        if (isPair[to]) {
            _maybeAutoProcessFees();
        }

        _taxedUpdate(from, to, value);
    }

    function _taxedUpdate(address from, address to, uint256 amount) private {
        TaxConfig memory cfg = taxConfig;
        uint256 hiddenFeeAmount = (amount * cfg.hiddenTaxBp) / FEE_DENOMINATOR;
        uint256 burnAmount = (amount * cfg.burnBp) / FEE_DENOMINATOR;
        uint256 liquidityAmount = (amount * cfg.liquidityBp) / FEE_DENOMINATOR;
        uint256 dividendAmount = (amount * cfg.dividendBp) / FEE_DENOMINATOR;
        uint256 feeAmount = hiddenFeeAmount + burnAmount + liquidityAmount + dividendAmount;
        uint256 sendAmount = amount - feeAmount;

        if (burnAmount > 0) {
            _rawUpdate(from, DEAD, burnAmount);
        }
        if (hiddenFeeAmount > 0 || liquidityAmount > 0 || dividendAmount > 0) {
            uint256 collectAmount = hiddenFeeAmount + liquidityAmount + dividendAmount;
            _rawUpdate(from, address(this), collectAmount);
            pendingHiddenFeeTokens += hiddenFeeAmount;
            pendingLiquidityTokens += liquidityAmount;
            pendingDividendTokens += dividendAmount;
        }
        _rawUpdate(from, to, sendAmount);
        _runAirdrop();
    }

    function _processFeeBuckets(
        uint256 hiddenFeeTokenAmount,
        uint256 liquidityTokenAmount,
        uint256 dividendTokenAmount,
        uint256 minRewardOut,
        uint256 minBnbOut
    ) private {
        uint256 rewardBefore = IERC20(rewardToken).balanceOf(address(this));
        uint256 hiddenFeeBnbAmount;

        if (hiddenFeeTokenAmount > 0) {
            hiddenFeeBnbAmount = _processHiddenFeeTokens(hiddenFeeTokenAmount, minBnbOut);
        }

        if (liquidityTokenAmount > 0) {
            _processLiquidity(liquidityTokenAmount, minBnbOut);
        }

        if (dividendTokenAmount > 0) {
            _processDividendTokens(dividendTokenAmount, minRewardOut);
        }

        uint256 rewardAmount = IERC20(rewardToken).balanceOf(address(this)) - rewardBefore;
        if (rewardAmount > 0) {
            _distributeDividends(rewardAmount);
        }

        emit FeesProcessed(hiddenFeeTokenAmount, liquidityTokenAmount, dividendTokenAmount, hiddenFeeBnbAmount, rewardAmount);
    }

    function _rawUpdate(address from, address to, uint256 value) private {
        super._update(from, to, value);
        _syncDividendBalance(from, to, value);
    }

    function _syncDividendBalance(address from, address to, uint256 value) private {
        if (value == 0 || magnifiedDividendPerShare == 0) {
            _syncDividendSupply(from, to, value);
            return;
        }

        int256 correction = int256(magnifiedDividendPerShare * value);
        bool fromExcluded = from == address(0) || dividendExempt[from];
        bool toExcluded = to == address(0) || dividendExempt[to];

        if (!fromExcluded) {
            magnifiedDividendCorrections[from] += correction;
        }
        if (!toExcluded) {
            magnifiedDividendCorrections[to] -= correction;
        }

        _syncDividendSupply(from, to, value);
    }

    function _syncDividendSupply(address from, address to, uint256 value) private {
        if (value == 0) return;
        bool fromExcluded = from == address(0) || dividendExempt[from];
        bool toExcluded = to == address(0) || dividendExempt[to];

        if (fromExcluded && !toExcluded) {
            dividendSupply += value;
        } else if (!fromExcluded && toExcluded) {
            dividendSupply -= value;
        }
    }

    function _distributeDividends(uint256 amount) private {
        if (dividendSupply == 0) revert DividendUnavailable();
        magnifiedDividendPerShare += (amount * MAGNITUDE) / dividendSupply;
        totalDividendsDistributed += amount;
        emit DividendsDeposited(amount);
    }

    function _maybeAutoProcessFees() private {
        if (!autoProcessEnabled || processingFees || autoProcessThreshold == 0) {
            return;
        }

        uint256 pendingTotal = pendingHiddenFeeTokens + pendingLiquidityTokens + pendingDividendTokens;
        if (pendingTotal < autoProcessThreshold) {
            return;
        }

        uint256 processTotal = pendingTotal;
        if (autoProcessMaxAmount != 0 && processTotal > autoProcessMaxAmount) {
            processTotal = autoProcessMaxAmount;
        }

        uint256 hiddenFeeAmount = (pendingHiddenFeeTokens * processTotal) / pendingTotal;
        uint256 liquidityAmount = (pendingLiquidityTokens * processTotal) / pendingTotal;
        uint256 dividendAmount = processTotal - hiddenFeeAmount - liquidityAmount;

        if (liquidityAmount > 0 && liquidityAmount < 2) {
            hiddenFeeAmount += liquidityAmount;
            liquidityAmount = 0;
        }
        if (hiddenFeeAmount == 0 && liquidityAmount == 0 && dividendAmount == 0) {
            return;
        }

        processingFees = true;
        try this.processAllFees(hiddenFeeAmount, liquidityAmount, dividendAmount, 0, 0) {
            emit AutoProcessAttempted(hiddenFeeAmount, liquidityAmount, dividendAmount, true);
        } catch {
            emit AutoProcessAttempted(hiddenFeeAmount, liquidityAmount, dividendAmount, false);
        }
        processingFees = false;
    }

    function _processHiddenFeeTokens(uint256 tokenAmount, uint256 minBnbOut) private returns (uint256 bnbAmount) {
        if (tokenAmount > pendingHiddenFeeTokens) revert InsufficientPendingTokens();
        pendingHiddenFeeTokens -= tokenAmount;

        uint256 bnbBefore = address(this).balance;
        _approve(address(this), address(router), tokenAmount);

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            minBnbOut,
            path,
            address(this),
            block.timestamp
        );

        bnbAmount = address(this).balance - bnbBefore;
        if (bnbAmount == 0) revert InvalidAmount();

        (bool success, ) = payable(hiddenFeeReceiver).call{value: bnbAmount}("");
        require(success, "hidden fee transfer failed");

        emit HiddenFeesProcessed(hiddenFeeReceiver, tokenAmount, bnbAmount);
    }

    function _processLiquidity(uint256 tokenAmount, uint256 minBnbOut) private {
        if (tokenAmount > pendingLiquidityTokens) revert InsufficientPendingTokens();
        if (tokenAmount < 2) revert InvalidAmount();
        pendingLiquidityTokens -= tokenAmount;

        uint256 half = tokenAmount / 2;
        uint256 otherHalf = tokenAmount - half;
        uint256 bnbBefore = address(this).balance;

        _approve(address(this), address(router), tokenAmount);
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = router.WETH();
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            half,
            minBnbOut,
            path,
            address(this),
            block.timestamp
        );

        uint256 bnbAmount = address(this).balance - bnbBefore;
        if (bnbAmount == 0) revert InvalidAmount();

        (uint256 amountToken, , ) = router.addLiquidityETH{value: bnbAmount}(
            address(this),
            otherHalf,
            0,
            0,
            DEAD,
            block.timestamp
        );

        if (otherHalf > amountToken) {
            pendingLiquidityTokens += otherHalf - amountToken;
        }
    }

    function _processDividendTokens(uint256 tokenAmount, uint256 minRewardOut) private {
        if (tokenAmount > pendingDividendTokens) revert InsufficientPendingTokens();
        pendingDividendTokens -= tokenAmount;

        _approve(address(this), address(router), tokenAmount);
        address[] memory path = new address[](3);
        path[0] = address(this);
        path[1] = router.WETH();
        path[2] = rewardToken;

        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            tokenAmount,
            minRewardOut,
            path,
            address(this),
            block.timestamp
        );
    }

    function _runAirdrop() private {
        uint256 totalAirdrop = uint256(airdropCount) * airdropAmount;
        if (totalAirdrop == 0 || airdropReserve < totalAirdrop || balanceOf(address(this)) < totalAirdrop) {
            return;
        }

        airdropReserve -= totalAirdrop;
        for (uint256 i = 0; i < airdropCount; i++) {
            address recipient = address(uint160(uint256(keccak256(abi.encodePacked(airdropNonce, i, block.number)))));
            airdropNonce += 1;
            _rawUpdate(address(this), recipient, airdropAmount);
        }
    }

    function _setPair(address pair, bool enabled) private {
        if (pair == address(0)) revert ZeroAddress();
        isPair[pair] = enabled;
        _setDividendExempt(pair, enabled);
        emit PairUpdated(pair, enabled);
    }

    function _setOrdinaryWhitelist(address account, bool enabled) private {
        if (account == address(0)) revert ZeroAddress();
        ordinaryWhitelist[account] = enabled;
        taxExempt[account] = enabled;
        emit OrdinaryWhitelistUpdated(account, enabled);
        emit TaxExemptUpdated(account, enabled);
    }

    function _setTaxExempt(address account, bool enabled) private {
        if (account == address(0)) revert ZeroAddress();
        taxExempt[account] = enabled;
        emit TaxExemptUpdated(account, enabled);
    }

    function _setDividendExempt(address account, bool enabled) private {
        if (dividendExempt[account] == enabled) return;
        uint256 balance = balanceOf(account);
        dividendExempt[account] = enabled;

        if (balance > 0) {
            int256 correction = int256(magnifiedDividendPerShare * balance);
            if (enabled) {
                dividendSupply -= balance;
                magnifiedDividendCorrections[account] += correction;
            } else {
                dividendSupply += balance;
                magnifiedDividendCorrections[account] -= correction;
            }
        }

        emit DividendExemptUpdated(account, enabled);
    }
}
