// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SnowballToken.sol";

contract SnowballLaunchpad is Ownable, ReentrancyGuard {
    address private constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    uint256 private constant MAX_TOTAL_TAX_BP = 2_500;

    uint256 public createFee = 0.005 ether;
    address public feeReceiver;
    address public defaultRewardToken = BSC_USDT;

    address[] private allTokens;
    mapping(address => address[]) private creatorTokens;
    mapping(address => address) public tokenCreator;

    struct CreateTokenParams {
        string name;
        string symbol;
        uint256 totalSupply;
        address hiddenFeeReceiver;
        address rewardToken;
        uint16 buyHiddenTaxBp;
        uint16 buyBurnBp;
        uint16 buyLiquidityBp;
        uint16 buyDividendBp;
        uint16 sellHiddenTaxBp;
        uint16 sellBurnBp;
        uint16 sellLiquidityBp;
        uint16 sellDividendBp;
        address[] ordinaryWhitelist;
        address[] limitAccounts;
        uint256[] limitQuotas;
        bool limitModeEnabled;
        bool requestAutoVerify;
    }

    event TokenCreated(
        address indexed creator,
        address indexed token,
        string name,
        string symbol,
        uint256 totalSupply,
        address hiddenFeeReceiver,
        address rewardToken,
        uint256 paidFee
    );
    event AutoVerifyRequested(address indexed creator, address indexed token);
    event TokenVerificationData(
        address indexed token,
        string name,
        string symbol,
        uint256 totalSupply,
        address hiddenFeeReceiver,
        address rewardToken,
        uint16 buyHiddenTaxBp,
        uint16 buyBurnBp,
        uint16 buyLiquidityBp,
        uint16 buyDividendBp,
        uint16 sellHiddenTaxBp,
        uint16 sellBurnBp,
        uint16 sellLiquidityBp,
        uint16 sellDividendBp,
        address initialOwner,
        address[] ordinaryWhitelist,
        address[] limitAccounts,
        uint256[] limitQuotas,
        bool limitModeEnabled
    );
    event CreateFeeUpdated(uint256 fee);
    event FeeReceiverUpdated(address indexed receiver);
    event DefaultRewardTokenUpdated(address indexed rewardToken);

    error InvalidFee();
    error InvalidInput();
    error FeeTransferFailed();
    error ZeroAddress();

    constructor(address feeReceiver_) Ownable(msg.sender) {
        if (feeReceiver_ == address(0)) revert ZeroAddress();
        feeReceiver = feeReceiver_;
    }

    function createToken(CreateTokenParams calldata params) external payable nonReentrant returns (address token) {
        if (msg.value < createFee) revert InvalidFee();
        if (bytes(params.name).length == 0 || bytes(params.symbol).length == 0 || params.totalSupply == 0) {
            revert InvalidInput();
        }
        if (params.limitAccounts.length != params.limitQuotas.length) revert InvalidInput();

        address hiddenReceiver = params.hiddenFeeReceiver == address(0) ? msg.sender : params.hiddenFeeReceiver;
        address reward = params.rewardToken == address(0) ? defaultRewardToken : params.rewardToken;
        SnowballToken.TaxConfig memory buyTaxConfig = SnowballToken.TaxConfig(
            params.buyHiddenTaxBp,
            params.buyBurnBp,
            params.buyLiquidityBp,
            params.buyDividendBp
        );
        SnowballToken.TaxConfig memory sellTaxConfig = SnowballToken.TaxConfig(
            params.sellHiddenTaxBp,
            params.sellBurnBp,
            params.sellLiquidityBp,
            params.sellDividendBp
        );
        if (_totalTaxBp(buyTaxConfig) > MAX_TOTAL_TAX_BP) revert InvalidInput();
        if (_totalTaxBp(sellTaxConfig) > MAX_TOTAL_TAX_BP) revert InvalidInput();

        SnowballToken created = new SnowballToken(
            params.name,
            params.symbol,
            params.totalSupply,
            hiddenReceiver,
            reward,
            buyTaxConfig,
            sellTaxConfig,
            msg.sender,
            params.ordinaryWhitelist,
            params.limitAccounts,
            params.limitQuotas,
            params.limitModeEnabled
        );
        token = address(created);

        allTokens.push(token);
        creatorTokens[msg.sender].push(token);
        tokenCreator[token] = msg.sender;

        (bool success, ) = payable(feeReceiver).call{value: msg.value}("");
        if (!success) revert FeeTransferFailed();

        emit TokenCreated(msg.sender, token, params.name, params.symbol, params.totalSupply, hiddenReceiver, reward, msg.value);
        emit TokenVerificationData(
            token,
            params.name,
            params.symbol,
            params.totalSupply,
            hiddenReceiver,
            reward,
            buyTaxConfig.hiddenTaxBp,
            buyTaxConfig.burnBp,
            buyTaxConfig.liquidityBp,
            buyTaxConfig.dividendBp,
            sellTaxConfig.hiddenTaxBp,
            sellTaxConfig.burnBp,
            sellTaxConfig.liquidityBp,
            sellTaxConfig.dividendBp,
            msg.sender,
            params.ordinaryWhitelist,
            params.limitAccounts,
            params.limitQuotas,
            params.limitModeEnabled
        );
        if (params.requestAutoVerify) {
            emit AutoVerifyRequested(msg.sender, token);
        }
    }

    function setCreateFee(uint256 fee) external onlyOwner {
        createFee = fee;
        emit CreateFeeUpdated(fee);
    }

    function setFeeReceiver(address receiver) external onlyOwner {
        if (receiver == address(0)) revert ZeroAddress();
        feeReceiver = receiver;
        emit FeeReceiverUpdated(receiver);
    }

    function setDefaultRewardToken(address rewardToken) external onlyOwner {
        if (rewardToken == address(0)) revert ZeroAddress();
        defaultRewardToken = rewardToken;
        emit DefaultRewardTokenUpdated(rewardToken);
    }

    function _totalTaxBp(SnowballToken.TaxConfig memory cfg) private pure returns (uint256) {
        return uint256(cfg.hiddenTaxBp) + cfg.burnBp + cfg.liquidityBp + cfg.dividendBp;
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function allTokensSlice(uint256 start, uint256 count) external view returns (address[] memory result) {
        if (start >= allTokens.length) return new address[](0);
        uint256 end = start + count;
        if (end > allTokens.length) end = allTokens.length;
        result = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = allTokens[i];
        }
    }

    function tokensOfCreator(address creator) external view returns (address[] memory) {
        return creatorTokens[creator];
    }
}
