const express = require('express');
const router = express.Router();

// NEW FILE. Stripe Connect onboarding endpoints - a user needs a connected
// account, and needs to actually complete Stripe's hosted onboarding (ID
// verification, bank account details) before a real payout can reach them.
// Nothing in frontend_new/src/api/*.ts calls these yet - they need to be
// added to the frontend (e.g. a "Set up payouts" button on the wallet page
// that redirects to the URL this returns).

const StripeService = require('../services/payments/stripeService');
const { PaymentMethod } = require('../models/real_money');
const { HttpError } = require('../utils/errors');
const { requireUser } = require('../auth/requireUser');

const stripeService = new StripeService();

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

/**
 * Finds or creates the user's Stripe Connect account, stored on the
 * PaymentMethod model (provider: "stripe_connect", details: account id) -
 * same pattern already used for persisting crypto deposit addresses.
 */
async function getOrCreateConnectAccount(userId, email) {
  let method = await PaymentMethod.findOne({
    where: { user_id: userId, provider: 'stripe_connect', active: true },
  });

  if (!method) {
    const accountId = await stripeService.createConnectedAccount(userId, email);
    method = await PaymentMethod.create({
      user_id: userId,
      provider: 'stripe_connect',
      details: accountId,
      active: true,
    });
  }

  return method.details; // the Stripe account id
}

// ---------------------------------------------------------------
// POST /wallet/stripe-connect/onboard { user_id, email, refresh_url, return_url }
// -> { url } - a Stripe-hosted onboarding link. Redirect the user's browser
// to this URL; Stripe handles ID verification and bank account collection.
// ---------------------------------------------------------------
router.post('/onboard', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.body);
    const email = req.body.email || req.user.email;
    if (!email) {
      throw new HttpError(400, 'email is required to create a Stripe Connect account');
    }

    // Stripe requires real URLs to redirect back to after onboarding -
    // these should point at your actual frontend. No sensible default
    // exists here (this backend doesn't know its frontend's real domain in
    // every environment), so they're required inputs rather than guessed.
    const refreshUrl = req.body.refresh_url;
    const returnUrl = req.body.return_url;
    if (!refreshUrl || !returnUrl) {
      throw new HttpError(400, 'refresh_url and return_url are required (where Stripe should send the user back to)');
    }

    const accountId = await getOrCreateConnectAccount(userId, email);
    const url = await stripeService.createOnboardingLink(accountId, refreshUrl, returnUrl);

    res.json({ url });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// ---------------------------------------------------------------
// GET /wallet/stripe-connect/status?user_id=X
// -> { onboarded: boolean, payouts_enabled, charges_enabled, details_submitted }
// ---------------------------------------------------------------
router.get('/status', requireUser, async (req, res, next) => {
  try {
    const userId = requireCurrentUserId(req, req.query);

    const method = await PaymentMethod.findOne({
      where: { user_id: userId, provider: 'stripe_connect', active: true },
    });

    if (!method) {
      return res.json({ onboarded: false, payouts_enabled: false, charges_enabled: false, details_submitted: false });
    }

    const status = await stripeService.getAccountStatus(method.details);
    res.json({ onboarded: status.payouts_enabled, ...status });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
