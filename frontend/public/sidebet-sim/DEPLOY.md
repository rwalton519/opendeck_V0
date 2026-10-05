# Deploying the fixed /sidebet-sim/

## What changed and why

The old `sidebet-sim/index.html` was a pure client-side toy: `state` was a
plain JS object living in one browser tab. Reload the page, or open a second
tab, and you got a brand-new empty simulation — no shared users, no shared
proposals, no persisted ledger. That's the root cause of both problems you
flagged.

The fix adds a small Node/Express backend (`server/`) that:

- Holds the users, proposals, and ledger in one place, on disk
  (`server/data/state.json`), so it survives restarts and is the same for
  every visitor — that's feature 1 (unlimited users, shared userbase).
- Timestamps every ledger row with a real ISO date/time and never deletes
  entries — that's feature 2 (permanent ledger).
- Is polled by the frontend every 2 seconds (`GET /api/state`) so every open
  browser converges on the same numbers — that's the "visual running update."

I didn't wire this into the existing `sidebet-server/` package you had
included in the zip — that one expects Postgres, email/password + JWT auth,
and a full migration step, which doesn't match how this sim actually signs
people in (just a display name, no password). Standing that up would be a
much bigger lift than the two features you asked for. If you *do* want the
sim to eventually ride on that real backend and DB, say so and I'll port it
over — but for now this ships something you can drop onto the existing EC2
box in a few minutes.

## 1. Copy files to the server

```bash
# from your Windows machine
scp -r server ec2-user@<your-ec2-host>:/home/ec2-user/opendeck/sidebet-sim-server
scp public/index.html ec2-user@<your-ec2-host>:/home/ec2-user/opendeck/sidebet-sim/index.html
```

(Adjust paths to wherever you keep static files/served apps today — this
assumes the same `/home/ec2-user/opendeck` root your other memory notes
reference.)

## 2. Install and run the backend

```bash
ssh ec2-user@<your-ec2-host>
cd /home/ec2-user/opendeck/sidebet-sim-server
npm install --production
```

Run it under whatever process manager you already use for the Node backend
(pm2, systemd, etc.). With pm2:

```bash
pm2 start server.js --name sidebet-sim-server --env production
pm2 save
```

Pick a port that doesn't collide with your main OpenDeck backend — the
default here is **4310** (`PORT` env var to change it).

Optional: set `SIDEBET_ADMIN_KEY` in the environment if you ever want to be
able to wipe the demo table back to Alex/Sam via:

```bash
curl -X POST http://localhost:4310/api/admin/reset -H "x-admin-key: <your key>"
```

There's no reset button in the UI anymore — with real shared multi-user
state, a "Reset demo" button would wipe every other visitor's proposals and
ledger too, so I removed it rather than ship something destructive by
accident.

## 3. nginx — proxy the API path

Add a location block alongside your existing `/webapp/` one (same pattern
you already use to route API calls to the Node backend instead of falling
through to the SPA catch-all):

```nginx
location /sidebet-sim/api/ {
    proxy_pass http://127.0.0.1:4310/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Make sure this block is defined **before** whatever catch-all serves
`/sidebet-sim/` as static files, so `/sidebet-sim/api/...` requests hit the
Node process and don't fall through to `index.html` — this is the exact
class of bug you already fixed once for `/webapp/`.

Reload nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4. Verify

```bash
curl https://opendeck.ca/sidebet-sim/api/health
# -> {"status":"ok"}
```

Then open `https://opendeck.ca/sidebet-sim/` in two different browsers (or
one normal + one incognito window), join with two different usernames, and
confirm:

- Each sees the other listed as "online" in the balances panel.
- A proposal created in one shows up in the other within ~2 seconds.
- The ledger panel timestamps entries with date + time and keeps growing —
  reload either tab and the history is still there.

## Notes / things worth knowing

- **Persistence is a JSON file**, not a database — appropriate for a sim at
  this scale, but if the ledger grows into the tens of thousands of rows
  you'll want to move it into Postgres/SQLite. Say the word if you want that
  swap.
- **"Online" means "seen in the last 20 seconds"** (via poll/heartbeat), not
  a real websocket presence channel — consistent with the REST-over-polling
  direction you already moved `TournamentTablePage.tsx` toward, and avoids
  the WebSocket-behind-nginx headaches you ran into there.
- **Seat identity persists per-browser** via `localStorage`, not a real
  login — reopening the same browser keeps you as the same player; a
  different browser/device is a different (or new) player. This matches the
  original sim's "no password" design; it is **not** meant to be secure
  identity for anything beyond a demo.
