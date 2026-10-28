"""Exercise real starter artifacts and deliberately damaged temporary copies."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("library_package", ROOT / "scripts/check-library-package.py")
CHECKER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECKER)


class StarterPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / "templates", self.root / "templates")
        for filename in ("LICENSE", "Folderit-n8n-library-starter-pack.zip"):
            shutil.copyfile(ROOT / filename, self.root / filename)
        self.workflow = self.root / "templates/archive-imap-attachments.json"

    def repack(self):
        with ZipFile(self.root / "Folderit-n8n-library-starter-pack.zip", "w", compression=ZIP_DEFLATED) as archive:
            for path in sorted((self.root / "templates").rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(self.root / "templates").as_posix())
            archive.write(self.root / "LICENSE", "LICENSE")

    def mutate_workflow(self, mutate, path=None):
        path = path or self.workflow
        document = json.loads(path.read_text())
        mutate(document)
        path.write_text(json.dumps(document))
        self.repack()

    def rejected(self, message):
        with self.assertRaisesRegex(CHECKER.PackageError, message):
            CHECKER.check(self.root)

    def test_committed_download_matches_all_sources(self):
        result = CHECKER.check(self.root)
        self.assertEqual(result["mainWorkflows"], 3)
        self.assertEqual(result["allWorkflowExports"], 4)

    def test_stale_zip_is_rejected(self):
        self.workflow.write_text(self.workflow.read_text() + "\n")
        self.rejected("Archive is stale")

    def test_extra_zip_entry_is_rejected(self):
        with ZipFile(self.root / "Folderit-n8n-library-starter-pack.zip", "a") as archive:
            archive.writestr("unexpected-test-export.json", "{}")
        self.rejected("file list differs")

    def test_missing_packaged_asset_is_rejected(self):
        (self.root / "templates/assets/archive-imap-attachments.png").unlink()
        self.repack()
        self.rejected("missing local linked file")

    def test_active_export_is_rejected_even_with_fresh_zip(self):
        self.mutate_workflow(lambda workflow: workflow.update(active=True))
        self.rejected("must be inactive")

    def test_pinned_execution_data_is_rejected(self):
        self.mutate_workflow(lambda workflow: workflow.update(pinData={"Settings": [{"json": {"fixture": "synthetic"}}]}))
        self.rejected("pinned results")

    def test_saved_trigger_state_is_rejected(self):
        self.mutate_workflow(lambda workflow: workflow.update(staticData={"node:trigger": {"checkpoint": "synthetic"}}))
        self.rejected("trigger state")

    def test_saved_credential_reference_is_rejected(self):
        self.mutate_workflow(lambda workflow: workflow["nodes"][0].update(credentials={"imap": {"id": "SYNTHETIC_REFERENCE", "name": "Synthetic test"}}))
        self.rejected("credential references")

    def test_configured_destination_id_is_rejected(self):
        def change(workflow):
            node = next(node for node in workflow["nodes"] if node["name"] == "Settings")
            settings = json.loads(node["parameters"]["jsonOutput"])
            settings["folderUid"] = "SYNTHETIC_PRIVATE_FOLDER"
            node["parameters"]["jsonOutput"] = json.dumps(settings)
        self.mutate_workflow(change)
        self.rejected("folderUid must remain a public placeholder")

    def test_broken_wiring_is_rejected(self):
        def change(workflow):
            workflow["connections"]["Settings"]["main"][0][0]["node"] = "Missing node"
        self.mutate_workflow(change)
        self.rejected("missing connection target")

    def test_stale_manifest_is_rejected(self):
        path = self.root / "templates/manifest.json"
        manifest = json.loads(path.read_text())
        manifest[0]["nodes"] += 1
        path.write_text(json.dumps(manifest))
        self.repack()
        self.rejected("Manifest workflow details are stale")

    def test_support_workflow_is_checked_too(self):
        self.mutate_workflow(lambda workflow: workflow.update(active=True), self.root / "templates/support/folderit-failure-alert-email.json")
        self.rejected("must be inactive")


if __name__ == "__main__":
    unittest.main()
