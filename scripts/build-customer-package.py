"""Build the deployment bundle while preserving the existing public 0.4 bundle."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = ['README.md', 'CUSTOMER-WORKFLOWS.md', 'RELEASE-CHECKS.txt']
FILES += [p.relative_to(ROOT).as_posix() for p in sorted((ROOT / 'examples').rglob('*.json'))]
FILES += ['examples/deployments/CUSTOMER-WORKFLOWS.md']

with ZipFile(ROOT / 'Folderit-n8n-deployment-workflows-0.5.0.zip', 'w', compression=ZIP_DEFLATED) as archive:
    for source, target in [('examples/deployments/START-HERE.html', 'START-HERE.html')] + [(p, p) for p in FILES]:
        info = ZipInfo(target, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (ROOT / source).read_bytes())
print('Built the customer archive; installation and release gates are in START-HERE.html.')
