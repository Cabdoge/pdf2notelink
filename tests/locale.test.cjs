const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/core.js');
require('../src/settings.js');
require('../src/adapter.js');
require('../src/main.js');
const App = global.HighlightNotes.App;

test('English and fallback UI contain no Chinese text, including failure messages', () => {
  for (const locale of ['en-US', 'en-GB', 'de-DE', undefined]) {
    const app = new App({ locale });
    assert.equal(app.strings.relatedNotes, 'Linked notes');
    assert.equal(app.strings.untitledNote, 'Untitled note');
    for (const text of Object.values(app.strings)) assert.doesNotMatch(text, /[\u3400-\u9fff]/u);
  }
});
test('Chinese locales retain Chinese UI; changing the app locale updates labels', () => {
  const Z = { locale: 'zh-CN' }, app = new App(Z);
  assert.equal(app.strings.relatedNotes, '关联笔记');
  assert.equal(app.strings.untitledNote, '无标题笔记');
  Z.locale = 'zh-TW';
  assert.match(app.strings.locationFailed, /未能定位引用/);
  Z.locale = 'en-US';
  assert.equal(app.strings.relatedNotes, 'Linked notes');
});
