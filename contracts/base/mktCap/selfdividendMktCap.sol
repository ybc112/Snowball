// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; 
import "../interface/IFactory.sol";
import "../interface/IRouter.sol";
import "../interface/IPancakePair.sol";
 
library SafeMath {
    function add(uint a, uint b) internal pure returns (uint) { return a + b; }
    function sub(uint a, uint b) internal pure returns (uint) { return a - b; }
    function mul(uint a, uint b) internal pure returns (uint) { return a * b; }
    function div(uint a, uint b) internal pure returns (uint) { return a / b; }
}
contract TokenDistributor {
    constructor(address token) {
        IERC20(token).approve(msg.sender, uint(~uint(0)));
    }
}

contract MktCap is Ownable {
    using SafeMath for uint;
    address dev;
    address token0;
    address token1;
    IRouter public router;
    address pair;
    TokenDistributor public _tokenDistributor;
    struct autoConfig {
        bool status;
        uint minPart;
        uint maxPart;
        uint parts;
    }
    autoConfig public autoSell;
    struct Allot {
        uint markting;
        uint burn;
        uint addL;
        uint dividend;
        uint total;
    }
    Allot public allot;

    address[] public marketingAddress;
    uint[] public marketingShare;
    uint internal sharetotal;

    constructor()  Ownable(msg.sender)  { 
        dev = _msgSender();
        token0 = address(this); 
        router = IRouter(0x10ED43C718714eb63d5aA57B78B54704E256024E); 
    }

    function setAll(
        Allot memory allotConfig,
        autoConfig memory sellconfig,
        address[] calldata list,
        uint[] memory share
    ) public onlyOwner {
        setAllot(allotConfig);
        setAutoSellConfig(sellconfig);
        setMarketing(list, share);
    }

    function setAutoSellConfig(autoConfig memory autoSell_) public onlyOwner {
        autoSell = autoSell_;
    }

    function setAllot(Allot memory allot_) public onlyOwner {
        allot = allot_;
    }

    function setPair(address token) public onlyOwner {
        token1 = token;
        _tokenDistributor = new TokenDistributor(token1);
        IERC20(token1).approve(address(router), uint(2 ** 256 - 1));
        pair = IFactory(router.factory()).getPair(token0, token1);
    }

    function setMarketing(
        address[] calldata list,
        uint[] memory share
    ) public onlyOwner {
        require(list.length > 0, "DAO:Can't be Empty");
        require(list.length == share.length, "DAO:number must be the same");
        uint total = 0;
        for (uint i = 0; i < share.length; i++) {
            total = total.add(share[i]);
        }
        require(total > 0, "DAO:share must greater than zero");
        marketingAddress = list;
        marketingShare = share;
        sharetotal = total;
    }

    function getToken0Price() public view returns (uint) {
        //代币价格
        address[] memory routePath = new address[](2);
        routePath[0] = token0;
        routePath[1] = token1;
        return router.getAmountsOut(1 ether, routePath)[1];
    }

    function getToken1Price() public view returns (uint) {
        //代币价格
        address[] memory routePath = new address[](2);
        routePath[0] = token1;
        routePath[1] = token0;
        return router.getAmountsOut(1 ether, routePath)[1];
    }

    function _sell(uint amount0In) internal {
        address[] memory path = new address[](2);
        path[0] = token0;
        path[1] = token1;
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount0In,
            0,
            path,
            address(_tokenDistributor),
            block.timestamp
        );
        IERC20(token1).transferFrom(
            address(_tokenDistributor),
            address(this),
            IERC20(token1).balanceOf(address(_tokenDistributor))
        );
    }

    function _buy(uint amount0Out) internal virtual{
        address[] memory path = new address[](2);
        path[0] = token1;
        path[1] = token0;
        router.swapTokensForExactTokens(
            amount0Out,
            IERC20(token1).balanceOf(address(this)),
            path,
            dev,
            block.timestamp
        );
        IERC20(token0).transferFrom(
            address(_tokenDistributor),
            address(this),
            IERC20(token0).balanceOf(address(_tokenDistributor))
        );
    }

    function _addL(uint amount0, uint amount1) internal {
        if (
            IERC20(token0).balanceOf(address(this)) < amount0 ||
            IERC20(token1).balanceOf(address(this)) < amount1
        ) return;
        router.addLiquidity(
            token0,
            token1,
            amount0,
            amount1,
            0,
            0,
            dev,
            block.timestamp
        );
    }

    function splitToken0Amount(
        uint amount
    ) internal view returns (uint, uint, uint) {
        uint toBurn = amount.mul(allot.burn).div(allot.total);
        uint toAddL = amount.mul(allot.addL).div(allot.total).div(2);
        uint toSell = amount.sub(toAddL).sub(toBurn);
        return (toSell, toBurn, toAddL);
    }

    function splitToken1Amount(
        uint amount
    ) internal view returns (uint, uint, uint) {
        uint total2Fee = allot.total.sub(allot.addL.div(2)).sub(allot.burn);
        uint amount2AddL = amount.mul(allot.addL).div(total2Fee).div(2);
        uint amount2Dividend = amount.mul(allot.dividend).div(total2Fee);
        uint amount2Marketing = amount.sub(amount2AddL).sub(amount2Dividend);
        return (amount2AddL, amount2Dividend, amount2Marketing);
    }
     function deposit(uint amountB) internal virtual { 
    }

    function trigger(uint t) internal  {
        if (t == 2 && autoSell.status) {
            uint balance = IERC20(token0).balanceOf(address(this));
            if (
                balance <
                IERC20(token0).totalSupply().mul(autoSell.minPart).div(
                    autoSell.parts
                )
            ) return;
            uint maxSell = IERC20(token0)
                .totalSupply()
                .mul(autoSell.maxPart)
                .div(autoSell.parts);
            if (balance > maxSell) balance = maxSell;
            (uint toSell, uint toBurn, uint toAddL) = splitToken0Amount(
                balance
            );
            if (toBurn > 0) IERC20(token0).transfer(address(0xdead), toBurn);
            uint bef = IERC20(token1).balanceOf(address(this));
            if (toSell > 0) _sell(toSell);
            uint amount2 = IERC20(token1).balanceOf(address(this)).sub(bef);
            (
                uint amount2AddL,
                uint amount2Dividend,
                uint amount2Marketing
            ) = splitToken1Amount(amount2);
           

            if (amount2Marketing > 0) {
                uint cake;
                for (uint i = 0; i < marketingAddress.length; i++) {
                    cake = amount2Marketing.mul(marketingShare[i]).div(
                        sharetotal
                    );
                    IERC20(token1).transfer(marketingAddress[i], cake);
                }
            }
            if (toAddL > 0) _addL(toAddL, amount2AddL);
             if (amount2Dividend > 0) deposit(amount2Dividend);
        }
    }
}

