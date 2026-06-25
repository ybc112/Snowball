// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./base/interface/IRouter.sol";

contract ShaZeroProtocol is ERC20, Ownable {
    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint16 public constant MAX_BURN_TAX_BP = 300;
    uint256 public constant DEFAULT_AIRDROP_ROUNDS = 1_000_000;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant PANCAKE_V2_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;

    IRouter public router;
    bool public tradingOpen;
    bool public limitModeEnabled;
    uint16 public burnTaxBp = 300;
    uint8 public airdropCount = 3;
    uint256 public airdropAmount = 1;
    uint256 public airdropReserve;
    uint160 private airdropNonce = 173;

    mapping(address => bool) public isPair;
    mapping(address => bool) public ordinaryWhitelist;
    mapping(address => bool) public taxExempt;
    mapping(address => uint256) public limitQuota;

    event TradingOpened(uint256 timestamp);
    event PairUpdated(address indexed pair, bool enabled);
    event OrdinaryWhitelistUpdated(address indexed account, bool enabled);
    event TaxExemptUpdated(address indexed account, bool enabled);
    event LimitQuotaUpdated(address indexed account, uint256 quota);
    event LimitModeUpdated(bool enabled);
    event BurnTaxUpdated(uint16 burnTaxBp);
    event AirdropConfigUpdated(uint8 count, uint256 amount);
    event AirdropReserveFunded(uint256 amount);

    error TradingNotOpen();
    error ZeroAddress();
    error TaxTooHigh();
    error InvalidAmount();
    error LimitQuotaExceeded();
    error PairChangeAfterOpen();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address initialOwner_
    ) ERC20(name_, symbol_) Ownable(initialOwner_) {
        if (initialOwner_ == address(0)) revert ZeroAddress();

        router = IRouter(PANCAKE_V2_ROUTER);

        _setOrdinaryWhitelist(initialOwner_, true);
        _setOrdinaryWhitelist(address(this), true);
        _setTaxExempt(DEAD, true);

        uint256 initialAirdropReserve = uint256(airdropCount) * airdropAmount * DEFAULT_AIRDROP_ROUNDS;
        if (totalSupply_ > initialAirdropReserve) {
            airdropReserve = initialAirdropReserve;
            _update(address(0), address(this), initialAirdropReserve);
            _update(address(0), initialOwner_, totalSupply_ - initialAirdropReserve);
            emit AirdropReserveFunded(initialAirdropReserve);
        } else {
            _update(address(0), initialOwner_, totalSupply_);
        }
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function totalTaxBp() public view returns (uint256) {
        return burnTaxBp;
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

    function setPair(address pair, bool enabled) external onlyOwner {
        if (tradingOpen) revert PairChangeAfterOpen();
        if (pair == address(0)) revert ZeroAddress();
        isPair[pair] = enabled;
        emit PairUpdated(pair, enabled);
    }

    function setBurnTax(uint16 burnTaxBp_) external onlyOwner {
        if (burnTaxBp_ > MAX_BURN_TAX_BP) revert TaxTooHigh();
        burnTaxBp = burnTaxBp_;
        emit BurnTaxUpdated(burnTaxBp_);
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
        transfer(address(this), amount);
        airdropReserve += amount;
        emit AirdropReserveFunded(amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || value == 0) {
            super._update(from, to, value);
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

        if (!tradingOpen || !isDexTrade || taxExempt[from] || taxExempt[to] || burnTaxBp == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 burnAmount = (value * burnTaxBp) / FEE_DENOMINATOR;
        uint256 sendAmount = value - burnAmount;

        if (burnAmount > 0) {
            super._update(from, DEAD, burnAmount);
        }
        super._update(from, to, sendAmount);
        _runAirdrop();
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
            super._update(address(this), recipient, airdropAmount);
        }
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
}
