# Upgrade a deployment connection from 0.5.0 or 0.5.1

This guide applies to the **unpublished 0.6.0 candidate**. Do not treat the candidate as an available or n8n-verified release.

The deployment credential must use an OAuth2 name to meet n8n's verification rules. The new type is **Folderit Connection OAuth2 API** (`folderitConnectionOAuth2Api`). Connections created with the older deployment type (`folderitApi`) need to be recreated and reselected in n8n. This also applies to standard Folderit accounts that used that deployment type.

Existing **Folderit OAuth2 API** connections (`folderitOAuth2Api`), including verified 0.4.0 standard-cloud workflows, use a separate type and do not need this migration. Check the saved connection's type, rather than its user-chosen name.

The connector does not copy secrets, modify saved credential records, choose a replacement connection, or delete the old connection. An old deployment selection stops with migration instructions before credential access or an API request.

## Before upgrading

1. Keep an export of each affected workflow in a private location. Exported workflows can contain internal identifiers and connection references; do not publish them.
2. Deactivate scheduled copies, including any overlapping copies of the same workflow. Record the last confirmed event/action and retain receipt tables, table IDs and destination IDs.
3. Check unfinished executions and pending receipts. An uncertain upload or message might already have reached its destination. Reconcile it independently before retrying. Keep uncertainty locks and pending receipts until that reconciliation is complete.
4. Record the original API URL, browser URL, exact account UID, allowed storage origins and expected connection scope. Obtain the matching **existing** Folderit API Client ID and Client Secret from your administrator or their original secure source. Creating a new Folderit API client is not required by this rename.

## Recreate and select the n8n connection

After an approved 0.6.0 release is available in your installation:

1. Open an affected Folderit action. In **Connection Type** or the credential setup selector, choose **Folderit Connection (Cloud or Custom Deployment)**. The older choice is labelled **Deployment Connection From 0.5.0/0.5.1 (Migration Required)** and cannot execute.
2. Create a **Folderit Connection OAuth2 API** credential. Enter the same API/documentation URL, browser/sign-in URL, existing Client ID and Client Secret, and storage origins. During migration, enter the original exact **Account UID** explicitly, even if the client currently sees only one account. Store the secret only in n8n's credential dialog.
3. Save and run the standard credential test. The new credential uses n8n's built-in client-credentials flow and works at first save; no bootstrap execution is required. Successful credential testing does not replace the workflow checks below.
4. Select the new connection type and saved credential in **every** affected Folderit action and Folderit Trigger. Preserve each node's account UID, file/folder IDs and other settings. A new credential in one node does not migrate the other nodes.
5. In current downloads, use the updated [read-only deployment example](examples/deployment-read-only.json) and [deployment workflow JSONs](examples/deployments/). The versioned `Folderit-n8n-deployment-workflows-0.5.0.zip` is a historical 0.5.0 export; it is not a migrated 0.6.0 package.

## Verify before enabling writes or schedules

1. Use **Folderit → Connection → Get** to verify the API origin, browser origin and exact account. Compare them with the original configuration. If the scope differs, stop and correct the connection; do not remove an expected-scope guard to make the workflow run.
2. Read an existing harmless document. Download its bytes and independently compare the expected file size and hash. Test an exact version too if the workflow uses one. Version UID and Expected Connection Scope are under **Options**; older top-level exported values remain supported.
3. Keep the existing receipt table and completed receipts. Do not rerun setup to create a new ledger during migration. After independent reconciliation of any uncertain action, use clearly labelled synthetic inputs to confirm the intended Folderit folder or message destination and duplicate suppression.
4. A replacement credential has a different n8n identity. A Folderit Trigger therefore establishes a fresh polling baseline. Reconcile events since the last confirmed old execution before activation; activation does not import missed history. Do not clear a held receipt or reset a checkpoint to force a resend. Read the [recovery instructions](https://github.com/folderit-dms/n8n-nodes-folderit/blob/main/CUSTOMER-WORKFLOWS.md#recovery-inspect-before-retrying).
5. Activate only after the read-only, destination, missed-event and recovery checks pass. Leave test workflows inactive afterward.

## If you need to stop or roll back

Leave affected workflows inactive and retain their old exports and credentials. Reinstalling an earlier connector can restore its earlier credential type, subject to that runtime's installation rules, but does not reconcile missed events or uncertain sends. Do not run old and migrated copies against separate receipt tables. Standard-cloud workflows using `folderitOAuth2Api` can continue separately.

## Validation scope

Published 0.5.1 passed local standard-demo/Apollo read-only acceptance and exact downloaded-byte checks. Its public archive and provenance were independently verified, but n8n's strict public scanner rejected the old deployment credential name. The 0.6.0 candidate corrects that naming and includes migration-boundary tests. Candidate-specific native/provider acceptance and public n8n verification must be recorded separately; this guide does not claim those checks completed.
