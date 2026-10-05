import type { ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { polygon, polygonAmoy } from "viem/chains";
import { env } from "../config/env";

/**
 * The actual Privy-SDK-touching half of PrivyProviders.tsx, split into its
 * own module so "@privy-io/react-auth" and "viem/chains" (~1.7MB combined,
 * per the `npm run build` chunk-size warning) are only ever fetched via the
 * React.lazy() in PrivyProviders.tsx when VITE_PRIVY_APP_ID is actually set.
 * Do not import this file directly - go through PrivyProviders.tsx, which
 * gates the dynamic import on isPrivyConfigured().
 */
export default function ConfiguredPrivyProviders({ children }: { children: ReactNode }) {
  const activeChain = env.polygonChainId === polygonAmoy.id ? polygonAmoy : polygon;

  return (
    <PrivyProvider
      appId={env.privyAppId}
      config={{
        loginMethods: ["email"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          // Confirmation-modal control lives here in this SDK version (the
          // older embeddedWallets.noPromptOnSignature is gone). true =
          // players still get a confirmation UI before every
          // signature/transaction.
          showWalletUIs: true,
        },
        defaultChain: activeChain,
        supportedChains: [polygon, polygonAmoy],
        appearance: {
          walletChainType: "ethereum-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
