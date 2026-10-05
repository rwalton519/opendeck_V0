const express = require('express');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

// FIXED: db/attachDb.js does `module.exports = attachDb` (a direct function
// export), but this was destructuring it as if it were a named export
// ({ attachDb }), which evaluates to undefined and crashes on
// `app.use(attachDb)` below. Found during verification of the other fixes
// in this pass - this was a pre-existing bug that stopped the server from
// booting at all, independent of anything else fixed here.
const attachDb = require('./db/attachDb');
const errorHandler = require('./middleware/errorHandler');

// -----------------------------------------------------------------
// Auth + Admin (auth is the REAL implementation - see backend_auth_patch)
// -----------------------------------------------------------------
const authRouter = require('./auth/routerAuth'); // prefix "/auth"
const accountRouter = require('./routers/account'); // prefix "/account"
const adminRouter = require('./admin/adminRouter'); // prefix "/admin"
// ADDED: backs public/admin/index.html (the Admin Dashboard). Same '/admin'
// prefix, same requireAdmin JWT auth as adminRouter above - see that
// file's header comment for why this is a second router rather than a
// second auth system.
const adminDashboardRouter = require('./admin/adminDashboardRouter');

// -----------------------------------------------------------------
// Wallet + Tournaments - REBUILT to match frontend_new/src/api/*.ts exactly.
// These replace every wallet/tournament router from every prior chunk.
// -----------------------------------------------------------------
const walletRouter = require('./routers/wallet'); // prefix "/wallet"
const walletWebhooksRouter = require('./routers/walletWebhooks'); // prefix "/wallet/webhooks" - mounted with raw body BEFORE express.json()
const walletStripeConnectRouter = require('./routers/walletStripeConnect'); // prefix "/wallet/stripe-connect"
// ADDED (USDC/Polygon integration): wallet linking + on-chain balance/history reads.
const walletOnchainRouter = require('./api/routes/walletOnchainRouter'); // prefix "/wallet/onchain"
const tournamentsRouter = require('./routers/tournaments'); // prefix "/tournaments"

// -----------------------------------------------------------------
// Everything else - unchanged from chunk2, no frontend contract mismatch
// was found for these, so left as originally converted.
// -----------------------------------------------------------------
const healthRouter = require('./routers/health');
const rngRouter = require('./routers/rng');
const gameRouter = require('./routers/game');
const complianceRouter = require('./routers/compliance_router'); // was an empty file - no routes
const kycRouter = require('./routers/kyc_router');
const paymentsRouter = require('./routers/payments_router');

// -----------------------------------------------------------------
// Cashgame + websocket - only ever existed in chunk1, no duplicate/conflict
// -----------------------------------------------------------------
const cashgameRouter = require('./api/routes/cashgameRouter'); // prefix "/cashgame"
const { attachWebSocketServer } = require('./api/routes/wsRouter');

// -----------------------------------------------------------------
// Cash Game Demo - unauthenticated, in-memory, play-money-only table used
// by public/cashgame-demo/index.html (frontend_new). No DB, no auth, no
// relation to the real cashgameRouter/wsRouter above - see
// routers/cashGameDemoRouter.js for why this uses SSE instead of the real
// table's websocket upgrade path.
// -----------------------------------------------------------------
const cashGameDemoRouter = require('./routers/cashGameDemoRouter'); // prefix "/cashgame-demo"
// Heads Up Demo - same unauthenticated/in-memory pattern as the cash game
// demo above (routers/demoTableRouter.js), just a 2-seat room. Shares the
// same DB-backed hand-history ledger (models/demo_hand_history.js),
// distinguished by room_key - see services/demo/createDemoRoom.js.
const headsUpDemoRouter = require('./routers/headsUpDemoRouter'); // prefix "/heads-up"
// Random Shuffle Test Table - same unauthenticated/in-memory pattern as the
// two demo tables above, but much simpler: no accounts, no seats to claim,
// no betting - see services/demo/rngShuffleTesterRoom.js. Shares the same
// DB-backed hand-history ledger (models/demo_hand_history.js), distinguished
// by room_key: 'rng-shuffle-tester'. Linked from the landing page as
// "Random Shuffle Test Table" at /RNG-shuffle-tester.
const rngShuffleTesterRouter = require('./routers/rngShuffleTesterRouter'); // prefix "/RNG-shuffle-tester"

