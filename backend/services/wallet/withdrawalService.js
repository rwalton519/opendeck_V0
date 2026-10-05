const WalletManager = require('./walletManager');
const Ledger = require('./ledger');
const { WithdrawalRequest } = require('../../models/real_money');
const StripeProvider = require('../payments/providerStripe');
const CryptoService = require('../payments/cryptoService');
const { METHOD_TO_PROVIDER, REAL_PAYOUT_CRYPTO_METHODS } = require('../../utils/paymentMethods');
const { HttpError } = require('../../utils/errors');

const cryptoService = new CryptoService();

// -----------------------------------------------------------------
// ADDED (spec recommendation §5.7 / §9 / §12): this is the withdrawal
// approve/reject logic that previously only existed inline inside
// POST /admin/withdrawals/approve and /admin/withdrawals/reject in
// admin/adminRouter.js. It's extracted here for one reason: this codebase
// had a SECOND, separate admin payout flow - POST /admin/approve_payout and
// /admin/reject_payout - that called ComplianceManager.approvePayout() /
// rejectPayout(), methods that were never actually implemented anywhere and
// would throw at runtime.
//
// Rather than inventing a second, parallel payout mechanism to back those
// legacy routes with (which would mean TWO different code paths capable of
// releasing frozen user funds - a real risk on a real-money platform),
// both admin/adminRouter.js's withdrawal-queue endpoints AND the legacy
// approve_payout/reject_payout endpoints now call this single shared
// implementation. `payoutId` from the legacy routes and `id` from the
// withdrawal-queue routes both refer to the same WithdrawalRequest primary
// key - there was never a second, distinct "payout" model in this codebase
// for the legacy routes to have been operating on.
// -----------------------------------------------------------------

/**
 * Approves a pending WithdrawalRequest: attempts a real payout where a real
 * payout mechanism exists (Stripe Connect transfer, Monero send), and
 * otherwise finalizes the internal ledger lock only (this codebase's
 * existing, pre-existing behavior for ACH and non-Monero crypto - see
 * utils/paymentMethods.js). Never silently reports success as if a real
 * transfer happened when it didn't.
 */
async function approveWithdrawal(db, withdrawalId) {
  const withdrawal = await WithdrawalRequest.findByPk(withdrawalId);

  if (!withdrawal) {
    throw new HttpError(404, 'Withdrawal request not found');
  }
  if (withdrawal.status !== 'pending') {
    throw new HttpError(400, `Withdrawal is already ${withdrawal.status}`);
  }

  const method = withdrawal.provider; // e.g. "card", "cryptoMonero"
  const providerGroup = METHOD_TO_PROVIDER[method];
  const amount = parseFloat(withdrawal.amount);

  let payoutReference = null;
  let realPayoutAttempted = false;
  let realPayoutMessage = 'Approved internally only - no real transfer was sent (see below).';

  if (providerGroup === 'stripe') {
    realPayoutAttempted = true;
    try {
      const result = await new StripeProvider().createWithdrawal(withdrawal.user_id, amount);
      payoutReference = result.external_id;
      realPayoutMessage = `Real Stripe transfer sent (transfer id: ${payoutReference}).`;
    } catch (err) {
      withdrawal.failure_reason = err.message;
      await withdrawal.save();
      throw new HttpError(err.statusCode || 502, `Real payout failed: ${err.message}`);
    }
  } else if (REAL_PAYOUT_CRYPTO_METHODS.has(method) && withdrawal.destination_address) {
    realPayoutAttempted = true;
    const result = await cryptoService.sendWithdrawal(withdrawal.user_id, amount, withdrawal.destination_address);

    if (result.status === 'error') {
      withdrawal.failure_reason = result.message;
      await withdrawal.save();
      throw new HttpError(502, `Real payout failed: ${result.message}`);
    }

    payoutReference = result.txid;
    realPayoutMessage = `Real Monero transaction sent (txid: ${payoutReference}).`;
  }

  await WalletManager.finalizeLocked(db, withdrawal.user_id, amount, `withdrawal_approved:${withdrawal.id}`);
  await Ledger.addEntry(db, withdrawal.user_id, amount, 'withdrawal', `withdrawal_request:${withdrawal.id}`);

  withdrawal.status = 'paid';
  withdrawal.payout_reference = payoutReference;
  withdrawal.failure_reason = null;
  await withdrawal.save();

  return {
    status: 'ok',
    real_payout_attempted: realPayoutAttempted,
    payout_reference: payoutReference,
    message: realPayoutMessage,
  };
}

/**
 * Rejects a pending WithdrawalRequest and returns the frozen funds to the
 * user's available balance.
 */
async function rejectWithdrawal(db, withdrawalId) {
  const withdrawal = await WithdrawalRequest.findByPk(withdrawalId);

  if (!withdrawal) {
    throw new HttpError(404, 'Withdrawal request not found');
  }
  if (withdrawal.status !== 'pending') {
    throw new HttpError(400, `Withdrawal is already ${withdrawal.status}`);
  }

  await WalletManager.unfreeze(
    db,
    withdrawal.user_id,
    parseFloat(withdrawal.amount),
    `withdrawal_rejected:${withdrawal.id}`
  );

  withdrawal.status = 'rejected';
  withdrawal.failure_reason = null;
  await withdrawal.save();

  return { status: 'ok' };
}

module.exports = { approveWithdrawal, rejectWithdrawal };
