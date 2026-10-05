import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "state.json");
const PORT = process.env.PORT || 4310;
const ONLINE_WINDOW_MS = 20_000; // a user is "online" if seen in the last 20s
const ADMIN_KEY = process.env.SIDEBET_ADMIN_KEY || null; // set this to enable /api/admin/reset

// ---------------------------------------------------------------------------
// Persistence — a plain JSON file. Every mutation is synchronous end-to-end
// (validate -> mutate -> write) so there's no `await` between reading and
// writing state, which keeps concurrent requests from racing each other.
// ---------------------------------------------------------------------------
function seedState() {
  return {
    users: {
      p1: { id: "p1", name: "Alex", balance: 1000, locked: 0, lastSeen: 0 },
      p2: { id: "p2", name: "Sam", balance: 1000, locked: 0, lastSeen: 0 },
    },
    proposals: [],
    ledger: [], // newest first: {id, userId, amount, type, note, createdAt}
    nextPid: 1,
    nextTid: 1,
  };
}

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    // basic shape guard in case of a corrupted/partial file
    if (parsed && parsed.users && parsed.proposals && parsed.ledger) return parsed;
  } catch (e) {
    // no file yet, or unreadable — fall through to a fresh seed
  }
  return seedState();
}

let state = loadState();

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE); // atomic on the same filesystem
}
persist(); // make sure the file exists from the very first boot

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function round2(n) {
  return Math.round(n * 100) / 100;
}

function parseOdds(str) {
  const m = (str || "").match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!m) return { ratio: 1, label: "1:1" };
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!a || !b) return { ratio: 1, label: "1:1" };
  return { ratio: a / b, label: `${a}:${b}` };
}

function touch(user) {
  user.lastSeen = Date.now();
}

function addLedger(userId, amount, type, note, predictionId = null) {
  state.ledger.unshift({
    id: state.nextTid++,
    userId,
    amount,
    type,
    note,
    predictionId,
    createdAt: new Date().toISOString(),
  });
}

function publicUser(u) {
  return {
    id: u.id,
    name: u.name,
    balance: u.balance,
    locked: u.locked,
    online: Date.now() - (u.lastSeen || 0) < ONLINE_WINDOW_MS,
  };
}

