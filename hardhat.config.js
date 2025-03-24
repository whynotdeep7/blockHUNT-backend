require("@nomicfoundation/hardhat-ethers");
require("dotenv").config();

console.log("ETH_RPC_URL:", process.env.RPC_URL ? "Loaded" : "Not loaded");
console.log("PRIVATE_KEY:", process.env.PRIVATE_KEY ? "Loaded" : "Not loaded");

module.exports = {
  solidity: "0.8.0",
  networks: {
    sepolia: {
      url: process.env.RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      gasPrice: 7000000000, // 7 gwei (very low)
      gas: 800000, // 800k gas (minimum)
      timeout: 300000 // 5 minutes
    },
  },
};