// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MintAddSale.sol";

contract MintAddSaleFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public createFee = 0.005 ether;
    address public feeReceiver;

    address[] private allSales;
    mapping(address => address[]) private creatorSales;
    mapping(address => address) public saleCreator;

    event MintAddSaleCreated(
        address indexed creator,
        address indexed sale,
        address indexed token,
        string saleName,
        uint256 pricePerShare,
        uint256 tokensPerShare,
        uint256 totalShares,
        uint256 paidFee
    );
    event CreateFeeUpdated(uint256 fee);
    event FeeReceiverUpdated(address indexed receiver);

    error InvalidFee();
    error InvalidInput();
    error FeeTransferFailed();
    error ZeroAddress();

    constructor(address feeReceiver_) Ownable(msg.sender) {
        if (feeReceiver_ == address(0)) revert ZeroAddress();
        feeReceiver = feeReceiver_;
    }

    function createSale(MintAddSale.SaleParams calldata params) external payable nonReentrant returns (address sale) {
        if (msg.value < createFee) revert InvalidFee();
        if (params.token == address(0) || params.pricePerShare == 0 || params.tokensPerShare == 0 || params.totalShares == 0) {
            revert InvalidInput();
        }

        MintAddSale created = new MintAddSale(params, msg.sender);
        sale = address(created);

        uint256 requiredTokens = params.totalShares * params.tokensPerShare;
        IERC20(params.token).safeTransferFrom(msg.sender, sale, requiredTokens);

        allSales.push(sale);
        creatorSales[msg.sender].push(sale);
        saleCreator[sale] = msg.sender;

        (bool success, ) = payable(feeReceiver).call{value: msg.value}("");
        if (!success) revert FeeTransferFailed();

        emit MintAddSaleCreated(
            msg.sender,
            sale,
            params.token,
            params.saleName,
            params.pricePerShare,
            params.tokensPerShare,
            params.totalShares,
            msg.value
        );
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

    function allSalesLength() external view returns (uint256) {
        return allSales.length;
    }

    function allSalesSlice(uint256 start, uint256 count) external view returns (address[] memory result) {
        if (start >= allSales.length) return new address[](0);
        uint256 end = start + count;
        if (end > allSales.length) end = allSales.length;
        result = new address[](end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = allSales[i];
        }
    }

    function salesOfCreator(address creator) external view returns (address[] memory) {
        return creatorSales[creator];
    }
}
