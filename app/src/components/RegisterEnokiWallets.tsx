"use client";

import { useEffect } from "react";
import { useSuiClientContext } from "@mysten/dapp-kit";
import { isEnokiNetwork, registerEnokiWallets } from "@mysten/enoki";
import { ENOKI_API_KEY, GOOGLE_CLIENT_ID, enokiEnabled } from "../config/enoki";

/**
 * Registers Enoki zkLogin wallets (Google) into the wallet-standard registry, so
 * they show up in dapp-kit's normal connect flow — no seed phrase, and Enoki
 * sponsors gas. Renders nothing. A no-op unless both env keys are set and the
 * active network is Enoki-supported (mainnet/testnet/devnet). On sign-in the wallet
 * opens an OAuth popup and reads the id_token back from `redirectUrl` (defaults to
 * this page), so no dedicated callback route is needed — just allowlist the app
 * origin in Google + Enoki.
 */
export function RegisterEnokiWallets() {
  const { client, network } = useSuiClientContext();

  useEffect(() => {
    if (!enokiEnabled || !isEnokiNetwork(network)) return;
    const { unregister } = registerEnokiWallets({
      apiKey: ENOKI_API_KEY,
      providers: { google: { clientId: GOOGLE_CLIENT_ID } },
      client,
      network,
    });
    return unregister;
  }, [client, network]);

  return null;
}
