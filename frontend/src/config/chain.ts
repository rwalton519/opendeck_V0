import { env } from "./env";

/**
 * Everything the browser wallet layer (src/lib/blockchain/browserWallet.ts)
 * needs to know about which chain we're on - same "read it from env, one
 * source of truth" pattern as the rest of src/config/env.ts.
 */
export const chain = {
  chainId: env.polygonChainId,
  // MetaMask's wallet_addEthereumChain wants chainId as a 0x-prefixed hex string.
  chainIdHex: `0x${env.polygonChainId.toString(16)}`,
  isMainnet: env.polygonChainId === 137,
  name: env.polygonChainId === 137 ? "Polygon Mainnet" : "Polygon Amoy Testnet",
  rpcUrls:
    env.polygonChainId === 137
      ? ["https://polygon-rpc.com"]
      : ["https://rpc-amoy.polygon.technology"],
  blockExplorerUrls:
    env.polygonChainId === 137
      ? ["https://polygonscan.com"]
      : ["https://amoy.polygonscan.com"],
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  usdcAddress: env.usdcAddress,
  usdcDecimals: 6,
  contractAddress: env.openDeckPokerContractAddress,
} as const;

/** Whether on-chain play is even configured for this build - the "Rebuy
 * with USDC" UI should hide itself entirely rather than show a button that
 * can only ever fail if this is false. */
export function isChainConfigured(): boolean {
  return chain.contractAddress.length > 0;
}
