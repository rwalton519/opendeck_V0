const { ethers } = require('ethers');
const Decimal = require('decimal.js');
const { OnchainWallet, OnchainTransaction } = require('../../models/onchain_wallet');
const contractService = require('./openDeckPokerContract');
const { chainConfig } = require('./chainConfig');

/**
 * Message a player signs with their own wallet (MetaMask etc.) to prove
 * they control the address they're linking - see browserWallet.ts's
 * signLinkMessage() on the frontend for the exact matching string. Includes
 * the userId so a signature produced for linking can't be replayed to link
 * the same address to a different OpenDeck account.
 */
function buildLinkMessage(userId, address) {
  return `OpenDeck wallet link\nUser: ${userId}\nAddress: ${address.toLowerCase()}\n` +
    'Signing this message does not authorize any transaction or transfer of funds.';
}

/**
 * Verifies the signature and links `address` to `userId`. One address per
 * user, and one user per address (unique constraints on both columns) -
 * two players can never share a linked wallet, and a player can't link a
 * second address without an explicit re-link flow this backend doesn't
 * expose yet (kept simple deliberately; add an unlink/relink endpoint if
 * that turns out to be needed).
 */
async function linkWallet(db, userId, address, signature) {
  if (!ethers.isAddress(address)) {
    throw new Error('Not a valid Ethereum/Polygon address.');
  }
  const message = buildLinkMessage(userId, address);
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    throw new Error('Invalid signature.');
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new Error('Signature does not match the given address.');
  }

  const existingForUser = await OnchainWallet.findOne({ where: { user_id: String(userId) } });
  if (existingForUser) {
    throw new Error('This account already has a linked wallet.');
  }
  const existingForAddress = await OnchainWallet.findOne({ where: { address: address.toLowerCase() } });
  if (existingForAddress) {
    throw new Error('This address is already linked to another account.');
  }

  return OnchainWallet.create({ user_id: String(userId), address: address.toLowerCase() });
}

/** Everything the dashboard's on-chain panel needs: the linked address (if
 * any), its current on-chain balance FOR THIS SPECIFIC TABLE isn't
 * meaningful at account level (balances are per-table on-chain - see the
 * contract), so this returns the linked address plus the recorded
 * transaction history; per-table balances are fetched separately, on the
 * table page, via GET /wallet/onchain/table-balance/:tableId. */
async function getWalletSummary(db, userId) {
  const wallet = await OnchainWallet.findOne({ where: { user_id: String(userId) } });
  const transactions = await OnchainTransaction.findAll({
    where: { user_id: String(userId) },
    order: [['created_at', 'DESC']],
    limit: 200,
  });

  return {
    address: wallet ? wallet.address : null,
    linkedAt: wallet ? wallet.linked_at : null,
    transactions: transactions.map((t) => ({
      id: String(t.id),
      tableId: t.table_id,
      type: t.type,
      amount: Number(t.amount),
      txHash: t.tx_hash,
      handId: t.hand_id,
      timestamp: t.created_at ? new Date(t.created_at).toISOString() : null,
    })),
  };
}

async function getLinkedAddress(db, userId) {
  const wallet = await OnchainWallet.findOne({ where: { user_id: String(userId) } });
  return wallet ? wallet.address : null;
}

/**
 * Verifies a player's on-chain fundTable() transaction and, once
 * confirmed, returns the credited amount. Does NOT itself mutate the cash
 * game seat - the caller (CashGameManager.rebuyFromChain) is responsible
 * for actually adding these chips to the seat, since that also needs the
 * seat/table locking that this service has no business doing.
 */
