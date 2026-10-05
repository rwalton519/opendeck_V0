const { ethers } = require('ethers');
const OpenDeckPokerAbi = require('../../abi/OpenDeckPoker.json');
const { chainConfig } = require('./chainConfig');
const { getProvider, getOperatorWallet } = require('./provider');

/** Read-only contract instance, for balance checks / event log parsing. */
function getReadContract() {
  return new ethers.Contract(chainConfig.contractAddress, OpenDeckPokerAbi, getProvider());
}

/** Contract instance signed by the operator wallet, for the two
 * operator-only write calls (operatorSettleHand, setSeatedForWithdrawal). */
function getOperatorContract() {
  return new ethers.Contract(chainConfig.contractAddress, OpenDeckPokerAbi, getOperatorWallet());
}

/** USDC has 6 decimals - see chainConfig.js. Converts a human dollar amount
 * (e.g. 25.5) to the on-chain base-unit BigInt (25500000n). */
function toUsdcUnits(humanAmount) {
  return ethers.parseUnits(String(humanAmount), chainConfig.usdcDecimals);
}

/** Inverse of toUsdcUnits - base-unit BigInt back to a JS number of dollars.
 * Fine for display/accounting at USDC's precision; anything that needs
 * exact decimal math server-side should stay in Decimal.js against the
 * string form (ethers.formatUnits already returns a decimal string). */
function fromUsdcUnits(baseUnits) {
  return Number(ethers.formatUnits(baseUnits, chainConfig.usdcDecimals));
}

/**
 * Deterministic per-hand identifier for operatorSettleHand's replay guard -
 * keccak256(tableId, handNumber), matching solidity's
 * abi.encodePacked(uint256,uint256) exactly so a hand can be independently
 * re-derived and checked against isHandSettled() by anyone, not just this
 * backend.
 */
function computeHandId(tableId, handNumber) {
  return ethers.solidityPackedKeccak256(['uint256', 'uint256'], [tableId, handNumber]);
}

/**
 * Verifies an on-chain fundTable() transaction actually happened, was
 * mined with enough confirmations, and matches the tableId/player the
 * caller claims - before the backend credits anything off-chain. This is
 * the check that stands between "player says they sent USDC" and "player's
 * seat stack actually goes up" (see onchainRakeService.js's
 * verifyAndCreditRebuy).
 *
 * Returns { amount, blockNumber } (amount in human USDC dollars) or throws
 * with a message safe to surface to the caller.
 */
async function verifyFundTableTx(txHash, expectedTableId, expectedPlayerAddress) {
  const provider = getProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error('Transaction not found (it may still be pending, or the hash is wrong).');
  }
  if (receipt.status !== 1) {
    throw new Error('Transaction reverted on-chain.');
  }
  if (receipt.to && receipt.to.toLowerCase() !== chainConfig.contractAddress.toLowerCase()) {
    throw new Error('Transaction was not sent to the OpenDeckPoker contract.');
  }

  const currentBlock = await provider.getBlockNumber();
  const confirmations = currentBlock - receipt.blockNumber + 1;
  if (confirmations < chainConfig.requiredConfirmations) {
    throw new Error(
      `Transaction has ${confirmations} confirmation(s); ${chainConfig.requiredConfirmations} required before crediting.`
    );
  }

  const contractInterface = new ethers.Interface(OpenDeckPokerAbi);
  let matched = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== chainConfig.contractAddress.toLowerCase()) continue;
    let parsed;
    try {
      parsed = contractInterface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== 'Funded') continue;
    const tableId = parsed.args.tableId.toString();
    const player = String(parsed.args.player).toLowerCase();
    if (tableId === String(expectedTableId) && player === expectedPlayerAddress.toLowerCase()) {
      matched = parsed;
      break;
    }
  }

  if (!matched) {
    throw new Error('No matching Funded event for this table/player was found in that transaction.');
  }

  return {
    amount: fromUsdcUnits(matched.args.amount),
    blockNumber: receipt.blockNumber,
  };
}

/**
 * Calls operatorSettleHand on-chain, applying signed USDC deltas (already
 * computed off-chain by onchainRakeService.js) to every on-chain-backed
 * player in a settled hand, and sweeping the rake slice. Deltas are
 * human-dollar numbers; converted to USDC base units here.
 */
async function settleHandOnChain(tableId, handNumber, playerDeltas, rakeAmount) {
  const contract = getOperatorContract();
  const handId = computeHandId(tableId, handNumber);

  const players = playerDeltas.map((d) => d.address);
  const deltas = playerDeltas.map((d) => toUsdcUnits(d.delta));
  const rakeUnits = toUsdcUnits(rakeAmount);

  const tx = await contract.operatorSettleHand(tableId, handId, players, deltas, rakeUnits);
  const receipt = await tx.wait();
  return { txHash: receipt.hash, handId };
}

/** Marks/clears whether a player's on-chain balance at a table is currently
 * backing a live seat (withdrawal gate - see the contract's doc comment). */
async function setSeatedForWithdrawal(tableId, playerAddress, isSeated) {
  const contract = getOperatorContract();
  const tx = await contract.setSeatedForWithdrawal(tableId, playerAddress, isSeated);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Reads a player's pooled on-chain balance for a table, in human USDC. */
async function getOnchainBalance(tableId, playerAddress) {
  const contract = getReadContract();
  const raw = await contract.balanceOf(tableId, playerAddress);
  return fromUsdcUnits(raw);
}

module.exports = {
  getReadContract,
  getOperatorContract,
  toUsdcUnits,
  fromUsdcUnits,
  computeHandId,
  verifyFundTableTx,
  settleHandOnChain,
  setSeatedForWithdrawal,
  getOnchainBalance,
};
