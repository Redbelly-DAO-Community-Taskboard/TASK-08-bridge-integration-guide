<div align="center">
<img width="1434" height="1024" alt="dao-logo-on-dark" src="https://github.com/user-attachments/assets/76709542-59a1-4344-8fe4-6662d1fcf2ac" />

# 🌉 Redbridge

**A working, testnet-deployed lock-and-mint bridge  Ethereum Sepolia ⇄ Redbelly Testnet.**

ETH locked on Sepolia. `WETH.rb` minted on Redbelly. Secured by a 2-of-3 multisig relayer network. Every transaction independently verifiable on-chain.

[![Live App](https://img.shields.io/badge/App-redbridge.test--hub.xyz-000000?style=for-the-badge&logoColor=white)](https://redbridge.test-hub.xyz)
[![API](https://img.shields.io/badge/API-api.redbridge.test--hub.xyz-orange?style=for-the-badge)](https://api.redbridge.test-hub.xyz/api/bridge-history)

</div>

---

## 🏆 Redbelly DAO Task Board Submission

| Field | Value |
|---|---|
| **Task** | TASK-08  Existing Bridge Integration Guide |
| **Live App** | https://redbridge.test-hub.xyz |
| **API** | https://api.redbridge.test-hub.xyz/api/bridge-history |
| **Source chain** | Ethereum Sepolia  Chain ID `11155111` |
| **Destination chain** | Redbelly Network Testnet  Chain ID `153` |
| **Destination RPC** | `https://governors.testnet.redbelly.network` |

---

## ✨ What is Redbridge?

Redbridge is a **lock-and-mint bridge**  the same fundamental pattern used by most production bridges (Wormhole, LayerZero OFT bridges, etc.), built as a single-asset-pair reference implementation for the Redbelly ecosystem.

Users lock ETH on Sepolia. Three independent relayer processes watch for that lock, verify it, and once **2 of 3** agree, `WETH.rb` mints automatically on Redbelly Testnet  1:1, no claim step, no manual bridging action beyond the initial lock.

- 🔒 **Lock-and-mint architecture**  the same base pattern as Wormhole/LayerZero, simplified for a single asset pair
- 🔁 **2-of-3 multisig relayer network**  no single point of failure; one compromised or offline signer can't mint or halt the bridge
- ⚡ **Fully automatic minting**  no separate "claim" transaction, mint fires the moment consensus is reached
- 🔍 **100% verifiable**  every lock/mint pair is checkable on Sepolia Etherscan and the Redbelly explorer
- 📊 **Live bridge history API**  every bridged transaction, queryable by anyone, not just the sender
- 🆘 **Stuck-fund recovery built in**  a self-serve support-ticket system with automatic already-bridged detection (see [Stuck-Fund Recovery](#-stuck-fund-recovery-support-tickets))
- 🧪 **Testnet-proven**  multiple real end-to-end transactions verified on-chain, including a genuinely recovered stuck lock (see below)

---

## 🏗️ Architecture

```
   Ethereum Sepolia                                    Redbelly Testnet
  ┌─────────────────────┐                          ┌──────────────────────┐
  │  SepoliaLockVault    │                          │  WETHBridged (ERC-20) │
  │  .sol                 │      watches Locked      │  .sol                  │
  │                        │      event                │                        │
  │  lock(recipient) ──────┼──► relayer (off-chain) ──►│  confirmMint(...)       │
  │  payable, locks ETH    │     3 independent          │  2-of-3 multisig gate   │
  └─────────────────────┘     signer processes        └──────────────────────┘
                                                                  │
                                                                  ▼
                                                        mints WETH.rb 1:1
                                                        to the recipient
```

**Why a relayer, not a light client?** A fully trustless bridge would run a light client of one chain inside the other  the approach LayerZero/Wormhole use at scale with their own validator sets. For a testnet reference implementation, a permissioned relayer set is the standard simplified pattern: it demonstrates the full lock → verify → mint flow without requiring a custom light-client implementation for Redbelly's consensus.

**Why 2-of-3, not 1-of-1?** A single relayer is a single point of failure  if its key is compromised, arbitrary mints become possible. Requiring 2 of 3 independent signers to agree before a mint executes means one compromised or offline signer cannot mint or halt the bridge alone. This mirrors the multisig-relayer/guardian pattern used by several production bridges.

**Roles, clarified:**

| Role | Who | What they do |
|---|---|---|
| 👤 **Bridge user** | Anyone | Calls `lock()` on Sepolia. This is their only on-chain action  no separate "approve" or "claim" step. |
| 🔑 **Relayer signers** | 3 pre-set wallets, configured at deploy via `updateRelayerSigner()` | Independently watch for `Locked` events, wait for confirmations, then call `confirmMint()`. Once 2 of 3 have called it, the contract mints automatically. |

---

## 📁 Repo Structure

```
dao-redbelly/
├── contracts/
│   ├── sepolia/
│   │   └── SepoliaLockVault.sol      # deployed on Sepolia  accepts and locks ETH
│   └── redbelly/
│       └── WETHBridged.sol           # deployed on Redbelly Testnet  2-of-3 gated minter
├── scripts/
│   ├── deploy-sepolia.js             # deploys SepoliaLockVault
│   └── deploy-redbelly.js            # deploys WETHBridged
├── test/
│   ├── SepoliaLockVault.test.js
│   ├── WETHBridged.test.js
│   └── EndToEndFlow.test.js          # full lock → approve → mint simulation
├── relayer/
│   ├── relayer.js                    # off-chain relayer process (run once per signer)
│   ├── db.js                         # SQLite persistence layer for bridge history + support tickets
│   └── api.js                        # HTTP API: bridge history (read-only) + support-ticket endpoints
├── ecosystem.config.js               # pm2 process definitions (2 relayer instances)
├── start-signer1.sh / start-signer2.sh   # env-loading wrapper scripts
├── hardhat.config.js
├── .env.example
└── README.md
```

**Stack:**

- **Contracts:** Solidity, Hardhat, ethers.js v6
- **Relayer:** Node.js, SQLite (better-sqlite3), PM2-managed
- **API:** HTTP API exposing live bridge history and the stuck-fund support-ticket system
- **Networks:** Ethereum Sepolia (source) · Redbelly Testnet, Chain ID `153` (destination)

---

## 🚀 Quickstart

Prerequisites: Node.js ≥ 18 · Sepolia ETH ([faucet](https://sepoliafaucet.com)) · Redbelly Testnet RBNT for relayer gas · an RPC provider whose free tier supports `eth_getLogs` (see [Troubleshooting](#-troubleshooting))

```bash
# Clone & install
git clone https://github.com/0xDarkSeidBull/daotask8.git
cd daotask8
npm install

# Configure environment
cp .env.example .env
nano .env
```

Fill in `.env`:
- `DEPLOYER_PRIVATE_KEY`  deploys both contracts, becomes initial contract owner
- `SEPOLIA_RPC`  see [§ Troubleshooting](#-troubleshooting); don't use a plain public endpoint without checking `eth_getLogs` range limits first
- `REDBELLY_TESTNET_RPC`  `https://governors.testnet.redbelly.network`
- `RELAYER_PRIVATE_KEY`, `RELAYER2_PRIVATE_KEY`  two independent wallets, funded with Redbelly Testnet RBNT

```bash
# Deploy contracts
npx hardhat run scripts/deploy-sepolia.js --network sepolia
npx hardhat run scripts/deploy-redbelly.js --network redbellyTestnet
```

Copy the deployed addresses into `LOCK_VAULT_ADDRESS` and `WETH_BRIDGED_ADDRESS` in `.env`.

```bash
# Register the 3 relayer signer addresses on-chain (from the contract owner account)
npx hardhat console --network redbellyTestnet
```
```js
const weth = await ethers.getContractAt("WETHBridged", process.env.WETH_BRIDGED_ADDRESS);
await weth.updateRelayerSigner(0, "0xYourSigner1Address");
await weth.updateRelayerSigner(1, "0xYourSigner2Address");
await weth.updateRelayerSigner(2, "0xYourSigner3Address"); // can stay unused if only running 2 signers
```

```bash
# Run the relayers (each signer gets its own env file + pm2 process)
cp .env .env.signer1   # set RELAYER_PRIVATE_KEY to signer 1's key, SIGNER_LABEL=signer1
cp .env .env.signer2   # set RELAYER_PRIVATE_KEY to signer 2's key, SIGNER_LABEL=signer2

pm2 start ecosystem.config.js
pm2 save
```

Verify it's running:
```bash
pm2 logs relayer-signer1 --lines 20 --nostream
```

Then bridge a test transaction by calling `lock()` on `SepoliaLockVault` (see [Code Snippets](#-code-snippets) below). Within a few minutes, `WETH.rb` lands in the recipient's Redbelly wallet automatically.

---

## 💻 Code Snippets

> There's no separate "approve" or "claim" step for the bridge user  locking **is** the bridge transaction, and minting fires automatically once the relayer network reaches 2-of-3 consensus.

**Setup**
```js
const { ethers } = require("ethers");

const sepoliaProvider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC);
const wallet = new ethers.Wallet(process.env.USER_PRIVATE_KEY, sepoliaProvider);

const LOCK_VAULT_ABI = [
  "function lock(address redbellyRecipient) external payable",
  "event Locked(uint256 indexed nonce, address indexed sender, address indexed redbellyRecipient, uint256 amount, uint256 timestamp)",
];

const lockVault = new ethers.Contract(process.env.LOCK_VAULT_ADDRESS, LOCK_VAULT_ABI, wallet);
```

**Bridge  lock ETH on Sepolia**
```js
async function bridgeETH(recipientOnRedbelly, amountEth) {
  const tx = await lockVault.lock(recipientOnRedbelly, {
    value: ethers.parseEther(amountEth),
  });
  console.log("Lock tx submitted:", tx.hash);

  const receipt = await tx.wait();
  const lockedEvent = receipt.logs
    .map((log) => {
      try { return lockVault.interface.parseLog(log); } catch { return null; }
    })
    .find((e) => e && e.name === "Locked");

  console.log("Locked with nonce:", lockedEvent.args.nonce.toString());
  return lockedEvent.args.nonce;
}

bridgeETH("0xRecipientAddressOnRedbelly", "0.01");
```

**Check mint status (polling  minting is automatic)**
```js
const redbellyProvider = new ethers.JsonRpcProvider(process.env.REDBELLY_TESTNET_RPC);
const WETH_BRIDGED_ABI = [
  "function computeMintKey(uint256 sourceChainId, uint256 sourceNonce) public pure returns (bytes32)",
  "function mintRequests(bytes32) public view returns (address recipient, uint256 amount, uint256 approvalCount, bool executed)",
];
const wethBridged = new ethers.Contract(process.env.WETH_BRIDGED_ADDRESS, WETH_BRIDGED_ABI, redbellyProvider);

const SEPOLIA_CHAIN_ID = 11155111;

async function checkMintStatus(lockNonce) {
  const mintKey = await wethBridged.computeMintKey(SEPOLIA_CHAIN_ID, lockNonce);
  const state = await wethBridged.mintRequests(mintKey);
  return { approvals: Number(state.approvalCount), executed: state.executed };
}
// Poll every 15s until executed === true
```

> **Why read `mintRequests()` instead of parsing event logs?** Parsing `approvalCount` out of a decoded event arg proved unreliable in this implementation (see [Troubleshooting §4](#-troubleshooting)). Reading contract state directly is the authoritative source of truth.

**Extending to ERC-20 tokens (if forking beyond native ETH)**
```js
const TOKEN_ABI = ["function approve(address spender, uint256 amount) external returns (bool)"];
const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);

const approveTx = await token.approve(LOCK_VAULT_ADDRESS, amountToBridge);
await approveTx.wait();
// then call the vault's lock(token, amount, recipient) equivalent
```

---

## ⛽ Gas Cost Analysis

Measured on Sepolia and Redbelly Testnet, gas price at time of testing (August 2026). Figures are gas units and native-currency cost only  USD cost varies with ETH/RBNT price and congestion.

| Operation | Chain | Gas used (approx.) | Notes |
|---|---|---:|---|
| `lock()`  0.001 ETH | Sepolia | ~68,000 | Single `SSTORE` for nonce + event emission dominate cost |
| `lock()`  0.012 ETH | Sepolia | ~68,000 | Gas cost is amount-independent  same storage writes regardless of value locked |
| `confirmMint()`  1st approval | Redbelly Testnet | ~85,000 | Writes new `mintRequests` entry, increments approval count |
| `confirmMint()`  2nd approval (triggers mint) | Redbelly Testnet | ~140,000 | Additional cost from ERC-20 `_mint()` call and `MintExecuted` event |

**Observation:** transaction size doesn't affect gas cost  only the number of distinct on-chain state changes does. There's no batching discount in this design; a production version handling high volume would benefit from a batched-mint pattern (one `confirmMint` call approving many nonces at once).

---

## 🆘 Stuck-Fund Recovery: Support Tickets

A lock that never resolves  whether from a relayer-side bug or a user submitting a malformed recipient  previously had no visible recovery path beyond asking directly. Redbridge now exposes a self-serve support-ticket system, backed by the same bridge-history database, so a stuck (or apparently-stuck) transaction always has a next step.

- **Open a ticket.** A user submits their Sepolia lock tx hash and wallet address from the app's Contact Support / Reclaim flow. The ticket automatically attaches the lock's current on-chain status  no manual lookup required.
- **Already-bridged detection is automatic.** If the submitted transaction has, in fact, already minted successfully, the ticket is created *and closed* in the same request, tagged `resolved_already_bridged`, with the destination Redbelly transaction attached as proof. Most "is my bridge stuck?" questions resolve themselves instantly, with no human in the loop.
- **Genuinely stuck locks stay `active`** until manually resolved, with the on-chain lock status attached, so no context is lost between the user's report and whoever investigates it.
- **Duplicate protection.** Re-submitting the same transaction while a ticket is already open returns the existing ticket instead of creating a second one.
- **My Tickets view.** A wallet can list every ticket it has opened, split into Active and Solved, without needing to remember a ticket ID.

**API**
```
POST /api/support-ticket                      open a ticket (auto-resolves if already minted)
GET  /api/support-ticket/:ticketId             fetch a single ticket
GET  /api/support-ticket/wallet/:address       all tickets for a wallet, split Active / Solved
POST /api/support-ticket/:ticketId/resolve     admin-only, marks a stuck lock as recovered
```

This closes the gap the original design left open: a stuck lock is no longer a silent failure. It's a tracked, resolvable ticket, with its outcome  already bridged, or manually recovered  documented and attached to a Redbelly transaction hash. Nonce `#9` in [Verified Testnet Transactions](#-verified-testnet-transactions) below is a real, end-to-end proof of this: a lock that was genuinely stuck for ~22 hours, recovered once the fix in [Troubleshooting §8](#-troubleshooting) was deployed.

---

## 🔧 Troubleshooting

Real errors hit during development, with root cause and fix  not hypothetical.

**1. `eth_getLogs` fails with "archive request" / "requires a personal token"**
Free public RPC endpoints (publicnode, Alchemy free tier) restrict block-range size on `eth_getLogs`  Alchemy free tier caps it at **10 blocks per call**. Fix: query in small chunks with a delay between calls, and keep `HISTORICAL_LOOKBACK_BLOCKS` small (300–500) unless on a paid tier.
```js
async function getLogsChunked(contract, filter, fromBlock, toBlock, chunkSize = 10) {
  const allEvents = [];
  for (let start = fromBlock; start <= toBlock; start += chunkSize) {
    const end = Math.min(start + chunkSize - 1, toBlock);
    allEvents.push(...(await contract.queryFilter(filter, start, end)));
    await new Promise((r) => setTimeout(r, 400));
  }
  return allEvents;
}
```

**2. Alchemy 429  "exceeded compute units per second capacity"**
Multiple relayer signer processes hitting the same free-tier API key at once multiplies request volume. Fix: add delay between chunk requests, keep lookback small, or move to a paid RPC tier for production volume.

**3. `SqliteError: database is locked` (`SQLITE_BUSY`) on relayer startup**
Two relayer processes open the same SQLite file at near-identical startup. Fix: set an explicit busy-timeout so SQLite retries instead of throwing.
```js
const db = new Database(DB_PATH, { timeout: 10000 });
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");
```

**4. `approvalCount` silently stored as `0` in the database**
Parsing `approvalCount` from decoded event args occasionally returned `undefined` → `Number(undefined)` → `NaN`, which `better-sqlite3` silently coerces to `0`. Fix: never trust event-log parsing for state that's directly readable  read `mintRequests(mintKey)` fresh from the contract instead.
```js
const freshState = await wethBridged.mintRequests(mintKey);
const approvalCount = Number(freshState.approvalCount); // authoritative
```

**5. `pm2 restart` doesn't pick up `.env` changes**
`ecosystem.config.js` reading `process.env.*` at file-load time gets cached by Node  `pm2 restart` doesn't re-execute the config file. Fix: use `pm2 delete` + fresh `pm2 start`, or have each process load its own `.env` via a shell wrapper at startup.
```bash
#!/bin/bash
set -a
source /path/to/.env.signer1
set +a
exec node /path/to/relayer/relayer.js
```

**6. Port already in use by an unrelated process**
A new API server shows `online` in `pm2 status` but every request 404s  another process was already bound to that port. Fix: `lsof -i :<port>` to confirm, then pick a free port and update reverse proxy config.

**7. Mint confirmation feels slow (~60-90s) on testnet**
`CONFIRMATION_BLOCKS=5` (waiting for 5 Sepolia block confirmations before relaying) plus a 15-second poll interval add up on testnet, where reorg risk is negligible compared to mainnet. Fix: drop `CONFIRMATION_BLOCKS` to `2` and the relayer's `POLL_INTERVAL_MS` to `5000` for a faster testnet experience  cuts the wait to roughly 25-30 seconds, still with enough confirmation depth to be safe against testnet reorgs. Going to `0` isn't recommended even on testnet: it removes the buffer entirely, so a reorged block could get relayed as if it were final.

**8. A stuck lock gets permanently skipped as "possible reorg"  but it wasn't a reorg**
`getLogsChunked()` returned a partial (sometimes empty) event array on an RPC error without throwing  the retry loop logged the failure and silently returned whatever had been collected so far. `verifyLockStillValid()` then compared that against the expected lock and, on an empty result, assumed the lock had been reorged out. It had no way to tell an RPC hiccup apart from a chain that genuinely no longer contains the event, so it permanently skipped the lock  the mint would never be attempted again without manual intervention. Fix: have `getLogsChunked()` throw once its retry budget is exhausted, instead of swallowing the error. Wrap the `verifyLockStillValid()` call in a try/catch: a thrown error means "ask again later" (re-queued with a 30-second backoff), and only a clean, successful query that genuinely returns zero matching events counts as a reorg.
```js
if (attempt >= 3) {
  console.error(`getLogs chunk [${start}-${end}] failed after 3 attempts:`, err.message);
  throw new Error(`getLogsChunked exhausted retries for [${start}-${end}]: ${err.message}`);
}
```

**9. Verification window queries blocks that haven't been mined yet**
`verifyLockStillValid()`'s query window was `originalBlockNumber + CHUNK_SIZE` (10 blocks ahead), but `CONFIRMATION_BLOCKS` was only 2. On a fresh lock, the relayer tried to verify against a block range that didn't exist on chain yet. This fired on *every single lock*, not just under RPC stress, and only resolved once the chain naturally caught up, roughly 90-100 seconds later  which the item 8 retry-queue patched over by design rather than fixing outright. Fix: cap the window's end at the chain's current block height, never past it.
```js
const currentHead = await sepoliaProvider.getBlockNumber();
const windowEnd = Math.min(originalBlockNumber + CHUNK_SIZE, currentHead);
```

---

## ✅ Verified Testnet Transactions

All transactions below were bridged in this testing cycle (19–20 August 2026) and are independently verifiable on the respective block explorers. Nonce `#9` was genuinely stuck for roughly 22 hours due to the RPC-lag bug in [Troubleshooting §8](#-troubleshooting), and is included here specifically as proof the fix  and the [recovery path](#-stuck-fund-recovery-support-tickets)  works end to end, not only in isolation.

| Lock nonce | Sepolia lock tx | Redbelly mint tx | Amount | Status |
|---|---|---|---|---|
| #17 | [`0xbef7522a...b91893a`](https://sepolia.etherscan.io/tx/0xbef7522a4d15a9708f83c90034359f02e5ce035b3beae017044352450b91893a) | [`0x815e7c58...f2345c`](https://redbelly.testnet.routescan.io/tx/0x815e7c58484ae15a6116bab2095d88c27a5bd73e261a6317621ffa5951f2345c) | 0.001 ETH | ✅ Minted |
| #16 | [`0x84b13ca3...d05737`](https://sepolia.etherscan.io/tx/0x84b13ca308679a7ebb902b7c227323248fcfe86473bd92298513520a05d05737) | [`0x91f30864...d7774a`](https://redbelly.testnet.routescan.io/tx/0x91f30864af8227f8b3d2332c68dcc7169260f37b115d43179bd6922633d7774a) | 0.001 ETH | ✅ Minted |
| #15 | [`0xc3d52399...19b657`](https://sepolia.etherscan.io/tx/0xc3d52399064fb2019ea50b764c0f1ec0ef600c853e6d7876f752fe777819b657) | [`0x1cca9aa1...b44a03`](https://redbelly.testnet.routescan.io/tx/0x1cca9aa129c87fa7cd86443ec578c18da8e45642558d939baef7509621b44a03) | 0.0011 ETH | ✅ Minted |
| #14 | [`0x48a5267f...5381b7`](https://sepolia.etherscan.io/tx/0x48a5267f86c24f3ecbbfa705fbb36126013e6a17e72d5a9055cfffe79b5381b7) | [`0xebac3c36...082ffc`](https://redbelly.testnet.routescan.io/tx/0xebac3c365f5eb195f5357a4299becf58b766c9a476bec2dbf360e47b4e082ffc) | 0.0012 ETH | ✅ Minted |
| #13 | [`0x626c2af8...3ba878`](https://sepolia.etherscan.io/tx/0x626c2af8bb77ee5cf8b2f5039283ccd5360dd3d3593c3858515abe80753ba878) | [`0xe9a6e522...a48855`](https://redbelly.testnet.routescan.io/tx/0xe9a6e5221ecf0964fd631e63efebe3bd94c1fb48f0ed5ca711aa7b3b99a48855) | 0.001 ETH | ✅ Minted |
| #9 | [`0x2b370c4f...a7889e`](https://sepolia.etherscan.io/tx/0x2b370c4fcf229328218cac6f9a95b463bcf1242d742d9c02b770ee9673a7889e) | [`0xe9e8f29f...4891ce`](https://redbelly.testnet.routescan.io/tx/0xe9e8f29f37409e22c36ca4f4b9b3c6c7ee11f5806d49368b518ea340154891ce) | 0.1 ETH | ✅ Minted  recovered from a stuck state ([item 8](#-troubleshooting)) |

**Deployed contracts:**
- `SepoliaLockVault` (Sepolia): [`0x130d07624d00DF30A5C30C3D237fD5d99A3DdE11`](https://sepolia.etherscan.io/address/0x130d07624d00DF30A5C30C3D237fD5d99A3DdE11)
- `WETHBridged` (Redbelly Testnet): [`0x11Bef97d2d2063b41887A76403B852b52D151501`](https://redbelly.testnet.routescan.io/token/0x11Bef97d2d2063b41887A76403B852b52D151501?type=erc20)

Live, queryable bridge history for **all** users, not just the addresses above:
`GET https://api.redbridge.test-hub.xyz/api/bridge-history`

---

## 🔬 Existing Bridge Protocol Research

Whether major cross-chain protocols currently support Redbelly Network natively  checked against each protocol's own live, current chain-list docs (not blog posts or stale summaries).

> **Chain ID note:** Redbelly **Mainnet** is chain ID **151**, Redbelly **Testnet** is chain ID **153**. Double-check which one you're targeting before deploying  mixing them up is a common mistake.

| Protocol | Native Redbelly support? | Source |
|---|---|---|
| **LayerZero** | ✅ **Yes, on Mainnet**  dedicated "Redbelly Mainnet" deployment + OFT Quickstart guide in official docs | [docs.layerzero.network](https://docs.layerzero.network/v2/deployments/deployed-contracts) |
| **Axelar** | ❌ **No confirmed support**  not listed in chain-connectivity docs or ecosystem page | [docs.axelar.dev](https://docs.axelar.dev/validator/external-chains/overview/) |
| **Wormhole** | ❌ **No**  absent from the official Supported Networks table (July 2026) across all 5 products, ~40 chains listed | [wormhole.com/docs](https://wormhole.com/docs/products/reference/supported-networks/) |
| **Connext** | ⚠️ **Unconfirmed**  new chains added on request via Discord, not a static list | [nxtp-docs.connext.network](https://nxtp-docs.connext.network/Integration/SystemOverview/chains/) |
| **Multichain** | ⛔ **N/A**  discontinued in 2023 |  |

**Beyond the original task list**, four integrations are more directly relevant:

- **Celer's cBridge** added Redbelly Network support in August 2025  bridges tokens between Ethereum, BNB Chain, and Redbelly.
- **Redbelly's own official bridge** ([reddex.io/bridge](https://www.reddex.io/bridge))  Redbelly's own X account has directly pointed users to reddex for bridging USDC/USDT into the network, describing it as their official and exclusive DEX.
- **Lucid Labs Bridge**  Redbelly's own developer docs explicitly recommend this for the return path: "To bring RBNT from a non-Redbelly chain to Redbelly, use Lucid Labs Bridge." It also has a built-in "Resend Transaction" feature for retrying a bridge transfer that gets stuck mid-relay, without needing to contact support first.
- **Router Protocol's Nitro** and **Polymer**  not general bridges you'd pick yourself, but they're the infrastructure Redbelly's own announcements credit for the existing wrapped-RBNT deployments: Nitro powers the Solana wrapped-RBNT bridge, Polymer powers the Ethereum one.

This repo's bridge demonstrates the minimal architecture needed for a Redbelly integration when a protocol has no native support: a source-chain lock contract, a destination-chain mint contract with multisig-gated minting, and an off-chain relayer network connecting the two. Since LayerZero is confirmed live on Redbelly Mainnet, it could in principle replace this repo's custom relayer with its own DVN/Executor infrastructure while keeping a similar lock-and-mint pattern  the natural next iteration for a mainnet deployment.

---

## 🛣️ Roadmap

- [x] Lock-and-mint core architecture (SepoliaLockVault + WETHBridged)
- [x] 2-of-3 multisig relayer network
- [x] Automatic minting on consensus  no manual claim step
- [x] Live bridge history API, queryable by any wallet
- [x] End-to-end verified on Sepolia + Redbelly Testnet
- [x] Chunked `eth_getLogs` scanning for free-tier RPC compatibility
- [x] pm2-managed relayer processes with env-reload fix
- [x] Existing bridge protocol research (LayerZero, Wormhole, Axelar, Connext, cBridge)
- [x] Stuck-fund recovery: support-ticket system with automatic already-bridged detection, duplicate protection, and admin resolution
- [ ] Batched-mint pattern for high-volume production use
- [ ] ERC-20 token support beyond native ETH
- [ ] Mainnet deployment, potentially on LayerZero DVN/Executor infrastructure

---

## 👨‍💻 Built By

**0xDarkSeidBull**  solo builder, Redbelly ecosystem contributor.

Also building: [**LitDEX**](https://litdex.test-hub.xyz) · [**BetsOnBlock**](https://betsonblock.test-hub.xyz)

---

## 📄 License

MIT  see [LICENSE](./LICENSE).

---

<div align="center">

Built for **TASK-08** on the **Redbelly DAO Task Board**.

</div>
