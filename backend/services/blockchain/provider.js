const { ethers } = require('ethers');
const { chainConfig, requireChainConfigured } = require('./chainConfig');

let _provider = null;
let _operatorWallet = null;

/** Lazily-constructed read provider - shared so we don't open a fresh
 * JSON-RPC connection per request. */
function getProvider() {
  requireChainConfigured();
  if (!_provider) {
    _provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl, chainConfig.chainId);
  }
  return _provider;
}

/** The operator's signing wallet - the only account allowed to call
 * operatorSettleHand / setSeatedForWithdrawal on-chain. Constructed lazily
 * (not at module load) so a deployment that hasn't configured on-chain
 * play yet doesn't crash at require-time just because this file got
 * pulled in transitively. */
function getOperatorWallet() {
  requireChainConfigured();
  if (!_operatorWallet) {
    _operatorWallet = new ethers.Wallet(chainConfig.operatorPrivateKey, getProvider());
  }
  return _operatorWallet;
}

module.exports = { getProvider, getOperatorWallet };
