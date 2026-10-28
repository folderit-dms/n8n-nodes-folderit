# n8n-nodes-folderit

Folderit document, folder, search, metadata, version and workflow operations, with polling triggers for n8n.

**Release status:** [Version 0.5.0 is published on npm](https://www.npmjs.com/package/n8n-nodes-folderit/v/0.5.0) as of **28 October 2026**, with GitHub Actions provenance. All 68 registry files match the tested build, and n8n's official scanner passed its security, source and provenance checks. Standard-cloud and Apollo read-only acceptance passed locally. n8n Cloud currently offers verified **0.4.0**; the 0.5.0 update still needs n8n's verification and propagation before Cloud acceptance can run. Existing 0.4.0 Cloud workflows and downloads remain supported.

## Get started

Read the [Folderit n8n setup guide](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/) for credentials, installation and a first workflow.

- **n8n Cloud:** as an instance owner or admin, open a workflow, click **+**, search **Folderit**, select it under **More from the community**, and click **Install**. If it is hidden, enable **Verified community nodes** in your Cloud console's **Instance settings**. See [n8n's installation instructions](https://docs.n8n.io/integrations/community-nodes/installation/verified-install/).
- **Self-hosted n8n:** open your n8n instance's **Settings → Community nodes → Install**, enter `n8n-nodes-folderit`, and install it, subject to your instance settings.
- In a Folderit node, create a **Folderit OAuth2 API** credential using the client ID and secret supplied by your Folderit administrator. Select your account and destination folder. API access and permissions must be enabled for your Folderit account.

A Creator Portal account is for publishing integrations. It is separate from the n8n Cloud instance where customers run workflows.


## Operations

- File: get details and metadata; list or search files; upload a binary file; add a file version; list version history; download current or exact-version bytes; download an available PDF preview. Exact-version downloads and previews are new in 0.5.0.
- Connection: verify the selected account and return non-secret API/browser/account context (0.5.0).
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

Credentials belong in n8n's credential store. Never put them in workflow JSON, this repository or npm. Published version 0.4.0 connects to the public `api.folderit.com` service. Version 0.5.0 adds the separate connection described below; existing OAuth2 credentials retain their cloud routing and account selection.

## Deployment connections (0.5.0)

One package supports standard cloud and public single-tenant/custom-domain deployments through **Folderit Connection API** credentials. This connection requires an n8n runtime exposing its secure egress helper; it has been tested locally on **n8n 2.42.5 / Node 24.21.0**. Missing capability fails before authentication. Installation on n8n Cloud remains subject to n8n's package verification and availability.

1. Install published `n8n-nodes-folderit@0.5.0` in a self-hosted test instance. Published 0.4.0 does not contain these fields or operations.
2. Open a **Folderit** node. In its **Credential** dropdown, choose **Create new credential**. At the top of the credential dialog, open **Setup credential** and choose **Folderit Connection (Cloud or Custom Deployment)**. The credential type must read **Folderit Connection API**. Some editor versions show this same choice as **Connection Type** in the node instead.
3. Enter **API or Documentation URL**, the matching **Client ID** and **Client Secret**, and the deployment's **Browser or Sign-in URL**. The cloud API default is prefilled. Examples below are address configurations, not access credentials.
4. Leave the credential's **Account UID** blank only when the client can access exactly one account. If verification reports several accounts, enter the exact intended UID before the first successful connection. It never chooses the first account. An explicit UID is checked directly without enumerating other accounts.
5. Save the credential. Its first modal test asks for a bootstrap read: close the credential dialog, set **Resource → Connection**, **Operation → Get**, leave the node's Account UID blank and **Execute step**. This checks public routing, exact authentication metadata and actual account access. Afterward, reopening the credential's test performs an independent account read. This two-step setup is needed because n8n's credential-test context does not expose secure DNS resolution.
6. Select that same credential in each Folderit action and trigger in the workflow. Blank node Account UID uses its verified account; a different UID is rejected. Run [deployment-read-only.json](examples/deployment-read-only.json) against an existing test file to inspect the connection, download it and compare actual bytes.

| Deployment | API/documentation URL | Browser/sign-in URL | Verified authentication origin |
|---|---|---|---|
| Standard cloud | `https://api.folderit.com` | `https://my.folderit.com` | `https://auth.folderit.com` |
| Apollo | `https://api.apollo.folderit.com` | `https://apollo.folderit.com` | `https://auth.apollo.folderit.com` |
| Custom-domain example | `https://api.my.chaffinch.com/#description/introduction` | `https://my.chaffinch.com/en/login/` | `https://auth.my.chaffinch.com` |

The connector normalizes supported docs URLs and appends `/v2` once. It keeps the browser origin separate: a blank browser URL outside standard cloud omits generated links. API hostnames must follow `api.<deployment-domain>`. Public discovery must confirm the exact sibling auth issuer, `/oauth2/token` endpoint, client-credentials grant and Basic authentication method before any secret is sent. Redirects, mismatches and cloud fallback are refused.

Saved sessions are bound to the API origin, client credentials and selected account. **Create a new credential for another deployment, account or replacement client key.** Do not edit a working credential to retarget live workflows. Existing **Standard Cloud OAuth2 (Existing Connections)** credentials and trigger checkpoints keep their original behavior. Switching a trigger to a new credential deliberately starts a new subscription: reconcile outstanding events before activation.

API calls, selectors, pagination, polling, previews and binary operations use the credential's deployment. For workflows with a shared receipt ledger, map **Expected Connection Scope** in every action to `connectionScope` from the earlier Connection/Get step. This verifies the action's actual credential before any destination write, including when record IDs overlap across deployments. The deployment-aware customer exports already include that check. Requests use n8n's enforced network filter, checked public DNS addresses and pinned TLS routing. Private hosts, IP literals, nonstandard ports, mixed private/public DNS, redirects and invalid certificates are refused. A private/on-premises deployment needs a separately supported network design; there is no proxy, certificate bypass or private-network toggle here.

S3 transfers are anonymous. If this deployment returns another storage service, your administrator must supply its **exact public HTTPS origin** in the credential's **Additional Storage Origins**, one per line. Do not paste a signed URL or a wildcard. Storage destinations are validated and resolved independently; Folderit tokens/cookies are not forwarded. External source links and signed storage URLs are not rewritten into browser links or included in sample exports.

**Download an exact version:** run **File → Get Versions**, copy the intended `versionUid`, then use **File → Download** with that Version UID. History is checked within a 1,000-version bound and actual downloaded size and any available historical SHA-256 are verified. Output distinguishes `downloadedVersionUid` from the current metadata's `versionUid`. **File → Download Preview** requires `previewAvailable=true` and verifies the returned PDF header. Both are binary actions for ordinary workflow nodes, not AI tools.

Read requests may renew a rejected token once. Writes renew an expired cached token before sending, but a rejected or uncertain write is never automatically replayed. Inspect the destination and receipt before repeating an upload or workflow start.

## Example workflows

For **Folderit Tailor-plan users**, the [current customer workflow guide](CUSTOMER-WORKFLOWS.md) provides six inactive, credential-free exports compatible with published connector 0.4.0:

- IMAP and Outlook attachment archiving with saved receipts, SHA-256 verification of downloaded bytes and protection against overlapping runs.
- New-document notifications and Due-date reminders in Microsoft Teams.
- Shared failure emails and one-time receipt-table setup.

Version 0.5.0 has [separate deployment-aware variants](examples/deployments/CUSTOMER-WORKFLOWS.md) under `examples/deployments/`, with a separate `Folderit-n8n-deployment-workflows-0.5.0.zip`. They include Connection/Get and action scope guards. The existing public download bundle and legacy exports are preserved for 0.4.0 users.

The [single-import starter pack](Folderit-n8n-library-starter-pack.zip) provides three standard-cloud library candidates with embedded manual receipt-table setup, workflow images and recovery notes. [Setup and validation status](templates/README.md). Fresh import and table creation/reuse passed. Real IMAP intake, exact downloaded-byte verification and duplicate replay also passed in n8n Cloud; the current starter pack includes the native IMAP Message-ID correction. Real Teams channel delivery, SMTP and remaining failure checks are pending, and these workflows have not been submitted to the template library.

These use n8n Data Tables and require your own mailbox, Teams and SMTP connections. Read the setup and recovery instructions before activation. An uncertain external result holds processing for inspection; there are no automatic upload/message retries. They are downloadable examples, not listings in n8n's template library.

The three simpler starters remain available for learning. Three downloadable starter workflows include setup notes and configurable placeholders. They import inactive and contain no saved credentials or pinned results. Configure and test them in your own instance before activation; they are not yet published in n8n's template library.

- [Archive email attachments in Folderit](examples/email-attachments-to-folderit.json): split and filter attachments, upload them and verify the stored file details. Configure IMAP and Folderit credentials. Replays can create duplicates; recovery instructions are included.
- [Notify Slack about new Folderit files](examples/folderit-new-files-to-slack.json): poll for file arrivals, read current details, optionally filter one parent folder and send a notification with the audit UID. Includes instructions for adapting the final action to Microsoft Teams. Cross-execution deduplication is a separate production concern.
- [Read-only AI document lookup](examples/folderit-ai-document-lookup.json): search names in a fixed folder and retrieve details through real Folderit tools. The supplied local Ollama model requires no AI API key. Cloud requires a reachable model provider; `127.0.0.1` on your computer is not reachable from n8n Cloud.

To import a file, download its raw JSON from GitHub, then open an n8n workflow's **⋯** menu and choose **Import from File**. Open the workflow's yellow setup notes before selecting credentials or executing it.

**List a folder:** Manual Trigger → Folderit / File / Get Many. Set the account and folder UIDs, select the credential and execute. Each file becomes a separate output item.

**Create a client folder:** Manual Trigger → Folderit / Folder / Create. Supply the parent folder UID and name. Enable Return Existing Folder if a same-name existing folder should be reused.

**Test a document round trip:** import [document-roundtrip.json](examples/document-roundtrip.json), set your account and test parent-folder UIDs in **Test Settings**, and select your Folderit credential in each Folderit node. It creates a test folder, uploads synthetic text, gets the file, downloads it and extracts the text. Compare `downloadedText` with the original `text` in Test Settings. Each execution uploads a new file; this is a smoke test, not the controlled-release/idempotency template. In CLI development mode n8n names the node `CUSTOM.folderit`; the distributed example uses the installed package name `n8n-nodes-folderit.folderit`.

**Search and read metadata:** import [search-and-read-metadata.json](examples/search-and-read-metadata.json), fill Search Settings and select your credential in both Folderit nodes. Search returns one item per matching document; metadata reads return one item per assigned field. No matches or no assigned metadata return no output items.

## AI-agent tools (0.4.0)

Connect **Folderit** to an **AI Agent** node's Tool input. Select a resource, operation and credential; keep the account and any required scope fixed. Use n8n's **Let the model define this parameter** control only for values the agent should supply. Each tool performs the operation you configure. Use a read operation for a read-only assistant; do not give an agent a write operation unless you intend to allow it.

File Upload, Add Version, Download and Download Preview require binary workflow data and are excluded from the tool operation menu. They also fail before any API call if forced into a tool through edited workflow JSON. Use ordinary Folderit nodes for these actions.

Import [document-roundtrip-with-ai.json](examples/document-roundtrip-with-ai.json) for a complete demonstration. Fill the two UIDs in Test Settings and select your Folderit credential in all five Folderit nodes. Install [Ollama](https://ollama.com/download), run `ollama pull qwen3.5:4b`, and select an Ollama credential with Base URL `http://127.0.0.1:11434` in Ollama Chat Model. No AI API key is needed when both apps run directly on the same computer. Docker/remote hosts need their own reachable Ollama address.

The workflow uploads synthetic text, retrieves and downloads it, then asks the AI Agent to retrieve the new document's details through its Folderit tool. Check `downloadedText`, then the AI Agent's `intermediateSteps` tool input/result and final name/UID. The local model is about 3.3 GB; download before recording. Execution time depends on hardware. On 2026-10-12 the complete workflow passed on n8n 2.42.5 with Ollama qwen3.5:4b: a real tool call used the uploaded UID, returned matching details, and the downloaded text matched exactly. No output was pinned or mocked.

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

Poll at least hourly and use a shorter interval on busy accounts. This implementation uses the API's default one-day audit window; interruptions longer than 23 hours and backlogs beyond the scan limit stop with an explicit error. Reconcile missed events first, then recreate the trigger node to establish a new baseline. It does not use the unverified GET-body sync cursor from the Zapier candidate. Sequence polling assumes the service exposes events in sequence order; delayed lower-sequence events and audit access changes need separate reconciliation. On n8n runtimes using legacy workflow static data, quiet polls may only update memory until an event starts an execution. A restart without a saved checkpoint now stops with a reconciliation error instead of silently establishing a fresh baseline. Long quiet periods on legacy runtimes can still require reconciliation after restart. Quiet-poll persistence was verified on self-hosted n8n 2.42.5 with durable polling enabled (configuration below); the package is now approved for Cloud, but we have not independently repeated this quiet-poll persistence test in a fresh Cloud instance. Polling is not an exactly-once delivery guarantee: downstream retries can repeat actions, so use the audit UID with a durable deduplication ledger for consequential work.

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

Writes are not automatically retried. A lost upload-completion response may mean the file was created: inspect the destination before repeating it. Failed part transfers attempt to abort unfinished uploads. A failed abort requires checking the upload state with Folderit. OAuth credentials are never attached to signed storage upload or download requests. Legacy cloud credentials accept HTTPS Amazon S3 URLs. The new Folderit Connection also supports explicitly configured, independently validated public storage origins.

If Folderit rejects a request, confirm the account UID, permissions and node inputs. For rate limiting, slow the workflow and retry reads after the server's waiting period. Use business-level document IDs or an external ledger to prevent duplicate uploads. n8n's execution history can contain document data returned by the API; configure retention appropriately.

## Validation status

TypeScript build and n8n lint pass. The 0.4.0/customer-workflow baseline passed 61 tests; the 0.5.0 acceptance results and remaining live-deployment checks are recorded in RELEASE-CHECKS.txt. On 2026-10-27, fresh n8n Cloud 2.45.4 installed verified Folderit 0.4.0 and completed a real 75-byte UTF-8 folder/upload/read/download test with independent byte verification. Receipt-table setup also passed on Cloud. Native 2.42.5 tests covered repeated/overlapping synthetic uploads, interrupted-result blocking across restart, manual recovery, actual scheduled Folderit arrivals, expiry receipts and Error Trigger delivery to a local SMTP sink. Teams transport was stubbed; real mailbox/channel delivery remains to be validated. See [customer-workflow validation and limits](CUSTOMER-WORKFLOWS.md#validation-completed-on-27-october-2026). On 2026-10-10, native n8n 2.42.5 executed the complete round-trip workflow using the actual Folderit OAuth credential and built-in binary nodes. The downloaded 79-byte UTF-8 test content matched exactly, including its non-ASCII character; filename and MIME type were preserved. A separate read-only download also passed after the cached token was marked expired, verifying native token renewal.

Version 0.2.0 passed native document search, integer metadata write/readback, unchanged-value suppression and clear verification. A separate live read confirmed cleanup. Account/folder/metadata picker calls and folder search passed through the live helper harness. Other metadata types have contract tests but have not all been exercised in live n8n workflows.

Version 0.3.0 passed native version upload, exact 80-byte download comparison, manual workflow start and workflow/history reads. The tested workflow contained only a conditional step, so no approval request or notification was sent. A live helper poll emitted the exact new version once, and a native scheduled workflow resumed the captured checkpoint and emitted the same event. Checkpoint persistence and no replay after restart were verified after an emitted event.

Local owner setup is complete. Browser testing verified the existing OAuth credential, account and metadata-field selectors, a complete read-only download/extraction workflow with the exact 80-byte UTF-8 test content, and manual trigger preview with the exact historical version. The icon loads from the installed archive. Folder, select-option and workflow pickers also passed in the editor, including select labels and exact workflow start-option resolution without executing writes. The packed npm archive was installed offline into the n8n community-node directory, and a native read/download workflow passed with identical bytes. The public npm 0.3.0 package was subsequently installed from the registry: all 39 files matched the tested archive, and a native read/download execution returned the exact expected 80 bytes. The earlier API harness also passed folder/file lists. The tooling dependency advisory has been assessed; upstream fixes and public-release checks are tracked in RELEASE-CHECKS.txt.

## Public release

GitHub repository: https://github.com/folderit-dms/n8n-nodes-folderit

Public npm package: [n8n-nodes-folderit 0.5.0](https://www.npmjs.com/package/n8n-nodes-folderit/v/0.5.0). Self-hosted users can install `n8n-nodes-folderit` through **Settings → Community Nodes**, subject to their instance settings.

Version 0.3.0 was built and staged by the included GitHub Actions workflow using npm trusted publishing and provenance, then approved by the maintainer with 2FA. [Release build](https://github.com/folderit-dms/n8n-nodes-folderit/actions/runs/38058519315) · [Provenance](https://search.sigstore.dev/?logIndex=3187253309).

Version 0.3.1 did not expose Folderit as an AI tool. Version 0.4.0 adds native AI-tool support for JSON operations while keeping binary upload, add-version and download operations in normal workflow nodes. Both releases passed the official scanner, including provenance verification. [0.4.0 release build](https://github.com/folderit-dms/n8n-nodes-folderit/actions/runs/38228293407) · [0.3.1 patch release build](https://github.com/folderit-dms/n8n-nodes-folderit/actions/runs/38060180424).

n8n confirmed successful verification and publication on n8n Cloud on **27 October 2026**, after automated and manual review. Customers install it by searching **Folderit** in the canvas node panel. [Customer setup guide](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/). The npm README included with 0.4.0 predates approval, and the immutable 0.5.0 archive contains the pre-publication README. This repository records the current publication status.

Version 0.5.0 was published on **28 October 2026**. [0.5.0 release build](https://github.com/folderit-dms/n8n-nodes-folderit/actions/runs/40656380108) · [0.5.0 provenance](https://search.sigstore.dev/?logIndex=3535417578). The verified Cloud listing still offers 0.4.0 while n8n checks and propagates the update.

## References

- https://api.folderit.com/
- https://www.folderit.com/knowledge-base/application-programming-interface-api/
- https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes

## License

MIT
