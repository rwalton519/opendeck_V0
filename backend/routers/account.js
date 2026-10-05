const express = require('express');
const router = express.Router();

const { requireUser } = require('../auth/requireUser');
const WalletManager = require('../services/wallet/walletManager');
const Ledger = require('../services/wallet/ledger');
const { PaymentRecord, PaymentStatus } = require('../models/payment_models');
// ADDED (USDC/Polygon integration): on-chain wallet link + transaction
// history, merged into the same dashboard response so req #3's "wallet
// balances and states (locked/released) and previous debits and credits"
// covers on-chain activity too, not just the fiat ledger.
const OnchainRakeService = require('../services/blockchain/onchainRakeService');

/**
 * GET /account/dashboard
 *
 * Single authenticated read for the user's account dashboard. Identity is
 * taken from the JWT, never from a user_id query/body parameter.
 */
router.get('/dashboard', requireUser, async (req, res, next) => {
  try {
    const user = req.user;
    const balance = await WalletManager.getBalance(req.db, String(user.id));
    const [transactions, paymentRecords, onchain] = await Promise.all([
      Ledger.getUserTransactions(req.db, String(user.id), 200),
      PaymentRecord.findAll({
        where: { user_id: String(user.id) },
        order: [['created_at', 'DESC']],
        limit: 200,
      }),
      OnchainRakeService.getWalletSummary(req.db, String(user.id)),
    ]);

    // PaymentRecord is the source of truth for deposit lifecycle state
    // (pending/completed/failed). The ledger only contains movements that
    // have actually settled into the wallet, so use it to calculate the
    // amount successfully deposited.
    const deposits = paymentRecords.map((row) => ({
      id: String(row.id),
      amount: Number(row.amount),
      status: String(row.status || PaymentStatus.pending),
      provider: row.provider,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
      reference: row.external_id || `payment_record:${row.id}`,
    }));

    const totalDeposited = transactions
      .filter((row) => String(row.type).toLowerCase() === 'deposit')
      .reduce((sum, row) => sum + Number(row.amount), 0);

    // ADDED: the full off-chain ledger, previously fetched but never
    // actually returned to the client - see the note above WalletManager's
    // credit/debit/freeze/unfreeze/finalizeLocked methods for the matching
    // backend-side fix that made this data worth exposing (before that fix,
    // every real-money movement except a Stripe card deposit was invisible
    // here even if this array had been wired up).
    const ledger = transactions.map((row) => ({
      id: String(row.id),
      amount: Number(row.amount),
      type: row.type,
      reference: row.reference,
      timestamp: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));

    res.json({
      user: {
        id: String(user.id),
        username: user.username,
        email: user.email,
      },
      balance: {
        available: Number(balance.available),
        locked: Number(balance.locked),
        total: Number(balance.available) + Number(balance.locked),
      },
      deposits,
      totalDeposited,
      ledger,
      onchain,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
