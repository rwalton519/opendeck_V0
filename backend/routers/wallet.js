const express = require('express');
const router = express.Router();

// NOTE: this file REPLACES four previously-delivered, mutually-inconsistent
// router files: chunk1's api/routes/walletRouter.js + paymentRouter.js, and
// chunk2's routers/wallet.js + routers/wallet_router.js. None of those
// matched frontend_new/src/api/wallet.ts's actual contract (different
// paths, different request/response shapes). This was built directly
// against that file instead of against the Python source, since the
// frontend is the actual consumer that has to work.

const WalletManager = require('../services/wallet/walletManager');
const Ledger = require('../services/wallet/ledger');
const PaymentManager = require('../services/payments/paymentManager');
const USDCWallet = require('../services/wallet/usdcWallet');
const CryptoService = require('../services/payments/cryptoService');
const { PaymentMethod, WithdrawalRequest } = require('../models/real_money');
const { METHOD_TO_PROVIDER, PAYMENT_METHOD_CAPABILITIES } = require('../utils/paymentMethods');

// ADDED (spec §8.5 / §12 - "audit end-to-end which money-movement routes
// actually invoke the compliance rule engine"): ComplianceManager.runChecks
// was already wired into cash-game/tournament buy-ins
// (services/game/buyinManager.js) but not into wallet deposits or
// withdrawals - the two routes where real money actually enters or leaves
// the platform. Wired in below, matching the exact same fire-and-forget
// pattern buyinManager.js already uses (flags are recorded for review, not
// used to block the request inline - that's this codebase's existing
// design for these rules, not something changed here).
const ComplianceManager = require('../services/compliance/complianceManager');
const User = require('../models/user');
const { requireUser } = require('../auth/requireUser');

const { HttpError } = require('../utils/errors');

const usdcWallet = new USDCWallet();
const cryptoService = new CryptoService();

function requireUserId(source) {
  const userId = source.user_id;
  if (!userId) {
    throw new HttpError(400, 'user_id is required');
  }
  return String(userId);
}

function requireCurrentUserId(req, source) {
  const userId = requireUserId(source);
  if (!req.user || String(req.user.id) !== userId) {
    throw new HttpError(403, 'user_id must match the authenticated user');
  }
  return userId;
}

function requirePositiveAmount(body) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError(400, 'amount must be a positive number');
  }
  return amount;
}

// ADDED: shared by both /deposit and /withdraw below. Mirrors
// services/game/buyinManager.js's existing `await ComplianceManager.runChecks(db, userId, amount)`
// call exactly - same fire-and-forget-to-storage pattern (flags get written
// for later review; a triggered rule does not by itself block the request,
// consistent with how this engine already behaves for buy-ins). Also
// passes the user's username through for SanctionsRules' name-based check,
// which buyinManager.js's call sites don't have readily available but this
// router does.
async function runComplianceChecks(db, userId, amount) {
  const user = await User.findByPk(userId).catch(() => null);
  await ComplianceManager.runChecks(db, userId, amount, user ? user.username : null);
}

// ---------------------------------------------------------------
// GET /wallet/balance?user_id=X -> { balance: number }
// ---------------------------------------------------------------
router.get('/balance', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.query);
    const balance = await WalletManager.getBalance(req.db, userId);
    res.json({ balance: parseFloat(balance.available) });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /wallet/transactions?user_id=X -> { transactions: WalletTransaction[] }
