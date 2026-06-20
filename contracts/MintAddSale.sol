// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./base/interface/IRouter.sol";

contract MintAddSale is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_DENOMINATOR = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    struct SaleParams {
        string saleName;
        address token;
        address router;
        address fundReceiver;
        uint256 pricePerShare;
        uint256 tokensPerShare;
        uint256 totalShares;
        uint256 maxSharesPerBuy;
        uint256 maxSharesPerWallet;
        uint256 whitelistTotalShares;
        uint16 bnbLiquidityBp;
        uint16 tokenLiquidityBp;
        bool whitelistEnabled;
        bool lpBurnEnabled;
        bool saleOpen;
        address[] whitelistAccounts;
        uint256[] whitelistQuotas;
    }

    string public saleName;
    IERC20 public immutable saleToken;
    IRouter public router;
    address public fundReceiver;

    uint256 public pricePerShare;
    uint256 public tokensPerShare;
    uint256 public totalShares;
    uint256 public soldShares;
    uint256 public maxSharesPerBuy;
    uint256 public maxSharesPerWallet;
    uint256 public whitelistTotalShares;
    uint256 public whitelistSoldShares;
    uint16 public bnbLiquidityBp;
    uint16 public tokenLiquidityBp;
    bool public whitelistEnabled;
    bool public lpBurnEnabled;
    bool public saleOpen;

    mapping(address => uint256) public boughtShares;
    mapping(address => uint256) public whitelistQuota;

    event SaleConfigured(
        uint256 pricePerShare,
        uint256 tokensPerShare,
        uint256 totalShares,
        uint256 maxSharesPerBuy,
        uint256 maxSharesPerWallet
    );
    event LiquidityConfigUpdated(uint16 bnbLiquidityBp, uint16 tokenLiquidityBp, bool lpBurnEnabled);
    event WhitelistConfigUpdated(bool enabled, uint256 totalShares);
    event WhitelistQuotaUpdated(address indexed account, uint256 quota);
    event SaleOpenUpdated(bool open);
    event Bought(
        address indexed buyer,
        uint256 shares,
        uint256 paidBnb,
        uint256 userTokenAmount,
        uint256 liquidityTokenAmount,
        uint256 liquidityBnbAmount
    );
    event LiquidityAdded(uint256 tokenAmount, uint256 bnbAmount, uint256 liquidity, address indexed lpReceiver);
    event FundReceiverUpdated(address indexed receiver);
    event RouterUpdated(address indexed router);

    error ZeroAddress();
    error InvalidAmount();
    error InvalidRatio();
    error SaleClosed();
    error SoldOut();
    error BuyLimitExceeded();
    error WalletLimitExceeded();
    error WhitelistExceeded();
    error TokenBalanceNotEnough();
    error BnbTransferFailed();

    constructor(SaleParams memory params, address initialOwner) Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (params.token == address(0)) revert ZeroAddress();
        if (params.fundReceiver == address(0)) params.fundReceiver = initialOwner;
        if (params.router == address(0)) params.router = PANCAKE_V2_ROUTER;

        saleName = params.saleName;
        saleToken = IERC20(params.token);
        router = IRouter(params.router);
        fundReceiver = params.fundReceiver;

        _setSaleConfig(
            params.pricePerShare,
            params.tokensPerShare,
            params.totalShares,
            params.maxSharesPerBuy,
            params.maxSharesPerWallet
        );
        _setLiquidityConfig(params.bnbLiquidityBp, params.tokenLiquidityBp, params.lpBurnEnabled);
        if (params.whitelistAccounts.length != params.whitelistQuotas.length) revert InvalidAmount();
        whitelistEnabled = params.whitelistEnabled;
        whitelistTotalShares = params.whitelistTotalShares;
        if (whitelistTotalShares > totalShares) revert InvalidAmount();
        for (uint256 i = 0; i < params.whitelistAccounts.length; i++) {
            if (params.whitelistAccounts[i] == address(0)) revert ZeroAddress();
            whitelistQuota[params.whitelistAccounts[i]] = params.whitelistQuotas[i];
            emit WhitelistQuotaUpdated(params.whitelistAccounts[i], params.whitelistQuotas[i]);
        }
        saleOpen = params.saleOpen;

        emit WhitelistConfigUpdated(whitelistEnabled, whitelistTotalShares);
        emit SaleOpenUpdated(saleOpen);
    }

    receive() external payable {}

    function requiredTokenAmount() public view returns (uint256) {
        return totalShares * tokensPerShare;
    }

    function remainingShares() external view returns (uint256) {
        return totalShares - soldShares;
    }

    function setSaleConfig(
        uint256 pricePerShare_,
        uint256 tokensPerShare_,
        uint256 totalShares_,
        uint256 maxSharesPerBuy_,
        uint256 maxSharesPerWallet_
    ) external onlyOwner {
        _setSaleConfig(pricePerShare_, tokensPerShare_, totalShares_, maxSharesPerBuy_, maxSharesPerWallet_);
    }

    function setLiquidityConfig(uint16 bnbLiquidityBp_, uint16 tokenLiquidityBp_, bool lpBurnEnabled_) external onlyOwner {
        _setLiquidityConfig(bnbLiquidityBp_, tokenLiquidityBp_, lpBurnEnabled_);
    }

    function setWhitelistConfig(bool enabled, uint256 totalWhitelistShares) external onlyOwner {
        if (totalWhitelistShares > totalShares) revert InvalidAmount();
        whitelistEnabled = enabled;
        whitelistTotalShares = totalWhitelistShares;
        emit WhitelistConfigUpdated(enabled, totalWhitelistShares);
    }

    function setWhitelistQuota(address[] calldata accounts, uint256[] calldata quotas) external onlyOwner {
        if (accounts.length != quotas.length) revert InvalidAmount();
        for (uint256 i = 0; i < accounts.length; i++) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            whitelistQuota[accounts[i]] = quotas[i];
            emit WhitelistQuotaUpdated(accounts[i], quotas[i]);
        }
    }

    function setSaleOpen(bool open) external onlyOwner {
        saleOpen = open;
        emit SaleOpenUpdated(open);
    }

    function setFundReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        fundReceiver = receiver;
        emit FundReceiverUpdated(receiver);
    }

    function setRouter(address router_) external onlyOwner {
        if (router_ == address(0)) revert ZeroAddress();
        router = IRouter(router_);
        emit RouterUpdated(router_);
    }

    function buy(uint256 shares) external payable nonReentrant {
        if (!saleOpen) revert SaleClosed();
        if (shares == 0) revert InvalidAmount();
        if (soldShares + shares > totalShares) revert SoldOut();
        if (maxSharesPerBuy > 0 && shares > maxSharesPerBuy) revert BuyLimitExceeded();
        if (maxSharesPerWallet > 0 && boughtShares[msg.sender] + shares > maxSharesPerWallet) {
            revert WalletLimitExceeded();
        }

        uint256 requiredBnb = pricePerShare * shares;
        if (msg.value < requiredBnb) revert InvalidAmount();

        if (whitelistEnabled) {
            if (whitelistQuota[msg.sender] < shares) revert WhitelistExceeded();
            if (whitelistTotalShares > 0 && whitelistSoldShares + shares > whitelistTotalShares) {
                revert WhitelistExceeded();
            }
            whitelistQuota[msg.sender] -= shares;
            whitelistSoldShares += shares;
            emit WhitelistQuotaUpdated(msg.sender, whitelistQuota[msg.sender]);
        }

        uint256 totalTokenAmount = tokensPerShare * shares;
        if (saleToken.balanceOf(address(this)) < totalTokenAmount) revert TokenBalanceNotEnough();

        soldShares += shares;
        boughtShares[msg.sender] += shares;

        uint256 liquidityTokenAmount = (totalTokenAmount * tokenLiquidityBp) / FEE_DENOMINATOR;
        uint256 userTokenAmount = totalTokenAmount - liquidityTokenAmount;
        uint256 liquidityBnbAmount = (requiredBnb * bnbLiquidityBp) / FEE_DENOMINATOR;
        uint256 fundBnbAmount = requiredBnb - liquidityBnbAmount;

        if (userTokenAmount > 0) {
            saleToken.safeTransfer(msg.sender, userTokenAmount);
        }

        if (liquidityTokenAmount > 0 && liquidityBnbAmount > 0) {
            _addLiquidity(liquidityTokenAmount, liquidityBnbAmount);
        }

        if (fundBnbAmount > 0) {
            _transferBnb(fundReceiver, fundBnbAmount);
        }

        uint256 refund = msg.value - requiredBnb;
        if (refund > 0) {
            _transferBnb(msg.sender, refund);
        }

        emit Bought(msg.sender, shares, requiredBnb, userTokenAmount, liquidityTokenAmount, liquidityBnbAmount);
    }

    function fundTokens(uint256 amount) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        saleToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdrawUnsoldTokens(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        saleToken.safeTransfer(to, amount);
    }

    function withdrawBnb(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        _transferBnb(to, amount);
    }

    function withdrawToken(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0) || to == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        IERC20(token).safeTransfer(to, amount);
    }

    function _setSaleConfig(
        uint256 pricePerShare_,
        uint256 tokensPerShare_,
        uint256 totalShares_,
        uint256 maxSharesPerBuy_,
        uint256 maxSharesPerWallet_
    ) private {
        if (pricePerShare_ == 0 || tokensPerShare_ == 0 || totalShares_ == 0) revert InvalidAmount();
        if (totalShares_ < soldShares) revert SoldOut();
        if (maxSharesPerBuy_ > 0 && maxSharesPerBuy_ > totalShares_) revert InvalidAmount();
        if (maxSharesPerWallet_ > 0 && maxSharesPerWallet_ > totalShares_) revert InvalidAmount();

        pricePerShare = pricePerShare_;
        tokensPerShare = tokensPerShare_;
        totalShares = totalShares_;
        maxSharesPerBuy = maxSharesPerBuy_;
        maxSharesPerWallet = maxSharesPerWallet_;

        emit SaleConfigured(pricePerShare_, tokensPerShare_, totalShares_, maxSharesPerBuy_, maxSharesPerWallet_);
    }

    function _setLiquidityConfig(uint16 bnbLiquidityBp_, uint16 tokenLiquidityBp_, bool lpBurnEnabled_) private {
        if (bnbLiquidityBp_ > FEE_DENOMINATOR || tokenLiquidityBp_ > FEE_DENOMINATOR) revert InvalidRatio();
        if ((bnbLiquidityBp_ == 0) != (tokenLiquidityBp_ == 0)) revert InvalidRatio();

        bnbLiquidityBp = bnbLiquidityBp_;
        tokenLiquidityBp = tokenLiquidityBp_;
        lpBurnEnabled = lpBurnEnabled_;

        emit LiquidityConfigUpdated(bnbLiquidityBp_, tokenLiquidityBp_, lpBurnEnabled_);
    }

    function _addLiquidity(uint256 tokenAmount, uint256 bnbAmount) private {
        address lpReceiver = lpBurnEnabled ? DEAD : owner();
        saleToken.forceApprove(address(router), tokenAmount);
        (uint256 usedToken, uint256 usedBnb, uint256 liquidity) = router.addLiquidityETH{value: bnbAmount}(
            address(saleToken),
            tokenAmount,
            0,
            0,
            lpReceiver,
            block.timestamp
        );
        emit LiquidityAdded(usedToken, usedBnb, liquidity, lpReceiver);
    }

    function _transferBnb(address to, uint256 amount) private {
        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) revert BnbTransferFailed();
    }
}
