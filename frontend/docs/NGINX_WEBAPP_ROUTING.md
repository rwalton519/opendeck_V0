# nginx: routing /webapp to the backend (currently missing)

## What we confirmed

```
curl -s https://opendeck.ca/webapp/api/health
curl -s https://opendeck.ca/webapp/health
```

Both returned the frontend's `index.html`. That means nginx has **no
location block at all** for `/webapp` today - every request under it
falls through to the SPA's catch-all fallback (`try_files $uri $uri/
/index.html;` or equivalent), which is why swapping the frontend's
`VITE_API_BASE_URL` between `/webapp/api` and `/webapp` never fixed
anything: neither one was ever wired to the Node backend on the server
side. This isn't a frontend config problem; it needs one nginx change.

## The fix

Everything - REST API (`/wallet`, `/auth`, `/admin`, `/cashgame-demo`,
etc.), the real-money table WebSocket (`api/routes/wsRouter.js`), and the
Cash Game Demo's SSE stream (`routers/cashGameDemoRouter.js`) - is the
same Node process on the same port (`PORT` in `backend/.env`, `8000` by
default - confirm yours with `pm2 describe backend` or by checking that
env var directly). So this only needs **one** location block:

```nginx
location /webapp/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_http_version 1.1;

    # Needed for the real-money table WebSocket (wss://opendeck.ca/webapp/ws/table/...)
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # Needed for req.ip to reflect the real client rather than nginx's own
    # address - see server.js's `app.set('trust proxy', 1)`, which is what
    # makes the Admin Dashboard's signup_ip/last_login_ip tracking work at
    # all. Without this header, every account would show the same IP:
    # nginx's.
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;

    # Needed for the Cash Game Demo's SSE stream
    # (GET /webapp/cashgame-demo/stream) to actually stream instead of
    # buffering until the connection closes. Safe to leave on globally
    # here since nothing else under /webapp/ needs response buffering.
    proxy_buffering off;
}
```

The trailing slash on both the `location` path and the `proxy_pass` URL
matters - that combination is what strips the `/webapp` prefix before
forwarding, so `https://opendeck.ca/webapp/wallet/balance` reaches the
backend as `/wallet/balance`, matching exactly how `server.js` mounts its
routers (`app.use('/wallet', walletRouter)`, not
`app.use('/webapp/wallet', ...)`).

A ready-to-paste copy of this (plus the two related gaps below) lives at
[`deploy/nginx/opendeck-webapp.conf`](../deploy/nginx/opendeck-webapp.conf).

## Related gap found while diagnosing this: `/sidebet-api/` has the same problem

`env.ts`'s `sideBetApiBaseUrl` defaults to `https://opendeck.ca/sidebet-api`,
and per `.env.example`, SideBet is served by a **separate** Node process
from the main backend (`VITE_SIDEBET_API_BASE_URL=http://localhost:4000`
in local dev, vs. the main backend's `8000`). There is currently no nginx
location block for `/sidebet-api/` either, so `/sidebet` in the app would
fail the same way `/cashgame-demo` did, once someone links to it. Not
reported yet because nothing on the homepage points at it today, but worth
fixing at the same time:

```nginx
location /sidebet-api/ {
    proxy_pass http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
```

Confirm the actual production port for the `sidebet-server` process before
applying this - `4000` is only the local-dev default.

## Related gap: the no-trailing-slash redirects cover only one of three demo pages

The original diagnosis here only mentioned `/cashgame-demo`, but the same
`try_files $uri $uri/ /index.html;` gap applies identically to the other
two static demo games linked from the homepage - `/heads-up` and
`/RNG-shuffle-tester` also fall through to the SPA when requested without
a trailing slash:

```nginx
location = /cashgame-demo      { return 301 /cashgame-demo/; }
location = /heads-up           { return 301 /heads-up/; }
location = /RNG-shuffle-tester { return 301 /RNG-shuffle-tester/; }
```

(`/sidebet-sim` reportedly already resolves without the slash in
production - if that's still true, it doesn't need this treatment.)

## Where this goes

Find your actual server block first:

```bash
sudo nginx -T 2>/dev/null | grep -n "server_name\|location"
```

Add the block above inside the `server { ... }` block that handles
`opendeck.ca` (likely the same one already serving the built frontend
from `dist/`), then:

```bash
sudo nginx -t                 # validates syntax before touching the live config
sudo systemctl reload nginx
```

## Verify it worked

```bash
curl -s https://opendeck.ca/webapp/health
```

This should now return **JSON** (or a 404 with a JSON body, if there's no
`/health` route defined - either is fine, the point is it's no longer
HTML). If you still get `index.html` back, nginx didn't pick up the
change - double check you edited the file `nginx -T` actually reported,
and that the `location /webapp/` block is inside the right `server {}`.

Once that's confirmed, re-run the two original commands from before - both
should now return real backend responses instead of the frontend's HTML,
and registration/login/deposits should work.

Or just run the whole checklist (webapp, sidebet-api, and the demo-page
redirects) in one shot:

```bash
./scripts/verify-webapp-routing.sh https://opendeck.ca
```
