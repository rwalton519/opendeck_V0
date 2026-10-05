const express = require('express');
const router = express.Router();

const requireAdmin = require('./adminPermissions');
const User = require('../models/user');
const { WalletBalance, WalletTransaction, WithdrawalRequest } = require('../models/real_money');
const ComplianceFlag = require('../models/compliance_models');
const { requireInt } = require('../utils/validation');
const { HttpError } = require('../utils/errors');

/**
 * Backs public/admin/index.html (the Admin Dashboard). Mounted at the same
 * '/admin' prefix as admin/adminRouter.js (see server.js) - this is a
 * second router under that prefix, not a parallel auth system: every route
 * here uses the exact same requireAdmin JWT middleware, so the dashboard's
 * login page is just a client for the EXISTING POST /admin/login.
 *
 * None of this reuses admin/adminRouter.js's existing GET /ledger/:user_id
 * or the freeze/unfreeze/withdrawal routes - those stay exactly where they
 * are and the dashboard calls them directly. This file only adds the
 * aggregate/cross-user views nothing else needed before: a global ledger,
 * an accounts list, and fraud-flag review.
 *
 * No formal Sequelize association exists between User and
 * WalletBalance/WalletTransaction/ComplianceFlag (none of those models
 * declare belongsTo/hasMany anywhere in this codebase - grepped to check
 * before writing this). Their user_id columns are also STRING while
 * User.id is an auto-increment INTEGER, so joins below are done as
 * separate queries + an in-memory lookup map (String(user.id) as the key)
 * rather than a Sequelize `include`, which would require adding
 * associations this codebase has never used for these tables.
 */

const toNum = (v) => (v == null ? 0 : parseFloat(v));

