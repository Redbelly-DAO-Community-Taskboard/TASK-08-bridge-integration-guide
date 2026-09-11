// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SepoliaLockVault
/// @notice Locks native ETH on Ethereum Sepolia, emitting an event that a
///         multi-sig-authorized relayer watches to mint an equivalent
///         wrapped WETH on Redbelly Testnet. This is the source-chain half
///         of a lock-and-mint bridge. This contract never releases funds by
///         itself; unlocking/refunds are owner-gated for emergency recovery
///         only (see emergencyWithdraw), matching a minimal-trust testnet
///         bridge design, not a trustless production bridge.
contract SepoliaLockVault is ReentrancyGuard, Pausable, Ownable2Step {
    /// @notice Minimum lockable amount, to avoid dust transactions that
    ///         cost more in relayer gas than they are worth.
    uint256 public constant MIN_LOCK_AMOUNT = 0.001 ether;

    /// @notice Maximum lockable amount per transaction, a conservative cap
    ///         appropriate for a testnet bridge demo (limits blast radius
    ///         of any bug, independent of the destination-side supply cap).
    uint256 public constant MAX_LOCK_AMOUNT = 10 ether;

    /// @notice Monotonically increasing nonce, included in the emitted event
    ///         so the destination-side mint can be uniquely and
    ///         deterministically tied back to this exact lock.
    uint256 public nonce;

    /// @notice Total ETH currently locked in this vault.
    uint256 public totalLocked;

    event Locked(
        uint256 indexed nonce,
        address indexed sender,
        address indexed redbellyRecipient,
        uint256 amount,
        uint256 timestamp
    );

    event EmergencyWithdraw(address indexed to, uint256 amount);

    error AmountTooLow(uint256 amount, uint256 minimum);
    error AmountTooHigh(uint256 amount, uint256 maximum);
    error ZeroRecipient();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice Locks msg.value and emits a Locked event for the relayer to
    ///         observe. `redbellyRecipient` is explicit (rather than
    ///         assumed to equal msg.sender) so a user can bridge to a
    ///         different address on Redbelly Testnet if desired.
    function lock(address redbellyRecipient) external payable whenNotPaused nonReentrant {
        if (redbellyRecipient == address(0)) revert ZeroRecipient();
        if (msg.value < MIN_LOCK_AMOUNT) revert AmountTooLow(msg.value, MIN_LOCK_AMOUNT);
        if (msg.value > MAX_LOCK_AMOUNT) revert AmountTooHigh(msg.value, MAX_LOCK_AMOUNT);

        uint256 currentNonce = nonce;
        nonce += 1;
        totalLocked += msg.value;

        emit Locked(currentNonce, msg.sender, redbellyRecipient, msg.value, block.timestamp);
    }

    /// @notice Owner-only emergency withdrawal, for recovering locked funds
    ///         if the bridge is deprecated or a critical bug is found.
    ///         This is a deliberate centralization point, documented here
    ///         and in docs/INTEGRATION_GUIDE.md security section, not
    ///         hidden -- a testnet demo bridge trades some trustlessness
    ///         for operability, and that tradeoff should be explicit.
    function emergencyWithdraw(address payable to, uint256 amount) external onlyOwner {
        require(amount <= address(this).balance, "insufficient balance");
        totalLocked -= amount > totalLocked ? totalLocked : amount;
        (bool success, ) = to.call{value: amount}("");
        require(success, "withdraw failed");
        emit EmergencyWithdraw(to, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {
        revert("use lock(address) instead of direct transfer");
    }
}
