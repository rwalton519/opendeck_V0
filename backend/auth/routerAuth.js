const express = require('express');
const router = express.Router();

const { createUser, loginUser } = require('./serviceAuth');
const { createUserToken } = require('./userToken');
const { requireString } = require('../utils/validation');
const { HttpError } = require('../utils/errors');
const { getClientIp } = require('../utils/getClientIp');
const { requireUser } = require('./requireUser');
const WalletManager = require('../services/wallet/walletManager');

// POST /auth/register
router.post('/register', async (req, res, next) => {
  try {
    const email = requireString(req.body, 'email').trim().toLowerCase();
    const username = requireString(req.body, 'username').trim();
    const password = requireString(req.body, 'password');

    if (username.length < 3 || username.length > 32) {
      throw new HttpError(400, 'Username must be between 3 and 32 characters.');
    }
    if (password.length < 8) {
      throw new HttpError(400, 'Password must be at least 8 characters.');
    }

    const user = await createUser(req.db, { email, username, password, ip: getClientIp(req) });
    await WalletManager.getBalance(req.db, String(user.id));

    const { password: _omit, ...userOut } = user.toJSON ? user.toJSON() : user;
    res.status(201).json({ ...userOut, user_id: user.id, message: 'Account created successfully.' });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// POST /auth/login
router.post('/login', async (req, res, next) => {
  try {
    const email = requireString(req.body, 'email').trim().toLowerCase();
    const password = requireString(req.body, 'password');

    const user = await loginUser(req.db, email, password, getClientIp(req));
    const token = createUserToken(user);

    res.json({
      token,
      user_id: user.id,
      email: user.email,
      username: user.username,
    });
  } catch (err) {
    if (err.statusCode) return next(err);
    next(new HttpError(400, err.message));
  }
});

// GET /auth/me
router.get('/me', requireUser, async (req, res, next) => {
  try {
    const balance = await WalletManager.getBalance(req.db, String(req.user.id));
    res.json({
      user: {
        id: String(req.user.id),
        username: req.user.username,
        email: req.user.email,
      },
      balance: {
        available: Number(balance.available),
        locked: Number(balance.locked),
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
