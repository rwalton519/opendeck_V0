const { WebSocketServer } = require('ws');
const url = require('url');

// NOTE: The following were not included in the supplied ZIP and are required
// by the original Python module:
//   - app.services.game.ws_auth.WSAuth               -> services/game/wsAuth
//   - app.services.game.models.table_models.CashGameTable -> services/game/models/tableModels
//   - app.services.game.event_dispatcher.GameEventDispatcher -> services/game/eventDispatcher
const WSAuth = require('../../services/game/wsAuth');
const { CashGameTable } = require('../../services/game/models/tableModels');

// table_id (number) -> Set<WebSocket>, same shape as Python's `active_connections` dict.
const activeConnections = new Map();

// Mirrors the Python module's lazy import of GameEventDispatcher inside a
// function (done there to avoid a circular import).
function getDispatcher() {
  // eslint-disable-next-line global-require
  return require('../../services/game/eventDispatcher');
}

function connectClient(tableId, ws) {
  if (!activeConnections.has(tableId)) {
    activeConnections.set(tableId, new Set());
  }
  activeConnections.get(tableId).add(ws);
}

function disconnectClient(tableId, ws) {
  if (activeConnections.has(tableId)) {
    activeConnections.get(tableId).delete(ws);
  }
}

function broadcast(tableId, message) {
  if (!activeConnections.has(tableId)) return;

  const dead = [];
  for (const ws of activeConnections.get(tableId)) {
    try {
      ws.send(JSON.stringify(message));
    } catch (err) {
      dead.push(ws);
    }
  }
  for (const ws of dead) {
    activeConnections.get(tableId).delete(ws);
  }
}

function broadcastState(tableId, state) {
  broadcast(tableId, {
    type: 'state_update',
    table_id: tableId,
    state,
  });
}

// Matches the FastAPI path "/ws/table/{table_id}"
const TABLE_PATH_RE = /^\/ws\/table\/(\d+)\/?$/;

/**
 * Wires the websocket upgrade handling into an existing HTTP server, mirroring
 * @router.websocket("/table/{table_id}") from ws_router.py.
 */
function attachWebSocketServer(httpServer, getDb) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const { pathname } = url.parse(request.url);
    const match = pathname.match(TABLE_PATH_RE);
    if (!match) {
      socket.destroy();
      return;
    }

    const tableId = parseInt(match[1], 10);

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleTableSocket(ws, tableId, getDb(), request);
    });
  });

  return wss;
}

async function handleTableSocket(ws, tableId, db, request) {
  let identity;
  try {
    identity = await WSAuth.authenticate(ws, db, request);
  } catch (err) {
    ws.close(4401, 'Unauthorized');
    return;
  }

  // FIXED (was: CashGameTable.findOne(db, { id: tableId })): Sequelize's
  // findOne() takes a single options object - `where` must be nested inside
  // it. `db` is not a query argument here; the model is already bound to
  // the shared `sequelize` connection at require-time (see db/sequelize.js),
  // so there is nothing to pass it into. The `db` param is left in this
  // function's signature since WSAuth.authenticate() above still uses it.
  const table = await CashGameTable.findOne({ where: { id: tableId } });
  if (!table) {
    ws.close(4404, 'Table not found');
    return;
  }

  if (identity.type === 'user') {
    const userId = String(identity.user.id);
    connectClient(tableId, ws);

    broadcastState(tableId, {
      type: 'player_joined',
      user_id: userId,
    });

    ws.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        return; // ignore malformed frames, same as an implicit no-op in Python's receive_json on bad input
      }

      const response = await getDispatcher().handleEvent(db, data);

      if (response && response.broadcast_state) {
        broadcastState(response.table_id, response.state);
      } else {
        broadcast(tableId, response);
      }
    });

    ws.on('close', () => {
      disconnectClient(tableId, ws);
    });
  }
}

module.exports = {
  attachWebSocketServer,
  activeConnections,
  connectClient,
  disconnectClient,
  broadcast,
  broadcastState,
};
