// Edge-case test: one short-stacked player goes all-in preflop against two
// deeper stacks who keep betting - verifies side-pot construction
// (buildPots in liveHandEngine.js) rather than just the everybody-has-equal-
// stacks happy path the main e2e test covers.
const { execSync } = require('child_process');
const BASE = 'http://localhost:8000';

function fundWallet(userId, amount) {
  execSync(
    `su postgres -c "psql -d transparent_poker -c \\"INSERT INTO wallet_balance (user_id, available, locked) VALUES ('${userId}', ${amount}, 0) ON CONFLICT (user_id) DO UPDATE SET available = ${amount};\\""`,
    { stdio: 'pipe' }
  );
}

async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
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
  const stacks = [50, 300, 300]; // seat 0 is short-stacked
  const users = [];
  for (let i = 0; i < 3; i++) {
    const name = ['short', 'mid', 'deep'][i];
    const email = `${name}${suffix}@test.com`;
    await j('POST', '/auth/register', { email, username: `${name}${suffix}`, password: 'Password123!' });
    const login = await j('POST', '/auth/login', { email, password: 'Password123!' });
    users.push({ name, id: login.user_id });
    fundWallet(login.user_id, 1000);
  }

  const table = await j('POST', '/cashgame/create', { name: `Sidepot Table ${suffix}`, small_blind: 1, big_blind: 2, max_players: 9 });
  const tableId = table.id;

  for (let i = 0; i < users.length; i++) {
    await j('POST', `/cashgame/${tableId}/seats/${i}/take`, { user_id: String(users[i].id), username: users[i].name, buy_in: stacks[i] });
  }

  let wrapped = await j('POST', `/cashgame/${tableId}/start-hand`, {});
  let state = wrapped.hand;
  console.log('start:', { phase: state.phase, toAct: state.toActSeatIndex, committed: state.committed });

  const seatToUser = { 0: users[0], 1: users[1], 2: users[2] };
  let guard = 0;
  let shortAllIn = false;

  while (state.phase !== 'idle' && guard < 40) {
    guard++;
    const seatIdx = state.toActSeatIndex;
    const user = seatToUser[seatIdx];
    const toCall = state.currentBet - (state.streetCommitted?.[seatIdx] ?? 0);
    const available = stacks[seatIdx] - state.committed[seatIdx];

    let action, amount;
    if (seatIdx === 0 && toCall > 0) {
      // short stack shoves all remaining chips preflop
      action = 'raise';
      amount = state.streetCommitted[seatIdx] + available; // all-in target
      shortAllIn = true;
    } else if (state.phase === 'preflop' && seatIdx === 2 && toCall > 0 && toCall < 200) {
      // deep stack re-raises to build a side pot (must clear minRaise)
      action = 'raise';
      amount = state.currentBet + Math.max(state.minRaise, 20);
    } else if (toCall > 0) {
      action = 'call';
    } else {
      action = 'check';
    }

    const before = state.phase;
    console.log(`  DEBUG seat=${seatIdx} user=${user?.name} toCall=${toCall} phase=${state.phase} currentBet=${state.currentBet} minRaise=${state.minRaise} -> action=${action} amount=${amount}`);
    const res = await j('POST', `/cashgame/${tableId}/action`, { user_id: String(user.id), action, amount });
    state = res.hand;
    console.log(`  [${before}] ${user.name} -> ${action}${amount ? '(' + amount + ')' : ''} => phase ${state.phase}, pot ${state.pot}, allIn=${JSON.stringify(state.allIn)}`);
  }

  assert(shortAllIn, 'short stack went all-in preflop');
  assert(guard < 40, 'hand resolved without infinite loop');

  const last = await j('GET', `/cashgame/${tableId}/last-hand`);
  console.log('results:', JSON.stringify(last.resultsByUserId));

  const netSum = Object.values(last.resultsByUserId).reduce((a, b) => a + b, 0);
  assert(Math.abs(netSum) < 0.01, `chip conservation across side pots: sum ~0 (got ${netSum})`);

  const shortNet = last.resultsByUserId[String(users[0].id)];
  assert(shortNet >= -50.01, `short stack never lost more than their ${stacks[0]}-chip stack (net ${shortNet})`);

  const finalState = await j('GET', `/cashgame/${tableId}/state`);
  const finalTotal = Object.values(finalState.seats || {}).reduce((sum, s) => sum + (s ? s.chips : 0), 0);
  const totalBuyIn = stacks.reduce((a, b) => a + b, 0);
  assert(Math.abs(finalTotal - totalBuyIn) < 0.01, `total table chips conserved: ${finalTotal} === ${totalBuyIn}`);

  console.log('\nSIDE-POT TEST PASSED');
}

main().catch((err) => {
  console.error('\nTEST FAILED:', err.message);
  process.exit(1);
});