// -----------------------------------------------------------------
// API docs (Swagger UI) - serves docs/api/openapi.yaml at GET /docs.
// Wrapped in try/catch so a missing/malformed spec file can never take
// the whole API down; a bad docs page is not worth the same blast radius
// as a bad route.
// -----------------------------------------------------------------
let swaggerDocsMiddleware = null;
try {
  // eslint-disable-next-line global-require
  const swaggerUi = require('swagger-ui-express');
  // eslint-disable-next-line global-require
  const YAML = require('yamljs');
  // eslint-disable-next-line global-require
  const path = require('path');
  const openapiDocument = YAML.load(path.join(__dirname, 'docs', 'api', 'openapi.yaml'));
  swaggerDocsMiddleware = { serve: swaggerUi.serve, setup: swaggerUi.setup(openapiDocument) };
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('[docs] Swagger UI not mounted:', err.message);
}

const app = express();

// This backend is always deployed behind nginx (see docs/ and the AWS
// runbook) - without this, req.ip on every route would just be nginx's own
// address (127.0.0.1), not the real client. `1` trusts exactly one hop of
// X-Forwarded-For (the immediate proxy in front of this process), which is
// correct for a single nginx reverse proxy and doesn't blindly trust an
// arbitrary chain of forwarded headers a client could otherwise spoof.
// Newly relevant as of the Admin Dashboard's IP tracking (see
// migrations/1745000700000_admin-dashboard.js) - nothing else in this
// backend depended on req.ip before now.
app.set('trust proxy', 1);

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','),
    credentials: true,
  })
);

// attachDb BEFORE the webhook route below, since it needs req.db and is
// mounted ahead of the global JSON parser.
app.use(attachDb);

// MUST be mounted before express.json() - this route needs the raw request
// body for Stripe signature verification (see routers/walletWebhooks.js).
// Its own express.raw() middleware consumes the body and fully handles the
// request, so express.json() below never runs for this specific path.
app.use('/wallet/webhooks', walletWebhooksRouter);

app.use(express.json());

app.use('/auth', authRouter);
app.use('/account', accountRouter);
app.use('/admin', adminRouter);
app.use('/admin', adminDashboardRouter);
app.use('/wallet', walletRouter);
app.use('/wallet/stripe-connect', walletStripeConnectRouter);
app.use('/wallet/onchain', walletOnchainRouter);
app.use('/tournaments', tournamentsRouter);

app.use('/', healthRouter);
app.use('/rng', rngRouter);
app.use('/game', gameRouter);
app.use('/', complianceRouter);
app.use('/', kycRouter);
app.use('/', paymentsRouter);
app.use('/cashgame', cashgameRouter);
app.use('/cashgame-demo', cashGameDemoRouter);
app.use('/heads-up', headsUpDemoRouter);
app.use('/RNG-shuffle-tester', rngShuffleTesterRouter);

// GET /docs - interactive API documentation (Swagger UI over
// docs/api/openapi.yaml). Also serve the raw spec at /docs/openapi.yaml so
// it can be pointed to directly (e.g. imported into Postman/Insomnia).
if (swaggerDocsMiddleware) {
  app.use('/docs', swaggerDocsMiddleware.serve, swaggerDocsMiddleware.setup);
  app.get('/docs/openapi.yaml', (req, res) => {
    res.sendFile(require('path').join(__dirname, 'docs', 'api', 'openapi.yaml'));
  });
}

app.use(errorHandler);

const PORT = process.env.PORT || 8000;
const server = http.createServer(app);

attachWebSocketServer(server, () => require('./db/sequelize'));

const { syncModels } = require('./db/syncModels');

syncModels()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`transparent_poker backend (merged) listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] Failed to sync models - is Postgres running and DATABASE_URL correct?', err);
    process.exit(1);
  });

module.exports = app;
