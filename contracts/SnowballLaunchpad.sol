// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./SnowballToken.sol";

contract SnowballLaunchpad is Ownable, ReentrancyGuard {
    address public constant BSC_USDT = 0x55d398326f99059fF775485246999027B3197955;
    uint256 public constant MAX_TOTAL_TAX_BP = 1_500;

    uint256 public createFee = 0.005 ether;
    address public feeReceiver;
    address public defaultRewardToken = BSC_USDT;

    SnowballToken.TaxConfig public defaultTaxConfig = SnowballToken.TaxConfig({
        hiddenTaxBp: 1500,
        burnBp: 0,
        liquidityBp: 0,
        dividendBp: 0
    });

    address[] private allTokens;
    mapping(address => address[]) private creatorTokens;
    mapping(address => address) public tokenCreator;

    struct CreateTokenParams {
        string name;
        string symbol;
        uint256 totalSupply;
        address hiddenFeeReceiver;
        address rewardToken;
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
        uint16 hiddenTaxBp,
        uint16 burnBp,
        uint16 liquidityBp,
        uint16 dividendBp,
        address initialOwner,
        address[] ordinaryWhitelist,
        address[] limitAccounts,
        uint256[] limitQuotas,
        bool limitModeEnabled
    );
    event CreateFeeUpdated(uint256 fee);
    event FeeReceiverUpdated(address indexed receiver);
    event DefaultRewardTokenUpdated(address indexed rewardToken);
    event DefaultTaxConfigUpdated(uint16 hiddenTaxBp, uint16 burnBp, uint16 liquidityBp, uint16 dividendBp);

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

        SnowballToken created = new SnowballToken(
            params.name,
            params.symbol,
            params.totalSupply,
            hiddenReceiver,
            reward,
            defaultTaxConfig,
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
            defaultTaxConfig.hiddenTaxBp,
            defaultTaxConfig.burnBp,
            defaultTaxConfig.liquidityBp,
            defaultTaxConfig.dividendBp,
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

    function setDefaultTaxConfig(
        uint16 hiddenTaxBp,
        uint16 burnBp,
        uint16 liquidityBp,
        uint16 dividendBp
    ) external onlyOwner {
        uint256 total = uint256(hiddenTaxBp) + burnBp + liquidityBp + dividendBp;
        if (total > MAX_TOTAL_TAX_BP) revert InvalidInput();
        defaultTaxConfig = SnowballToken.TaxConfig(hiddenTaxBp, burnBp, liquidityBp, dividendBp);
        emit DefaultTaxConfigUpdated(hiddenTaxBp, burnBp, liquidityBp, dividendBp);
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
