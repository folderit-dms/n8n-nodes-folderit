# Changelog

## 0.3.0 — unreleased

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
