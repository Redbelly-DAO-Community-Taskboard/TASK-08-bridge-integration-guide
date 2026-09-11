// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title WETHBridged
/// @notice Wrapped-ETH ERC-20 on Redbelly Testnet, minted 1:1 against ETH
///         locked in SepoliaLockVault on Ethereum Sepolia. Minting requires
///         2-of-3 relayer-signer approval (see confirmMint) rather than a
///         single trusted relayer, so no single compromised key can mint
///         unbacked tokens. Total supply is hard-capped at 100,000,000,000
///         (100B) tokens.
contract WETHBridged is ERC20, ReentrancyGuard, Pausable, Ownable2Step {
    /// @notice Hard supply cap: 100,000,000,000 tokens (18 decimals).
    uint256 public constant MAX_SUPPLY = 100_000_000_000 * 10 ** 18;

    /// @notice Number of relayer-signer approvals required before a mint
    ///         executes. Fixed at 2-of-3 per the bridge's security design.
    uint256 public constant REQUIRED_APPROVALS = 2;

    /// @notice The 3 authorized relayer-signer addresses.
    address[3] public relayerSigners;

    /// @notice Tracks which addresses are currently authorized signers,
    ///         for O(1) membership checks.
    mapping(address => bool) public isRelayerSigner;

    /// @dev A pending mint request keyed by the Sepolia lock's unique
    ///      (sourceChainId, nonce) pair, so it can never be confused with a
    ///      request from a different source chain or a different lock.
    struct MintRequest {
        address recipient;
        uint256 amount;
        uint256 approvalCount;
        bool executed;
    }

    /// @notice mintKey => MintRequest. mintKey = keccak256(sourceChainId, nonce).
    mapping(bytes32 => MintRequest) public mintRequests;

    /// @notice mintKey => signer => has this signer already approved.
    mapping(bytes32 => mapping(address => bool)) public hasApproved;

    event MintApproved(bytes32 indexed mintKey, address indexed signer, uint256 approvalCount);
    event MintExecuted(bytes32 indexed mintKey, address indexed recipient, uint256 amount);
    event RelayerSignerUpdated(uint256 indexed index, address indexed oldSigner, address indexed newSigner);

    error NotRelayerSigner(address caller);
    error AlreadyApproved(bytes32 mintKey, address signer);
    error AlreadyExecuted(bytes32 mintKey);
    error MismatchedRequest(bytes32 mintKey);
    error SupplyCapExceeded(uint256 requested, uint256 available);
    error ZeroAddress();
    error DuplicateSigner(address signer);

    modifier onlyRelayerSigner() {
        if (!isRelayerSigner[msg.sender]) revert NotRelayerSigner(msg.sender);
        _;
    }

    /// @param initialOwner Contract owner, distinct from relayer signers.
    ///        Owner can rotate signers and pause but cannot mint directly.
    /// @param signers Exactly 3 initial relayer-signer addresses.
    constructor(address initialOwner, address[3] memory signers) ERC20("Bridged Wrapped Ether", "WETH.rb") Ownable(initialOwner) {
        for (uint256 i = 0; i < 3; i++) {
            if (signers[i] == address(0)) revert ZeroAddress();
            for (uint256 j = i + 1; j < 3; j++) {
                if (signers[i] == signers[j]) revert DuplicateSigner(signers[i]);
            }
            relayerSigners[i] = signers[i];
            isRelayerSigner[signers[i]] = true;
        }
    }

    /// @notice Computes the unique key for a mint request tied to a specific
    ///         Sepolia lock event. Chain ID is included so this contract
    ///         (if ever redeployed to point at a different source chain)
    ///         can never conflate nonces from two different source chains.
    function computeMintKey(uint256 sourceChainId, uint256 sourceNonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(sourceChainId, sourceNonce));
    }

    /// @notice Called by a relayer signer to approve minting for a specific
    ///         observed Sepolia lock event. The first call for a given
    ///         mintKey establishes the recipient/amount; subsequent calls
    ///         must match exactly, preventing a compromised or buggy signer
    ///         from silently redirecting funds by submitting different
    ///         parameters for the same lock.
    function confirmMint(
        uint256 sourceChainId,
        uint256 sourceNonce,
        address recipient,
        uint256 amount
    ) external onlyRelayerSigner whenNotPaused nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();

        bytes32 mintKey = computeMintKey(sourceChainId, sourceNonce);
        MintRequest storage req = mintRequests[mintKey];

        if (req.executed) revert AlreadyExecuted(mintKey);
        if (hasApproved[mintKey][msg.sender]) revert AlreadyApproved(mintKey, msg.sender);

        if (req.approvalCount == 0) {
            req.recipient = recipient;
            req.amount = amount;
        } else {
            if (req.recipient != recipient || req.amount != amount) {
                revert MismatchedRequest(mintKey);
            }
        }

        hasApproved[mintKey][msg.sender] = true;
        req.approvalCount += 1;

        emit MintApproved(mintKey, msg.sender, req.approvalCount);

        if (req.approvalCount >= REQUIRED_APPROVALS) {
            _executeMint(mintKey, req);
        }
    }

    function _executeMint(bytes32 mintKey, MintRequest storage req) private {
        if (totalSupply() + req.amount > MAX_SUPPLY) {
            revert SupplyCapExceeded(req.amount, MAX_SUPPLY - totalSupply());
        }
        req.executed = true;
        _mint(req.recipient, req.amount);
        emit MintExecuted(mintKey, req.recipient, req.amount);
    }

    /// @notice Owner-only signer rotation, e.g. if a relayer key is
    ///         suspected compromised. Rotating a signer does not affect
    ///         already-recorded approvals on in-flight mint requests.
    function updateRelayerSigner(uint256 index, address newSigner) external onlyOwner {
        require(index < 3, "invalid index");
        if (newSigner == address(0)) revert ZeroAddress();
        for (uint256 i = 0; i < 3; i++) {
            if (i != index && relayerSigners[i] == newSigner) revert DuplicateSigner(newSigner);
        }

        address old = relayerSigners[index];
        isRelayerSigner[old] = false;
        relayerSigners[index] = newSigner;
        isRelayerSigner[newSigner] = true;

        emit RelayerSignerUpdated(index, old, newSigner);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
