# n8n-nodes-folderit

Folderit document, folder, search, metadata, version and workflow operations, with polling triggers for n8n.

**Release status:** [0.3.0 is published on npm](https://www.npmjs.com/package/n8n-nodes-folderit/v/0.3.0) with GitHub Actions provenance. The registry-installed package passed a native n8n 2.42.5 read/download test with exact file contents. n8n verification and Cloud availability are pending. Source repository: [folderit-dms/n8n-nodes-folderit](https://github.com/folderit-dms/n8n-nodes-folderit).

## Operations

- File: get details and metadata; list or search files; upload a binary file; add a file version; list version history; download a file as binary data.
- Folder: create a child folder; get details; list or search folders.
- Metadata: list field definitions; read record metadata; validate, update or clear one field.
- Workflow: list available manual starts; queue a selected workflow; read all progress runs.
- Folderit Trigger: new file, folder or version; record edits; metadata changes; workflow task events.
- Account, folder, metadata-field, select-option and workflow pickers use exact IDs.
- List operations support Return All or a result limit and pagination (at most 1,000 pages).
- Downloads stream into n8n binary storage, preserving the file name and MIME type.
- Uploads support non-empty files up to 100 MiB, in 10 MiB parts. Uploads are buffered in memory.

Delete operations and approval-response actions are not included. Workflow task events report task activity; an accepted task does not by itself prove that the whole workflow completed.

## Credentials

Folderit currently documents API access as a Tailor-plan feature. Obtain a client ID, client secret and account UID from your Folderit administrator. Create a **Folderit OAuth2 API** credential in n8n and enter the client ID and secret. n8n handles the OAuth2 client-credentials exchange at `https://auth.folderit.com/oauth2/token`. Choose the account in the node, or enter its UID using an expression.

Credentials belong in n8n's credential store. Never put them in workflow JSON, this repository or npm. The node connects to the public `api.folderit.com` service; dedicated/private API hosts are not supported in this release.

## Example workflows

**Archive an attachment:** an email node that retrieves binary attachments → Folderit / File / Upload. Set the input binary field to the actual attachment field name and provide the destination folder UID. For several attachments, split them into separate items first.

**List a folder:** Manual Trigger → Folderit / File / Get Many. Set the account and folder UIDs, select the credential and execute. Each file becomes a separate output item.

**Create a client folder:** Manual Trigger → Folderit / Folder / Create. Supply the parent folder UID and name. Enable Return Existing Folder if a same-name existing folder should be reused.

**Test a document round trip:** import [document-roundtrip.json](examples/document-roundtrip.json), set your account and test parent-folder UIDs in **Test Settings**, and select your Folderit credential in each Folderit node. It creates a test folder, uploads synthetic text, gets the file, downloads it and extracts the text. Compare `downloadedText` with the original `text` in Test Settings. Each execution uploads a new file; this is a smoke test, not the controlled-release/idempotency template. In CLI development mode n8n names the node `CUSTOM.folderit`; the distributed example uses the installed package name `n8n-nodes-folderit.folderit`.

**Search and read metadata:** import [search-and-read-metadata.json](examples/search-and-read-metadata.json), fill Search Settings and select your credential in both Folderit nodes. Search returns one item per matching document; metadata reads return one item per assigned field. No matches or no assigned metadata return no output items.

## Search and typed metadata

File and Folder Search support a query, selectable search fields, parent-folder, extension and document-number filters. At least one query/filter is required. Results use the server's `searchAfter` cursor with UID as a tie-breaker. Limits are 10,000 results and 100 pages; a capped Return All operation fails explicitly rather than silently truncating.

For Metadata / Update, select the exact field and record UID, then use **JSON Value**, **Select Option** or **Clear Value**. JSON examples: `"Approved"`, `42`, `false`, `"2026-10-10"`, `["first-option-uid", "second-option-uid"]`. Decimal strings preserve precision; datetime strings require an explicit timezone. Table values use `{"rows":[[{"key":"column_key","value":"text"}]]}` and are validated against the field's actual column schema. Unknown fields/options/types and invalid values are rejected before saving. User/entity values are exact UIDs, with access enforced by Folderit.

Updates replace the selected field's values only. An unchanged value causes no write; successful writes require a matching readback. Clear uses explicit null. Locked files may require an existing File Lock ID; locks are never overridden. If verification fails after a write, inspect the record before retrying. The node never repeats the write to repair stale readback. These checks do not make concurrent writes atomic.

## Versions and workflows

**File / Add Version** takes incoming binary data and an existing file UID. It keeps the document identity and uses the same multipart upload protections and 100 MiB limit as a new upload. Supply an existing File Lock ID if needed. **Get Versions** returns each historical version separately, including `fileUid` and `versionUid`, with a 10,000-result safety limit. Check version history before retrying an uncertain upload completion.

**Workflow / Start** refreshes the record's manual-start options before submitting the chosen `workflowUID::triggerID`. Output `queued: true` means accepted for processing. Use **Get Status** to read progress afterward; multiple runs of the same workflow are preserved. Starts are not automatically retried or idempotent. Inspect progress before repeating an uncertain start.

## Polling triggers

Choose the account, event and optional exact record UID in **Folderit Trigger**, then set its polling interval. Publish/activate the workflow in your n8n instance to start scheduled polling. Initial activation establishes a baseline; it does not import old history. Changing the account, credential ID, event or record filter starts a fresh baseline. Manual testing previews up to ten recent matching events without consuming the scheduled checkpoint.

Each output has a stable audit `id`, `auditUid`, sequence `auditId`, `event` and `entityUid`. Version events additionally carry the exact historical `versionUid` and version details. Task events include `taskUid`; metadata events include `metaUid`. Arbitrary audit payloads are not exposed. Use Get or Metadata / Get afterward when current record values are needed.

The trigger reads the account's recent audit log in descending sequence order, scans at most 1,000 audit rows per poll, and emits new matching events oldest first. Version enrichment scans at most 1,000 versions per file and fails if the exact version cannot be found. It never substitutes the current version. Failures leave the checkpoint unchanged. Filtered non-matching events still advance a successful poll's checkpoint.

Poll at least hourly and use a shorter interval on busy accounts. This implementation uses the API's default one-day audit window; interruptions longer than 23 hours and backlogs beyond the scan limit stop with an explicit error. Reconcile missed events first, then recreate the trigger node to establish a new baseline. It does not use the unverified GET-body sync cursor from the Zapier candidate. Sequence polling assumes the service exposes events in sequence order; delayed lower-sequence events and audit access changes need separate reconciliation. On n8n runtimes using legacy workflow static data, quiet polls may only update memory until an event starts an execution. A restart without a saved checkpoint now stops with a reconciliation error instead of silently establishing a fresh baseline. Long quiet periods on legacy runtimes can still require reconciliation after restart. Quiet-poll persistence was verified on self-hosted n8n 2.42.5 with durable polling enabled (configuration below); n8n Cloud compatibility remains subject to review. Polling is not an exactly-once delivery guarantee: downstream retries can repeat actions, so use the audit UID with a durable deduplication ledger for consequential work.

Import [watch-file-versions.json](examples/watch-file-versions.json) for a credential-free starting point. Select your account, optional file UID and credential before activation.

## Tested polling configuration

Action nodes and the polling trigger were tested on self-hosted n8n **2.42.5**, Node **24.21.0**. To persist quiet polling checkpoints on that tested runtime, all four settings were enabled before starting n8n:

```sh
N8N_SCHEDULER_ENABLED=true
N8N_SCHEDULER_POLL_TRIGGERS_ENABLED=true
N8N_USE_WORKFLOW_PUBLICATION_SERVICE=true
N8N_POLLER_DURABLE_CURSORS_ENABLED=true
```

A quiet poll saved its cursor with zero workflow executions; restarting n8n preserved that cursor and subsequent quiet polls advanced its timestamp with no errors. These are version-specific runtime settings, not a claim of compatibility with every n8n deployment. Cloud administrators control their runtime configuration. The trigger uses n8n's public polling context API and fails explicitly when a restart has no saved checkpoint. Reconcile missed activity before deliberately establishing a new baseline.

## Development

Use a current Node.js 24 LTS release.

```sh
npm ci
npm run build
npm run lint
npm test
npm run dev -- --custom-user-folder ../work/n8n-folderit-local
```

The development command runs a local n8n instance with the connector loaded. Initial n8n owner setup and real Folderit credentials are required for live testing. Keep the local instance bound to localhost. Do not commit its database or credentials.

## Error handling and limits

Writes are not automatically retried. A lost upload-completion response may mean the file was created: inspect the destination before repeating it. Failed part transfers attempt to abort unfinished uploads. A failed abort requires checking the upload state with Folderit. OAuth credentials are never attached to signed storage upload or download requests. The current storage implementation accepts only HTTPS Amazon S3 URLs; a different Folderit storage endpoint needs a reviewed compatibility update.

If Folderit rejects a request, confirm the account UID, permissions and node inputs. For rate limiting, slow the workflow and retry reads after the server's waiting period. Use business-level document IDs or an external ledger to prevent duplicate uploads. n8n's execution history can contain document data returned by the API; configure retention appropriately.

## Validation status

TypeScript build, n8n lint and 43 automated tests pass. On 2026-10-10, native n8n 2.42.5 executed the complete round-trip workflow using the actual Folderit OAuth credential and built-in binary nodes. The downloaded 79-byte UTF-8 test content matched exactly, including its non-ASCII character; filename and MIME type were preserved. A separate read-only download also passed after the cached token was marked expired, verifying native token renewal.

Version 0.2.0 passed native document search, integer metadata write/readback, unchanged-value suppression and clear verification. A separate live read confirmed cleanup. Account/folder/metadata picker calls and folder search passed through the live helper harness. Other metadata types have contract tests but have not all been exercised in live n8n workflows.

Version 0.3.0 passed native version upload, exact 80-byte download comparison, manual workflow start and workflow/history reads. The tested workflow contained only a conditional step, so no approval request or notification was sent. A live helper poll emitted the exact new version once, and a native scheduled workflow resumed the captured checkpoint and emitted the same event. Checkpoint persistence and no replay after restart were verified after an emitted event.

Local owner setup is complete. Browser testing verified the existing OAuth credential, account and metadata-field selectors, a complete read-only download/extraction workflow with the exact 80-byte UTF-8 test content, and manual trigger preview with the exact historical version. The icon loads from the installed archive. Folder, select-option and workflow pickers also passed in the editor, including select labels and exact workflow start-option resolution without executing writes. The packed npm archive was installed offline into the n8n community-node directory, and a native read/download workflow passed with identical bytes. The public npm 0.3.0 package was subsequently installed from the registry: all 39 files matched the tested archive, and a native read/download execution returned the exact expected 80 bytes. The earlier API harness also passed folder/file lists. The tooling dependency advisory has been assessed; upstream fixes and public-release checks are tracked in RELEASE-CHECKS.txt.

## Public release

GitHub repository: https://github.com/folderit-dms/n8n-nodes-folderit

Public npm package: [n8n-nodes-folderit 0.3.0](https://www.npmjs.com/package/n8n-nodes-folderit/v/0.3.0). Self-hosted users can install `n8n-nodes-folderit` through **Settings → Community Nodes**, subject to their instance settings.

Version 0.3.0 was built and staged by the included GitHub Actions workflow using npm trusted publishing and provenance, then approved by the maintainer with 2FA. [Release build](https://github.com/folderit-dms/n8n-nodes-folderit/actions/runs/38058519315) · [Provenance](https://search.sigstore.dev/?logIndex=3187253309).

Verification is handled through https://creators.n8n.io/nodes. n8n decides approval; npm publication alone does not make the connector available in n8n Cloud.

## References

- https://api.folderit.com/
- https://www.folderit.com/knowledge-base/application-programming-interface-api/
- https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes

## License

MIT
