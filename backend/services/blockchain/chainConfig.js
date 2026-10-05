/**
 * Central runtime configuration for the Polygon/USDC integration. Same
 * "single source of truth via env vars" pattern as core/config.js - every
 * value here is overridable without touching code, and the module throws
 * loudly at first real use (not at require-time) if something essential is
 * missing, so importing this file in places that don't actually touch the
 * chain (e.g. at server boot, transitively) never breaks a deployment that
 * hasn't set up USDC yet.
 */

function readEnv(key, fallback = null) {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
}

const chainConfig = {
  /** Polygon mainnet chain id. 80002 (Amoy) for testnet deployments. */
  chainId: Number(readEnv('POLYGON_CHAIN_ID', '137')),

  /** JSON-RPC endpoint the backend uses to read events / send operator txs. */
  rpcUrl: readEnv('POLYGON_RPC_URL'),

  /** Deployed OpenDeckPoker.sol address (see contracts/deploy.js output). */
  contractAddress: readEnv('OPENDECK_POKER_CONTRACT_ADDRESS'),

  /** Native USDC on Polygon. Verify against Circle's published address for
   * whatever network POLYGON_CHAIN_ID actually points at before trusting
   * this in a non-mainnet environment. */
  usdcAddress: readEnv('USDC_ADDRESS', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359'),

  /** USDC has 6 decimals (unlike most ERC-20s' 18) - hardcoded, not
   * read from the token at runtime, since it changes the meaning of every
   * amount conversion in this module if ever wrong; getting it from chain
   * once at boot and caching would just move the same risk one step later
   * for no real benefit. */
  usdcDecimals: 6,

  /** Private key of the backend's operator wallet - the ONLY key allowed to
   * call operatorSettleHand / setSeatedForWithdrawal on-chain. Treat with
   * the same care as a payment processor's API secret: never log it, never
   * send it to the frontend, rotate it via setOperator() if it's ever
   * suspected compromised. */
  operatorPrivateKey: readEnv('OPENDECK_OPERATOR_PRIVATE_KEY'),

  /** How many confirmations to require before treating a player's fundTable
   * tx as final and crediting their off-chain seat stack. Polygon reorgs of
   * a handful of blocks are not unheard of; this is deliberately more
   * conservative than "1" for a real-money credit. */
  requiredConfirmations: Number(readEnv('POLYGON_REQUIRED_CONFIRMATIONS', '15')),
};

function requireChainConfigured() {
  const missing = ['rpcUrl', 'contractAddress', 'operatorPrivateKey'].filter((key) => !chainConfig[key]);
  if (missing.length) {
    throw new Error(
      `On-chain USDC integration is not configured (missing: ${missing.join(', ')}). ` +
      'Set POLYGON_RPC_URL, OPENDECK_POKER_CONTRACT_ADDRESS, and OPENDECK_OPERATOR_PRIVATE_KEY.'
    );
  }
}

module.exports = { chainConfig, requireChainConfigured };
