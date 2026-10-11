const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/settings.js');
require('../src/adapter.js');
require('../src/main.js');
const H = global.HighlightNotes;

test('trigger policy separates native comments from note navigation for both platforms', () => {
  const event = { type: 'pointerdown', button: 0, isTrusted: true };
  for (const isMac of [true, false]) {
    const key = isMac ? 'metaKey' : 'ctrlKey';
    assert.equal(H.triggerPointer(event, 'click', isMac), true);
    assert.equal(H.triggerPointer(event, 'modifier', isMac), false);
    assert.equal(H.triggerPointer({ ...event, [key]: true }, 'modifier', isMac), true);
    for (const extra of [{ altKey: true }, { shiftKey: true }, { [isMac ? 'ctrlKey' : 'metaKey']: true }, { button: 2 }, { isTrusted: false }, { type: 'keydown' }]) {
      assert.equal(H.triggerPointer({ ...event, [key]: true, ...extra }, 'modifier', isMac), false);
    }
  }
});
test('missing and invalid preferences fall back to click; settings labels are localized', () => {
  for (const value of [undefined, '', 'bad', true, 1, 'click', 'modifier']) {
    const Z = { Prefs: { get(key, global) { assert.equal(key, H.Settings.key); assert.equal(global, true); return value; } } };
    assert.equal(H.Settings.mode(Z), value === 'modifier' ? value : 'click');
  }
  for (const locale of ['en-US', 'de-DE', undefined]) {
    for (const text of Object.values(H.Settings.strings({ locale }))) assert.doesNotMatch(text, /[\u3400-\u9fff]/u);
  }
  assert.equal(H.Settings.strings({ locale: 'zh-CN' }).click, '直接点击高亮');
});
test('preference changes invalidate pending navigation, close choosers and clear gesture state; stop unregisters', () => {
  let callbacks = [], removed = 0, gestures = 0, dismissed = 0;
  const token = Symbol();
  const Z = { Prefs: {
    registerObserver(key, fn, global) { assert.ok([H.Settings.key, H.Settings.positionKey].includes(key)); assert.equal(global, true); callbacks.push(fn); return token; },
    unregisterObserver(value) { assert.equal(value, token); removed++; },
  }, Notifier: { registerObserver() { return 1; }, unregisterObserver() {} } };
  global.ChromeUtils = { importESModule() { return { setInterval: () => 1, clearInterval() {} }; } };
  const app = new H.App(Z); app.scan = () => {};
  app.adapter.cancelGestures = () => gestures++;
  const state = { token: 5, dismiss() { dismissed++; } };
  app.windows.set({}, state); app.start(); callbacks.forEach(fn => fn());
  assert.equal(state.token, 7); assert.equal(gestures, 2); assert.equal(dismissed, 2);
  app.stop(); assert.equal(removed, 2); assert.equal(app.windows.size, 0);
  delete global.ChromeUtils;
});

test('reading position defaults safely and is independent of trigger mode', () => {
  for (const value of [undefined, '', 'invalid', true, 'reference', 'start']) {
    for (const mode of ['click', 'modifier']) {
      const Z = { Prefs: { get: key => key === H.Settings.key ? mode : value } };
      assert.equal(H.Settings.position(Z), value === 'start' ? 'start' : 'reference');
      assert.equal(H.Settings.mode(Z), mode);
    }
  }
});
test('beginning resets nested and document scroll without selecting or editing', () => {
  const root = { scrollTop: 600, parentElement: null };
  const wrapper = { scrollTop: 240, parentElement: root };
  const content = { scrollTop: 0, parentElement: wrapper };
  const adapter = new H.Adapter({});
  assert.equal(adapter.scrollToStart({ querySelector: () => content, scrollingElement: root }), true);
  assert.equal(wrapper.scrollTop, 0); assert.equal(root.scrollTop, 0);
  assert.equal(adapter.scrollToStart({ querySelector: () => null }), false);
});
