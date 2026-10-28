"""Prepare library submissions with an embedded, manually run ledger setup.

Keep both previously distributed workflow bundles and their JSON unchanged.
No provider credential, private fixture, activation or pinned output is exported.
"""
from copy import deepcopy
import json
from pathlib import Path
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "templates"
OUT.mkdir(exist_ok=True)
KB = "https://www.folderit.com/knowledge-base/connect-folderit-to-n8n/"
RECOVERY = """## Inspect before retrying
Each destination action first saves a pending receipt. A confirmed result marks it done. A repeated input checks that receipt.

There is one shared processing lock, with **no automatic expiry**. A failed or uncertain action holds the lock. Uploads and Teams messages are never automatically retried.

1. Open the failed execution and confirm its owner has stopped.
2. Inspect the pending receipt and the actual Folderit file or Teams message.
3. If the action occurred, verify its exact identity; record its destination ID and mark only that receipt done.
4. Only after proving no action occurred and no old request can finish may you remove that pending receipt.
5. Reconcile all pending work before setting the lock free and its owner blank. Keep all completed receipts.
6. Retry the retained failed input. If the result is uncertain, keep it blocked.

Competing runs wait for the lock for about one minute. This is duplicate protection with manual recovery, not an exactly-once transaction. Keep failed executions/binaries long enough for recovery and monitor table quotas.
"""


def transform(value, mapping):
    if isinstance(value, dict):
        return {k: transform(v, mapping) for k, v in value.items()}
    if isinstance(value, list):
        return [transform(v, mapping) for v in value]
    if isinstance(value, str):
        for before, after in mapping.items():
            value = value.replace("$('" + before + "')", "$('" + after + "')")
            value = value.replace('$("' + before + '")', '$("' + after + '")')
        return value
    return value


def sticky(slug, name, text, x, y, width, height, color=5):
    return dict(id=str(uuid.uuid5(uuid.NAMESPACE_URL, "folderit-library/" + slug + "/" + name)),
                name=name, type="n8n-nodes-base.stickyNote", typeVersion=1,
                position=[x, y], parameters=dict(content=text, width=width, height=height, color=color))


