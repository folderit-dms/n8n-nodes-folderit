# OAuth2 credential naming and migration

> Execute inline with superpowers:executing-plans and test-driven-development. The user approved preparing the rename and migration guide; another publication requires separate approval.

**Goal:** Satisfy the official scanner's OAuth2 naming requirements while preserving the standard-cloud credential and preventing silent reuse of retired deployment selections.

**Design:** Register `FolderitConnectionOAuth2Api` / `folderitConnectionOAuth2Api` in place of deployment-only `FolderitApi` / `folderitApi`. Keep `folderitOAuth2Api` unchanged. Detect old deployment selections before credential access or requests, including exports missing the authentication parameter. Explain how users recreate and reselect the connection using their existing Folderit API client. No automatic credential migration or secret extraction.

**Scope:** Credential file/class/name, deployment constant and request guard, action/trigger credential registration, affected deployment examples/tests, migration guide, README/changelog/package metadata and strict local lint. Starter/library workflows and ZIPs stay unchanged. Prepare an unpublished 0.6.0 candidate to signal the deployment-credential migration.

## Steps

- [ ] Add failing tests for registration, old explicit/implicit selections stopping before requests, and the new selection ignoring a stale retired credential reference.
- [ ] Record the official source scanner failing on 0.5.1 with inline configuration disabled.
- [ ] Rename the deployment credential and update references; preserve OAuth2 behavior, bindings, standard-cloud fields, signed-storage isolation and Options compatibility.
- [ ] Keep the retired authentication choice visible with a migration notice and actionable error; never choose another saved connection automatically.
- [ ] Set local ESLint `noInlineConfig` so CI cannot accept scanner-incompatible naming exemptions.
- [ ] Update deployment-only examples, write migration/recovery instructions, and record the unpublished candidate version.
- [ ] Build, run targeted/full tests, strict source/tarball scanner, packaging checks and archive comparison. Perform native checks where the existing credential types permit; report any new-type provider acceptance honestly.
- [ ] Commit the reviewable candidate and prepare PR/CI. Do not publish or create credentials without the relevant authorization.

## Review focus

- Saved standard-cloud workflows must keep `folderitOAuth2Api` and its existing account picker contract.
- An old deployment parameter or old-only credential reference must produce migration guidance before any network or credential-store access.
- A deliberately selected new credential may coexist with stale old references; it must use only the selected new type.
- A deployment/account scope mismatch must still stop before writes; token refresh must not replay writes.
- Existing three library exports, generic arrival workflow, starter ZIP and intentional send-failure quarantines must be unchanged.

Ruling: Keep eslint.config.mjs at the exact n8n default because strict CLI rejects any modification. Add npm run lint:release with --no-inline-config to CI and the release build, preserving the official strict configuration and enforcing the scanner policy.
