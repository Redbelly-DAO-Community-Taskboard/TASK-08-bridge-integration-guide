const hre = require("hardhat");
const VAULT_OWNER = process.env.VAULT_OWNER || "";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const owner = hre.ethers.isAddress(VAULT_OWNER) ? VAULT_OWNER : deployer.address;
  console.log("Deploying with account:", deployer.address);
  console.log("Network:", hre.network.name, "chainId:", hre.network.config.chainId);
  console.log("Vault owner will be:", owner);
  const Vault = await hre.ethers.getContractFactory("SepoliaLockVault");
  const vault = await Vault.deploy(owner);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log("\nSepoliaLockVault deployed to:", address);
  console.log("MIN_LOCK_AMOUNT:", hre.ethers.formatEther(await vault.MIN_LOCK_AMOUNT()), "ETH");
  console.log("MAX_LOCK_AMOUNT:", hre.ethers.formatEther(await vault.MAX_LOCK_AMOUNT()), "ETH");
  console.log("\nSave this as LOCK_VAULT_ADDRESS in your .env");
  console.log(`  npx hardhat verify --network sepolia ${address} "${owner}"`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
