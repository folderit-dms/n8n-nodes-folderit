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


def sticky(slug, name, text, x, y, width, height, color=7):
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


def annotate(obj, case):
    """Apply n8n's overview/section-note format without changing execution."""
    slug = case["slug"]
    imap = slug == "archive-imap-attachments"
    recovery = "https://github.com/folderit-dms/n8n-nodes-folderit/blob/main/CUSTOMER-WORKFLOWS.md#recovery-inspect-before-retrying"
    custom = {
        "archive-imap-attachments": "Change allowedExtensions for your intake. A stable Message-ID is required; empty files and files over 100 MiB fail. Extension filtering is not malware scanning.",
        "notify-teams-on-new-documents": "Set folderUid for one exact parent, excluding descendants; blank accepts account events. Poll at least hourly. Interruptions beyond 23 hours need reconciliation.",
        "remind-teams-about-due-dates": "Change reminderDays and overdueDays. This reads standard Due dates, not document text or custom metadata. Dates and the 09:00 schedule use UTC; folder scans are not recursive.",
    }[slug]
    first_test = {
        "archive-imap-attachments": "Start with an empty test inbox: existing unseen mail can be fetched. Activate before sending two allowed test attachments and one excluded file. Check downloaded bytes and replay suppression.",
        "notify-teams-on-new-documents": "Activate, allow the first poll, then upload a test file. Inspect the actual channel notice and repeat suppression. Manual previews can include historical events and send notices.",
        "remind-teams-about-due-dates": "Keep the schedule off while testing future, due-today, overdue and missing-date documents. Inspect actual channel messages and repeat suppression before activation.",
    }[slug]
    intro = ("### How it works\n" + case["audience"] + " " + case["outcome"] +
             " Completed receipts suppress repeats. An uncertain destination result stops processing and holds the lock for manual recovery.\n\n"
             "### Setup\nRequires Folderit **Tailor with API access**, a dedicated test destination and provider credentials. Install Folderit using the connection guide below. Tested on n8n **2.46.0** with **n8n-nodes-folderit 0.4.0**; Data Table v1.1 is required.\n\n"
             "1. Keep inactive. Choose a stable table name in **Ledger setup settings** and run only **1. Set up receipt table**, once at a time in the same n8n project.\n"
             "2. " + case["setup"] + " Never put secrets in Settings. Copies processing the same input must share the table.\n"
             "3. " + first_test + "\n\n"
             "### Customization\n" + custom + "\n\n"
             "[Connection and first-run guide](" + KB + ") · [Recovery instructions](" + recovery + ")\n\n"
             "[Workflow image](https://raw.githubusercontent.com/folderit-dms/n8n-nodes-folderit/main/templates/assets/" + slug + ".png)")
    # Keep a single left-to-right service path. Notes sit behind the nodes they
    # explain; the isolated setup branch stays the first execution root.
    positions = {
        "Settings": (200, 400), "Split and validate attachments": (400, 400),
        "Hash attachment bytes": (600, 400), "Build attachment receipt keys": (800, 400),
        "Read new document details": (400, 400), "Prepare arrival notifications": (600, 400),
        "List tracked documents": (400, 400), "Read document expiry dates": (600, 400),
        "Select due reminders": (800, 400), "Process one item": (1100, 760),
        "Read processing lock": (1100, 400), "Check lock record": (1300, 400),
        "Acquire processing lock": (1500, 400), "Confirm lock ownership": (1700, 400),
        "Lock acquired?": (1700, 120), "Limit lock waiting": (1900, 120),
        "Wait before checking lock": (2100, 120), "Find processing receipt": (2400, 400),
        "Decide whether to process": (2600, 400), "Already completed?": (2800, 400),
        "Report previous completion": (3000, 160), "Record pending attempt": (3300, 540),
        "Restore work item": (3500, 540), "Upload attachment": (3700, 540),
        "Read uploaded document": (3900, 540), "Download stored attachment": (4200, 760),
        "Hash stored attachment bytes": (4400, 760), "Verify destination result": (4600, 540),
        "Send Teams notification": (3700, 540), "Save completed receipt": (4900, 540),
        "Confirm completed receipt": (5100, 540), "Release processing lock": (5300, 400),
        "Confirm lock released": (5500, 400),
    }
    for node in obj["nodes"]:
        if node["name"] in positions:
            node["position"] = list(positions[node["name"]])
        elif node["name"].startswith("Setup:") or node["name"] in (
                "1. Set up receipt table", "Ledger setup settings", "Copy ledgerTableId into Settings"):
            node["position"][1] -= 600
    intake = {
        "archive-imap-attachments": "## 2 · Select safe attachments\nConfigure the IMAP and Settings nodes first. Split permitted attachments and hash their bytes; read/unread status is unchanged. Message-ID and attachment identity distinguish repeats from a different email with identical content.",
        "notify-teams-on-new-documents": "## 2 · Read new document events\nUse the same account UID and Folderit credential in the trigger and Settings. Read accessible document details and apply the optional exact-folder filter. A missing document stops for inspection.",
        "remind-teams-about-due-dates": "## 2 · Select the current reminder\nRead standard Due dates and choose one current milestone, not every missed milestone. Missing dates are skipped; malformed dates fail. A changed date starts a new reminder cycle; default overdue notices stop after seven days.",
    }[slug]
    sections = [
        ("Intake and selection", intake, -80, 200, 1080, 800),
        ("Serialize processing", "## 3 · Process one item at a time\nA shared lock serializes overlapping runs. Confirm ownership before continuing; competing runs wait for about one minute, then stop. There is no automatic lock expiry: a failed run needs inspection.", 1000, -80, 1280, 1080),
        ("Check saved receipts", "## 4 · Skip confirmed work\nLook up the item’s durable receipt. Completed work follows the upper bypass; a new item continues to the destination action. Pending or inconsistent receipts stop for recovery instead of repeating an uncertain action.", 2300, -80, 880, 1080),
        ("Record before writing", "## 5 · Record before uploading\nSave a pending receipt before creating the Folderit file. If the request fails or times out, inspect the actual destination before retrying; the file may already exist." if imap else "## 5 · Record before notifying\nSave a pending receipt before posting to Teams. Use a delegated work account that can post in the configured channel. A failed or uncertain response holds the lock; inspect the channel before retrying.", 3200, 200, 900, 800),
        ("Verify the destination", "## 6 · Verify the stored bytes\nRead the new document, download its stored binary and compare SHA-256 with the original attachment. Only an exact match may become a completed receipt. A successful upload status alone is insufficient." if imap else "## 6 · Check the returned message\nRequire a message ID from Teams before completing the receipt. During acceptance testing, also open the actual channel and check its body and destination; a green execution alone is insufficient.", 4100, 200, 700, 800),
        ("Complete and release", "## 7 · Save the result, then unlock\nConfirm the completed receipt before freeing the lock and taking the next item. Retain completed receipts. After a failure, confirm the old owner has stopped and reconcile every pending result before releasing its lock.", 4800, 200, 900, 800),
        ("Manual receipt-table setup", "## 1 · Run setup before the service trigger\nChoose a stable table name, then run this manual branch once. It validates or creates local receipts and the lock without contacting providers. Copy the final ledgerTableId into the main Settings node; preserve this table on upgrades.", -80, 1080, 2160, 650),
    ]
    obj["nodes"] += [sticky(slug, "Overview and requirements", intro, -1000, -100, 860, 900, 1)]
    obj["nodes"] += [sticky(slug, name, text, x, y, width, height)
                     for name, text, x, y, width, height in sections]


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

    annotate(obj, case)
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
                acceptance={
                    "archive-imap-attachments": "Real IMAP intake, exact bytes and duplicate replay passed in n8n Cloud; annotation-only revision preserves that processing logic; library review is separate",
                    "notify-teams-on-new-documents": "Real scheduled Teams arrival, exact-folder exclusion and duplicate replay passed in n8n Cloud; annotation-only revision preserves that processing logic; library review is separate",
                    "remind-teams-about-due-dates": "Real Teams reminders, skipped dates, duplicate replay, changed-date overlap and controlled failure quarantine passed in n8n Cloud; annotation-only revision preserves that processing logic; library review is separate",
                }[case["slug"]])


if __name__ == "__main__":
    manifest = [build(case) for case in CASES]
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
