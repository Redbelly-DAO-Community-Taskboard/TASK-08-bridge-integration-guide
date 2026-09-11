const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WETHBridged", function () {
  let token, owner, signer1, signer2, signer3, outsider, recipient;
  const SEPOLIA_CHAIN_ID = 11155111;

  beforeEach(async function () {
    [owner, signer1, signer2, signer3, outsider, recipient] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("WETHBridged");
    token = await Token.deploy(owner.address, [signer1.address, signer2.address, signer3.address]);
    await token.waitForDeployment();
  });

  describe("constructor", function () {
    it("sets up exactly the 3 provided relayer signers", async function () {
      expect(await token.isRelayerSigner(signer1.address)).to.equal(true);
      expect(await token.isRelayerSigner(signer2.address)).to.equal(true);
      expect(await token.isRelayerSigner(signer3.address)).to.equal(true);
      expect(await token.isRelayerSigner(outsider.address)).to.equal(false);
    });

    it("reverts on a zero-address signer", async function () {
      const Token = await ethers.getContractFactory("WETHBridged");
      await expect(
        Token.deploy(owner.address, [signer1.address, ethers.ZeroAddress, signer3.address])
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });

    it("reverts on duplicate signers", async function () {
      const Token = await ethers.getContractFactory("WETHBridged");
      await expect(
        Token.deploy(owner.address, [signer1.address, signer1.address, signer3.address])
      ).to.be.revertedWithCustomError(token, "DuplicateSigner");
    });
  });

  describe("2-of-3 mint approval", function () {
    it("does not mint after only 1 of 3 approvals", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      expect(await token.balanceOf(recipient.address)).to.equal(0);
    });

    it("mints automatically once the 2nd approval is submitted", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));

      const mintKey = await token.computeMintKey(SEPOLIA_CHAIN_ID, 0);
      await expect(
        token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"))
      )
        .to.emit(token, "MintExecuted")
        .withArgs(mintKey, recipient.address, ethers.parseEther("1"));

      expect(await token.balanceOf(recipient.address)).to.equal(ethers.parseEther("1"));
    });

    it("a 3rd approval after execution reverts with AlreadyExecuted", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));

      await expect(
        token.connect(signer3).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "AlreadyExecuted");
    });

    it("reverts if a non-signer tries to approve", async function () {
      await expect(
        token.connect(outsider).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "NotRelayerSigner");
    });

    it("reverts if the same signer tries to approve the same mintKey twice", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await expect(
        token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "AlreadyApproved");
    });

    it("reverts if a second signer submits mismatched recipient/amount for the same lock", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await expect(
        token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, outsider.address, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "MismatchedRequest");
    });

    it("reverts on a zero-address recipient", async function () {
      await expect(
        token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, ethers.ZeroAddress, ethers.parseEther("1"))
      ).to.be.revertedWithCustomError(token, "ZeroAddress");
    });

    it("keeps different nonces from the same source chain fully independent", async function () {
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));

      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 1, recipient.address, ethers.parseEther("2"));
      await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 1, recipient.address, ethers.parseEther("2"));

      expect(await token.balanceOf(recipient.address)).to.equal(ethers.parseEther("3"));
    });

    it("distinguishes mintKeys by source chain ID, not just nonce", async function () {
      const OTHER_CHAIN_ID = 80002;
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await token.connect(signer1).confirmMint(OTHER_CHAIN_ID, 0, recipient.address, ethers.parseEther("5"));

      const keyA = await token.computeMintKey(SEPOLIA_CHAIN_ID, 0);
      const keyB = await token.computeMintKey(OTHER_CHAIN_ID, 0);
      expect(keyA).to.not.equal(keyB);
    });
  });

  describe("supply cap", function () {
    it("reverts if a mint would exceed MAX_SUPPLY", async function () {
      const cap = await token.MAX_SUPPLY();
      const overCap = cap + 1n;

      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, overCap);
      await expect(
        token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, overCap)
      ).to.be.revertedWithCustomError(token, "SupplyCapExceeded");
    });

    it("allows minting exactly up to MAX_SUPPLY", async function () {
      const cap = await token.MAX_SUPPLY();
      await token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, cap);
      await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, cap);
      expect(await token.totalSupply()).to.equal(cap);
    });
  });

  describe("pausability", function () {
    it("blocks confirmMint while paused", async function () {
      await token.connect(owner).pause();
      await expect(
        token.connect(signer1).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"))
      ).to.be.reverted;
    });

    it("reverts if a non-owner tries to pause", async function () {
      await expect(token.connect(signer1).pause()).to.be.revertedWithCustomError(
        token,
        "OwnableUnauthorizedAccount"
      );
    });
  });

  describe("signer rotation", function () {
    it("allows the owner to rotate a compromised signer", async function () {
      await expect(token.connect(owner).updateRelayerSigner(0, outsider.address))
        .to.emit(token, "RelayerSignerUpdated")
        .withArgs(0, signer1.address, outsider.address);

      expect(await token.isRelayerSigner(signer1.address)).to.equal(false);
      expect(await token.isRelayerSigner(outsider.address)).to.equal(true);
    });

    it("reverts rotating to an address that is already a signer", async function () {
      await expect(
        token.connect(owner).updateRelayerSigner(0, signer2.address)
      ).to.be.revertedWithCustomError(token, "DuplicateSigner");
    });

    it("reverts if a non-owner tries to rotate a signer", async function () {
      await expect(
        token.connect(signer1).updateRelayerSigner(0, outsider.address)
      ).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    });

    it("a newly rotated-in signer can approve fresh mint requests", async function () {
      await token.connect(owner).updateRelayerSigner(0, outsider.address);
      await token.connect(outsider).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      await token.connect(signer2).confirmMint(SEPOLIA_CHAIN_ID, 0, recipient.address, ethers.parseEther("1"));
      expect(await token.balanceOf(recipient.address)).to.equal(ethers.parseEther("1"));
    });
  });

  describe("token metadata", function () {
    it("reports correct name and symbol", async function () {
      expect(await token.name()).to.equal("Bridged Wrapped Ether");
      expect(await token.symbol()).to.equal("WETH.rb");
    });
  });
});
