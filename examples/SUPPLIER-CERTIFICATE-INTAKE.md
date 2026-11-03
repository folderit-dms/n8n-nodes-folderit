# Supplier certificate intake in Folderit and Microsoft Teams

This example helps procurement or compliance teams spot incomplete certificate submissions. It checks each new document in one exact Folderit intake folder against permitted filename extensions and the expiry entered in Folderit's **standard Due date**. Teams receives the failed checks and corrective actions, or a request for human review. The workflow never approves a supplier or certificate.

[Download workflow JSON](supplier-certificate-intake.json) · [Workflow image](assets/supplier-certificate-intake.png) · [Folderit connection guide](https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/)

## Set up a test

1. Use Folderit **Tailor with API access**, n8n with **Data Table v1.1**, and a delegated Microsoft Teams work account allowed to post in your test channel. Acceptance used n8n **2.46.4 Cloud** and verified **n8n-nodes-folderit 0.4.0**. The package's npm release and Cloud verification are separate.
2. In the n8n workflow editor, open the top workflow menu, choose **Import → From file**, and select the downloaded JSON. Keep the workflow inactive.
3. In **Ledger setup settings**, choose a stable table name dedicated to this intake. Run only **1. Set up receipt table**, once at a time. Copy the returned `ledgerTableId` into the main **Settings** node. Setup creates or validates the receipt columns and processing lock; it never clears an existing lock.
4. Select the same **Folderit OAuth2 API** credential in **New Folderit file** and **Read new document details**. Set the same account UID in the trigger and main Settings. Select your delegated **Microsoft Teams OAuth2** credential in **Send Teams notification**. Store secrets only in n8n credentials.
5. In Settings, replace `accountUid`, `folderUid`, `ledgerTableId`, `teamId` and `channelId`. `folderUid` is required and matches one exact parent, excluding descendants. Set `reviewOwner` to the responsible team or role, `allowedExtensions` to comma-separated extensions without dots (default `pdf`), and `minimumValidityDays` to 1–365 (default 30).
6. Record actual certificate expiry in the document's **standard Folderit Due date**. Dates are not extracted from file contents or custom metadata. The workflow reads Folderit records and writes only to the configured Teams channel and n8n receipt table.
7. In a dedicated test folder/channel, activate the workflow and allow its first poll before uploading synthetic documents. Inspect the actual messages, completed receipts and free lock. Replaying the same retained events must not send a second message. Turn testing off afterward.

## Decisions and limitations

| Input at processing time | Teams result |
| --- | --- |
| Permitted extension and at least the minimum days remaining | Ready for **human review** of supplier identity and document contents |
| Missing or malformed standard Due date | Ask the reviewer to check the certificate and record/correct its expiry |
| Past expiry or expiry today | Urgent renewal/date-check notice |
| Short remaining validity | Request renewal or a decision from the responsible reviewer |
| Disallowed filename extension | Request a permitted format and review its contents |
| Different parent folder | No notice |

Dates use UTC calendar days. Filename filtering is not content or malware validation. Checks use metadata available when the arrival is processed: entering expiry afterward can race the poll and does not clear an earlier notice. Only new-file arrivals are monitored; later date/policy corrections do not resend completed arrivals. Manual trigger previews can include historical events and send notices about them.

Keep the one-minute polling schedule, or poll at least hourly. Interruptions beyond 23 hours, scan-limit errors and inaccessible documents require reconciliation. Receipts cannot recover missing audit history. Copies handling the same arrivals must share one table. Do not reuse the generic arrival table: this intake has its own receipt namespace.

## Failure recovery

A pending receipt is saved before the Teams send. A confirmed message ID completes it. An uncertain or failed action holds the processing lock; it is never automatically expired or resent. Confirm the owner execution has stopped, inspect the pending outcome in the destination, reconcile its exact identity, and only then recover the receipt and lock. Keep completed receipts. Follow the [full recovery procedure](../CUSTOMER-WORKFLOWS.md#recovery-inspect-before-retrying).

## Acceptance on 3 November 2026

Fresh native imports passed. Six retained synthetic arrivals covered ready, short validity, today, expired, missing date and disallowed format; another-folder input was excluded. One additional upload passed actual scheduled polling. Seven actual Teams message bodies, IDs and destination identities were independently read through Microsoft Graph. All eight uploaded fixture files were independently downloaded and SHA-256 checked. Replays and two overlapping copies preserved seven completed receipts and a free success lock. A separate rejected channel send retained one pending receipt and held lock for the stopped execution. All test workflows were inactive afterward.

Local tests additionally cover invalid calendar dates, boundary days, configuration validation, event/document pairing and output minimization. These checks verify this tested setup, not every deployment or future provider behavior. Template 22274's library review is separate; the existing generic arrival export and three-workflow starter ZIP remain available.
