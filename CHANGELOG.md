# Changelog

## 0.5.0 — published, 2026-10-28

- Add deployment-aware Folderit Connection credentials alongside unchanged standard-cloud OAuth2 credentials.
- Verify exact public OIDC discovery before client-secret exchange; bind encrypted sessions to deployment, client and account. Pin public DNS/TLS routing and reject redirects, private destinations and credential forwarding to storage.
- Route every action, selector, polling request and anonymous binary transfer through its selected deployment. Generate links only for the configured browser origin.
- Add Connection/Get, exact-version downloads with byte verification, and PDF previews. Keep all binary operations unavailable as AI tools.
- Scope new polling checkpoints and deployment-workflow receipt keys by deployment and account. Keep the 0.4 customer bundle/exports intact and provide 0.5 variants separately under examples/deployments. Preserve existing cloud credential defaults, checkpoints and cloud receipt keys.
- Add a credential-free read-only deployment example and installation/migration guidance. Standard-cloud and Apollo authenticated read-only acceptance passed. Chaffinch authenticated acceptance and 0.5.0 n8n Cloud availability remain separate checks.

### Customer workflow examples

- Add IMAP/Outlook attachment archiving with persistent receipts, a shared processing lock and actual downloaded-byte verification.
- Add Microsoft Teams arrival notices and document Due-date reminder workflows.
- Add one-time Data Table setup, shared SMTP failure alerts and operator recovery instructions.
- Add 15 tests covering workflow exports and their processing rules. No connector runtime changes.

## 0.4.1 — 2026-10-27

- Record n8n verification and Cloud publication; link the customer setup guide.
- Include three inactive, credential-free starter workflows for attachment archiving, Slack notifications and read-only AI lookup.
- Add setup, permissions, recovery and platform limitations to each workflow.
- No changes to connector runtime operations.

## 0.4.0 — 2026-10-12

- Enable Folderit JSON actions as native n8n AI-agent tools.
- Hide binary upload, version-upload and download actions in the tool picker and reject them before API access in tool execution.
- Preserve all existing operations in normal workflows.

## 0.3.1 — 2026-10-10

- Explicitly leave AI tool support disabled for binary document operations.
- Remove the inline lint exception so the source passes n8n package scanning.

## 0.3.0 — 2026-10-10

- Reject startup or leadership changes without a saved polling checkpoint, avoiding silent rebaselining.
- Verify quiet-poll persistence across restart on n8n 2.42.5 with durable cursors.
- Keep polling sequence comparisons compatible with the ES2019 build target.
- Add file version upload and paginated version history with explicit lock support.
- Add available workflow discovery, dynamic start options, queued start and progress reads.
- Add a polling trigger for new files, folders, versions, record edits, metadata and task events.
- Seed new subscriptions without replaying history; preserve checkpoints on errors and manual previews.
- Resolve version events against the exact historical version and report polling gaps explicitly.

## 0.2.0 — unreleased

- Add account, folder, metadata field and select-option pickers.
- Add file/folder search with stable cursor pagination and explicit limits.
- Add metadata discovery, read, typed update and clear operations.
- Validate field types, select membership, decimal precision and table columns.
- Skip unchanged values and verify saved values without repeating writes.

## 0.1.0 — local prototype

- Add Folderit OAuth2 client-credentials authentication.
- Add file get, paginated list and multipart upload.
- Add streamed file download with credential-isolated signed storage requests.
- Keep pagination page size constant to prevent repeated records when a limit spans pages.
- Add folder create, get and paginated list.
- Add contract tests for upload failure handling, pagination and credential isolation.
