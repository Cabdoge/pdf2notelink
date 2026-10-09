const { test } = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/core.js');
const raw = { attachmentURI: 'http://zotero.org/users/local/TEST1234/items/ATTACH01', annotationKey: 'ANNOT001' };
const resolve = uri => ({ libraryID: uri.includes('groups') ? 2 : 1, key: uri.split('/').at(-1) });

test('encoded and plain native annotation references, including legacy URI field', () => {
  for (const text of [JSON.stringify(raw), encodeURIComponent(JSON.stringify(raw))]) {
    assert.equal(H.referenceIdentity(H.decodeAnnotation(text), resolve), '1/ATTACH01/ANNOT001');
  }
  assert.equal(H.referenceIdentity({ uri: raw.attachmentURI, annotationKey: raw.annotationKey }, resolve), '1/ATTACH01/ANNOT001');
});
test('malformed and imprecise references do not match by text or position', () => {
  for (const text of ['%zz', 'null', '[]', '{broken']) assert.equal(H.decodeAnnotation(text), null);
  for (const value of [{}, { ...raw, annotationKey: '' }, { ...raw, attachmentURI: 'https://evil.test/items/ATTACH01' }, { attachmentURI: raw.attachmentURI, position: { pageIndex: 0 } }]) {
    assert.equal(H.referenceIdentity(value, resolve), null);
  }
  assert.equal(H.referenceIdentity(raw, () => { throw Error('unknown library'); }), null);
});
test('same annotation keys in different libraries and attachments stay distinct', () => {
  assert.notEqual(H.referenceIdentity(raw, resolve), H.referenceIdentity({ ...raw, attachmentURI: 'http://zotero.org/groups/42/items/ATTACH01' }, resolve));
  assert.notEqual(H.identity(1, 'ATTACH01', 'ANNOT001'), H.identity(1, 'ATTACH02', 'ANNOT001'));
});
test('many notes and repeated occurrences; edits, trash, delete, rebuild', () => {
  const index = new H.ReverseIndex();
  const id = H.identity(1, 'ATTACH01', 'ANNOT001');
  index.replace({ id: 1, libraryID: 1, title: 'A' }, [{ id, snippet: 'first' }, { id, snippet: 'second' }]);
  index.replace({ id: 2, libraryID: 1, title: 'B' }, [{ id, snippet: 'other note' }]);
  index.replace({ id: 3, libraryID: 2, title: 'C' }, [{ id, snippet: 'wrong library' }]);
  assert.deepEqual(index.find(id).map(x => x.snippets.length), [2, 1]);
  index.replace({ id: 1, libraryID: 1, title: 'A' }, []);
  assert.equal(index.find(id).length, 1);
  index.replace({ id: 2, libraryID: 1, title: 'B', deleted: true }, [{ id, snippet: 'trash' }]);
  assert.equal(index.find(id).length, 0);
  index.replace({ id: 2, libraryID: 1, title: 'B' }, [{ id, snippet: 'restored' }]);
  index.clearLibrary(2);
  assert.equal(index.find(id).length, 1);
  index.remove(2);
  assert.equal(index.find(id).length, 0);
});
test('pointer guard excludes keyboard, synthetic, right click, modifiers', () => {
  const event = { type: 'pointerdown', button: 0, isTrusted: true };
  assert.equal(H.plainPointer(event), true);
  for (const props of [{ type: 'keydown' }, { button: 2 }, { isTrusted: false }, { shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) assert.equal(H.plainPointer({ ...event, ...props }), false);
});
