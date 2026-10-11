const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js'); require('../src/settings.js'); require('../src/adapter.js'); require('../src/main.js');
const H = global.HighlightNotes;
function fixture(position) {
  const state = { token: 0 }; let ready = true; const calls = [];
  const note = { id: 1 }, editor = { item: note };
  const Z = { Prefs: { get: () => position }, Items: { getAsync: async () => note }, Promise: { delay: async () => {} } };
  const app = new H.App(Z); app.alive = true; app.state = () => state;
  app.adapter.isActive = () => true;
  app.adapter.openNote = () => editor;
  app.adapter.editorDocument = () => ready ? { querySelector: () => ({}) } : null;
  app.adapter.scrollToStart = () => { calls.push('start'); return true; };
  app.adapter.referenceNodes = () => [{ scrollIntoView: () => calls.push('reference') }];
  app.popup = (_, message) => calls.push(message);
  return { app, Z, state, calls, setReady: v => { ready = v; } };
}
test('opening chooses only the requested position and repeated opens still scroll', async () => {
  for (const mode of ['start', 'reference']) {
    const f = fixture(mode);
    await f.app.open({}, 0, 'identity', { id: 1 });
    await f.app.open({}, 1, 'identity', { id: 1 });
    assert.deepEqual(f.calls, [mode, mode]);
  }
});
test('cancelling while fetching or loading prevents stale position changes', async () => {
  for (const phase of ['fetch', 'load']) {
    const f = fixture('start');
    if (phase === 'fetch') f.Z.Items.getAsync = async () => { f.state.token++; return { id: 1 }; };
    else { f.setReady(false); f.Z.Promise.delay = async () => { f.state.token++; f.setReady(true); }; }
    await f.app.open({}, 0, 'identity', { id: 1 }); assert.deepEqual(f.calls, []);
  }
});
test('position failures distinguish beginning from missing reference', async () => {
  for (const mode of ['start', 'reference']) {
    const f = fixture(mode); f.app.adapter.scrollToStart = () => false; f.app.adapter.referenceNodes = () => [];
    await f.app.open({}, 0, 'identity', { id: 1 });
    assert.deepEqual(f.calls, [mode === 'start' ? f.app.strings.startFailed : f.app.strings.locationFailed]);
  }
});
