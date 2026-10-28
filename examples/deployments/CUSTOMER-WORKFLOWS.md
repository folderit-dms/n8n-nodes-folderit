# Folderit customer workflows

These workflows are for **Folderit Tailor-plan users**, who can use the Folderit API. They run in your own n8n instance with your own service connections. Folderit credentials belong in n8n's credential store, never in a workflow's Settings node.

[Folderit installation and connection guide](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/)

## Choose a workflow

| Download | What it does | Connections you need |
| --- | --- | --- |
| [IMAP attachment archive](email-attachments-to-folderit-safe.json) | Saves permitted attachments, verifies their stored names, folder and SHA-256 hashes, and tracks completed work | IMAP and Folderit |
| [Outlook attachment archive](outlook-attachments-to-folderit-safe.json) | The same receipt-based archive with a Microsoft Outlook trigger | Outlook OAuth2 and Folderit |
| [New documents → Teams](folderit-new-files-to-teams.json) | Sends document arrival notices with document/audit IDs; supports an exact parent-folder filter | Folderit and delegated Microsoft Teams OAuth2 |
| [Expiry reminders → Teams](folderit-expiry-reminders-to-teams.json) | Checks a folder's document Due dates daily and sends milestone reminders | Folderit and delegated Microsoft Teams OAuth2 |
| [Shared failure alerts](folderit-failure-alert-email.json) | Emails an operator when a connected workflow fails | SMTP |
| [Ledger setup](folderit-ledger-setup.json) | Creates the n8n Data Table used for receipts and the processing lock | None |

The verified Folderit connector is available on n8n Cloud. These newer workflows require **Data Table node v1.1** and its table-management operations; native processing was tested on **n8n 2.42.5**. On **27 October 2026**, a fresh **n8n Cloud 2.45.4** instance installed verified Folderit 0.4.0 and passed a real folder/upload/read/download round trip with an independently verified 75-byte UTF-8 file. Receipt-table setup was also tested there. Your real Microsoft/mail connections still need acceptance tests.

## Deployment-aware connections and upgrades

These exports for published connector 0.5.0 require **Folderit Connection**, the new **Connection → Get** operation and n8n's secure egress helper. They cannot run on published connector 0.4.0. Use the [credential setup steps](../../README.md#deployment-connections-050) with published `n8n-nodes-folderit@0.5.0` in an isolated self-hosted instance. n8n Cloud currently offers verified 0.4.0; wait for the verified 0.5.0 update before using these exports there.

Choose the same Folderit Connection credential in **Read connection context** and every Folderit action/trigger. The context is read live from encrypted credential settings; it contains no secret. The workflows compare its exact account with Settings before processing. Every action also checks Expected Connection Scope against that context before proceeding; a credential from another deployment is rejected even when its account/document UIDs overlap. Custom-deployment receipt keys include the API origin, keeping overlapping account/file/audit IDs separate.

Existing standard-cloud workflows and saved credentials need no change. When deliberately upgrading an existing workflow, keep its account, folder, mailbox label, destination IDs and receipt table unchanged. The original standard-cloud receipt-key format is preserved so completed cloud receipts still suppress replay. Preserve the table and reconcile pending work before switching. A new trigger credential starts a new baseline: reconcile outstanding events before enabling it. A different deployment needs a new credential and its own verified account settings; never repoint a live credential.

## Start from your own computer

