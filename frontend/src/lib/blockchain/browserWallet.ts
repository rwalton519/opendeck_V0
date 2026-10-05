import { BrowserProvider, Contract, JsonRpcProvider, parseUnits } from "ethers";
import { chain, isChainConfigured } from "../../config/chain";
import OpenDeckPokerAbi from "../../abi/OpenDeckPoker.json";
import Erc20Abi from "../../abi/ERC20.json";

/**
 * Thin wrapper around window.ethereum (MetaMask or any EIP-1193 injected
 * provider). Nothing here talks to the OpenDeck backend directly - it only
 * talks to the player's own wallet and the chain. The backend never sees a
 * private key; it only ever sees a signature (for wallet linking, see
 * src/api/onchain.ts) or a transaction hash (for rebuys, see
 * src/api/cashgame.ts's rebuyOnChain), both of which it verifies
 * independently against Polygon (services/blockchain/openDeckPokerContract.js).
 */

// Minimal EIP-1193 provider shape - avoids depending on @metamask/* types
// just for this one interface, and works for any injected wallet, not only
// MetaMask specifically. Also the exact shape Privy's
// ConnectedWallet.getEthereumProvider() returns for an embedded wallet
// (see hooks/usePrivyWalletLink.ts), which is what lets the
// *WithProvider() functions below serve both wallet sources with no
// MetaMask-specific assumptions.
export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    // Not narrowed to Eip1193Provider here deliberately: @privy-io/react-auth
    // already augments Window.ethereum as `ethereum?: any`, and TS requires
    // merged declarations to match exactly. getInjectedProvider() below
    // casts to Eip1193Provider at the one place this value is actually
    // read, so this loose ambient type doesn't weaken type safety anywhere
    // else in this file.
    ethereum?: any;
  }
}

export class WalletNotFoundError extends Error {
  constructor() {
    super("No wallet extension found. Install MetaMask (or another injected wallet) to play with USDC.");
    this.name = "WalletNotFoundError";
  }
}

function getInjectedProvider(): Eip1193Provider {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new WalletNotFoundError();
  }
  return window.ethereum;
}

/** Requests account access and returns the connected address (checksum-cased). */
export async function connectWallet(): Promise<string> {
  const injected = getInjectedProvider();
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner();
  return signer.getAddress();
}

/** Ensures the wallet is on the configured Polygon chain, adding it first if
 * the wallet doesn't already know about it. */
export async function ensureCorrectNetwork(): Promise<void> {
  const injected = getInjectedProvider();

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.chainIdHex }],
    });
  } catch (err) {
    // 4902 = chain not added to the wallet yet.
    const code = (err as { code?: number } | null)?.code;
    if (code !== 4902) throw err;
    await injected.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chain.chainIdHex,
          chainName: chain.name,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorerUrls,
          nativeCurrency: chain.nativeCurrency,
        },
      ],
    });
  }
}

/** Message the player must sign to link a wallet - see src/api/onchain.ts's
 * getLinkMessage, which fetches the exact text the backend will verify. */
export async function signMessage(address: string, message: string): Promise<string> {
  return signMessageWithProvider(getInjectedProvider(), address, message);
}

/**
 * Same signing flow as signMessage(), but against an arbitrary EIP-1193
 * provider rather than window.ethereum specifically. Lets the link-wallet
 * flow (POST /wallet/onchain/link) be shared between a MetaMask-style
 * injected wallet and a Privy embedded wallet's own provider (see
 * hooks/usePrivyWalletLink.ts) instead of duplicating it.
 */
export async function signMessageWithProvider(
  injected: Eip1193Provider,
  address: string,
  message: string,
): Promise<string> {
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner(address);
  return signer.signMessage(message);
}

export interface FundTableResult {
  txHash: string;
}

/**
 * The actual "Rebuy with USDC" on-chain flow: approve the contract to pull
 * `amount` USDC, then call fundTable(tableId, amount). Two separate wallet
 * confirmations are unavoidable with a standard ERC-20 (approve is a
 * distinct transaction from the transfer that uses it) - the caller's UI
 * should tell the player to expect two prompts.
 *
 * Returns the fundTable transaction hash - the caller then sends this to
 * the backend's POST /cashgame/:tableId/rebuy-onchain (see
 * src/api/cashgame.ts's rebuyOnChain), which independently verifies it
 * on-chain before crediting any chips (services/blockchain/onchainRakeService.js).
 * This function does NOT itself wait for the backend to see it, only for
 * the transaction to be mined.
 */
export async function fundTableWithUsdc(tableId: number, amountUsdc: number): Promise<FundTableResult> {
  if (!isChainConfigured()) {
    throw new Error("On-chain USDC play is not configured for this deployment yet.");
  }

  const injected = getInjectedProvider();
  const provider = new BrowserProvider(injected);
  const signer = await provider.getSigner();

  const amountUnits = parseUnits(String(amountUsdc), chain.usdcDecimals);

  const usdc = new Contract(chain.usdcAddress, Erc20Abi, signer);
  const approveTx = await usdc.approve(chain.contractAddress, amountUnits);
  await approveTx.wait();

  const pokerContract = new Contract(chain.contractAddress, OpenDeckPokerAbi, signer);
  const fundTx = await pokerContract.fundTable(tableId, amountUnits);
  const receipt = await fundTx.wait();

  return { txHash: receipt.hash as string };
}

/** Reads the connected wallet's own USDC balance (for showing "you have $X
 * available to fund" before they commit to a rebuy amount). */
export async function getUsdcWalletBalance(address: string): Promise<number> {
  return getUsdcBalanceWithProvider(getInjectedProvider(), address);
}

/** Same balance read as getUsdcWalletBalance(), against an arbitrary
 * EIP-1193 provider - see signMessageWithProvider() above for why. */
export async function getUsdcBalanceWithProvider(injected: Eip1193Provider, address: string): Promise<number> {
  const provider = new BrowserProvider(injected);
  const usdc = new Contract(chain.usdcAddress, Erc20Abi, provider);
  const raw = (await usdc.balanceOf(address)) as bigint;
  return Number(raw) / 10 ** chain.usdcDecimals;
}

/**
 * Reads any address's USDC balance directly from the configured Polygon
 * RPC - no wallet/provider connection needed at all. Used by WalletPage to
 * show the balance of a Privy-created (or previously linked) wallet just
 * from its address, without requiring the player to have an active wallet
 * session in the tab that's rendering the balance.
 */
export async function getUsdcBalanceReadOnly(address: string): Promise<number> {
  const provider = new JsonRpcProvider(chain.rpcUrls[0]);
  const usdc = new Contract(chain.usdcAddress, Erc20Abi, provider);
  const raw = (await usdc.balanceOf(address)) as bigint;
  return Number(raw) / 10 ** chain.usdcDecimals;
}
