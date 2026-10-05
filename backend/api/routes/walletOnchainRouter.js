const express = require('express');
const router = express.Router();

const OnchainRakeService = require('../../services/blockchain/onchainRakeService');
const contractService = require('../../services/blockchain/openDeckPokerContract');
const CashGameManager = require('../../services/game/cashgameManager');
const { requireString } = require('../../utils/validation');
const { HttpError } = require('../../utils/errors');
const { requireUser } = require('../../auth/requireUser');

// GET /wallet/onchain/link-message - the exact message the player's wallet
// must sign to prove ownership of the address before linking. Requiring
// the frontend to fetch this (rather than construct it client-side) means
// the signed text can never drift from what the backend actually verifies.
router.get('/link-message', requireUser, async (req, res, next) => {
  try {
    const address = requireString(req.query, 'address');
    const message = OnchainRakeService.buildLinkMessage(String(req.user.id), address);
    res.json({ message });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /wallet/onchain/link  { address, signature }
router.post('/link', requireUser, async (req, res, next) => {
  try {
    const address = requireString(req.body, 'address');
    const signature = requireString(req.body, 'signature');

    const wallet = await OnchainRakeService.linkWallet(req.db, String(req.user.id), address, signature);
    res.json({ address: wallet.address, linked_at: wallet.linked_at, status: 'linked' });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /wallet/onchain/summary - linked address + on-chain transaction
// history for the dashboard (see routers/account.js's /dashboard for the
// combined fiat+on-chain view).
router.get('/summary', requireUser, async (req, res, next) => {
  try {
    const summary = await OnchainRakeService.getWalletSummary(req.db, String(req.user.id));
    res.json(summary);
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /wallet/onchain/table-balance/:tableId - the player's pooled
// on-chain USDC balance for one table, read live from the contract (not
// cached), for the "Rebuy with USDC" panel on the table page.
router.get('/table-balance/:tableId', requireUser, async (req, res, next) => {
  try {
    const tableId = await CashGameManager.resolveTableId(req.db, req.params.tableId);
    const address = await OnchainRakeService.getLinkedAddress(req.db, String(req.user.id));
    if (!address) {
      return res.json({ address: null, balance: 0 });
    }
    const balance = await contractService.getOnchainBalance(tableId, address);
    res.json({ address, balance });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

module.exports = router;
