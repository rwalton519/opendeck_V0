const express = require('express');
const router = express.Router();

// NOTE: app.services.kyc.provider_sumsub.SumSubProvider was not included in
// this chunk. Import path mirrors the original
// (`from app.services.kyc.provider_sumsub import SumSubProvider`).
const SumSubProvider = require('../services/kyc/providerSumsub');

const kyc = new SumSubProvider();

// Converted from routers/kyc_router.py -> APIRouter() with NO prefix
// (routes declare their own full paths "/kyc/start", "/kyc/status").
//
// `user_id: str` with no path placeholder -> FastAPI binds it as a required
// QUERY parameter, not a JSON body, for both routes below.

// POST /kyc/start?user_id=...
router.post('/kyc/start', async (req, res, next) => {
  try {
    const { user_id: userId } = req.query;
    const result = await kyc.startVerification(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /kyc/status?user_id=...
router.get('/kyc/status', async (req, res, next) => {
  try {
    const { user_id: userId } = req.query;
    const result = await kyc.getStatus(userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
