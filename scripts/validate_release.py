"""Check all release metadata against the built package, including update hashes."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile

parser = argparse.ArgumentParser()
parser.add_argument('--tag')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text())
package = json.loads((root / 'package.json').read_text())
version = manifest['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected a stable semver version'
assert version == package['version'], 'Version mismatch'
assert manifest['name'] == package['name'] == 'pdf2notelink'
if args.tag:
    assert args.tag == f'v{version}', 'Tag does not match manifest version'
zotero = manifest['applications']['zotero']
assert zotero['id'] == 'highlight-notes@local.zotero', 'Do not change upgrade identity'
repo = package['homepage']
assert repo == 'https://github.com/Cabdoge/pdf2notelink'
assert zotero['update_url'] == repo + '/releases/latest/download/updates.json'
assert package['license'] == 'MIT'
assert 'Copyright (c) 2026 Cabdoge' in (root / 'LICENSE').read_text()
assert f'## {version}\n' in (root / 'CHANGELOG.md').read_text()
artifact = root / 'dist' / f'pdf2notelink-{version}.xpi'
with ZipFile(artifact) as archive:
    assert archive.testzip() is None
    expected = {'manifest.json', 'bootstrap.js', 'src/core.js', 'src/settings.js', 'src/adapter.js', 'src/main.js', 'prefs.js', 'preferences/pane.xhtml', 'preferences/pane.js', 'LICENSE'}
    assert set(archive.namelist()) == expected
    for name in expected:
        assert archive.read(name) == (root / name).read_bytes(), name + ' is stale'
update_file = root / 'dist/updates.json'
updates = json.loads(update_file.read_text())
assert set(updates['addons']) == {zotero['id']}
records = updates['addons'][zotero['id']]['updates']
assert len(records) == 1
update = records[0]
assert update['version'] == version
assert update['update_link'] == f'{repo}/releases/download/v{version}/{artifact.name}'
assert update['update_hash'] == 'sha256:' + hashlib.sha256(artifact.read_bytes()).hexdigest()
assert update['applications']['zotero'] == {k: zotero[k] for k in ['strict_min_version', 'strict_max_version']}
checksums = (root / 'dist/SHA256SUMS').read_text()
for path in [artifact, update_file]:
    assert hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.name + '\n' in checksums
assert (root / 'dist/release-notes.md').read_text().strip()
print(f'Validated v{version}: XPI contents, update identity/URL/compatibility, hashes, license and release notes')
