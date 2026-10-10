const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/adapter.js');
const H = global.HighlightNotes;

function fixture({ mode = 'click', isMac = false } = {}) {
  const handlers = new Map(), timers = [];
  const win = {
    MouseEvent: class { constructor(type, props) { Object.assign(this, props, { type, isTrusted: false }); } },
    addEventListener(type, fn) { handlers.set(type, fn); },
    removeEventListener(type) { handlers.delete(type); },
    setTimeout(fn) { timers.push(fn); },
  };
  let nativeCalls = 0, clicks = 0;
  const native = function (ids, fromView, event) {
    nativeCalls++;
    const selected = this._state.selectedAnnotationIDs;
    if (ids.length === 1 && selected.length && (event?.ctrlKey || isMac && event?.metaKey)) {
      this._state.selectedAnnotationIDs = selected.includes(ids[0]) ? selected.filter(id => id !== ids[0]) : [...selected, ids[0]];
    } else this._state.selectedAnnotationIDs = ids;
    return 42;
  };
  const internal = {
    _primaryView: { _iframeWindow: win },
    _state: { annotations: [{ id: 'ANNOT001', type: 'highlight' }], selectedAnnotationIDs: [] },
    setSelectedAnnotations: native,
  };
  const reader = { tabID: 'reader-1', _type: 'pdf', _internalReader: internal };
  const Z = { Reader: { _readers: [reader] }, isMac };
  const adapter = new H.Adapter(Z, () => clicks++, () => {}, () => mode);
  adapter.scan();
  const event = (type, overrides = {}) => ({ type, button: 0, isTrusted: true, clientX: 10, clientY: 10, pointerId: 1,
    target: { closest: () => true, ownerDocument: { defaultView: win } }, ...overrides });
  const dispatch = (type, overrides) => { const e = event(type, overrides); handlers.get(type)?.(e); return e; };
  const flush = () => { while (timers.length) timers.shift()(); };
  return { adapter, Z, reader, internal, handlers, native, dispatch, event, flush,
    setMode(value) { mode = value; adapter.cancelGestures(); }, clicks: () => clicks, nativeCalls: () => nativeCalls };
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
test('modifier mode handles preselected highlights and native sidebar multi-selection on both platforms', () => {
  for (const isMac of [true, false]) {
    const f = fixture({ mode: 'modifier', isMac });
    const modifier = isMac ? { metaKey: true } : { ctrlKey: true };
    for (const selected of [[], ['ANNOT001'], ['OTHER001'], ['ANNOT001', 'OTHER001']]) {
      f.internal._state.selectedAnnotationIDs = selected;
      const down = f.dispatch('pointerdown', modifier);
      const before = f.clicks();
      f.internal.setSelectedAnnotations(['ANNOT001'], true, down);
      assert.deepEqual(f.internal._state.selectedAnnotationIDs, ['ANNOT001']);
      assert.equal(f.clicks(), before);
      assert.equal(down[isMac ? 'metaKey' : 'ctrlKey'], true, 'original event mutated');
      f.dispatch('pointerup', modifier); f.flush();
      assert.equal(f.clicks(), before + 1);
    }
    const plain = f.dispatch('pointerdown');
    f.internal.setSelectedAnnotations(['ANNOT001'], true, plain);
    f.dispatch('pointerup'); f.flush(); assert.equal(f.clicks(), 4);
    f.internal.setSelectedAnnotations(['OTHER001'], false, f.event('mousedown', modifier));
    assert.deepEqual(f.internal._state.selectedAnnotationIDs, ['ANNOT001', 'OTHER001']);
    assert.equal(f.clicks(), 4); f.adapter.stop();
  }
});
test('modifier gestures reject drag, cancellation, wrong keys, new/batch/programmatic selections and setting changes', () => {
  for (const kind of ['drag', 'cancel', 'wrongKey', 'extraKey', 'releasedKey', 'new', 'multi', 'programmatic', 'setting', 'queuedSetting', 'pointer']) {
    const f = fixture({ mode: 'modifier', isMac: true });
    const mods = kind === 'wrongKey' ? { ctrlKey: true } : { metaKey: true, altKey: kind === 'extraKey' };
    const down = f.dispatch('pointerdown', mods);
    f.internal.setSelectedAnnotations(kind === 'new' ? ['NEW00001'] : kind === 'multi' ? ['ANNOT001', 'OTHER001'] : ['ANNOT001'], true, kind === 'programmatic' ? undefined : down);
    if (kind === 'drag') f.dispatch('pointermove', { ...mods, clientX: 30 });
    if (kind === 'cancel') f.dispatch('pointercancel');
    if (kind === 'setting') { f.setMode('click'); f.setMode('modifier'); }
    f.dispatch('pointerup', kind === 'releasedKey' ? {} : { ...mods, pointerId: kind === 'pointer' ? 2 : 1 });
    if (kind === 'queuedSetting') f.setMode('click');
    f.flush(); assert.equal(f.clicks(), 0, kind); f.adapter.stop();
  }
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
