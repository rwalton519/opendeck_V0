const express = require('express');
const router = express.Router();

const PaymentManager = require('../services/payments/paymentManager');
const { HttpError } = require('../utils/errors');

// Converted from routers/payments_router.py -> APIRouter() with NO prefix
// (route declares its own full path "/payments/deposit").
//
// `user_id: str, amount: float` with no path placeholders -> FastAPI binds
// both as required QUERY parameters, not a JSON body. Kept as query params
// here too, for backward compatibility with whatever still calls this
// legacy path this way.
//
// DEPRECATED - this is a legacy leftover from an earlier conversion chunk.
// The canonical, frontend-contract-matching endpoint is POST /wallet/deposit
// (routers/wallet.js, JSON body: { user_id, amount, method }). New
// integration work - including the frontend card-deposit UI referenced in
// the Frontend Executive Summary v2.0 - should call that instead. This
// route is kept only so nothing that already hits this exact path breaks.
//
// PRE-EXISTING BUG FIXED HERE: this used to call
// stripeService.createDepositIntent() directly, bypassing PaymentManager
// entirely. That meant no PaymentRecord row was ever created for the
// PaymentIntent it made. POST /wallet/webhooks/stripe - the only thing that
// actually credits a wallet once a card payment succeeds - looks up a
// PaymentRecord by Stripe's PaymentIntent id. With no record to find, a
// real customer charge made through this endpoint would succeed on
// Stripe's side while the user's wallet balance silently never moved.
// Rewired below to go through PaymentManager.deposit() - the exact same
// code path POST /wallet/deposit uses - so a PaymentRecord always exists
// for the webhook to find, and the response shape matches /wallet/deposit
// exactly (see docs/DEPOSIT_CARD_PAYMENT_CONTRACT.md for the full contract
// this now guarantees).

// POST /payments/deposit?user_id=...&amount=...
router.post('/payments/deposit', async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    const amount = Number(req.query.amount);

    if (!userId) {
      throw new HttpError(400, 'user_id is required');
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpError(400, 'amount must be a positive number');
    }

    const { record, providerResult } = await PaymentManager.deposit(req.db, userId, amount, 'stripe');

    res.json({
      success: true,
      message: 'Payment initiated - complete it on the client using the returned client secret.',
      transactionId: String(record.id),
      data: { method: 'card', provider: 'stripe', client_secret: providerResult.client_secret },
    });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
