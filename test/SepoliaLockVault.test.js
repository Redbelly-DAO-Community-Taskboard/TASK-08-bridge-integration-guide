const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");

describe("SepoliaLockVault", function () {
  let vault, owner, user, recipient;

  beforeEach(async function () {
    [owner, user, recipient] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("SepoliaLockVault");
    vault = await Vault.deploy(owner.address);
    await vault.waitForDeployment();
  });

  it("locks ETH and emits a Locked event with correct fields", async function () {
    const amount = ethers.parseEther("1");
    await expect(vault.connect(user).lock(recipient.address, { value: amount }))
      .to.emit(vault, "Locked")
      .withArgs(0, user.address, recipient.address, amount, anyValue);

    expect(await vault.totalLocked()).to.equal(amount);
    expect(await vault.nonce()).to.equal(1);
  });

  it("increments nonce across multiple locks", async function () {
    const amount = ethers.parseEther("1");
    await vault.connect(user).lock(recipient.address, { value: amount });
    await vault.connect(user).lock(recipient.address, { value: amount });
    expect(await vault.nonce()).to.equal(2);
  });

  it("reverts if amount is below MIN_LOCK_AMOUNT", async function () {
    await expect(
      vault.connect(user).lock(recipient.address, { value: 1 })
    ).to.be.revertedWithCustomError(vault, "AmountTooLow");
  });

  it("reverts if amount is above MAX_LOCK_AMOUNT", async function () {
    await expect(
      vault.connect(user).lock(recipient.address, { value: ethers.parseEther("11") })
    ).to.be.revertedWithCustomError(vault, "AmountTooHigh");
  });

  it("reverts if recipient is the zero address", async function () {
    await expect(
      vault.connect(user).lock(ethers.ZeroAddress, { value: ethers.parseEther("1") })
    ).to.be.revertedWithCustomError(vault, "ZeroRecipient");
  });

  it("rejects direct ETH transfers, requiring lock() to be called", async function () {
    await expect(
      user.sendTransaction({ to: await vault.getAddress(), value: ethers.parseEther("1") })
    ).to.be.reverted;
  });

  it("blocks locking while paused", async function () {
    await vault.connect(owner).pause();
    await expect(
      vault.connect(user).lock(recipient.address, { value: ethers.parseEther("1") })
    ).to.be.reverted;
  });

  it("allows locking again after unpause", async function () {
    await vault.connect(owner).pause();
    await vault.connect(owner).unpause();
    await expect(
      vault.connect(user).lock(recipient.address, { value: ethers.parseEther("1") })
    ).to.not.be.reverted;
  });

  it("reverts if non-owner tries to pause", async function () {
    await expect(vault.connect(user).pause()).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount"
    );
  });

  it("allows owner to perform an emergency withdrawal", async function () {
    const amount = ethers.parseEther("2");
    await vault.connect(user).lock(recipient.address, { value: amount });

    await expect(vault.connect(owner).emergencyWithdraw(owner.address, amount))
      .to.emit(vault, "EmergencyWithdraw")
      .withArgs(owner.address, amount);

    expect(await vault.totalLocked()).to.equal(0);
  });

  it("reverts emergency withdrawal for a non-owner", async function () {
    await vault.connect(user).lock(recipient.address, { value: ethers.parseEther("1") });
    await expect(
      vault.connect(user).emergencyWithdraw(user.address, ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
  });

  it("reverts emergency withdrawal above the contract balance", async function () {
    await expect(
      vault.connect(owner).emergencyWithdraw(owner.address, ethers.parseEther("100"))
    ).to.be.revertedWith("insufficient balance");
  });

  it("supports 2-step ownership transfer", async function () {
    await vault.connect(owner).transferOwnership(user.address);
    expect(await vault.owner()).to.equal(owner.address);
    await vault.connect(user).acceptOwnership();
    expect(await vault.owner()).to.equal(user.address);
  });
});
