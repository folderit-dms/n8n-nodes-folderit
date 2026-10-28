"""Check the committed starter ZIP and public exports without changing them.

Run after rebuilding the pack. This checks packaging and export hygiene only;
it does not verify credentials, provider delivery or n8n library approval.
"""
import json
from pathlib import Path
import re
import sys
from zipfile import BadZipFile, ZipFile


class PackageError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise PackageError(message)


class LocalLinks:
    """Resolve only local document links, including Markdown image targets."""

    @staticmethod
    def targets(text):
        return re.findall(r'(?:href|src)=["\']([^"\']+)["\']|\]\(([^\s)]+)\)', text)


def check_export(document, filename):
    require(document.get("active") is False, filename + ": export must be inactive")
    require(not document.get("pinData"), filename + ": pinned results must be removed")
    require(not document.get("staticData"), filename + ": saved trigger state must be removed")
    for key in ("id", "versionId", "activeVersionId"):
        require(not document.get(key), filename + ": saved workflow identity must be removed")
    require(not document.get("settings", {}).get("errorWorkflow"), filename + ": saved error-workflow ID must be removed")
    nodes = document["nodes"]
    names = [node["name"] for node in nodes]
    require(len(names) == len(set(names)), filename + ": duplicate node names")
    for node in nodes:
        require(not node.get("credentials"), filename + ": saved credential references must be removed")
        require(not node.get("webhookId"), filename + ": saved webhook IDs must be removed")
        if node["name"] == "Settings":
            settings = json.loads(node["parameters"]["jsonOutput"])
            for key in ("accountUid", "folderUid", "ledgerTableId", "mailboxScope", "teamId", "channelId"):
                if key not in settings:
                    continue
                value = settings[key]
                optional_folder = key == "folderUid" and value == ""
                require(optional_folder or (isinstance(value, str) and re.fullmatch(r"YOUR_[A-Z_]+", value)), filename + ": " + key + " must remain a public placeholder")
    for source, channels in document.get("connections", {}).items():
        require(source in names, filename + ": unknown source node in connections")
        for outputs in channels.values():
            for edges in outputs:
                for edge in edges:
                    require(edge["node"] in names, filename + ": missing connection target")


def check(root):
    source = root / "templates"
    expected = {path.relative_to(source).as_posix(): path.read_bytes()
                for path in source.rglob("*") if path.is_file()}
    expected["LICENSE"] = (root / "LICENSE").read_bytes()
    require("START-HERE.html" in expected and "manifest.json" in expected, "Missing starter entry point or manifest")
    with ZipFile(root / "Folderit-n8n-library-starter-pack.zip") as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Duplicate archive entries")
        require(set(names) == set(expected), "Archive file list differs from templates and LICENSE")
        require(archive.testzip() is None, "Archive CRC check failed")
        for name, content in expected.items():
            require(archive.read(name) == content, "Archive is stale: " + name)
    workflows = {}
    for filename, content in expected.items():
        if filename.endswith(".json"):
            document = json.loads(content)
            if isinstance(document, dict) and "nodes" in document:
                check_export(document, filename)
                workflows[filename] = document
        if filename.endswith((".html", ".md")):
            for html_target, md_target in LocalLinks.targets(content.decode("utf-8")):
                target = html_target or md_target
                if re.match(r"^[a-zA-Z][\w+.-]*:", target) or target.startswith(("#", "//")):
                    continue
                relative = target.split("#", 1)[0].split("?", 1)[0]
                require((source / filename).parent.joinpath(relative).resolve().is_relative_to(source.resolve()), filename + ": local link escapes starter pack")
                resolved = (source / filename).parent.joinpath(relative).resolve()
                require(resolved.is_file(), filename + ": missing local linked file")
    manifest = json.loads(expected["manifest.json"])
    manifest_files = [item["file"] for item in manifest]
    main_files = {name for name in workflows if "/" not in name}
    require(len(manifest_files) == len(set(manifest_files)) and set(manifest_files) == main_files, "Manifest must describe each main workflow exactly once")
    for item in manifest:
        workflow = workflows[item["file"]]
        require(item["name"] == workflow["name"] and item["nodes"] == len(workflow["nodes"]), "Manifest workflow details are stale")
        require(workflow["nodes"][0]["name"] == "1. Set up receipt table", "Manual setup must remain the safe first root")
    return {"files": len(expected), "mainWorkflows": len(main_files), "allWorkflowExports": len(workflows),
            "result": "Starter ZIP matches source; export and local-link checks passed"}


if __name__ == "__main__":
    try:
        print(json.dumps(check(Path(__file__).resolve().parents[1]), indent=2))
    except (PackageError, BadZipFile, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        print("Starter package check failed: " + str(error), file=sys.stderr)
        sys.exit(1)
