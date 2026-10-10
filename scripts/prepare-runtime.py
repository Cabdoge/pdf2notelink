"""Prepare a fresh isolated Zotero profile; never touch the normal profile."""
import json
from pathlib import Path
import shlex
import tempfile
from zipfile import ZipFile, ZIP_DEFLATED

source = Path(__file__).resolve().parents[1]
root = Path(tempfile.mkdtemp(prefix='zotero-highlight-notes-test-', dir='/private/tmp'))
profile = root / 'profile'
data = root / 'data'
extensions = profile / 'extensions'
extensions.mkdir(parents=True)
data.mkdir()
prefs = {
    'extensions.zotero.dataDir': str(data),
    'extensions.zotero.useDataDir': True,
    'extensions.zotero.firstRun': False,
    'extensions.zotero.sync.autoSync': False,
    'extensions.zotero.httpServer.enabled': False,
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.startupScanScopes': 15,
    'extensions.sideloadScopes': 15,
    'extensions.update.enabled': False,
}
(profile / 'user.js').write_text(''.join(
    f'user_pref({json.dumps(k)}, {json.dumps(v)});\n' for k, v in prefs.items()))
bootstrap = (source / 'bootstrap.js').read_text() + '''
var originalStartup = startup;
startup = async function(data, reason) {
  try {
    await originalStartup(data, reason);
    scope.TEST_ROOT = TEST_ROOT_VALUE;
    Services.scriptloader.loadSubScript(data.rootURI + 'tests/runtime.js', scope);
  } catch (e) {
    await Zotero.File.putContentsAsync(TEST_ROOT_VALUE + '/startup-error.txt', String(e) + '\\n' + e.stack);
  }
};
'''.replace('TEST_ROOT_VALUE', json.dumps(str(root)))
with ZipFile(extensions / 'highlight-notes@local.zotero.xpi', 'w', ZIP_DEFLATED) as archive:
    for name in ['manifest.json', 'src/core.js', 'src/settings.js', 'src/adapter.js', 'src/main.js', 'prefs.js', 'preferences/pane.xhtml', 'preferences/pane.js', 'tests/runtime.js']:
        archive.write(source / name, name)
    archive.writestr('bootstrap.js', bootstrap)

# A synthetic vector PDF: no personal library content or third-party files.
stream = b'BT /F1 18 Tf 60 710 Td (Highlight one for linked notes.) Tj 0 -65 Td (Highlight two for another note.) Tj 0 -65 Td (Highlight three has no linked note.) Tj ET'
objects = [
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream',
]
pdf = bytearray(b'%PDF-1.4\n')
offsets = []
for number, obj in enumerate(objects, 1):
    offsets.append(len(pdf))
    pdf += f'{number} 0 obj\n'.encode() + obj + b'\nendobj\n'
xref = len(pdf)
pdf += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
for offset in offsets:
    pdf += f'{offset:010} 00000 n \n'.encode()
pdf += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(root / 'fixture.pdf').write_bytes(pdf)
print('Isolated test directory:', root)
print('Launch in a graphical macOS session:')
print(shlex.join(['/Applications/Zotero.app/Contents/MacOS/zotero', '-no-remote', '-profile', str(profile), '-ZoteroDebugText']))
print('Results:', root / 'report.json')
