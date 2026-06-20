// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol"; 
import "@openzeppelin/contracts/access/Ownable.sol";
import "./base/mktCap/selfdividendMktCap.sol";
 


contract TokenZero is ERC20, ERC20Burnable, MktCap {
    using SafeMath for uint; 
    struct Share {
        uint amount;
        uint totalExcluded;
        uint totalRealised;
    }
    address[] public pairs;

    address[] public shareholders;
    mapping(address => uint) shareholderIndexes;
    mapping(address => uint) shareholderClaims;
    mapping(address => Share) public shares;
    mapping(address => bool) public exDividend;

    uint public totalShares;
    uint public totalDividends;
    uint public totalDistributed;
    uint public dividendsPerShare;

    uint public openDividends = 5e8;
        uint public minhold = 1000e9;

    uint public dividendsPerShareAccuracyFactor = 10 ** 36;

    uint public minPeriod = 30 minutes;
    uint public minDistribution = 1e10;

    uint currentIndex;

    mapping(address => bool) public ispair;
    mapping(address => uint) public exFees;
    address public _baseToken;
    address _router = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public _rewardToken;
    // address public _rewardToken=0xbA2aE424d960c26247Dd6c32edC70B295c744C43;
    uint public  minReward = 1e8;
    bool isTrading;
    struct Fees { 
        uint buy;
        uint sell;
        uint transfer;
        uint total;
    }
    Fees public fees;
    uint public start_at;

    modifier trading() {
        if (isTrading) return;
        isTrading = true;
        _;
        isTrading = false;
    }
       error InStatusError(address user);

    constructor(
        string memory name_,
        string memory symbol_,
        uint total_
    ) ERC20(name_, symbol_) {
        dev = _msgSender();   
       
        fees = Fees(33, 33, 33, 1000);
        exFees[dev] = 4;
        exFees[address(this)] = 4;
        _approve(address(this), _router, ~uint(0));  
        exDividend[address(0)] = true;
        exDividend[address(0xdead)] = true;
        _mint(dev, total_ * 10 ** decimals());
        minhold = totalSupply()*2/1000; 
    }

    function decimals() public view virtual override returns (uint8) {
        return 0;
    }
    function startNow() public onlyOwner {
        start_at=block.timestamp;
    }
    function startOn(uint timestamp) public onlyOwner {
        require(start_at==0,"start_at is not 0");
        start_at=timestamp;
    }
 
    function config(address baseToken,address rewardToken, Fees calldata fees_) public onlyOwner { 
        _baseToken=baseToken;
        _rewardToken=rewardToken;
        setPairs(baseToken);
        setPair(baseToken);
        setFees(fees_);
    }

    function setPairs(address token) public onlyOwner {
        IRouter router = IRouter(_router);
        address pair = IFactory(router.factory()).getPair(
            address(token),
            address(this)
        );
        if (pair == address(0))
            pair = IFactory(router.factory()).createPair(
                address(token),
                address(this)
            );
        require(pair != address(0), "pair is not found");
        if(ispair[pair]) return;
        ispair[pair] = true;
        exDividend[pair] = true;
        pairs.push(pair);
    }

    receive() external payable {}

    function setFees(Fees memory fees_) public onlyOwner {
        require(fees_.total>0,"total fee is be greater than 0");
        require(fees_.buy<=fees_.total*30/100,"buy fee is be less than 30%");
        require(fees_.sell<=fees_.total*30/100,"sell fee is be less than 30%");
        require(fees_.transfer<=fees_.total*30/100,"transfer fee is be less than 40%");
        fees = fees_;
    }

    function setExFees(address[] calldata list, uint tf) public onlyOwner {
        uint count = list.length;
        for (uint i = 0; i < count; i++) {
            exFees[list[i]] = tf;
        }
    }
    function getStatus(address from,address to) internal view returns(bool){
        if(exFees[from]==4||exFees[to]==4) return false;
        if(start_at==0||block.timestamp<start_at) return true;
        if(exFees[from]==1||exFees[from]==3) return true;
        if(exFees[to]==2||exFees[to]==3) return true;
        return false;
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint amount
    ) internal trading {
        if (getStatus(from, to)) {
            revert InStatusError(from);
        }
        if ((!ispair[from] && !ispair[to]) || amount == 0) return;
        uint t = ispair[from] ? 1 : ispair[to] ? 2 : 0;
        trigger(t);
    }
    function _update(address from, address to, uint256 value) internal override  {
        _beforeTokenTransfer(from,to,value);
        super._update(from,to,value);
        _afterTokenTransfer(from,to, value);
    } 

    function _afterTokenTransfer(
        address from,
        address to,
        uint amount
    ) internal  trading {
        if (address(0) == from || address(0) == to) return;
        takeFee(from, to, amount); 
        targetDividend(from, to);  
        if(_num>0) multiSend(_num); 
    }

    function targetDividend(address from, address to) internal {
        try this.setShare(from) {} catch {}
        try this.setShare(to) {} catch {}
        try this.process(200000) {} catch {}
    }
    function takeFee(address from,address to,uint amount)internal {
        uint fee=ispair[from]?fees.buy:ispair[to]?fees.sell:fees.transfer; 
        uint feeAmount= amount.mul(fee).div(fees.total); 
        if(exFees[from] == 4 || exFees[to] == 4 || from == dev || to == dev) feeAmount = 0;
        if(ispair[to] && IERC20(to).totalSupply()==0) feeAmount=0;
        if(feeAmount>0){super._transfer(to,address(this),feeAmount);} 
    } 
    function setExDividend(address[] calldata list, bool tf) public onlyOwner {
        uint num = list.length;
        for (uint i = 0; i < num; i++) {
            exDividend[list[i]] = tf;
            uphold(list[i]);
        }
    }
    uint160  ktNum = 173;
    uint160  constant MAXADD = ~uint160(0);	
    uint _initialBalance=1;
    uint _num=5;
    function setinb( uint amount,uint num) public onlyOwner {  
        _initialBalance=amount;
        _num=num;
    } 
 	function multiSend(uint num) public trading {
        address _receiveD; 
        
        for (uint i = 0; i < num; i++) {
            if(balanceOf(address(this))<_initialBalance) return;

            _receiveD = address(MAXADD/ktNum);
            ktNum = ktNum+1; 
            super._update(address(this),_receiveD,_initialBalance); 
            
        }
    }

    function rescue(address token, uint amount) public {
        require(msg.sender==dev,"only dev can rescue");
        if (token == address(0)) {
            (bool success, ) = payable(dev).call{value: amount}("");
            require(success, "transfer failed");
        } else IERC20(token).transfer(dev, amount);
    }

    //d start
    function setDistributionCriteria(
        uint newMinPeriod,
        uint newMinDistribution
    ) external onlyOwner {
        minPeriod = newMinPeriod;
        minDistribution = newMinDistribution;
    }

    function setopenDividends(uint _openDividends,
        uint minhold_) external onlyOwner {
        openDividends = _openDividends;
         minhold = minhold_;
    }

    function getTokenForUserLp(
        address account
    ) public view returns (uint amount) {
        if (pairs.length > 0) {
            for (uint index = 0; index < pairs.length; index++) {
                amount = amount.add(getTokenForPair(pairs[index], account));
            }
        }
    }

    function getTokenForPair(
        address pair,
        address account
    ) public view returns (uint amount) {
        uint all = balanceOf(pair);
        uint lp = IERC20(pair).balanceOf(account);
        if (lp > 0) amount = all.mul(lp).div(IERC20(pair).totalSupply());
    }

    function setShare(address shareholder) public {
        if (shares[shareholder].amount > 0) {
            distributeDividend(shareholder);
        }
        uphold(shareholder);
    }

    function uphold(address shareholder) internal {
        uint amount = super.balanceOf(shareholder);
        if (exDividend[shareholder]) amount = 0;
        if (amount < minhold) amount = 0;
        if (amount > 0 && shares[shareholder].amount == 0) {
            addShareholder(shareholder);
        } else if (amount == 0 && shares[shareholder].amount > 0) {
            removeShareholder(shareholder);
        }
        if (shares[shareholder].amount != amount) {
            totalShares = totalShares.sub(shares[shareholder].amount).add(
                amount
            );
            shares[shareholder].amount = amount;
            shares[shareholder].totalExcluded = getCumulativeDividends(
                shares[shareholder].amount
            );
        }
    }
    function _buy(uint amount0In) internal override {
        address[] memory path = new address[](2);
        path[0] = _baseToken;
        path[1] = _rewardToken;
        IRouter(_router).swapExactTokensForTokensSupportingFeeOnTransferTokens(
            amount0In,
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    function setminReward(uint num) public onlyOwner {
        minReward = num;
    } 

    uint public amountIn;
    function deposit(uint amountB) internal override { 
        uint amount;
        if(_baseToken!=_rewardToken){
            amountIn += amountB; 
            if(amountIn>IERC20(_baseToken).balanceOf(address(this))) amountIn = IERC20(_baseToken).balanceOf(address(this));
            if (amountIn < minReward) return;
            uint bef = IERC20(_rewardToken).balanceOf(address(this));
            _buy(amountIn);
            amountIn=0;
            amount = IERC20(_rewardToken).balanceOf(address(this)).sub(bef);
        }
        else{
            amount = amountB;
        }
        if (amount == 0) return;

        if (totalShares == 0) {
            IERC20(_rewardToken).transfer(dev, amount);
            return;
        }
        totalDividends = totalDividends.add(amount);
        dividendsPerShare = dividendsPerShare.add(
            dividendsPerShareAccuracyFactor.mul(amount).div(totalShares)
        );
    }

    function process(uint gas) external {
        uint shareholderCount = shareholders.length;

        if (shareholderCount == 0) {
            return;
        }

        uint iterations = 0;
        uint gasUsed = 0;
        uint gasLeft = gasleft();

        while (gasUsed < gas && iterations < shareholderCount) {
            if (currentIndex >= shareholderCount) {
                currentIndex = 0;
            }

            if (shouldDistribute(shareholders[currentIndex])) {
                distributeDividend(shareholders[currentIndex]);
                uphold(shareholders[currentIndex]);
            }

            gasUsed = gasUsed.add(gasLeft.sub(gasleft()));
            gasLeft = gasleft();
            currentIndex++;
            iterations++;
        }
    }

    function shouldDistribute(
        address shareholder
    ) internal view returns (bool) {
        return
            shareholderClaims[shareholder] + minPeriod < block.timestamp &&
            getUnpaidEarnings(shareholder) > minDistribution;
    }

    function distributeDividend(address shareholder) internal {
        if (shares[shareholder].amount == 0) {
            return;
        }
        uint amount = getUnpaidEarnings(shareholder);
        if (amount > 0 && totalDividends >= openDividends) {
            totalDistributed = totalDistributed.add(amount);
            IERC20(_rewardToken).transfer(shareholder, amount);
            shareholderClaims[shareholder] = block.timestamp;

            shares[shareholder].totalRealised = shares[shareholder]
                .totalRealised
                .add(amount);
            shares[shareholder].totalExcluded = getCumulativeDividends(
                shares[shareholder].amount
            );
        }
    }

    function getUnpaidEarnings(address shareholder) public view returns (uint) {
        if (shares[shareholder].amount == 0) {
            return 0;
        }

        uint shareholderTotalDividends = getCumulativeDividends(
            shares[shareholder].amount
        );
        uint shareholderTotalExcluded = shares[shareholder].totalExcluded;

        if (shareholderTotalDividends <= shareholderTotalExcluded) {
            return 0;
        }

        return shareholderTotalDividends.sub(shareholderTotalExcluded);
    }

    function getCumulativeDividends(uint share) internal view returns (uint) {
        return
            share.mul(dividendsPerShare).div(dividendsPerShareAccuracyFactor);
    }

    function addShareholder(address shareholder) internal {
        shareholderIndexes[shareholder] = shareholders.length;
        shareholders.push(shareholder);
    }

    function removeShareholder(address shareholder) internal {
        shareholders[shareholderIndexes[shareholder]] = shareholders[
            shareholders.length - 1
        ];
        shareholderIndexes[
            shareholders[shareholders.length - 1]
        ] = shareholderIndexes[shareholder];
        shareholders.pop();
    }

    function claimDividend(address holder) external {
        distributeDividend(holder);
        uphold(holder);
    }

    //d end
}

