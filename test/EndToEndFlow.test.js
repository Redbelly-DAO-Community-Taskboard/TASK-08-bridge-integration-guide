const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("End-to-end bridge flow (simulated)", function () {
  let vault, token, owner, user, signer1, signer2, signer3;
  const SEPOLIA_CHAIN_ID = 11155111;

  beforeEach(async function () {
    [owner, user, signer1, signer2, signer3] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("SepoliaLockVault");
    vault = await Vault.deploy(owner.address);
    await vault.waitForDeployment();
    const Token = await ethers.getContractFactory("WETHBridged");
    token = await Token.deploy(owner.address, [signer1.address, signer2.address, signer3.address]);
    await token.waitForDeployment();
  });

  function getLockedArgs(receipt) {
    return receipt.logs
      .map((log) => { try { return vault.interface.parseLog(log); } catch { return null; } })
      .find((p) => p && p.name === "Locked").args;
  }

  it("a user's lock is exactly reproduced by relayer-signer confirmations, minting 1:1", async function () {
    const lockAmount = ethers.parseEther("2.5");
    const tx = await vault.connect(user).lock(user.address, { value: lockAmount });
    const receipt = await tx.wait();
    const { nonce, redbellyRecipient, amount } = getLockedArgs(receipt);

    await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount);
    expect(await token.balanceOf(user.address)).to.equal(0);

    await expect(token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount))
      .to.emit(token, "MintExecuted");

    expect(await token.balanceOf(user.address)).to.equal(lockAmount);
    expect(await vault.totalLocked()).to.equal(lockAmount);
  });

  it("a third, redundant relayer confirmation after mint is a harmless no-op revert", async function () {
    const lockAmount = ethers.parseEther("1");
    const tx = await vault.connect(user).lock(user.address, { value: lockAmount });
    const receipt = await tx.wait();
    const { nonce, redbellyRecipient, amount } = getLockedArgs(receipt);

    await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount);
    await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount);

    await expect(
      token.connect(signer3).confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount)
    ).to.be.revertedWithCustomError(token, "AlreadyExecuted");
  });

  it("multiple users locking independently each get their own correctly-sized mint", async function () {
    const [, userA, userB] = await ethers.getSigners();
    const amountA = ethers.parseEther("1");
    const amountB = ethers.parseEther("3");

    const txA = await vault.connect(userA).lock(userA.address, { value: amountA });
    const nonceA = getLockedArgs(await txA.wait()).nonce;
    const txB = await vault.connect(userB).lock(userB.address, { value: amountB });
    const nonceB = getLockedArgs(await txB.wait()).nonce;

    expect(nonceA).to.not.equal(nonceB);

    await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, nonceA, userA.address, amountA);
    await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, nonceA, userA.address, amountA);
    await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, nonceB, userB.address, amountB);
    await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, nonceB, userB.address, amountB);

    expect(await token.balanceOf(userA.address)).to.equal(amountA);
    expect(await token.balanceOf(userB.address)).to.equal(amountB);
  });
});
