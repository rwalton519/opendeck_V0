const express = require('express');
const router = express.Router();

const AdminAuth = require('./adminAuth');
const requireAdmin = require('./adminPermissions');

// NOTE: these four managers (app/services/wallet/wallet_manager.py,
// app/services/compliance/compliance_manager.py,
// app/services/game/cashgame_manager.py,
// app/services/game/tournament_manager.py) were not included in the supplied
// ZIP. Import paths mirror the originals.
const WalletManager = require('../services/wallet/walletManager');
const ComplianceManager = require('../services/compliance/complianceManager');
const CashGameManager = require('../services/game/cashgameManager');
const TournamentManager = require('../services/game/tournamentManager');
const { WithdrawalRequest } = require('../models/real_money');

// ADDED (found while building the Admin Dashboard - see
// admin/adminDashboardRouter.js): needed for the /ledger/:user_id fix
// directly below.
const Ledger = require('../services/wallet/ledger');

// FIXED: withdrawal approve/reject logic is now a shared service (see its
// header comment) instead of living inline here - both the real
// /withdrawals/approve|reject routes AND the legacy /approve_payout,
// /reject_payout routes below now call the same implementation.
const withdrawalService = require('../services/wallet/withdrawalService');

const { METHOD_TO_PROVIDER, REAL_PAYOUT_CRYPTO_METHODS } = require('../utils/paymentMethods');

const { requireString, requireFloat, requireInt, requireDict } = require('../utils/validation');
const { HttpError } = require('../utils/errors');

