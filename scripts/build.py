"""Reproducible Zotero XPI and update manifest; no third-party dependencies."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text())
version = manifest['version']
repo = json.loads((root / 'package.json').read_text())['homepage']
out = root / 'dist' / f'pdf2notelink-{version}.xpi'
out.parent.mkdir(exist_ok=True)
files = ['manifest.json', 'bootstrap.js', 'src/core.js', 'src/adapter.js', 'src/main.js', 'LICENSE']
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        info = ZipInfo(name, (2026, 10, 9, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, (root / name).read_bytes())
with ZipFile(out) as archive:
    assert archive.testzip() is None
    assert archive.namelist() == files
zotero = manifest['applications']['zotero']
updates = {'addons': {zotero['id']: {'updates': [{
    'version': version,
    'update_link': f'{repo}/releases/download/v{version}/{out.name}',
    'update_hash': 'sha256:' + hashlib.sha256(out.read_bytes()).hexdigest(),
    'applications': {'zotero': {key: zotero[key] for key in ['strict_min_version', 'strict_max_version']}}
}]}}}
update_file = out.parent / 'updates.json'
update_file.write_text(json.dumps(updates, indent=2) + '\n')
(out.parent / 'SHA256SUMS').write_text(''.join(
    hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n'
    for path in [out, update_file]))
changelog = (root / 'CHANGELOG.md').read_text()
notes = changelog.split(f'## {version}\n', 1)[1].split('\n## ', 1)[0].strip()
(out.parent / 'release-notes.md').write_text(notes + '\n')
print(out)
