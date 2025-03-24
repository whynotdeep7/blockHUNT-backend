const { ethers } = require("hardhat");

async function main() {
  console.log("Starting deployment...");
  console.log("Using RPC URL:", process.env.ETH_RPC_URL);
  console.log("Using account:", process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.slice(0, 6) + "..." : "Not loaded");

  try {
    const HackathonFunding = await ethers.getContractFactory("HackathonFunding");
    console.log("Contract factory created.");

    // Get current balance
    const signer = await ethers.provider.getSigner();
    const balance = await ethers.provider.getBalance(await signer.getAddress());
    console.log("Current balance:", ethers.formatEther(balance), "ETH");

    // Calculate maximum affordable gas
    const maxGasPrice = ethers.parseUnits("7", "gwei"); // Very low gas price
    const gasLimit = 800000; // Minimum necessary for contract deployment
    
    console.log("Using gas price:", ethers.formatUnits(maxGasPrice, "gwei"), "gwei");
    console.log("Using gas limit:", gasLimit);

    console.log("Deploying contract...");
    const hackathon = await HackathonFunding.deploy({
      gasLimit: gasLimit,
      gasPrice: maxGasPrice
    });
    
    console.log("Deployment transaction sent, waiting for confirmation...");
    await hackathon.waitForDeployment();
    
    const deployedAddress = await hackathon.getAddress();
    console.log("HackathonFunding deployed to:", deployedAddress);
  } catch (error) {
    console.error("Deployment error:", error.message);
    if (error.code) console.error("Error code:", error.code);
    if (error.reason) console.error("Error reason:", error.reason);
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error in main function:", error);
    process.exitCode = 1;
  });