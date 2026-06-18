"use client";

import {
  ConnectButton,
  useConnectWallet,
  useCurrentAccount,
  useDisconnectWallet,
  useWallets,
} from "@mysten/dapp-kit";
import { isGoogleWallet } from "@mysten/enoki";
import { enokiEnabled } from "../config/enoki";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Multi-color Google "G". */
function GoogleG() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-2.8-.4-4.1H24v7.8h12.4c-.3 2.1-1.6 5.2-4.7 7.3l7.2 5.6c4.3-4 6.2-9.9 6.2-16.6z" />
      <path fill="#FBBC05" d="M10.5 28.3c-.5-1.5-.8-3.1-.8-4.8s.3-3.3.8-4.8l-7.9-6.1C1 16.1 0 19.9 0 23.5s1 7.4 2.6 10.9l7.9-6.1z" />
      <path fill="#34A853" d="M24 47c6.3 0 11.6-2.1 15.5-5.7l-7.2-5.6c-2 1.4-4.7 2.3-8.3 2.3-6.4 0-11.7-3.7-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 47 24 47z" />
    </svg>
  );
}

/**
 * The one-tap onboarding control. When Enoki is configured, lead with "Continue
 * with Google" (zkLogin — no seed phrase, gas sponsored by Enoki) and keep the
 * standard wallet picker as a secondary option. When connected (any wallet),
 * collapse to an address chip with sign-out. Falls back to the wallet picker alone
 * when zkLogin isn't configured.
 */
export function AuthControls() {
  const account = useCurrentAccount();
  const wallets = useWallets();
  const { mutate: connect, isPending } = useConnectWallet();
  const { mutate: disconnect } = useDisconnectWallet();

  if (account) {
    return (
      <span className="pill" title={account.address}>
        <span className="dot" />
        <span className="mono">{short(account.address)}</span>
        <button className="linkbtn" onClick={() => disconnect()}>
          sign out
        </button>
      </span>
    );
  }

  const googleWallet = wallets.find((w) => isGoogleWallet(w));
  if (enokiEnabled && googleWallet) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          className="btn btn-google"
          disabled={isPending}
          onClick={() => connect({ wallet: googleWallet })}
        >
          <GoogleG /> Continue with Google
        </button>
        <ConnectButton />
      </div>
    );
  }

  return <ConnectButton />;
}
