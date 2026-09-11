require("dotenv").config();
const { ethers } = require("ethers");
const db = require("./db");

const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";
const REDBELLY_RPC = process.env.REDBELLY_TESTNET_RPC || "https://governors.testnet.redbelly.network";
const SEPOLIA_CHAIN_ID = 11155111;

const LOCK_VAULT_ADDRESS = process.env.LOCK_VAULT_ADDRESS;
const WETH_BRIDGED_ADDRESS = process.env.WETH_BRIDGED_ADDRESS;
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY;
const SIGNER_LABEL = process.env.SIGNER_LABEL || "relayer";

const CONFIRMATION_BLOCKS = parseInt(process.env.CONFIRMATION_BLOCKS || "5", 10);
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || "20", 10);
const POLL_INTERVAL_MS = 5_000;
const HISTORICAL_LOOKBACK_BLOCKS = parseInt(process.env.HISTORICAL_LOOKBACK_BLOCKS || "10000", 10);

const LOCK_VAULT_ABI = [
  "event Locked(uint256 indexed nonce, address indexed sender, address indexed redbellyRecipient, uint256 amount, uint256 timestamp)",
];
const WETH_BRIDGED_ABI = [
  "function confirmMint(uint256 sourceChainId, uint256 sourceNonce, address recipient, uint256 amount) external",
  "function computeMintKey(uint256 sourceChainId, uint256 sourceNonce) public pure returns (bytes32)",
  "function mintRequests(bytes32) public view returns (address recipient, uint256 amount, uint256 approvalCount, bool executed)",
];

