# Connector review correction

Implement the two exact requirements saved in outputs/n8n-connector-review-2026-11-03/portal-review-issues.txt of the parent workspace. The existing user authorization covers minimal tested review corrections; no release is authorized beyond 0.5.0.

Use built-in OAuth2 client credentials for folderitApi, preserving its public/custom deployment fields and deriving a hidden token endpoint from a validated API URL. Replace testedBy/connection-test.ts with a standard credential test that works at first save. Remove manual OAuth exchange and DNS pinning; retain strict URL, TLS, redirect, account and expected-scope protections at applicable request boundaries. Keep the legacy folderitOAuth2Api credential unchanged.

Move Version UID and Expected Connection Scope into Options. Keep execution fallback for older top-level exported parameters, with explicit Options values taking precedence, so exact-version download and destination-scope safeguards survive an upgrade. Update deployment-aware example JSONs to Options, but leave the proven starter package/three submission templates unchanged unless they actually use these fields.

Approaches: retain manual OAuth (rejected by review); remove custom deployments (breaks accepted customer scope); use built-in OAuth2 with validated derived endpoint and account-scoped helpers (selected as the minimal way to meet both requirements). No new dependency or product feature. Native/provider acceptance must be described according to actual evidence; local-only tests do not imply Cloud acceptance. Prepare a reviewable candidate without publishing npm, merging or changing live credentials.