// -------------------------
// AUTH
// -------------------------
// FIXED (security recommendation from spec review): admin credentials were
// previously accepted as URL query parameters (?username=&password=),
// mirroring the original Python's bare scalar FastAPI params. Query strings
// are routinely captured in access logs, proxy logs, and browser history,
// making that transport an avoidable credential-exposure risk for an admin
// account. Credentials are now read from a JSON request body instead - the
// AdminAuth.authenticate() call itself is unchanged, since it only ever
// took plain strings and never cared where they came from.
//
// Any admin-facing client must be updated to POST { "username", "password" }
// as a JSON body rather than appending them to the URL.
router.post('/login', async (req, res, next) => {
  try {
    const username = requireString(req.body, 'username');
    const password = requireString(req.body, 'password');

    const token = await AdminAuth.authenticate(req.db, username, password);
    res.json({ token });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// PASSWORD ROTATION
// -------------------------
// Allows an authenticated admin to rotate their own password without direct
// database access. The current password is required so a stolen admin token
// alone cannot be used to silently replace credentials.
router.post('/change-password', requireAdmin, async (req, res, next) => {
  try {
    const currentPassword = requireString(req.body, 'current_password');
    const newPassword = requireString(req.body, 'new_password');

    if (newPassword.length < 12) {
      throw new HttpError(400, 'new_password must be at least 12 characters long');
    }
    if (currentPassword === newPassword) {
      throw new HttpError(400, 'new_password must differ from current_password');
    }
    if (!AdminAuth.verifyPassword(currentPassword, req.admin.password_hash)) {
      throw new HttpError(401, 'Current password is incorrect');
    }

    req.admin.password_hash = AdminAuth.hashPassword(newPassword);
    await req.admin.save();

    res.json({ status: 'password_changed' });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// LEDGER / WALLET
// -------------------------
// Python: adjust_balance(user_id: str, amount: float, reason: str, ...) -> all query params
router.post('/adjust_balance', requireAdmin, async (req, res, next) => {
  try {
    const userId = requireString(req.query, 'user_id');
    const amount = requireFloat(req.query, 'amount');
    const reason = requireString(req.query, 'reason');

    if (amount > 0) {
      await WalletManager.credit(req.db, userId, amount, `admin_adjust:${reason}`);
    } else {
      await WalletManager.debit(req.db, userId, Math.abs(amount), `admin_adjust:${reason}`);
    }

    res.json({ status: 'ok', user_id: userId, amount });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// Python: GET /ledger/{user_id} -> user_id IS a path parameter here.
// FIXED (found while building the Admin Dashboard): this called
// WalletManager.getLedger(), a method that does not exist anywhere on that
// class (services/wallet/walletManager.js only ever managed the balance
// row, never transaction history) - this route would have thrown a
// TypeError on every call. The real ledger reader is
// Ledger.getUserTransactions() (services/wallet/ledger.js), the exact same
// one GET /wallet/transactions already uses for a user's own history.
router.get('/ledger/:user_id', requireAdmin, async (req, res, next) => {
  try {
    const { user_id: userId } = req.params;
    const rows = await Ledger.getUserTransactions(req.db, userId, 500);
    res.json(
      rows.map((r) => ({
        id: String(r.id),
        user_id: r.user_id,
        type: r.type,
        amount: parseFloat(r.amount),
        timestamp: r.created_at ? new Date(r.created_at).toISOString() : null,
        reference: r.reference,
      }))
    );
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// USER CONTROLS
// -------------------------
// FIXED (spec §5.7 / §9 / §12): ComplianceManager.freezeUser/unfreezeUser
// didn't exist before - these calls would throw at runtime. ComplianceManager
// now implements both for real (see services/compliance/complianceManager.js),
// backed by a new users.is_frozen column.
router.post('/freeze_user', requireAdmin, async (req, res, next) => {
  try {
    const userId = requireString(req.query, 'user_id');
    await ComplianceManager.freezeUser(req.db, userId);
    res.json({ status: 'user_frozen', user_id: userId });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

router.post('/unfreeze_user', requireAdmin, async (req, res, next) => {
  try {
    const userId = requireString(req.query, 'user_id');
    await ComplianceManager.unfreezeUser(req.db, userId);
    res.json({ status: 'user_unfrozen', user_id: userId });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// PAYOUT APPROVALS (legacy route names)
// -------------------------
// FIXED (spec §5.7 / §9 / §12): previously called
// ComplianceManager.approvePayout/rejectPayout, methods that didn't exist
// anywhere in this codebase and would throw at runtime. There was never a
// separate "payout" data model for those methods to have operated on in
// the first place - the only real payout queue in this system is
// WithdrawalRequest, which POST /withdrawals/approve and /withdrawals/reject
// below already handle correctly. These legacy routes now delegate to that
// exact same logic via the shared withdrawalService, treating `payout_id`
// as a WithdrawalRequest id - rather than either leaving them broken or
// inventing a second, parallel mechanism capable of releasing real funds.
router.post('/approve_payout', requireAdmin, async (req, res, next) => {
  try {
    const payoutId = requireInt(req.query, 'payout_id');
    const result = await withdrawalService.approveWithdrawal(req.db, payoutId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

router.post('/reject_payout', requireAdmin, async (req, res, next) => {
  try {
    const payoutId = requireInt(req.query, 'payout_id');
    const result = await withdrawalService.rejectWithdrawal(req.db, payoutId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// GAME CONTROLS
// -------------------------
router.post('/force_seat', requireAdmin, async (req, res, next) => {
  try {
    const userId = requireString(req.query, 'user_id');
    const tableId = requireInt(req.query, 'table_id');
    const buyin = requireFloat(req.query, 'buyin');

    const result = await CashGameManager.seatPlayer(req.db, userId, tableId, buyin);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

router.post('/force_remove', requireAdmin, async (req, res, next) => {
  try {
    const userId = requireString(req.query, 'user_id');
    const tableId = requireInt(req.query, 'table_id');

    const result = await CashGameManager.leaveTable(req.db, userId, tableId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// FIXED (spec §5.7 / §9 / §12): TournamentManager.advanceLevel didn't exist
// before - this call would throw at runtime. It's now implemented for real
// (see services/game/tournamentManager.js), based on the same level-advance
// logic the tournament scheduler already runs automatically on a timer -
// this route lets an admin trigger it manually/early.
router.post('/tournament/advance_level', requireAdmin, async (req, res, next) => {
  try {
    const tournamentId = requireInt(req.query, 'tournament_id');
    const result = await TournamentManager.advanceLevel(req.db, tournamentId);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// Python: finalize_tournament(tournament_id: int, payouts: dict, ...)
// `tournament_id` is a scalar -> query param. `payouts` is the only
// non-scalar (body-eligible) parameter, so FastAPI binds the *entire* JSON
// request body directly to it (no embedding/nesting under a "payouts" key,
// since embedding is only applied when there are multiple body params or
// Body(embed=True) is explicit). Preserved here as req.body itself.
router.post('/tournament/finalize', requireAdmin, async (req, res, next) => {
  try {
    const tournamentId = requireInt(req.query, 'tournament_id');
    const payouts = requireDict({ payouts: req.body }, 'payouts');

    const result = await TournamentManager.finalize(req.db, tournamentId, payouts);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// -------------------------
// WITHDRAWALS (matches frontend_new/src/api/wallet.ts's admin calls)
// -------------------------
// This is the real, canonical withdrawal-approval implementation, now
// shared with the legacy /approve_payout and /reject_payout routes above
// via services/wallet/withdrawalService.js (see that file's header comment
// and the fix note above /approve_payout for why).

router.get('/withdrawals/pending', requireAdmin, async (req, res, next) => {
  try {
    const rows = await WithdrawalRequest.findAll({
      where: { status: 'pending' },
      order: [['created_at', 'ASC']],
    });

    res.json(
      rows.map((w) => ({
        id: String(w.id),
        user_id: w.user_id,
        amount: parseFloat(w.amount),
        method: w.provider,
        timestamp: w.created_at ? new Date(w.created_at).toISOString() : null,
        destination_address: w.destination_address,
        failure_reason: w.failure_reason,
        // ADDED: lets an admin UI show whether approving this will
        // actually send real money out, or only clear the internal ledger
        // (still the case for ACH and non-Monero crypto methods).
        has_real_payout: METHOD_TO_PROVIDER[w.provider] === 'stripe' || REAL_PAYOUT_CRYPTO_METHODS.has(w.provider),
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.post('/withdrawals/approve', requireAdmin, async (req, res, next) => {
  try {
    const id = requireInt(req.body, 'id');
    const result = await withdrawalService.approveWithdrawal(req.db, id);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

router.post('/withdrawals/reject', requireAdmin, async (req, res, next) => {
  try {
    const id = requireInt(req.body, 'id');
    const result = await withdrawalService.rejectWithdrawal(req.db, id);
    res.json(result);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
