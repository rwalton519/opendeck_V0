const { PrivyClient } = require('@privy-io/server-auth');
const { privyConfig, isPrivyConfigured, requirePrivyConfigured } = require('./privyConfig');

/**
 * Lazily-constructed singleton - avoids instantiating (and validating
 * config for) a PrivyClient at require-time, so importing this module
 * anywhere doesn't break a deployment that hasn't set PRIVY_APP_SECRET
 * yet, same "throw at first real use, not at boot" convention as
 * services/blockchain/chainConfig.js's requireChainConfigured().
 */
let client = null;
function getClient() {
  requirePrivyConfigured();
  if (!client) {
    client = new PrivyClient(privyConfig.appId, privyConfig.appSecret);
  }
  return client;
}

/**
 * Verifies a Privy identity/access token (the `identity_token` /
 * `getAccessToken()` value the frontend can obtain from an authenticated
 * Privy session - see @privy-io/react-auth's useIdentityToken /
 * getAccessToken) and returns its verified claims, including the Privy
 * user id (claims.userId).
 *
 * Nothing in this codebase requires this today - wallet linking
 * (api/routes/walletOnchainRouter.js) verifies ownership by ECDSA
 * signature recovery instead, which needs no Privy secret at all. This
 * exists as the "server-side verification" hook for anything added later
 * that needs to confirm a request actually came from a Privy-authenticated
 * session (e.g. gating an admin action on a verified Privy identity,
 * rather than just a signed wallet address).
 */
async function verifyAuthToken(token) {
  return getClient().verifyAuthToken(token);
}

module.exports = { getClient, verifyAuthToken, isPrivyConfigured };