// ---------------------------------------------------------------
// Sourced from the Ledger (services/wallet/ledger.js), which this router
// writes to on every settled deposit/withdrawal below. The Ledger/
// WalletTransaction model has no `status` column, so every row returned
// here is stamped "succeeded" - by design, this router only ever writes a
// ledger entry once a movement has actually settled (see deposit/withdraw
// handlers), never at the pending/frozen stage, so that's accurate rather
// than a shortcut.
router.get('/transactions', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.query);
    const rows = await Ledger.getUserTransactions(req.db, userId, 100);

    res.json({
      transactions: rows.map((r) => ({
        id: String(r.id),
        type: r.type,
        amount: parseFloat(r.amount),
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : null,
        status: 'succeeded',
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /wallet/payment-methods/capabilities
// ---------------------------------------------------------------
// ADDED (spec §6.2-6.3 / §12): lets a client discover, up front, which
// payment methods actually have real deposit/withdrawal support right now,
// instead of only finding out by getting a 501 back from /deposit or
// /withdraw. Reads from utils/paymentMethods.js's PAYMENT_METHOD_CAPABILITIES,
// which is the single source of truth this endpoint and the reject-paths
// below both use - if real capability for a method changes, only that file
// needs to change.
router.get('/payment-methods/capabilities', (req, res) => {
  res.json({ methods: PAYMENT_METHOD_CAPABILITIES });
});

// ---------------------------------------------------------------
// POST /wallet/deposit { user_id, amount, method } -> PaymentResult
// ---------------------------------------------------------------
// REWORKED: this used to instantly refresh + credit on every deposit,
// which only ever "worked" because the old provider stubs always claimed
// "completed" the instant you asked. Real card payments are asynchronous -
// creating a Stripe PaymentIntent does NOT mean the customer has paid yet.
// Now:
//   - card/debit/square/eWallet (-> stripe): creates a real PaymentIntent
//     and returns its client_secret. The frontend must complete payment
//     client-side (Stripe Elements + confirmCardPayment). The wallet is
//     credited by POST /wallet/webhooks/stripe below, NOT here.
//   - bankTransfer/eTransfer (-> ach): honestly rejected - see
//     providerAch.js for exactly what's missing (bank-account linking flow).
//   - cryptoBtc/cryptoEth/cryptoMonero/cryptoOther (-> crypto): honestly
//     rejected - crypto uses the separate address-based flow below
//     (GET /wallet/crypto-deposit-address + POST /wallet/crypto-deposit-confirm).
router.post('/deposit', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.body);
    const amount = requirePositiveAmount(req.body);
    const method = req.body.method;
    const provider = METHOD_TO_PROVIDER[method];

    if (!provider) {
      throw new HttpError(400, `Unsupported payment method: ${method}`);
    }

    // FIXED (spec §8.5 / §12): this route moves real money into the
    // platform and previously never invoked the compliance rule engine at
    // all - see the runComplianceChecks() comment above for exactly what
    // this does and does not do (it flags for review; it does not block).
    await runComplianceChecks(req.db, userId, amount);

    const { record, providerResult } = await PaymentManager.deposit(req.db, userId, amount, provider);

    if (provider === 'stripe') {
      return res.json({
        success: true,
        message: 'Payment initiated - complete it on the client using the returned client secret.',
        transactionId: String(record.id),
        data: { method, provider, client_secret: providerResult.client_secret },
      });
    }

    // ach/crypto providers throw before getting here (see their
    // createDeposit() implementations) - this line only exists in case a
    // future provider genuinely does complete synchronously.
    res.json({ success: true, message: 'Deposit initiated.', transactionId: String(record.id), data: { method, provider } });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// NOTE: the Stripe webhook handler used to live here, but it CANNOT -
// signature verification (stripeService.constructWebhookEvent) needs the
// exact raw request bytes, and by the time a request reaches this router
// it's already been through server.js's global express.json() middleware,
// which replaces req.body with a parsed object (the raw bytes are gone by
// then). Moved to routers/walletWebhooks.js, mounted in server.js BEFORE
// the global JSON parser, with its own express.raw() middleware.

// ---------------------------------------------------------------
// POST /wallet/withdraw { user_id, amount, method } -> PaymentResult
// ---------------------------------------------------------------
// Withdrawals do NOT settle immediately - funds are frozen
// (WalletManager.freeze, the same mechanism used for cashgame/tournament
// buy-ins) and a WithdrawalRequest row is created for admin review via
// GET/POST /admin/withdrawals/*. This matches how a real-money platform
// should handle outbound transfers (admin sign-off before money leaves),
// and is why the response says "submitted for approval" rather than
// "completed".
router.post('/withdraw', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.body);
    const amount = requirePositiveAmount(req.body);
    const method = req.body.method;
    const provider = METHOD_TO_PROVIDER[method];

    if (!provider) {
      throw new HttpError(400, `Unsupported payment method: ${method}`);
    }

    // ADDED: a real crypto payout needs a destination address, and there
    // was previously nowhere to collect one. Not part of
    // frontend_new/src/api/wallet.ts's current `withdraw(userId, amount,
    // method)` signature - the frontend needs an `address` param added for
    // crypto methods once it's ready to use this for real. Only required
    // for cryptoMonero specifically, since that's the only crypto method
    // with a real payout implementation to actually send it through (see
    // utils/paymentMethods.js's REAL_PAYOUT_CRYPTO_METHODS).
    const destinationAddress = req.body.address || null;
    if (method === 'cryptoMonero' && !destinationAddress) {
      throw new HttpError(400, 'A destination address is required for Monero withdrawals.');
    }

    // Throws "Insufficient funds to freeze" if the user doesn't have enough
    // available balance - caught below and turned into a normal
    // success:false response rather than a 500.
    await WalletManager.freeze(req.db, userId, amount, `withdraw_pending:${method}`);

    // FIXED (spec §8.5 / §12): this route moves real money out of the
    // platform and previously never invoked the compliance rule engine at
    // all. Run after freeze() rather than before - if the freeze itself
    // fails (insufficient funds), there's no withdrawal to screen yet, and
    // this ordering avoids leaving a compliance flag for a withdrawal that
    // never actually got created.
    await runComplianceChecks(req.db, userId, amount);

    const withdrawal = await WithdrawalRequest.create({
      user_id: userId,
      amount,
      provider: method, // store the specific method (e.g. "cryptoBtc"), not the collapsed provider
      status: 'pending',
      created_at: new Date(),
      destination_address: destinationAddress,
    });

    res.json({
      success: true,
      message: 'Withdrawal request submitted for approval.',
      transactionId: String(withdrawal.id),
      data: { status: 'pending', method },
    });
  } catch (err) {
    if (err.message === 'Insufficient funds to freeze') {
      return res.json({ success: false, message: 'Insufficient balance for this withdrawal.' });
    }
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// GET /wallet/deposit-status?transactionId=X&user_id=Y
// ---------------------------------------------------------------
// Exposes the PaymentManager.refreshStatus() path that already exists in
// services/payments/paymentManager.js. The previous API forced clients to
// infer payment completion by polling the aggregate wallet balance. The
// transaction id is scoped to the authenticated user before any provider
// status lookup occurs.
router.get('/deposit-status', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.query);
    const transactionId = Number(req.query.transactionId || req.query.transaction_id);
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      throw new HttpError(400, 'transactionId is required and must be a positive integer');
    }

    const record = await PaymentManager.refreshStatus(req.db, transactionId, userId);
    res.json({
      transactionId: String(record.id),
      status: record.status,
      provider: record.provider,
      amount: parseFloat(record.amount),
      external_id: record.external_id,
      created_at: record.created_at ? new Date(record.created_at).toISOString() : null,
      updated_at: record.updated_at ? new Date(record.updated_at).toISOString() : null,
    });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// GET /wallet/crypto-deposit-address?asset=X&user_id=Y
// ---------------------------------------------------------------
// Only ETH (services/wallet/usdcWallet.js, ethers-based) and XMR
// (services/payments/cryptoService.js, monero-wallet-rpc) have a real
// address-generation backend anywhere in any chunk. BTC and any other
// asset return a 501 rather than a fabricated address - matches the
// frontend's own comment in api/wallet.ts acknowledging this endpoint may
// need to surface a real error state.
//
// Addresses are generated once per (user, asset) and persisted on the
// PaymentMethod model, not regenerated on every call - a wallet address
// needs to stay stable for a given user or deposits sent to an old address
// would be lost.
router.get('/crypto-deposit-address', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.query);
    const asset = String(req.query.asset || '').toUpperCase();

    if (asset !== 'ETH' && asset !== 'XMR') {
      throw new HttpError(501, `${asset} deposits are not yet supported.`);
    }

    const providerKey = `crypto_${asset}`;
    let method = await PaymentMethod.findOne({
      where: { user_id: userId, provider: providerKey, active: true },
    });

    if (!method) {
      let address;
      if (asset === 'ETH') {
        address = usdcWallet.createWallet().address;
      } else {
        const result = await cryptoService.generateDepositAddress(userId, 'XMR');
        address = result.address;
      }

      method = await PaymentMethod.create({
        user_id: userId,
        provider: providerKey,
        details: address,
        active: true,
      });
    }

    res.json({ asset, address: method.details });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// GET /wallet/crypto-deposit-status?asset=X&user_id=Y
// ---------------------------------------------------------------
// FLAGGED STUB: no automatic blockchain monitoring exists (nothing watches
// a generated address for incoming transactions on its own). This always
// reports unconfirmed. See POST /wallet/crypto-deposit-confirm below for
// the real (but manually-triggered) confirmation + crediting path - full
// automation would mean either a provider webhook (Circle/MoonPay, both
// already have client wrappers in services/payments/) or a polling worker
// against the relevant chain, neither of which exists yet.
router.get('/crypto-deposit-status', requireUser, async (req, res, next) => {
  try {
    requireCurrentUserId(req, req.query);
    res.json({ confirmed: false });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// POST /wallet/crypto-deposit-confirm { user_id, asset, txid }
// ---------------------------------------------------------------
// NEW - not part of frontend_new/src/api/wallet.ts's current contract
// (there's no call site for this yet), added so a crypto deposit can
// actually be verified and credited by SOMETHING real, rather than crypto
// deposits being entirely decorative. Checks a real transaction id against
// monero-wallet-rpc (services/payments/cryptoService.js) and credits the
// wallet once it has enough confirmations. Only XMR is supported - that's
// the only asset with a real confirmation-checking implementation anywhere
// in this codebase (ETH/BTC have none).
//
// Idempotency: guards against crediting the same txid twice by checking
// the ledger for an existing entry referencing it before crediting.
router.post('/crypto-deposit-confirm', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.body);
    const asset = String(req.body.asset || '').toUpperCase();
    const txid = req.body.txid;

    if (asset !== 'XMR') {
      throw new HttpError(501, `Confirmation checking for ${asset} is not yet supported (only XMR).`);
    }
    if (!txid) {
      throw new HttpError(400, 'txid is required');
    }

    const result = await cryptoService.checkConfirmations(txid);

    if (result.status === 'error') {
      throw new HttpError(502, `Failed to check transaction: ${result.message}`);
    }
    if (result.status !== 'confirmed') {
      return res.json({ confirmed: false, confirmations: result.confirmations || 0 });
    }

    const reference = `crypto_deposit:${asset}:${txid}`;
    const alreadyCredited = await Ledger.getUserTransactions(req.db, userId, 500).then((rows) =>
      rows.some((r) => r.reference === reference)
    );

    if (!alreadyCredited) {
      await WalletManager.credit(req.db, userId, result.amount, reference, 'deposit');
    }

    res.json({ confirmed: true, amount: result.amount, confirmations: result.confirmations });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
