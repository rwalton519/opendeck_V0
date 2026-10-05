const createDemoTableRouter = require('./demoTableRouter');
const room = require('../services/demo/headsUpDemoRoom');

// Heads Up Demo sync endpoint - mounted at /heads-up (see server.js).
// Same shared route implementation as /cashgame-demo (routers/demoTableRouter.js),
// pointed at the 2-seat headsUpDemoRoom instead.
module.exports = createDemoTableRouter(room);
