const { CryptoDeposit } = require('../../models/real_money');
const WalletManager = require('../wallet/walletManager');
const BitcoinService = require('./bitcoinService');
const EthereumService = require('./ethereumService');
const CryptoService = require('./cryptoService');

async function inspect(deposit) {
  if (deposit.asset === 'BTC') return new BitcoinService().getDeposit(deposit.address);
  if (deposit.asset === 'ETH') return new EthereumService().findDeposit(deposit.address, deposit.created_at && Math.floor(new Date(deposit.created_at).getTime() / 1000));
  if (deposit.asset === 'XMR' && deposit.txid) return new CryptoService().checkConfirmations(deposit.txid);
  return { status: 'watching', confirmations: 0 };
}

async function pollCryptoDeposits(db) {
  const deposits = await CryptoDeposit.findAll({ where: { status: ['watching', 'pending'] } });
  for (const deposit of deposits) {
    try {
      const result = await inspect(deposit);
      if (result.txid) deposit.txid = result.txid;
      deposit.confirmations = result.confirmations || 0;
      if (result.amount != null) deposit.amount = result.amount;
      deposit.status = result.status;
      if (result.status === 'confirmed' && !deposit.credited_at) {
        await WalletManager.credit(db, deposit.user_id, result.amount, `crypto_deposit:${deposit.asset}:${result.txid}`, 'deposit');
        deposit.credited_at = new Date();
        deposit.status = 'credited';
      }
      await deposit.save();
    } catch (err) { console.error(`[crypto monitor] ${deposit.asset} deposit ${deposit.id}:`, err.message); }
  }
}

function startCryptoDepositMonitor(db) {
  const interval = Math.max(Number(process.env.CRYPTO_MONITOR_INTERVAL_MS || 30000), 10000);
  pollCryptoDeposits(db).catch((err) => console.error('[crypto monitor] startup:', err.message));
  return setInterval(() => pollCryptoDeposits(db).catch((err) => console.error('[crypto monitor] tick:', err.message)), interval);
}
module.exports = { pollCryptoDeposits, startCryptoDepositMonitor };
