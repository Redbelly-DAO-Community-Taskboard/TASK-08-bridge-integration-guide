const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.BRIDGE_DB_PATH || path.join(__dirname, "bridge-history.db");
const db = new Database(DB_PATH, { timeout: 10000 });
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS locks (
    source_chain_id INTEGER NOT NULL,
    source_nonce INTEGER NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    amount_wei TEXT NOT NULL,
    sepolia_tx_hash TEXT NOT NULL,
    sepolia_block_number INTEGER NOT NULL,
    locked_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY (source_chain_id, source_nonce)
  );

  CREATE TABLE IF NOT EXISTS approvals (
    source_chain_id INTEGER NOT NULL,
    source_nonce INTEGER NOT NULL,
    signer_address TEXT NOT NULL,
    approval_count INTEGER NOT NULL,
    redbelly_tx_hash TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    PRIMARY KEY (source_chain_id, source_nonce, signer_address)
  );

  CREATE TABLE IF NOT EXISTS mints (
    source_chain_id INTEGER NOT NULL,
    source_nonce INTEGER NOT NULL,
    redbelly_tx_hash TEXT NOT NULL,
    minted_at INTEGER NOT NULL,
    PRIMARY KEY (source_chain_id, source_nonce)
  );

  CREATE INDEX IF NOT EXISTS idx_locks_locked_at ON locks(locked_at DESC);

  CREATE TABLE IF NOT EXISTS support_tickets (
    ticket_id TEXT PRIMARY KEY,
    tx_hash TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    amount_wei TEXT,
    description TEXT,
    lock_status TEXT,
    created_at INTEGER NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_tx_hash ON support_tickets(tx_hash);
`);

const ticketCols = db.prepare(`PRAGMA table_info(support_tickets)`).all().map((c) => c.name);
if (!ticketCols.includes("status")) {
  db.exec(`ALTER TABLE support_tickets ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`);
}
if (!ticketCols.includes("redbelly_tx_hash")) {
  db.exec(`ALTER TABLE support_tickets ADD COLUMN redbelly_tx_hash TEXT`);
}
if (!ticketCols.includes("resolved_at")) {
  db.exec(`ALTER TABLE support_tickets ADD COLUMN resolved_at INTEGER`);
}
db.prepare(`UPDATE support_tickets SET status = 'resolved_manual' WHERE resolved = 1 AND status = 'active'`).run();

function upsertLock({ sourceChainId, sourceNonce, sender, recipient, amountWei, sepoliaTxHash, sepoliaBlockNumber }) {
  db.prepare(`
    INSERT INTO locks (source_chain_id, source_nonce, sender, recipient, amount_wei, sepolia_tx_hash, sepolia_block_number, locked_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(source_chain_id, source_nonce) DO NOTHING
  `).run(sourceChainId, sourceNonce, sender, recipient, amountWei, sepoliaTxHash, sepoliaBlockNumber, Date.now());
}

function recordApproval({ sourceChainId, sourceNonce, signerAddress, approvalCount, redbellyTxHash }) {
  db.prepare(`
    INSERT INTO approvals (source_chain_id, source_nonce, signer_address, approval_count, redbelly_tx_hash, approved_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_chain_id, source_nonce, signer_address) DO NOTHING
  `).run(sourceChainId, sourceNonce, signerAddress, approvalCount, redbellyTxHash, Date.now());
}

function recordMint({ sourceChainId, sourceNonce, redbellyTxHash }) {
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO mints (source_chain_id, source_nonce, redbelly_tx_hash, minted_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(source_chain_id, source_nonce) DO NOTHING
    `).run(sourceChainId, sourceNonce, redbellyTxHash, Date.now());

    db.prepare(`
      UPDATE locks SET status = 'minted' WHERE source_chain_id = ? AND source_nonce = ?
    `).run(sourceChainId, sourceNonce);
  });
  tx();
}