1. Open your n8n instance in a browser. For Cloud, use the [n8n Cloud console](https://app.n8n.cloud/). For a company-hosted instance, ask your n8n administrator for its web address. You do not need access to Folderit's development computer.
2. An n8n owner/admin installs Folderit: open a workflow, click **+**, search **Folderit**, select the verified community result and install it. [Detailed instructions](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/#install).
3. Ask your Folderit administrator for your API client ID, its matching secret, and access to an isolated test folder. In these deployment-aware exports, select a **Folderit Connection API** credential. To create one, open a Folderit node’s **Credential → Create new credential**, then choose **Setup credential → Folderit Connection (Cloud or Custom Deployment)** in the dialog. Follow the bootstrap Connection/Get read in the README before activation. The [connection guide](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/#connect) explains the account/folder fields.
4. Download the JSON file you need. On GitHub, open the file, choose its **Raw** view and save it. In n8n's workflow editor, open the **⋯** menu near the top right and choose **Import from File**. Read the yellow guide notes in the imported workflow.
5. First import **Ledger setup**. Choose a descriptive table name in its **Settings** node, execute it once, and copy `ledgerTableId` from the final **Ledger is ready** node. Run setup once at a time, in the same n8n project as the other workflows. Rerunning it preserves existing receipts and locks.
6. Import your chosen customer workflow. Open its **Settings** node and replace every `YOUR_…` value, including `ledgerTableId`. Select credentials in every relevant node. Use the same receipt table for copies of a workflow processing the same source/destination. The table ID is configuration, not a password.
7. Import **Shared failure alerts**. Configure the sender, recipient and HTTPS n8n instance address in Settings; select your SMTP credential in **Email the workflow owner**. Save it. In the main workflow, open **⋯ → Settings → Error workflow**, select the saved alert workflow and save. Keep failed-execution saving enabled.
8. Test with synthetic data using the checks below. For scheduled triggers, activate/publish the workflow, allow its initial poll, then create new input. Manual previews can show older events. Do not treat a manual preview as proof of scheduled delivery.

No template includes credentials, private account IDs, pinned output or enabled schedules. Installation alone does not connect your mailbox or Teams tenant.

## Attachment archiving

Set `accountUid`, `folderUid`, `ledgerTableId`, `mailboxScope` and `allowedExtensions` in Settings. `mailboxScope` is a stable label for that mailbox; keep it unchanged across replays. Select the same Folderit Connection credential in **Read connection context**, **Upload attachment**, **Read uploaded document** and **Download stored attachment**. Each new upload is downloaded again and its bytes hashed before its receipt is marked complete. This adds download traffic and verifies the stored bytes even when Folderit has not yet populated its hash metadata.

For IMAP, configure a dedicated intake mailbox with TLS. Your provider may require an app password or OAuth-capable setup. The first connection can fetch existing unseen messages; use an empty test intake mailbox initially.

For Outlook, select **Microsoft Outlook OAuth2** in the trigger, sign in to the intended mailbox and review the requested permissions with your Microsoft administrator. The template downloads attachments and leaves read/unread status unchanged. It watches new arrivals; it is not an old-mail migration workflow. Prefer a dedicated intake folder if your mailbox has unrelated traffic.

The workflow processes one permitted attachment at a time. Its receipt key includes deployment, account, folder, mailbox, message ID, attachment field, filename and byte hash. Replaying the same input checks its receipt; a different email can intentionally archive identical content. A message with no stable identity fails before archiving. Outlook provider IDs can change when messages move, so avoid moving mail during processing and inspect the identity used when recovering a run.

Files must be non-empty and no larger than the connector's 100 MiB limit. Extension filtering is not malware scanning. A completed upload is read independently and its filename, parent folder and SHA-256 hash must match before its receipt is marked done.

Test with one message containing two small permitted attachments and one disallowed attachment. Confirm two correct files in Folderit. Replay the same input and check that no additional files appear. Test an empty attachment and a controlled failure before using customer documents.

## Teams notifications

Select the same Folderit Connection credential in the Folderit Trigger, Read connection context and every Folderit action. Set the same account in the Folderit Trigger and in Settings. Enter the exact Microsoft team and channel IDs, then select a delegated **Microsoft Teams OAuth2** credential in the send node. The signed-in user must be allowed to post in that channel. App-only channel-message sending is not used.

For document arrivals, blank `folderUid` means accessible account events; a supplied UID matches only that exact parent folder, not its descendants. Activation establishes a baseline. Upload a test document after activation and check the actual channel message. Messages contain document name, document UID and audit UID, not file contents.

The receipt key includes the audit UID and destination, so replaying an event checks that destination's saved receipt. Renaming a file does not create a new arrival receipt. Changing the destination allows a notice to be sent there.

Folderit polling uses a bounded audit window. Poll at least hourly; interruptions longer than 23 hours or scan-limit errors require reconciliation. The receipt ledger suppresses repeats; it cannot recover missing audit history. A deleted or inaccessible document stops processing for inspection.

## Expiry reminders

Put the documents to monitor in one folder and set each document's standard Folderit **Due date** to its actual expiry/renewal date. This workflow reads that field. It does not extract dates from file content, infer legal expiry or read an arbitrary custom metadata field.

Default reminders are at 30, 7, 1 and 0 days. A run sends only the current window's reminder: for example, a document first seen with 20 days left receives the 30-day milestone. Missed milestones are not all sent at once. The 0-day milestone can be sent once through 7 days overdue. Configure `reminderDays` and `overdueDays` in Settings.

The schedule defaults to 09:00 UTC and comparisons use UTC calendar days. Documents without Due dates produce no reminder. Malformed dates fail visibly. Each account/document/due date/milestone/destination combination has its own receipt; a changed Due date starts a new cycle. The folder is not scanned recursively.

Test future, due-today, overdue, missing-date and invalid-date records in a test folder. Check the actual Teams message and then repeat a run to verify that the same milestone is suppressed.

## Recovery: inspect before retrying

The table has one `__mutex__` processing-lock row and one row per attempted action. Only the lock's owner execution may proceed. Competing executions wait and retry only lock acquisition for roughly one minute. Uploads and message sends are never automatically retried.

- `state=done` with a destination ID means the action was confirmed and recorded.
- `state=pending` means an attempt began but no confirmed receipt was saved. The external action may have happened. Do not assume it failed.
- A held lock with a failed/stopped owner prevents later runs from repeating an uncertain action. There is deliberately no automatic lease expiry or lock reset.

If lock waiting times out while another run is still working, retain the failed input and retry that failed execution after the owner completes. If the owner failed:

1. Open its saved n8n execution and identify the last completed node. Confirm the owner execution has ended; do not unlock a running or still-uncertain execution.
2. Open the project's **Overview → Data Tables** and the configured receipt table. Inspect the pending row and its source reference. Check the actual Folderit destination or Teams channel independently.
3. If the action occurred, verify the exact file/message identity. For files, compare name, folder and hash. Record the correct destination ID and change that receipt to `done` only when verified.
4. If you have established that no action occurred and the old request cannot still complete, remove only that pending receipt so it can be tried again. If the result is still uncertain, leave it pending and investigate; do not guess.
5. Once pending work is reconciled and the owner has definitely ended, set only the `__mutex__` row's state to `free` and owner to an empty string. Preserve its schema marker and all completed receipts.
6. Retry the retained failed input. Already-completed items are skipped; unresolved ones stop for inspection.

This coordinates n8n runs; it is not a distributed transaction with Folderit or Microsoft. Do not run concurrent setup, create separate ledgers for copies expected to deduplicate together, or clear a lock while a previous owner may still write. Back up the ledger, monitor its storage quota, and retain receipts for as long as their inputs may be replayed. Deleting receipts or restoring an older table backup can permit repeats. For high-volume or recovery-critical use, assess queueing, storage capacity and operational ownership before activation.

## Failure alerts and acceptance

The shared Error Trigger workflow sends an SMTP alert containing workflow/execution IDs and a same-origin link when available. It deliberately omits raw error messages, stack traces, document contents and signed storage URLs. Trigger failures may lack an execution ID. Manual executions do not automatically invoke Error Trigger; use an activated test workflow to prove delivery.

An alert workflow can fail too. Check SMTP delivery, executions and retention independently. These examples do not install an external uptime monitor or reconcile an expired Folderit audit window automatically.

Before enabling real data, verify credentials, permissions, actual destination output, repeat handling, a controlled failure and its alert, and a restart/recovery case. Package approval alone does not prove your end-to-end workflow. Delivery through your real Microsoft/IMAP/SMTP connections must be tested with your chosen accounts. Cloud round-trip and receipt-table setup checks do not prove every scheduled customer workflow.

## Validation completed on 27 October 2026

- Build, official n8n lint and all 61 tests passed from a clean source copy (46 connector tests and 15 customer-workflow tests).
- Native n8n 2.42.5 processed real synthetic Folderit uploads with downloaded-byte verification. Repeating the same input produced no additional files. Two overlapping runs produced two files total for the same two attachments.
- A controlled interruption after an actual upload left its receipt pending and lock held. A replay before and after a server restart was blocked. After independently checking the destination and reconciling that one test receipt, recovery skipped the existing file and uploaded only the remaining attachment. This is manual reconciliation, not automatic recovery.
- Scheduled Folderit arrival polling read actual events through the shared ledger. Expiry processing read a real synthetic Due date and produced one receipt across two runs. Microsoft Teams sending was replaced with a local provider stub for these tests; delivery to a real tenant is still unverified.
- An actual production workflow error invoked Error Trigger and delivered an alert to a local SMTP test server. One alert attempted during deliberate server shutdown could not acquire a task runner; an alert workflow is not an external uptime monitor.
- Real IMAP/Outlook intake and real Teams/external SMTP delivery require customer/provider credentials and remain unverified. No claim of exactly-once delivery across services is made.