function snapshot() {
  return {
    serverTime: new Date().toISOString(),
    users: Object.values(state.users).map(publicUser),
    proposals: state.proposals,
    ledger: state.ledger,
  };
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireUser(seat) {
  const u = state.users[seat];
  if (!u) throw new ApiError(404, "Unknown player. Rejoin the table.");
  return u;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.use(cors({ origin: (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "10kb" }));

const router = express.Router();

router.get("/health", (req, res) => res.json({ status: "ok" }));

// Full snapshot — polled by every connected client every couple of seconds.
router.get("/state", (req, res) => {
  res.json(snapshot());
});

// Lightweight presence ping so "online now" stays accurate without a websocket.
router.post("/heartbeat", (req, res) => {
  const { seat } = req.body || {};
  const u = state.users[seat];
  if (u) {
    touch(u);
    persist();
  }
  res.json(snapshot());
});

// Create a brand-new player (or the two pre-seeded demo seats, via /enter).
router.post("/join", (req, res, next) => {
  try {
    const name = (req.body?.name || "").trim();
    if (!name) throw new ApiError(400, "Enter a username first.");
    if (name.length > 20) throw new ApiError(400, "Names must be 20 characters or fewer.");

    const taken = Object.values(state.users).some(
      (u) => u.name.toLowerCase() === name.toLowerCase()
    );
    if (taken) throw new ApiError(409, `"${name}" is already at the table — pick another name.`);

    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    let id = "u_" + (slug || crypto.randomUUID().slice(0, 8));
    if (state.users[id]) id = id + "_" + crypto.randomUUID().slice(0, 6);

    state.users[id] = { id, name, balance: 1000, locked: 0, lastSeen: Date.now() };
    persist();
    res.json({ seat: publicUser(state.users[id]), state: snapshot() });
  } catch (e) {
    next(e);
  }
});

// Rejoin an existing seat (e.g. after a page reload, using the id stored locally).
router.post("/enter", (req, res, next) => {
  try {
    const { seat } = req.body || {};
    const u = requireUser(seat);
    touch(u);
    persist();
    res.json({ seat: publicUser(u), state: snapshot() });
  } catch (e) {
    next(e);
  }
});

router.post("/proposals", (req, res, next) => {
  try {
    const { seat, title, odds, stake } = req.body || {};
    const creator = requireUser(seat);
    touch(creator);

    const cleanTitle = (title || "").trim();
    const baseStake = parseFloat(stake);
    if (!cleanTitle) throw new ApiError(400, "Give the prediction a title.");
    if (!baseStake || baseStake <= 0) throw new ApiError(400, "Stake must be a positive number.");

    const parsedOdds = parseOdds(odds);
    const opponentStake = round2(baseStake);
    const creatorStake = round2(baseStake * parsedOdds.ratio);

    if (creatorStake > creator.balance) {
      throw new ApiError(
        400,
        `At ${parsedOdds.label} odds, ${creator.name} needs to lock $${creatorStake.toFixed(
          2
        )}, but only has $${creator.balance.toFixed(2)} available.`
      );
    }

    creator.balance -= creatorStake;
    creator.locked += creatorStake;

    const proposal = {
      id: state.nextPid++,
      title: cleanTitle,
      odds: parsedOdds.label,
      creatorStake,
      opponentStake,
      status: "OPEN",
      creator: creator.id,
      opponent: null,
      votes: {},
      result: null,
      createdAt: new Date().toISOString(),
    };
    state.proposals.unshift(proposal);
    addLedger(creator.id, -creatorStake, "LOCK", `Locked on "${cleanTitle}" (${parsedOdds.label} odds)`, proposal.id);

    persist();
    res.json(snapshot());
  } catch (e) {
    next(e);
  }
});

router.post("/proposals/:id/accept", (req, res, next) => {
  try {
    const pid = Number(req.params.id);
    const { seat } = req.body || {};
    const acceptor = requireUser(seat);
    touch(acceptor);

    const p = state.proposals.find((x) => x.id === pid);
    if (!p || p.status !== "OPEN") throw new ApiError(409, "That proposal is no longer open.");
    if (p.creator === seat) throw new ApiError(400, "You can't accept your own proposal.");
    if (p.opponentStake > acceptor.balance) {
      throw new ApiError(400, `${acceptor.name} only has $${acceptor.balance.toFixed(2)} available.`);
    }

    acceptor.balance -= p.opponentStake;
    acceptor.locked += p.opponentStake;
    p.opponent = acceptor.id;
    p.status = "MATCHED";
    p.matchedAt = new Date().toISOString();

    addLedger(acceptor.id, -p.opponentStake, "LOCK", `Locked to accept "${p.title}" (${p.odds} odds)`, p.id);

    persist();
    res.json(snapshot());
  } catch (e) {
    next(e);
  }
});

router.post("/proposals/:id/vote", (req, res, next) => {
  try {
    const pid = Number(req.params.id);
    const { seat, winnerId } = req.body || {};
    const voter = requireUser(seat);
    touch(voter);

    const p = state.proposals.find((x) => x.id === pid);
    if (!p || p.status !== "MATCHED") throw new ApiError(409, "That proposal isn't awaiting a vote.");
    if (seat !== p.creator && seat !== p.opponent) throw new ApiError(403, "Only the two participants can vote.");
    if (winnerId !== p.creator && winnerId !== p.opponent) throw new ApiError(400, "Invalid winner.");

    p.votes[seat] = winnerId;

    const voters = [p.creator, p.opponent];
    const allVoted = voters.every((v) => p.votes[v]);
    if (allVoted && p.votes[p.creator] === p.votes[p.opponent]) {
      settle(p, p.votes[p.creator]);
    }

    persist();
    res.json(snapshot());
  } catch (e) {
    next(e);
  }
});

function settle(p, winnerId) {
  const loserId = winnerId === p.creator ? p.opponent : p.creator;
  const winner = state.users[winnerId];
  const loser = state.users[loserId];
  const winnerStake = winnerId === p.creator ? p.creatorStake : p.opponentStake;
  const loserStake = loserId === p.creator ? p.creatorStake : p.opponentStake;
  const payout = round2(p.creatorStake + p.opponentStake);

  winner.locked -= winnerStake;
  loser.locked -= loserStake;
  winner.balance += payout;

  addLedger(winnerId, payout, "PAYOUT", `Won "${p.title}"`, p.id);

  p.status = "SETTLED";
  p.result = winnerId;
  p.settledAt = new Date().toISOString();
}

// Admin-only, not exposed in the UI: wipes the shared table back to the two
// seeded demo seats. Requires SIDEBET_ADMIN_KEY to be set and passed as a
// header, precisely so an ordinary "Reset demo" button can't nuke everyone
// else's live proposals and ledger history.
router.post("/admin/reset", (req, res, next) => {
  try {
    if (!ADMIN_KEY || req.get("x-admin-key") !== ADMIN_KEY) {
      throw new ApiError(403, "Not authorized.");
    }
    state = seedState();
    persist();
    res.json(snapshot());
  } catch (e) {
    next(e);
  }
});

app.use("/api", router);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || "Internal error" });
});

app.listen(PORT, () => {
  console.log(`SideBet sim server listening on http://localhost:${PORT}`);
  console.log(`Persisting shared state to ${DATA_FILE}`);
});
