// Enoki zkLogin + gas-sponsorship config. These are PUBLIC values (NEXT_PUBLIC_*):
// the Enoki *public* api key (enoki_public_…) and the Google OAuth client id are
// safe in the browser — sponsorship and allowed move-call targets are enforced by
// the Enoki portal allowlist, not by secrecy of the key. When either is absent,
// zkLogin is disabled and the app falls back to wallet-extension connect.
//
// NOTE: Next.js only inlines `process.env.NEXT_PUBLIC_*` when referenced literally,
// so these must be literal property reads (not computed).

export const ENOKI_API_KEY = process.env.NEXT_PUBLIC_ENOKI_API_KEY ?? "";
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

/** True only when both the Enoki key and the Google client id are configured. */
export const enokiEnabled = Boolean(ENOKI_API_KEY && GOOGLE_CLIENT_ID);
