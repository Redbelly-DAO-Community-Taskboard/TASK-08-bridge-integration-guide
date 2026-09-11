const hre = require("hardhat");
const TOKEN_OWNER = process.env.TOKEN_OWNER || "";
const RELAYER_SIGNER_1 = process.env.RELAYER_SIGNER_1 || "";
const RELAYER_SIGNER_2 = process.env.RELAYER_SIGNER_2 || "";
const RELAYER_SIGNER_3 = process.env.RELAYER_SIGNER_3 || "";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const owner = hre.ethers.isAddress(TOKEN_OWNER) ? TOKEN_OWNER : deployer.address;
  const signers = [RELAYER_SIGNER_1, RELAYER_SIGNER_2, RELAYER_SIGNER_3];
  for (const s of signers) {
    if (!hre.ethers.isAddress(s)) {
      throw new Error("RELAYER_SIGNER_1/2/3 must all be set to distinct valid addresses.");
    }
  }
  if (new Set(signers.map((s) => s.toLowerCase())).size !== 3) {
    throw new Error("RELAYER_SIGNER_1/2/3 must be 3 distinct addresses.");
  }
  console.log("Deploying with account:", deployer.address);
  console.log("Network:", hre.network.name, "chainId:", hre.network.config.chainId);
  console.log("Token owner will be:", owner);
  console.log("Relayer signers:", signers);
  const Token = await hre.ethers.getContractFactory("WETHBridged");
  const token = await Token.deploy(owner, signers);
  await token.waitForDeployment();
  const address = await token.getAddress();
  console.log("\nWETHBridged deployed to:", address);
  console.log("MAX_SUPPLY:", hre.ethers.formatEther(await token.MAX_SUPPLY()));
  console.log("\nSave this as WETH_BRIDGED_ADDRESS in your .env");
  console.log(`  npx hardhat verify --network redbellyTestnet ${address} "${owner}" "[${signers.join(",")}]"`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