function requireEnv(name, value) {
  if (!value) {
    console.error(`[fatal] Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class WorkQueue {
  constructor(concurrency) {
    this.concurrency = concurrency;
    this.queue = [];
    this.activeCount = 0;
  }
  push(taskFn) {
    this.queue.push(taskFn);
    this._tryStartNext();
  }
  _tryStartNext() {
    while (this.activeCount < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift();
      this.activeCount++;
      Promise.resolve()
        .then(task)
        .catch((err) => console.error("[queue] Unhandled task error:", err))
        .finally(() => {
          this.activeCount--;
          this._tryStartNext();
        });
    }
  }
}

async function main() {
  requireEnv("LOCK_VAULT_ADDRESS", LOCK_VAULT_ADDRESS);
  requireEnv("WETH_BRIDGED_ADDRESS", WETH_BRIDGED_ADDRESS);
  requireEnv("RELAYER_PRIVATE_KEY", RELAYER_PRIVATE_KEY);

  const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  const redbellyProvider = new ethers.JsonRpcProvider(REDBELLY_RPC);
  const redbellyWallet = new ethers.Wallet(RELAYER_PRIVATE_KEY, redbellyProvider);

  const lockVault = new ethers.Contract(LOCK_VAULT_ADDRESS, LOCK_VAULT_ABI, sepoliaProvider);
  const wethBridged = new ethers.Contract(WETH_BRIDGED_ADDRESS, WETH_BRIDGED_ABI, redbellyWallet);

  console.log(`[${SIGNER_LABEL}] Relayer starting.`);
  console.log(`[${SIGNER_LABEL}] Watching Sepolia lock vault: ${LOCK_VAULT_ADDRESS}`);
  console.log(`[${SIGNER_LABEL}] Submitting to Redbelly WETHBridged: ${WETH_BRIDGED_ADDRESS}`);
  console.log(`[${SIGNER_LABEL}] Relayer address: ${redbellyWallet.address}`);
  console.log(`[${SIGNER_LABEL}] Confirmation depth: ${CONFIRMATION_BLOCKS} blocks`);
  console.log(`[${SIGNER_LABEL}] Max concurrent locks in flight: ${MAX_CONCURRENT}`);

  const submitted = new Set();
  const inProgress = new Set();
  const queue = new WorkQueue(MAX_CONCURRENT);

  let nonceManager = {
    next: null,
    lock: Promise.resolve(),
    async getNext() {
      const result = this.lock.then(async () => {
        if (this.next === null) {
          this.next = await redbellyProvider.getTransactionCount(redbellyWallet.address, "pending");
        }
        const n = this.next;
        this.next += 1;
        return n;
      });
      this.lock = result.catch(() => {});
      return result;
    },
    rollback() {
      if (this.next !== null) this.next -= 1;
    },
  };

  const CHUNK_SIZE = parseInt(process.env.GETLOGS_CHUNK_SIZE || "10", 10);

  async function getLogsChunked(filter, fromBlock, toBlock) {
    const allEvents = [];
    let start = fromBlock;
    while (start <= toBlock) {
      const end = Math.min(start + CHUNK_SIZE - 1, toBlock);
      let attempt = 0;
      while (true) {
        try {
          const events = await lockVault.queryFilter(filter, start, end);
          allEvents.push(...events);
          break;
        } catch (err) {
          attempt++;
          if (attempt >= 3) {
            console.error(`[${SIGNER_LABEL}] getLogs chunk [${start}-${end}] failed after 3 attempts:`, err.message);
            throw new Error(`getLogsChunked exhausted retries for [${start}-${end}]: ${err.message}`);
          }
          await sleep(1000 * attempt);
        }
      }
      start = end + 1;
    }
    return allEvents;
  }

  async function processLockEvent(event) {
    const { nonce, sender, redbellyRecipient, amount } = event.args;
    const nonceKey = nonce.toString();
    if (submitted.has(nonceKey) || inProgress.has(nonceKey)) return;
    inProgress.add(nonceKey);

    try {
      console.log(`[${SIGNER_LABEL}] Observed lock #${nonceKey}: ${sender} -> ${redbellyRecipient}, ${ethers.formatEther(amount)} ETH`);

      db.upsertLock({
        sourceChainId: SEPOLIA_CHAIN_ID,
        sourceNonce: Number(nonce),
        sender,
        recipient: redbellyRecipient,
        amountWei: amount.toString(),
        sepoliaTxHash: event.transactionHash || (event.log && event.log.transactionHash),
        sepoliaBlockNumber: event.log ? event.log.blockNumber : event.blockNumber,
      });

      const lockBlock = event.log ? event.log.blockNumber : event.blockNumber;
      if (lockBlock === undefined) {
        console.error(`[${SIGNER_LABEL}] Could not determine block number for lock #${nonceKey}, skipping.`);
        return;
      }
      let currentBlock = await sepoliaProvider.getBlockNumber();
      while (currentBlock - lockBlock < CONFIRMATION_BLOCKS) {
        await sleep(POLL_INTERVAL_MS);
        currentBlock = await sepoliaProvider.getBlockNumber();
      }

      let stillPresent;
      try {
        stillPresent = await verifyLockStillValid(nonce, sender, redbellyRecipient, amount, lockBlock);
      } catch (verifyErr) {
        console.warn(`[${SIGNER_LABEL}] Lock #${nonceKey} verification RPC error (not a reorg, will retry): ${verifyErr.message}`);
        inProgress.delete(nonceKey);
        setTimeout(() => queue.push(() => processLockEvent(event)), 30000);
        return;
      }
      if (!stillPresent) {
        console.warn(`[${SIGNER_LABEL}] Lock #${nonceKey} genuinely not found on-chain (real reorg) -- skipping.`);
        return;
      }

      const mintKey = await wethBridged.computeMintKey(SEPOLIA_CHAIN_ID, nonce);
      const existing = await wethBridged.mintRequests(mintKey);
      if (existing.executed) {
        console.log(`[${SIGNER_LABEL}] Lock #${nonceKey} already minted. Skipping.`);
        submitted.add(nonceKey);
        db.recordMint({
          sourceChainId: SEPOLIA_CHAIN_ID,
          sourceNonce: Number(nonce),
          redbellyTxHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
        });
        return;
      }

      const txNonce = await nonceManager.getNext();
      try {
        console.log(`[${SIGNER_LABEL}] Submitting confirmMint for lock #${nonceKey} (account nonce ${txNonce})...`);
        const tx = await wethBridged.confirmMint(SEPOLIA_CHAIN_ID, nonce, redbellyRecipient, amount, { nonce: txNonce });
        console.log(`[${SIGNER_LABEL}] Submitted: ${tx.hash}`);
        const receipt = await tx.wait();
        console.log(`[${SIGNER_LABEL}] Confirmed lock #${nonceKey} in block ${receipt.blockNumber}`);
        submitted.add(nonceKey);

        // Don't trust event-log parsing for approvalCount (unreliable in practice).
        // Read the authoritative state straight from the contract instead.
        let freshApprovalCount = 0;
        let freshExecuted = false;
        try {
          const freshState = await wethBridged.mintRequests(mintKey);
          freshApprovalCount = Number(freshState.approvalCount);
          freshExecuted = freshState.executed;
        } catch (readErr) {
          console.error(`[${SIGNER_LABEL}] Could not read fresh mintRequests state for lock #${nonceKey}:`, readErr.message);
        }

        db.recordApproval({
          sourceChainId: SEPOLIA_CHAIN_ID,
          sourceNonce: Number(nonce),
          signerAddress: redbellyWallet.address,
          approvalCount: freshApprovalCount,
          redbellyTxHash: tx.hash,
        });

        if (freshExecuted) {
          db.recordMint({
            sourceChainId: SEPOLIA_CHAIN_ID,
            sourceNonce: Number(nonce),
            redbellyTxHash: tx.hash,
          });
          console.log(`[${SIGNER_LABEL}] Lock #${nonceKey}: confirmed executed (approvalCount=${freshApprovalCount}).`);
        } else {
          console.log(`[${SIGNER_LABEL}] Lock #${nonceKey}: approvalCount now ${freshApprovalCount}, not yet executed.`);
        }
      } catch (err) {
        nonceManager.rollback();
        if (err.message && err.message.includes("AlreadyApproved")) {
          console.log(`[${SIGNER_LABEL}] Already approved lock #${nonceKey} previously.`);
          submitted.add(nonceKey);
        } else {
          console.error(`[${SIGNER_LABEL}] Error submitting confirmMint for lock #${nonceKey}:`, err.message);
        }
      }
    } finally {
      inProgress.delete(nonceKey);
    }
  }

  async function verifyLockStillValid(nonce, expectedSender, expectedRecipient, expectedAmount, originalBlockNumber) {
    const filter = lockVault.filters.Locked(nonce);
    const windowStart = Math.max(0, originalBlockNumber - CHUNK_SIZE);
    const currentHead = await sepoliaProvider.getBlockNumber();
    const windowEnd = Math.min(originalBlockNumber + CHUNK_SIZE, currentHead);
    const logs = await getLogsChunked(filter, windowStart, windowEnd);
    if (logs.length === 0) return false;
    const log = logs[logs.length - 1];
    return (
      log.args.sender === expectedSender &&
      log.args.redbellyRecipient === expectedRecipient &&
      log.args.amount === expectedAmount
    );
  }

  const currentBlock = await sepoliaProvider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - HISTORICAL_LOOKBACK_BLOCKS);
  console.log(`[${SIGNER_LABEL}] Scanning historical locks from block ${fromBlock} to ${currentBlock} (chunk size ${CHUNK_SIZE})...`);
  const historicalEvents = await getLogsChunked(lockVault.filters.Locked(), fromBlock, currentBlock);
  console.log(`[${SIGNER_LABEL}] Found ${historicalEvents.length} historical lock(s). Enqueuing.`);
  for (const event of historicalEvents) {
    queue.push(() => processLockEvent(event));
  }

  console.log(`[${SIGNER_LABEL}] Listening for new Locked events...`);
  lockVault.on("Locked", (nonce, sender, redbellyRecipient, amount, timestamp, event) => {
    queue.push(() => processLockEvent(event));
  });

  setInterval(() => {
    console.log(`[${SIGNER_LABEL}] heartbeat: active=${queue.activeCount} queued=${queue.queue.length} submitted_total=${submitted.size}`);
  }, 60_000);
}

main().catch((err) => {
  console.error("[fatal] Relayer crashed:", err);
  process.exit(1);
});
