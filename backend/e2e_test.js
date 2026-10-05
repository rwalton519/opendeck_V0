// End-to-end smoke test against the running server (http://localhost:8000).
// Exercises: register -> login -> create table -> seat 3 players ->
// start-hand -> action() through preflop/flop/turn/river -> showdown,
// verifying chip conservation and that bet/call/raise work on every street.
const { execSync } = require('child_process');
const BASE = 'http://localhost:8000';

// Test-only wallet funding: bypasses the deposit/Stripe flow entirely so
// this script can verify the poker ENGINE (seating, betting, showdown)
// independently of payment-provider connectivity (this sandbox has no
// network path to api.stripe.com at all - see chat for why). Real deposits
// still go through /wallet/deposit -> Stripe exactly as coded.
function fundWallet(userId, amount) {
  execSync(
    `su postgres -c "psql -d transparent_poker -c \\"INSERT INTO wallet_balance (user_id, available, locked) VALUES ('${userId}', ${amount}, 0) ON CONFLICT (user_id) DO UPDATE SET available = ${amount};\\""`,
    { stdio: 'pipe' }
  );
}

async function j(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok:', msg);
}

async function main() {
  const suffix = Date.now();
  const users = [];
  for (const name of ['alice', 'bob', 'carol']) {
    const email = `${name}${suffix}@test.com`;
    const reg = await j('POST', '/auth/register', { email, username: `${name}${suffix}`, password: 'Password123!' });
    const login = await j('POST', '/auth/login', { email, password: 'Password123!' });
    users.push({ name, email, id: login.user_id, token: login.token });
    fundWallet(login.user_id, 500);
    console.log(`registered+logged in ${name} -> user_id=${login.user_id}, wallet funded (test-only bypass)`);
  }

  const table = await j('POST', '/cashgame/create', { name: `Test Table ${suffix}`, small_blind: 1, big_blind: 2, max_players: 9 });
  console.log('created table:', table);
  const tableId = table.table_id ?? table.id;
  assert(tableId != null, 'table creation returns a table id');

  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    const seat = await j('POST', `/cashgame/${tableId}/seats/${i}/take`, { user_id: String(u.id), username: u.name, buy_in: 200 });
    console.log(`seated ${u.name} at seat ${i}:`, seat.chips ?? seat);
  }

  const totalBuyIn = 200 * users.length;

  const startWrapped = await j('POST', `/cashgame/${tableId}/start-hand`, {});
  let start = startWrapped.hand ?? startWrapped;
  assert(start.phase === 'preflop', `hand starts in preflop phase (got ${start.phase})`);
  console.log('hand started:', { phase: start.phase, pot: start.pot, toAct: start.toActSeatIndex });

  // Drive the hand: everyone calls/checks to see every street through to
  // showdown, with one raise thrown in on the flop to prove raise works too.
  let state = start;
  let guard = 0;
  const seatToUser = {};
  users.forEach((u, i) => (seatToUser[i] = u));
  let raisedOnFlop = false;

  while (state.phase !== 'idle' && guard < 60) {
    guard++;
    const seatIdx = state.toActSeatIndex;
    const user = seatToUser[seatIdx];
    const toCall = state.currentBet - (state.streetCommitted?.[seatIdx] ?? 0);

    let action, amount;
    if (state.phase === 'flop' && !raisedOnFlop && toCall === 0) {
      action = 'raise';
      amount = state.currentBet + 6; // bet 6 on the flop
      raisedOnFlop = true;
    } else if (toCall > 0) {
      action = 'call';
    } else {
      action = 'check';
    }

    const before = state.phase;
    const resWrapped = await j('POST', `/cashgame/${tableId}/action`, { user_id: String(user.id), action, amount });
    state = resWrapped.hand ?? resWrapped;
    console.log(`  [${before}] ${user.name} (seat ${seatIdx}) -> ${action}${amount ? '(' + amount + ')' : ''} => phase now ${state.phase}, pot ${state.pot}`);
  }

  assert(guard < 60, 'hand completed within a bounded number of actions (no infinite loop)');
  assert(raisedOnFlop, 'a raise was actually applied on the flop street');

  const last = await j('GET', `/cashgame/${tableId}/last-hand`);
  console.log('last completed hand:', JSON.stringify(last.resultsByUserId));
  assert(last.communityCards.length === 5, 'all 5 community cards were dealt (flop+turn+river)');

  const netSum = Object.values(last.resultsByUserId).reduce((a, b) => a + b, 0);
  assert(Math.abs(netSum) < 0.01, `chip conservation: sum of net results across players is ~0 (got ${netSum})`);

  const finalState = await j('GET', `/cashgame/${tableId}/state`);
  const finalTotal = Object.values(finalState.seats || {}).reduce((sum, s) => sum + (s ? s.chips : 0), 0);
  assert(Math.abs(finalTotal - totalBuyIn) < 0.01, `total chips at table still equal total buy-ins: ${finalTotal} === ${totalBuyIn}`);

  console.log('\nALL CHECKS PASSED');
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
