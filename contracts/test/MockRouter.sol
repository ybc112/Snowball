// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockRouter {
    using SafeERC20 for IERC20;

    address public immutable weth;
    uint256 public lastTokenAmount;
    uint256 public lastBnbAmount;
    address public lastLpReceiver;

    constructor(address weth_) {
        weth = weth_;
    }

    receive() external payable {}

    function factory() external view returns (address) {
        return address(this);
    }

    function WETH() external view returns (address) {
        return weth;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256,
        uint256,
        address to,
        uint256
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amountTokenDesired);
        lastTokenAmount = amountTokenDesired;
        lastBnbAmount = msg.value;
        lastLpReceiver = to;
        return (amountTokenDesired, msg.value, amountTokenDesired + msg.value);
    }
}