function getBridgeHistory({ limit = 100, offset = 0 } = {}) {
  const locks = db.prepare(`
    SELECT * FROM locks ORDER BY locked_at DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  const getApprovalsStmt = db.prepare(`
    SELECT signer_address, approval_count, redbelly_tx_hash, approved_at
    FROM approvals
    WHERE source_chain_id = ? AND source_nonce = ?
    ORDER BY approval_count ASC
  `);
  const getMintStmt = db.prepare(`
    SELECT redbelly_tx_hash, minted_at FROM mints
    WHERE source_chain_id = ? AND source_nonce = ?
  `);

  return locks.map((lock) => {
    const approvals = getApprovalsStmt.all(lock.source_chain_id, lock.source_nonce);
    const mint = getMintStmt.get(lock.source_chain_id, lock.source_nonce) || null;
    return {
      sourceChainId: lock.source_chain_id,
      sourceNonce: lock.source_nonce,
      sender: lock.sender,
      recipient: lock.recipient,
      amountWei: lock.amount_wei,
      sepoliaTxHash: lock.sepolia_tx_hash,
      sepoliaBlockNumber: lock.sepolia_block_number,
      lockedAt: lock.locked_at,
      status: lock.status,
      approvals: approvals.map((a) => ({
        signerAddress: a.signer_address,
        approvalCount: a.approval_count,
        redbellyTxHash: a.redbelly_tx_hash,
        approvedAt: a.approved_at,
      })),
      mint: mint ? { redbellyTxHash: mint.redbelly_tx_hash, mintedAt: mint.minted_at } : null,
    };
  });
}

function getLockByNonce(sourceChainId, sourceNonce) {
  const history = getBridgeHistory({ limit: 1000, offset: 0 });
  return history.find((l) => l.sourceChainId === sourceChainId && l.sourceNonce === sourceNonce) || null;
}

function getTotalLockCount() {
  return db.prepare(`SELECT COUNT(*) as count FROM locks`).get().count;
}

function getLockByTxHash(txHash) {
  return db.prepare(`SELECT * FROM locks WHERE sepolia_tx_hash = ?`).get(txHash) || null;
}

const ZERO_HASH = "0x" + "0".repeat(64);

function getMintBySepoliaTxHash(txHash) {
  const lock = db.prepare(`SELECT * FROM locks WHERE sepolia_tx_hash = ?`).get(txHash);
  if (!lock) return null;
  const mint = db.prepare(`
    SELECT redbelly_tx_hash, minted_at FROM mints WHERE source_chain_id = ? AND source_nonce = ?
  `).get(lock.source_chain_id, lock.source_nonce);
  if (!mint) return null;
  if (mint.redbelly_tx_hash === ZERO_HASH) {
    return { redbelly_tx_hash: null, minted_at: mint.minted_at };
  }
  return mint;
}

function createSupportTicket({ ticketId, txHash, walletAddress, amountWei, description, lockStatus, status = "active", redbellyTxHash = null }) {
  const resolvedAt = status === "active" ? null : Date.now();
  db.prepare(`
    INSERT INTO support_tickets (ticket_id, tx_hash, wallet_address, amount_wei, description, lock_status, created_at, resolved, status, redbelly_tx_hash, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ticketId, txHash, walletAddress, amountWei || null, description || null, lockStatus || null,
    Date.now(), status === "active" ? 0 : 1, status, redbellyTxHash, resolvedAt
  );
}

function getOpenTicketByTxHash(txHash) {
  return db.prepare(`
    SELECT * FROM support_tickets WHERE tx_hash = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1
  `).get(txHash) || null;
}

function getSupportTicket(ticketId) {
  return db.prepare(`SELECT * FROM support_tickets WHERE ticket_id = ?`).get(ticketId) || null;
}

function getTicketsByWallet(walletAddress) {
  return db.prepare(`
    SELECT * FROM support_tickets WHERE wallet_address = ? COLLATE NOCASE ORDER BY created_at DESC
  `).all(walletAddress);
}

function resolveTicket(ticketId, { redbellyTxHash }) {
  const info = db.prepare(`
    UPDATE support_tickets SET status = 'resolved_manual', redbelly_tx_hash = ?, resolved_at = ?, resolved = 1
    WHERE ticket_id = ? AND status = 'active'
  `).run(redbellyTxHash || null, Date.now(), ticketId);
  if (info.changes === 0) return null;
  return getSupportTicket(ticketId);
}

module.exports = {
  upsertLock,
  recordApproval,
  recordMint,
  getBridgeHistory,
  getLockByNonce,
  getLockByTxHash,
  getMintBySepoliaTxHash,
  getTotalLockCount,
  createSupportTicket,
  getOpenTicketByTxHash,
  getSupportTicket,
  getTicketsByWallet,
  resolveTicket,
};
