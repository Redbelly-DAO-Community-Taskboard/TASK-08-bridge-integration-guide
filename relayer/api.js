require("dotenv").config();
const express = require("express");
const db = require("./db");

const PORT = parseInt(process.env.BRIDGE_API_PORT || "3210", 10);
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TICKET_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateTicketId() {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += TICKET_ID_CHARS[Math.floor(Math.random() * TICKET_ID_CHARS.length)];
  }
  return `RBRIDGE-${suffix}`;
}

function formatTicket(t) {
  return {
    ticketId: t.ticket_id,
    txHash: t.tx_hash,
    walletAddress: t.wallet_address,
    amountWei: t.amount_wei,
    description: t.description,
    lockStatus: t.lock_status,
    status: t.status,
    redbellyTxHash: t.redbelly_tx_hash,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
  };
}

app.get("/api/bridge-history", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    const history = db.getBridgeHistory({ limit, offset });
    const total = db.getTotalLockCount();
    res.json({ total, limit, offset, results: history });
  } catch (err) {
    console.error("[api] Error fetching bridge history:", err.message);
    res.status(500).json({ error: "Internal error fetching bridge history" });
  }
});

app.get("/api/bridge-history/:sourceChainId/:sourceNonce", (req, res) => {
  const sourceChainId = parseInt(req.params.sourceChainId, 10);
  const sourceNonce = parseInt(req.params.sourceNonce, 10);
  if (Number.isNaN(sourceChainId) || Number.isNaN(sourceNonce)) {
    return res.status(400).json({ error: "sourceChainId and sourceNonce must be integers" });
  }
  try {
    const lock = db.getLockByNonce(sourceChainId, sourceNonce);
    if (!lock) return res.status(404).json({ error: "Lock not found" });
    res.json(lock);
  } catch (err) {
    console.error("[api] Error fetching lock:", err.message);
    res.status(500).json({ error: "Internal error fetching lock" });
  }
});

app.post("/api/support-ticket", (req, res) => {
  const { txHash, walletAddress, amount, description } = req.body || {};

  if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
    return res.status(400).json({ error: "txHash must be a valid 0x-prefixed 32-byte transaction hash" });
  }
  if (typeof walletAddress !== "string" || !ADDRESS_RE.test(walletAddress)) {
    return res.status(400).json({ error: "walletAddress must be a valid 0x-prefixed 20-byte address" });
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 2000)) {
    return res.status(400).json({ error: "description must be a string under 2000 characters" });
  }

  try {
    const existing = db.getOpenTicketByTxHash(txHash);
    if (existing) {
      return res.status(200).json({
        ticketId: existing.ticket_id,
        status: existing.status,
        message: "An open ticket already exists for this transaction.",
      });
    }

    const lock = db.getLockByTxHash(txHash);
    const lockStatus = lock ? lock.status : null;
    const ticketId = generateTicketId();

    if (lockStatus === "minted") {
      const mint = db.getMintBySepoliaTxHash(txHash);
      db.createSupportTicket({
        ticketId,
        txHash,
        walletAddress,
        amountWei: amount !== undefined ? String(amount) : null,
        description: description || null,
        lockStatus,
        status: "resolved_already_bridged",
        redbellyTxHash: mint ? mint.redbelly_tx_hash : null,
      });
      return res.json({
        ticketId,
        status: "resolved_already_bridged",
        lockStatus,
        redbellyTxHash: mint ? mint.redbelly_tx_hash : null,
        message: "This transaction already bridged successfully and is on Redbelly Chain. No action needed.",
      });
    }

    db.createSupportTicket({
      ticketId,
      txHash,
      walletAddress,
      amountWei: amount !== undefined ? String(amount) : null,
      description: description || null,
      lockStatus,
      status: "active",
    });

    res.json({ ticketId, status: "active", lockStatus });
  } catch (err) {
    console.error("[api] Error creating support ticket:", err.message);
    res.status(500).json({ error: "Internal error creating support ticket" });
  }
});

app.get("/api/support-ticket/:ticketId", (req, res) => {
  try {
    const ticket = db.getSupportTicket(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: "Ticket not found" });
    res.json(formatTicket(ticket));
  } catch (err) {
    console.error("[api] Error fetching support ticket:", err.message);
    res.status(500).json({ error: "Internal error fetching support ticket" });
  }
});

app.get("/api/support-ticket/wallet/:address", (req, res) => {
  const { address } = req.params;
  if (!ADDRESS_RE.test(address)) {
    return res.status(400).json({ error: "address must be a valid 0x-prefixed 20-byte address" });
  }
  try {
    const tickets = db.getTicketsByWallet(address);
    const active = tickets.filter((t) => t.status === "active");
    const solved = tickets.filter((t) => t.status !== "active");
    res.json({
      active: active.map(formatTicket),
      solved: solved.map(formatTicket),
    });
  } catch (err) {
    console.error("[api] Error fetching wallet tickets:", err.message);
    res.status(500).json({ error: "Internal error fetching wallet tickets" });
  }
});

app.post("/api/support-ticket/:ticketId/resolve", (req, res) => {
  const adminKey = req.header("x-admin-key");
  if (!process.env.ADMIN_API_KEY) {
    return res.status(503).json({ error: "Admin resolve endpoint not configured (ADMIN_API_KEY missing)" });
  }
  if (!adminKey || adminKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { redbellyTxHash } = req.body || {};
  try {
    const updated = db.resolveTicket(req.params.ticketId, { redbellyTxHash });
    if (!updated) return res.status(404).json({ error: "Ticket not found or already resolved" });
    res.json({ ticketId: updated.ticket_id, status: updated.status, redbellyTxHash: updated.redbelly_tx_hash });
  } catch (err) {
    console.error("[api] Error resolving ticket:", err.message);
    res.status(500).json({ error: "Internal error resolving ticket" });
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", totalLocks: db.getTotalLockCount() });
});

app.listen(PORT, () => {
  console.log(`[bridge-history-api] Listening on port ${PORT}`);
});
