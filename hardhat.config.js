require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || "";
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";

function accounts() {
  return PRIVATE_KEY ? [PRIVATE_KEY] : [];
}

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1
      },
      viaIR: true,
      evmVersion: "paris"
    }
  },
  networks: {
    hardhat: {},
    bsc: {
      url: process.env.BSC_RPC_URL || process.env.RPC_URL || "https://bsc-dataseed.binance.org",
      chainId: 56,
      accounts: accounts()
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: accounts()
    }
  },
  etherscan: {
    apiKey: BSCSCAN_API_KEY
  }
};
