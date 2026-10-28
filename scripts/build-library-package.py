"""Build a separate starter ZIP without changing published workflow bundles."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "templates"
TARGET = ROOT / "Folderit-n8n-library-starter-pack.zip"

with ZipFile(TARGET, "w", compression=ZIP_DEFLATED) as archive:
    files = [(p, p.relative_to(SOURCE).as_posix()) for p in sorted(SOURCE.rglob("*")) if p.is_file()]
    files.append((ROOT / "LICENSE", "LICENSE"))
    for path, name in files:
        info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
print(f"Built {TARGET.name} with {len(files)} files; original bundles unchanged.")