CASES = [
    dict(slug="archive-imap-attachments", source="email-attachments-to-folderit-safe.json",
         title="Archive IMAP email attachments in Folderit with verified files and saved receipts",
         audience="Operations teams that need a searchable document archive for an intake mailbox.",
         outcome="Save permitted attachments, independently download and hash every new file, and remember confirmed work across runs.",
         table="Folderit IMAP archive receipts",
         setup="Connect an IMAP credential in **New email with attachments** and the SAME **Folderit OAuth2 API** credential in all three Folderit actions. Set accountUid, folderUid, mailboxScope and allowedExtensions in **Settings**. mailboxScope is a permanent label for this mailbox, not its password. After the setup branch succeeds, paste its ledgerTableId into Settings.",
         behavior="## Mailbox and attachment rules\nUse a dedicated intake mailbox with TLS. Existing unseen messages may be fetched on the first connection; start with an empty test inbox. Read/unread status is unchanged. A stable Message-ID is required.\n\nMultiple permitted attachments are processed one at a time. Empty files and files over 100 MiB fail. Extension filtering is not malware scanning. The receipt includes account, destination, mailbox, message, attachment identity, filename and byte hash. A different email can intentionally archive identical content.",
         test="Send one synthetic message with two small permitted attachments and one disallowed extension. Confirm exactly two files in the configured Folderit folder, including actual downloaded bytes. Replay the same retained input and confirm no extra files. Test a missing Message-ID, empty attachment and controlled failure. The source mailbox and Folderit destination must be your own dedicated test resources."),
    dict(slug="notify-teams-on-new-documents", source="folderit-new-files-to-teams.json",
         title="Notify a Microsoft Teams channel about new Folderit documents with saved receipts",
         audience="Teams that need document-arrival notices in a designated Microsoft Teams channel.",
         outcome="Read new Folderit document details, optionally filter an exact folder, post a concise notice, and remember each confirmed event/destination pair.",
         table="Folderit Teams arrival receipts",
         setup="Select the SAME **Folderit OAuth2 API** credential in the Folderit trigger and details action. Set the same account UID in the trigger and **Settings**, plus the teamId and channelId. Select **Microsoft Teams OAuth2** in **Send Teams notification**; use a delegated Microsoft account allowed to post in the target channel. Paste the setup branch's ledgerTableId into Settings.",
         behavior="## Activation and event scope\nActivation establishes a new polling baseline. Activate the workflow first, allow the initial poll, then upload a synthetic document. Manual previews can include historical events and can send notices about them.\n\nBlank folderUid accepts accessible account events. A supplied folderUid matches that exact parent only, excluding descendants. Messages contain document name, document UID and audit UID, not document contents.\n\nPoll at least hourly. Interruptions beyond 23 hours or scan-limit errors require reconciliation; receipts cannot restore missing audit history. A deleted or inaccessible document stops for inspection. App-only Graph channel posting is not used.",
         test="Use a dedicated Teams test channel and Folderit test folder. After activation and the initial poll, upload one synthetic file and inspect the actual channel message. Replay that same event and confirm no second notice. Test another folder, a missing/inaccessible document, and a controlled send failure."),
    dict(slug="remind-teams-about-due-dates", source="folderit-expiry-reminders-to-teams.json",
         title="Send Folderit document due-date reminders to Microsoft Teams with saved receipts",
         audience="Contract and certificate owners who maintain renewal dates in Folderit.",
         outcome="Read standard Folderit Due dates, calculate the current reminder milestone, and send one confirmed notice per document/date/milestone/destination.",
         table="Folderit Teams due-date receipts",
         setup="Select the SAME **Folderit OAuth2 API** credential in both Folderit read nodes. Enter accountUid, folderUid, teamId and channelId in **Settings**. Select a delegated **Microsoft Teams OAuth2** credential in the send node. Set reminderDays and overdueDays as needed. Paste ledgerTableId from the manual setup branch into Settings.",
         behavior="## Dates and reminders\nSet each test document's standard Folderit **Due date**. This workflow does not extract dates from content, read arbitrary custom metadata, or decide legal expiry. Folderit records are only read. The folder scan is not recursive.\n\nThe schedule is 09:00 UTC; comparisons use UTC calendar days. Default milestones are 30, 7, 1 and 0 days. At 20 days remaining, the 30-day milestone is sent; it does not send every missed milestone. The 0-day notice can be sent once through 7 days overdue. A changed Due date starts a new cycle. Missing dates are skipped; malformed dates fail visibly.",
         test="Use synthetic documents with a future, due-today, overdue and missing Due date. Test invalid-date handling separately. Inspect each actual Teams message, then repeat the run and confirm that the same milestones are suppressed. Test a controlled channel-send failure. Keep the schedule off until all checks pass."),
]


