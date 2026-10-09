const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/adapter.js');
const H = global.HighlightNotes;

function fixture() {
  const handlers = new Map(), timers = [];
  const win = {
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type) { handlers.delete(type); },
    setTimeout(fn) { timers.push(fn); },
  };
  let nativeCalls = 0, clicks = 0;
  const native = function (ids) { nativeCalls++; this._state.selectedAnnotationIDs = ids; return 42; };
  const internal = {
    _primaryView: { _iframeWindow: win },
    _state: { annotations: [{ id: 'ANNOT001', type: 'highlight' }], selectedAnnotationIDs: [] },
    setSelectedAnnotations: native,
  };
  const reader = { tabID: 'reader-1', _type: 'pdf', _internalReader: internal };
  const Z = { Reader: { _readers: [reader] } };
  const adapter = new H.Adapter(Z, () => clicks++, () => {});
  adapter.scan();
  const event = (type, overrides = {}) => ({ type, button: 0, isTrusted: true, clientX: 10, clientY: 10, pointerId: 1,
    target: { closest: () => true, ownerDocument: { defaultView: win } }, ...overrides });
  const dispatch = (type, overrides) => { const e = event(type, overrides); handlers.get(type)?.(e); return e; };
  const flush = () => { while (timers.length) timers.shift()(); };
  return { adapter, Z, reader, internal, handlers, native, dispatch, event, flush, clicks: () => clicks, nativeCalls: () => nativeCalls };
}
test('native callback preserved; navigate only after a finished single click', () => {
  const f = fixture();
  const down = f.dispatch('pointerdown');
  assert.equal(f.internal.setSelectedAnnotations(['ANNOT001'], true, down), 42);
  assert.equal(f.clicks(), 0);
  f.dispatch('pointerup'); f.flush();
  assert.equal(f.clicks(), 1); assert.equal(f.nativeCalls(), 1);
  f.adapter.scan(); assert.equal(f.handlers.size, 5);
  f.adapter.stop(); assert.equal(f.internal.setSelectedAnnotations, f.native); assert.equal(f.handlers.size, 0);
});
test('drag, new annotation, sidebar and programmatic selection never navigate', () => {
  for (const kind of ['drag', 'new', 'sidebar', 'programmatic', 'cancel', 'multi']) {
    const f = fixture(); const e = f.dispatch('pointerdown');
    const ids = kind === 'new' ? ['NEW00001'] : kind === 'multi' ? ['ANNOT001', 'ANNOT002'] : ['ANNOT001'];
    f.internal.setSelectedAnnotations(ids, kind !== 'sidebar', kind === 'programmatic' ? undefined : e);
    if (kind === 'drag') f.dispatch('pointermove', { clientX: 25 });
    if (kind === 'cancel') f.dispatch('pointercancel');
    f.dispatch('pointerup'); f.flush(); assert.equal(f.clicks(), 0, kind); f.adapter.stop();
  }
});
test('closing a reader restores callback; disable cancels pending pointerup', () => {
  const f = fixture(); const e = f.dispatch('pointerdown');
  f.internal.setSelectedAnnotations(['ANNOT001'], true, e); f.dispatch('pointerup');
  f.Z.Reader._readers = []; f.adapter.scan(); f.flush();
  assert.equal(f.clicks(), 0); assert.equal(f.handlers.size, 0); assert.equal(f.internal.setSelectedAnnotations, f.native);
});
