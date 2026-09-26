# World for Agents sandbox

Entry: https://haulie-chi.vercel.app/world-sandbox, also linked from the courier workspace and each simulated verification panel.

This connects to the **official** World sandbox OIDC service, not the local “Simulate fresh verification” button. World currently mocks sandbox identities. Successful sandbox authentication is not production proof of humanity.

## What works

1. Accept a sandbox delivery. The backend creates a five-minute transaction bound to the delivery, action, random state, nonce, S256 PKCE verifier and (when connected) existing subject.
2. World handles authentication at `https://sandbox.auth.world.org`. Haulie requests exactly `openid`, `max_age=0`, `prompt=login` and the supported Orb-v3 authentication class.
3. The backend checks callback state, exchanges the single-use code using confidential `client_secret_basic`, and validates the RS256 ID token against World's cached JWKS: issuer, audience, expiry, issue time, nonce, authentication class, proof-of-possession method and fresh `auth_time`.
4. Only the validated callback executes the sandbox acceptance. A second request must freshly authenticate the **same subject** to confirm pickup.
5. Status is read back from encrypted HttpOnly session state. URL success flags and client-side proof claims do not authorize actions. Denied, cancelled, expired, invalid and unavailable flows leave the requested action unauthorized.

Transactions and browser-scoped order state are AES-GCM encrypted, purpose-bound, expiring cookies; production cookies are Secure, HttpOnly, SameSite=Lax and `__Host-` prefixed. Raw subjects, token responses and secrets are not returned to the UI or logged by application code. Callback codes are only exchanged server-side. Provider requests time out and do not follow redirects or blindly retry consumed codes.

The requested credential is proportionate to the provider contract: only `openid`, with no profile or email scopes, and the sandbox’s sole advertised Orb-v3 class. This checks credential possession and continuity; it does not claim live biometrics or MFA.

## Configuration

Register in https://sandbox.auth.world.org/portal with `client_secret_basic` and the **exact** callback:

```
https://haulie-chi.vercel.app/api/world-sandbox/callback
```

Server-only Vercel production environment variables:

- `WORLD_SANDBOX_CLIENT_ID`
- `WORLD_SANDBOX_CLIENT_SECRET`
- `WORLD_SANDBOX_SESSION_SECRET`: independent random secret, at least 32 characters
- `WORLD_SANDBOX_ORIGIN`: `https://haulie-chi.vercel.app`

These are configured on the current deployment. No credentials belong in source control or `NEXT_PUBLIC_*`. Credential changes require a deployment. Other deployments need their exact HTTPS callback registered and the origin updated.

## Scope

The sandbox journey has its own isolated order ledger for each browser, expiring after 24 hours. It does not assign the shared PostgreSQL live jobs, change the local dashboard demo state, bind an actual Sui wallet, or pay money. This deliberately keeps the provider's fake test identities away from real inventory and funds. The existing IDKit-v4/PostgreSQL live backend remains separate.

The encrypted cookie ledger is appropriate only for these isolated test orders: it does not provide global courier uniqueness, cross-browser exclusive assignment, durable audit records, or atomic multi-tab mutations. Those guarantees require integrating the verified identity with the existing authenticated PostgreSQL transactions before enabling real deliveries. Provider code redemption and consumed pending cookies reject ordinary callback replay; this is not a claim of durable globally exactly-once settlement.

## Verification and integration debrief

Verified against the deployed official provider on 2026-09-26:

- Successful sandbox acceptance, then a second fresh pickup verification using the same World identity.
- Cancellation before returning from World prevented acceptance.
- Denied callback and mismatched state left the ledger empty.
- Cross-origin start request returned 403.
- Mobile/desktop layouts at 360, 390, 768, 1024 and 1440 pixels had no horizontal overflow.

Unit tests cover issuer/audience/signature/expiry/nonce validation, stale and future authentication, identity mismatch, encrypted-cookie tampering, cookie purpose separation and invalid/repeated order transitions. The denied callback test injects the documented OAuth error rather than claiming a person clicked a provider consent screen; current sandbox test authentication completes automatically.

Run local tests with `npm test` and `npm run test:e2e`. Run the opt-in real-provider suite with:

```
WORLD_SANDBOX_LIVE_TEST=1 PLAYWRIGHT_BASE_URL=https://haulie-chi.vercel.app npx playwright test tests/e2e/world-sandbox.spec.ts
```

Time to first success was not instrumented; the first deployed authorization-code round trip succeeded after registration credentials were configured. Main friction: public `/docs` is an overview, while detailed OIDC and freshness instructions are exposed through public MCP `list_idp_guides` / `get_idp_guide` at `https://sandbox.auth.world.org/mcp`. The official repository's app-install guidance lags the event's mocked-proof behavior. A direct browser-readable OIDC quickstart and explicit mock-identity behavior would improve onboarding.

Sources: https://sandbox.auth.world.org/docs, public MCP guides `getting-started`, `oidc`, `step-up`, and https://sandbox.auth.world.org/.well-known/openid-configuration.