async function verifyAndCreditRebuy(db, userId, tableId, txHash) {
  const address = await getLinkedAddress(db, userId);
  if (!address) {
    throw new Error('Link a wallet before rebuying with USDC.');
  }

  const existing = await OnchainTransaction.findOne({ where: { tx_hash: txHash, type: 'rebuy_credited' } });
  if (existing) {
    throw new Error('This transaction has already been credited.');
  }

  const { amount, blockNumber } = await contractService.verifyFundTableTx(txHash, tableId, address);

  await OnchainTransaction.create({
    user_id: String(userId),
    table_id: tableId,
    type: 'rebuy_credited',
    amount,
    tx_hash: txHash,
  });

  // Best-effort: mark this player's on-chain balance as backing a live
  // seat, so they can't withdraw it out from under themselves mid-session.
  // Not fatal if it fails (e.g. chain temporarily unreachable) - the
  // player's off-chain seat stack is already correctly credited above,
  // which is the part that actually matters for play; the withdrawal gate
  // is a secondary safety net, not the source of truth for whether funds
  // are "in play."
  try {
    await contractService.setSeatedForWithdrawal(tableId, address, true);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[onchainRakeService] setSeatedForWithdrawal failed for table ${tableId}, user ${userId}:`, err.message);
  }

  return { amount, blockNumber, address };
}

/** Clears the on-chain withdrawal lock when a player leaves a table -
 * mirrors verifyAndCreditRebuy's best-effort seat lock above. */
async function releaseSeatLock(db, userId, tableId) {
  const address = await getLinkedAddress(db, userId);
  if (!address) return;
  try {
    await contractService.setSeatedForWithdrawal(tableId, address, false);
    await OnchainTransaction.create({
      user_id: String(userId),
      table_id: tableId,
      type: 'withdrawal_unlocked',
      amount: 0,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[onchainRakeService] releaseSeatLock failed for table ${tableId}, user ${userId}:`, err.message);
  }
}

/**
 * Computes and (best-effort) executes the on-chain slice of a single
 * hand's rake + settlement, once liveHandEngine.js has already determined
 * the hand satisfied both gating conditions (reached the flop, and at
 * least one bet/raise occurred) and has already applied the FULL rake
 * (fiat + chain) to the off-chain chip ledger.
 *
 * IMPORTANT - the approximation this makes, stated plainly: poker chips at
 * a seat aren't individually tagged as "chain dollars" or "fiat dollars"
 * once they're mixed into a stack. This function apportions each
 * contributing seat's net hand result to on-chain settlement using that
 * seat's CURRENT ratio of on-chain-funded chips to total chips
 * (seat.onchainStack / seat.chips, captured just before the hand). That's
 * a fair, transparent, and auditable convention - and it's what actually
 * determines how much real USDC moves - but it is a convention, not a
 * literal trace of specific dollars through a specific pot. This is
 * disclosed to players in the dashboard's on-chain transaction history
 * (each row shows the table, hand-adjacent settlement amount, and tx
 * hash so it can be independently verified against Polygon).
 *
 * `seatSnapshots`: seatIndex -> { userId, chipsBeforeHand, onchainStackBeforeHand }
 * `resultsByUserId`: userId -> net chip delta for the whole hand (already
 *   rake-inclusive - i.e. winners' payouts already had the full rake taken
 *   out before this was computed, same numbers settlementManager.js uses
 *   for the fiat ledger).
 * `totalPot`, `totalRakeAmount`: from liveHandEngine.js's finishHand.
 *
 * Returns a result object for logging/testing; never throws - a failure
 * here must never undo or block the off-chain settlement that already
 * happened, since chip balances are the source of truth for who won what.
 * A failed on-chain sweep is a reconciliation problem to catch later
 * (flagged honestly: there is no reconciliation job in this codebase yet -
 * the OnchainTransaction row's absence/failure status is the only signal
 * an operator has today that a hand's on-chain leg needs manual review).
 */