def build(case):
    obj = json.loads((ROOT / "examples" / case["source"]).read_text())
    obj["name"] = case["title"]
    obj["nodes"] = [n for n in obj["nodes"] if n["type"] != "n8n-nodes-base.stickyNote"]
    setup = json.loads((ROOT / "examples/folderit-ledger-setup.json").read_text())
    setup_nodes = [n for n in setup["nodes"] if n["type"] != "n8n-nodes-base.stickyNote"]
    mapping = {n["name"]: "Setup: " + n["name"] for n in setup_nodes}
    mapping.update({"Set up ledger": "1. Set up receipt table", "Settings": "Ledger setup settings", "Ledger is ready": "Copy ledgerTableId into Settings"})
    for node in setup_nodes:
        node["parameters"] = transform(node["parameters"], mapping)
        old_name = node["name"]
        node["name"] = mapping[old_name]
        node["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "folderit-library/" + case["slug"] + "/" + node["name"]))
        node["position"][1] += 1500
        if old_name == "Settings":
            node["parameters"]["jsonOutput"] = json.dumps({"tableName": case["table"]}, indent=2)
    # n8n 2.42.5 CLI execution falls back to the first root in source order.
    # Make the manual, local-only branch the safe first run in a fresh import.
    obj["nodes"] = setup_nodes + obj["nodes"]
    for source, channels in setup["connections"].items():
        if source not in mapping:
            continue
        channels = deepcopy(channels)
        for edges in channels.values():
            for edge_list in edges:
                for edge in edge_list:
                    edge["node"] = mapping[edge["node"]]
        obj["connections"][mapping[source]] = channels

    intro = ("# " + case["title"] + "\n\n" + case["audience"] + "\n\n" + case["outcome"] +
             "\n\n**Folderit Tailor plan with API access is required.** Install `n8n-nodes-folderit` and use the standard-cloud OAuth2 credential. Requires Data Table node v1.1. Core processing was tested on n8n 2.42.5; test your real mailbox/channel before activation. The default export is inactive and contains no credentials or pinned results.\n\n[Folderit installation and connection guide](" + KB + ")")
    intro += "\n\n![Workflow overview](https://raw.githubusercontent.com/folderit-dms/n8n-nodes-folderit/main/templates/assets/" + case["slug"] + ".png)"
    setup_text = ("# Configure before activation\n\n1. Keep this workflow inactive. Create credentials in n8n's credential store.\n2. Run the separate **1. Set up receipt table** manual branch once, without running the service trigger. Run setup one at a time in the SAME n8n project.\n3. Open **Copy ledgerTableId into Settings** and copy its `ledgerTableId`.\n4. " + case["setup"] +
                  "\n5. All copies processing the same source/destination must share the same table. Setup reuses an existing table of that name and preserves receipts. Keep its name stable.\n6. Complete the acceptance checks, then activate the service trigger. Never put passwords, API secrets or tokens in Settings.")
    alert_text = ("# Failure visibility and optional alerts\n\nA failed action stops the run and can leave its receipt/lock pending. Inspect **Executions**, the receipt table and the actual destination before retrying. Keep failed-execution saving on.\n\nFor an email alert, import the [shared SMTP error workflow](https://raw.githubusercontent.com/folderit-dms/n8n-nodes-folderit/main/examples/folderit-failure-alert-email.json), configure its sender/recipient and SMTP credential, save it, then choose it in this workflow's **⋯ → Settings → Error workflow**. SMTP alerts are optional; core processing does not depend on that separate workflow.\n\nProve alert delivery with a controlled failure in an activated test workflow. Manual errors do not automatically invoke Error Trigger. An alert workflow can itself fail; monitor the provider separately.")
    obj["nodes"] += [
        sticky(case["slug"], "Overview and requirements", intro, 0, -1160, 1040, 980),
        sticky(case["slug"], "Configure before activation", setup_text, 1120, -760, 1160, 650, 4),
        sticky(case["slug"], "Provider behavior", case["behavior"], 2360, -760, 1160, 620),
        sticky(case["slug"], "Recovery and duplicate handling", RECOVERY, 3600, -760, 1320, 750, 3),
        sticky(case["slug"], "Manual receipt-table setup", "# Run this branch once\n\nThis branch creates or reuses the receipt table and validates its lock. It does not connect to Folderit or Microsoft and does not send mail.\n\nOpen **Ledger setup settings** and choose a stable table name, then execute **1. Set up receipt table**. Copy the final table ID into the main **Settings** node above. Do not run setup concurrently. Preserve this table when upgrading or duplicating the main workflow.", 0, 970, 1500, 420, 4),
        sticky(case["slug"], "Acceptance checks", "# Test your actual connections\n\n" + case["test"], 1650, 970, 1450, 420),
        sticky(case["slug"], "Failures and email alerts", alert_text, 3220, 970, 1700, 540, 3),
    ]
    obj["active"] = False
    obj["pinData"] = {}
    for key in ["id", "versionId", "activeVersionId", "createdAt", "updatedAt", "tags", "meta"]:
        obj.pop(key, None)
    for node in obj["nodes"]:
        node.pop("credentials", None)
        node.pop("webhookId", None)
    obj["settings"].pop("errorWorkflow", None)
    target = OUT / (case["slug"] + ".json")
    target.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n")
    return dict(file=target.name, name=case["title"], nodes=len(obj["nodes"]),
                requirements=["Folderit Tailor plan and API access", "n8n Data Table v1.1", "provider credentials"],
                acceptance="provider checks pending; not submitted to n8n library")


if __name__ == "__main__":
    manifest = [build(case) for case in CASES]
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
