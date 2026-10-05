const express = require('express');
const router = express.Router();

// Converted from routers/health.py (no prefix - APIRouter() with no prefix arg):
//
//   @router.get("/")
//   def health():
//       return {"status": "ok"}

router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