async function computeAndSettleHandOnchain(db, tableId, handNumber, seatSnapshots, resultsByUserId, totalPot, totalRakeAmount) {
  if (!chainConfig.contractAddress || !chainConfig.rpcUrl || !chainConfig.operatorPrivateKey) {
    return { attempted: false, reason: 'chain_not_configured' };
  }
  if (!(totalRakeAmount > 0) || !(totalPot > 0)) {
    return { attempted: false, reason: 'no_rake_due' };
  }

  const contributingSeats = Object.values(seatSnapshots).filter(
    (s) => s.chipsBeforeHand > 0 && s.onchainStackBeforeHand > 0 && resultsByUserId[s.userId] !== undefined
  );
  if (contributingSeats.length === 0) {
    return { attempted: false, reason: 'no_onchain_backed_chips_in_hand' };
  }

  const linkedAddresses = {};
  for (const seat of contributingSeats) {
    // eslint-disable-next-line no-await-in-loop
    linkedAddresses[seat.userId] = await getLinkedAddress(db, seat.userId);
  }
  const settleable = contributingSeats.filter((s) => linkedAddresses[s.userId]);
  if (settleable.length === 0) {
    return { attempted: false, reason: 'no_linked_wallets_among_onchain_backed_seats' };
  }

  // Fraction of the whole pot that was chain-backed, by chip weight -
  // determines how much of the total rake must actually be swept on-chain.
  const totalChainWeight = settleable.reduce(
    (sum, s) => sum + Math.min(1, s.onchainStackBeforeHand / s.chipsBeforeHand),
    0
  );
  const chainRakeAmount = new Decimal(totalRakeAmount)
    .times(totalChainWeight)
    .dividedBy(settleable.length || 1)
    .toDecimalPlaces(6);

  if (chainRakeAmount.lte(0)) {
    return { attempted: false, reason: 'chain_rake_rounds_to_zero' };
  }

  // Proportional raw delta per seat, then rescale so the batch nets to
  // exactly -chainRakeAmount (the contract requires exact conservation -
  // see operatorSettleHand's sum check).
  const raw = settleable.map((s) => {
    const ratio = Math.min(1, s.onchainStackBeforeHand / s.chipsBeforeHand);
    return { seat: s, ratio, rawDelta: new Decimal(resultsByUserId[s.userId]).times(ratio) };
  });
  const rawTotal = raw.reduce((sum, r) => sum.plus(r.rawDelta), new Decimal(0));
  const target = chainRakeAmount.neg();
  const correction = target.minus(rawTotal);
  const ratioSum = raw.reduce((sum, r) => sum + r.ratio, 0) || 1;

  const playerDeltas = raw.map((r, i) => {
    const share = i === raw.length - 1
      ? correction.minus(raw.slice(0, -1).reduce((s, x) => s.plus(correction.times(x.ratio / ratioSum)), new Decimal(0)))
      : correction.times(r.ratio / ratioSum);
    const delta = r.rawDelta.plus(share).toDecimalPlaces(6);
    return { address: linkedAddresses[r.seat.userId], delta: delta.toNumber(), userId: r.seat.userId };
  });

  try {
    const { txHash, handId } = await contractService.settleHandOnChain(
      tableId,
      handNumber,
      playerDeltas.map((d) => ({ address: d.address, delta: d.delta })),
      chainRakeAmount.toNumber()
    );

    await Promise.all(playerDeltas.map((d) => OnchainTransaction.create({
      user_id: String(d.userId),
      table_id: tableId,
      type: 'rake_settled',
      amount: d.delta,
      tx_hash: txHash,
      hand_id: handId,
    })));

    return { attempted: true, settled: true, txHash, handId, chainRakeAmount: chainRakeAmount.toNumber(), playerDeltas };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[onchainRakeService] on-chain settlement FAILED for table ${tableId} hand ${handNumber} - off-chain chip settlement already completed and stands as-is:`, err.message);
    return { attempted: true, settled: false, error: err.message };
  }
}

module.exports = {
  buildLinkMessage,
  linkWallet,
  getWalletSummary,
  getLinkedAddress,
  verifyAndCreditRebuy,
  releaseSeatLock,
  computeAndSettleHandOnchain,
};
