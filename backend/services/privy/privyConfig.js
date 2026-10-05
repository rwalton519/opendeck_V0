/**
 * Central runtime configuration for the Privy integration - same
 * "single source of truth via env vars" pattern as
 * services/blockchain/chainConfig.js and core/config.js.
 *
 * PRIVY_APP_ID is the same public App ID the frontend uses (as
 * VITE_PRIVY_APP_ID) - safe to duplicate here since it's not a secret.
 * PRIVY_APP_SECRET is backend-only: it must never be sent to the client,
 * logged, or committed. It's only needed if/when this backend verifies a
 * Privy identity/session token server-side (see ./privyClient.js) -
 * nothing on the wallet-linking path (api/routes/walletOnchainRouter.js)
 * requires it, since that path verifies wallet ownership by ECDSA
 * signature recovery, which works the same regardless of which wallet
 * (Privy embedded or an injected wallet like MetaMask) produced it.
 */

function readEnv(key, fallback = null) {
  const value = process.env[key];
  return value && value.length > 0 ? value : fallback;
}

const privyConfig = {
  appId: readEnv('PRIVY_APP_ID'),
  appSecret: readEnv('PRIVY_APP_SECRET'),
};

function isPrivyConfigured() {
  return Boolean(privyConfig.appId && privyConfig.appSecret);
}

function requirePrivyConfigured() {
  const missing = ['appId', 'appSecret'].filter((key) => !privyConfig[key]);
  if (missing.length) {
    throw new Error(
      `Privy is not configured (missing: ${missing.join(', ')}). Set PRIVY_APP_ID and PRIVY_APP_SECRET.`
    );
  }
}

module.exports = { privyConfig, isPrivyConfigured, requirePrivyConfigured };
