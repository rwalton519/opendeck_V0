const createDemoTableRouter = require('./demoTableRouter');
const room = require('../services/demo/cashGameDemoRoom');

// Cash Game Demo sync endpoint - mounted at /cashgame-demo (see server.js).
// See routers/demoTableRouter.js for the actual route implementations and
// services/demo/createDemoRoom.js for the room logic.
module.exports = createDemoTableRouter(room);
