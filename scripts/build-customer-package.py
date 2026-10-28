"""Rebuild the credential-free customer archive from reviewed repository files."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = ['README.md', 'CUSTOMER-WORKFLOWS.md', 'RELEASE-CHECKS.txt']
FILES += ['examples/' + name + '.json' for name in [
    'deployment-read-only', 'folderit-ledger-setup',
    'email-attachments-to-folderit-safe', 'outlook-attachments-to-folderit-safe',
    'folderit-new-files-to-teams', 'folderit-expiry-reminders-to-teams',
    'folderit-failure-alert-email',
]]

with ZipFile(ROOT / 'Folderit-n8n-customer-workflows.zip', 'w', compression=ZIP_DEFLATED) as archive:
    for source, target in [('examples/START-HERE.html', 'START-HERE.html')] + [(p, p) for p in FILES]:
        info = ZipInfo(target, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (ROOT / source).read_bytes())
print('Built the customer archive; installation and release gates are in START-HERE.html.')
