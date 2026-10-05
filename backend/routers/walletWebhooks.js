const express = require('express');
const router = express.Router();

// NEW FILE. Mounted separately in server.js, BEFORE the global
// express.json() middleware, specifically so this route can use
// express.raw() instead - Stripe webhook signature verification
// (stripeService.constructWebhookEvent) needs the exact raw request bytes
// Stripe signed, not a re-serialized JSON object. Once express.json() (or
// any body parser) has consumed the request stream, the original raw bytes
// are gone and signature verification will always fail.
//
// This is what actually credits a user's wallet for a real card deposit -
// routers/wallet.js's POST /deposit only ever CREATES a Stripe PaymentIntent
// and returns a client_secret; the payment isn't real/complete until Stripe
// tells us so via this webhook.

const WalletManager = require('../services/wallet/walletManager');
const StripeService = require('../services/payments/stripeService');
const { PaymentRecord, PaymentStatus } = require('../models/payment_models');

const stripeService = new StripeService();

router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, req.headers['stripe-signature']);
  } catch (err) {
    console.error('[stripe webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;

    try {
      const record = await PaymentRecord.findOne({ where: { external_id: intent.id } });

      if (!record) {
        console.error(`[stripe webhook] no PaymentRecord found for PaymentIntent ${intent.id}`);
        return res.status(200).send('ok'); // ack anyway - nothing to retry into
      }

      // IDEMPOTENCY: Stripe retries webhook delivery until it gets a 2xx.
      // Without this check, a retried delivery would credit the wallet
      // twice for the same real-world payment.
      if (record.status === PaymentStatus.completed) {
        return res.status(200).send('ok');
      }

      record.status = PaymentStatus.completed;
      record.updated_at = new Date();
      await record.save();

      await WalletManager.credit(req.db, record.user_id, parseFloat(record.amount), `payment_record:${record.id}`, 'deposit');
    } catch (err) {
      console.error('[stripe webhook] failed to credit wallet:', err);
      return res.status(500).send('Internal error crediting wallet');
    }
  }

  res.status(200).send('ok');
});

module.exports = router;