// ---------------------------------------------------------------
// GET /admin/dashboard/summary
// ---------------------------------------------------------------
router.get('/dashboard/summary', requireAdmin, async (req, res, next) => {
  try {
    const [userCount, frozenCount, pendingWithdrawals, openFlags, balances, deposits, withdrawals] =
      await Promise.all([
        User.count(),
        User.count({ where: { is_frozen: true } }),
        WithdrawalRequest.count({ where: { status: 'pending' } }),
        ComplianceFlag.count({ where: { resolved: false } }),
        WalletBalance.findAll({ attributes: ['available', 'locked'] }),
        WalletTransaction.sum('amount', { where: { type: 'deposit' } }),
        WalletTransaction.sum('amount', { where: { type: 'withdrawal' } }),
      ]);

    const totalHeld = balances.reduce((sum, b) => sum + toNum(b.available) + toNum(b.locked), 0);

    res.json({
      total_users: userCount,
      frozen_accounts: frozenCount,
      pending_withdrawals: pendingWithdrawals,
      open_fraud_flags: openFlags,
      total_balance_held: totalHeld,
      total_deposits: toNum(deposits),
      total_withdrawals: toNum(withdrawals),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/dashboard/ledger?limit=100&offset=0
// Every debit/credit across every user, newest first - deposits and
// withdrawals as requested, plus whatever other entry types exist
// (buyin/payout - see services/game/buyinManager.js) since those are real
// movements too and hiding them would make this an incomplete ledger.
// ---------------------------------------------------------------
router.get('/dashboard/ledger', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Number(req.query.offset) || 0;

    const rows = await WalletTransaction.findAll({
      order: [['created_at', 'DESC']],
      limit,
      offset,
    });

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = await User.findAll({ where: { id: userIds }, attributes: ['id', 'username'] });
    const usernameById = new Map(users.map((u) => [String(u.id), u.username]));

    res.json(
      rows.map((r) => ({
        id: String(r.id),
        user_id: r.user_id,
        username: usernameById.get(String(r.user_id)) || null,
        type: r.type, // deposit, withdrawal, buyin, payout
        direction: r.type === 'deposit' || r.type === 'payout' ? 'credit' : 'debit',
        amount: toNum(r.amount),
        reference: r.reference,
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : null,
      }))
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/dashboard/accounts
// uid, username, email, IP (signup + last login), total deposits,
// current balance, frozen status, open fraud-flag count per account.
// ---------------------------------------------------------------
router.get('/dashboard/accounts', requireAdmin, async (req, res, next) => {
  try {
    const users = await User.findAll({
      attributes: [
        'id', 'username', 'email', 'is_frozen',
        'signup_ip', 'last_login_ip', 'last_login_at',
      ],
      order: [['id', 'ASC']],
    });
    const userIds = users.map((u) => String(u.id));

    const [balances, deposits, flagCounts] = await Promise.all([
      WalletBalance.findAll({ where: { user_id: userIds } }),
      WalletTransaction.findAll({
        where: { user_id: userIds, type: 'deposit' },
        attributes: ['user_id', 'amount'],
      }),
      ComplianceFlag.findAll({
        where: { user_id: userIds, resolved: false },
        attributes: ['user_id'],
      }),
    ]);

    const balanceByUser = new Map(balances.map((b) => [String(b.user_id), b]));
    const depositTotalByUser = new Map();
    for (const tx of deposits) {
      const key = String(tx.user_id);
      depositTotalByUser.set(key, (depositTotalByUser.get(key) || 0) + toNum(tx.amount));
    }
    const flagCountByUser = new Map();
    for (const f of flagCounts) {
      const key = String(f.user_id);
      flagCountByUser.set(key, (flagCountByUser.get(key) || 0) + 1);
    }

    res.json(
      users.map((u) => {
        const key = String(u.id);
        const bal = balanceByUser.get(key);
        return {
          uid: key,
          username: u.username,
          email: u.email,
          signup_ip: u.signup_ip,
          last_login_ip: u.last_login_ip,
          last_login_at: u.last_login_at ? new Date(u.last_login_at).toISOString() : null,
          is_frozen: u.is_frozen,
          balance_available: bal ? toNum(bal.available) : 0,
          balance_locked: bal ? toNum(bal.locked) : 0,
          total_deposits: depositTotalByUser.get(key) || 0,
          open_fraud_flags: flagCountByUser.get(key) || 0,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// GET /admin/dashboard/fraud-flags?resolved=false
// Backed by the existing ComplianceFlag rows ComplianceManager.runChecks()
// already writes on every deposit/withdrawal/buy-in (services/compliance/*)
// - "flagged for potential fraud" is exactly what an unresolved flag here
// means. Freezing the account uses the EXISTING POST /admin/freeze_user,
// not a new endpoint.
// ---------------------------------------------------------------
router.get('/dashboard/fraud-flags', requireAdmin, async (req, res, next) => {
  try {
    const resolvedParam = req.query.resolved;
    const where = resolvedParam === undefined ? {} : { resolved: resolvedParam === 'true' };

    const rows = await ComplianceFlag.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: 200,
    });

    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const users = await User.findAll({ where: { id: userIds }, attributes: ['id', 'username', 'is_frozen'] });
    const userById = new Map(users.map((u) => [String(u.id), u]));

    res.json(
      rows.map((r) => {
        const u = userById.get(String(r.user_id));
        return {
          id: r.id,
          user_id: r.user_id,
          username: u ? u.username : null,
          is_frozen: u ? u.is_frozen : null,
          rule: r.rule,
          message: r.message,
          resolved: r.resolved,
          timestamp: r.created_at ? new Date(r.created_at).toISOString() : null,
        };
      })
    );
  } catch (err) {
    next(err);
  }
});

// Optional, small bonus paired with the freeze button: lets an admin clear
// a flag from the review queue once it's been looked at (independent of
// freezing the account - not every flag warrants a freeze).
router.post('/dashboard/fraud-flags/:id/resolve', requireAdmin, async (req, res, next) => {
  try {
    const id = requireInt(req.params, 'id');
    const flag = await ComplianceFlag.findByPk(id);
    if (!flag) throw new HttpError(404, 'Flag not found');
    flag.resolved = true;
    await flag.save();
    res.json({ status: 'ok' });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
