require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const Database = require("better-sqlite3");
const path = require("path");
const https = require("https");

const DB_PATH = process.env.BRIDGE_DB_PATH || path.join(__dirname, "bridge-history.db");
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CHECK_INTERVAL_MS = parseInt(process.env.MONITOR_CHECK_INTERVAL_MS || "60000", 10);
const STUCK_THRESHOLD_MS = parseInt(process.env.MONITOR_STUCK_THRESHOLD_MS || String(3 * 60 * 1000), 10);
const FOLLOWUP_THRESHOLD_MS = parseInt(process.env.MONITOR_FOLLOWUP_THRESHOLD_MS || String(15 * 60 * 1000), 10);

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("[monitor] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing in .env — cannot send alerts, exiting.");
  process.exit(1);
}

const db = new Database(DB_PATH, { timeout: 10000 });
db.pragma("busy_timeout = 10000");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS monitor_alerts (
    source_chain_id INTEGER NOT NULL,
    source_nonce INTEGER NOT NULL,
    alert_level TEXT NOT NULL,
    alerted_at INTEGER NOT NULL,
    PRIMARY KEY (source_chain_id, source_nonce, alert_level)
  );
`);

function sendTelegramAlert(text) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" });
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode !== 200) console.error(`[monitor] Telegram send failed (${res.statusCode}):`, body);
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      console.error("[monitor] Telegram request error:", err.message);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

function getApprovalCount(chainId, nonce) {
  const row = db.prepare(`SELECT COUNT(*) as c FROM approvals WHERE source_chain_id = ? AND source_nonce = ?`).get(chainId, nonce);
  return row ? row.c : 0;
}

function hasAlert(chainId, nonce, level) {
  return !!db.prepare(`SELECT 1 FROM monitor_alerts WHERE source_chain_id = ? AND source_nonce = ? AND alert_level = ?`).get(chainId, nonce, level);
}

function recordAlert(chainId, nonce, level) {
  db.prepare(`INSERT OR IGNORE INTO monitor_alerts (source_chain_id, source_nonce, alert_level, alerted_at) VALUES (?, ?, ?, ?)`).run(chainId, nonce, level, Date.now());
}

async function checkStuckLocks() {
  const now = Date.now();
  const pending = db.prepare(`SELECT * FROM locks WHERE status = 'pending'`).all();

  for (const lock of pending) {
    const elapsedMs = now - lock.locked_at;
    const elapsedMin = Math.floor(elapsedMs / 60000);
    const approvals = getApprovalCount(lock.source_chain_id, lock.source_nonce);

    if (elapsedMs >= STUCK_THRESHOLD_MS && approvals < 2 && !hasAlert(lock.source_chain_id, lock.source_nonce, "initial")) {
      await sendTelegramAlert(
        `⚠️ <b>Redbridge: stuck lock detected</b>\nNonce: #${lock.source_nonce}\nSepolia tx: ${lock.sepolia_tx_hash}\nLocked ${elapsedMin} min ago, still only ${approvals}/2 approvals.\nhttps://sepolia.etherscan.io/tx/${lock.sepolia_tx_hash}`
      );
      recordAlert(lock.source_chain_id, lock.source_nonce, "initial");
      console.log(`[monitor] Alerted (initial) on nonce #${lock.source_nonce}, ${elapsedMin}min elapsed.`);
    }

    if (elapsedMs >= FOLLOWUP_THRESHOLD_MS && approvals < 2 && !hasAlert(lock.source_chain_id, lock.source_nonce, "followup")) {
      await sendTelegramAlert(
        `🚨 <b>Redbridge: still stuck</b>\nNonce #${lock.source_nonce} pending ${elapsedMin} min, ${approvals}/2 approvals. Needs manual investigation.\nhttps://sepolia.etherscan.io/tx/${lock.sepolia_tx_hash}`
      );
      recordAlert(lock.source_chain_id, lock.source_nonce, "followup");
      console.log(`[monitor] Alerted (followup) on nonce #${lock.source_nonce}, ${elapsedMin}min elapsed.`);
    }
  }

  const previouslyAlerted = db.prepare(`SELECT DISTINCT source_chain_id, source_nonce FROM monitor_alerts WHERE alert_level = 'initial'`).all();
  for (const { source_chain_id, source_nonce } of previouslyAlerted) {
    if (hasAlert(source_chain_id, source_nonce, "resolved")) continue;
    const lock = db.prepare(`SELECT * FROM locks WHERE source_chain_id = ? AND source_nonce = ?`).get(source_chain_id, source_nonce);
    if (lock && lock.status === "minted") {
      await sendTelegramAlert(`✅ <b>Redbridge: recovered</b>\nNonce #${source_nonce} has minted successfully. No longer stuck.`);
      recordAlert(source_chain_id, source_nonce, "resolved");
      console.log(`[monitor] Sent resolved notice for nonce #${source_nonce}.`);
    }
  }
}

console.log(`[monitor] Starting. Interval ${CHECK_INTERVAL_MS / 1000}s, alert at ${STUCK_THRESHOLD_MS / 60000}min, followup at ${FOLLOWUP_THRESHOLD_MS / 60000}min.`);
checkStuckLocks().catch((e) => console.error("[monitor] check error:", e.message));
setInterval(() => {
  checkStuckLocks().catch((e) => console.error("[monitor] check error:", e.message));
}, CHECK_INTERVAL_MS);
