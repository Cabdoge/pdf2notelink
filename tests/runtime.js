/* Loaded only by the isolated test profile's bootstrap, never packaged in XPI. */
(async function () {
  const Z = Zotero;
  const root = TEST_ROOT;
  if (!/^\/private\/tmp\/zotero-highlight-notes-test(?:-[A-Za-z0-9_-]+)?$/.test(root) ||
      Z.Prefs.get("dataDir") !== root + "/data") throw Error("Refusing runtime tests outside isolated data directory");
  const report = { version: Z.version, locale: Z.locale, platform: Z.isMac ? 'macOS' : Z.isWin ? 'Windows' : 'Linux', tests: [], status: "running" };
  const write = () => Z.File.putContentsAsync(root + "/report.json", JSON.stringify(report, null, 2));
  const check = async (name, fn) => {
    try { await fn(); report.tests.push({ name, pass: true }); }
    catch (e) { report.tests.push({ name, pass: false, error: String(e), stack: e.stack }); }
    await write();
  };
  const assert = (value, message) => { if (!value) throw Error(message); };
  const wait = async (fn, message, count = 160) => {
    for (let i = 0; i < count; i++) { const value = fn(); if (value) return value; await Z.Promise.delay(100); }
    throw Error(message);
  };
  try {
    await write();
    const win = await wait(() => Z.getMainWindow()?.ZoteroPane && Z.getMainWindow(), "main window not ready");
    await Z.Promise.delay(1500);
    const parent = new Z.Item('journalArticle'); parent.setField('title', 'Highlight Notes 测试文献'); await parent.saveTx();
    const attachment = await Z.Attachments.importFromFile({ file: root + '/fixture.pdf', parentItemID: parent.id });
    const annotations = [];
    for (let i = 0; i < 3; i++) {
      const a = new Z.Item('annotation'); a.libraryID = attachment.libraryID; a.parentID = attachment.id;
      a.annotationType = 'highlight'; a.annotationText = ['Highlight one', 'Highlight two', 'Highlight three'][i];
      a.annotationColor = '#ffd400'; a.annotationPageLabel = '1';
      a.annotationSortIndex = `00000|000${i}00|00000`;
      a.annotationPosition = JSON.stringify({ pageIndex: 0, rects: [[60, 706 - i * 65, 310, 728 - i * 65]] });
      await a.saveTx(); annotations.push(a);
    }
    const nativeReferences = [];
    for (const annotation of annotations) {
      const json = await Z.Annotations.toJSON(annotation);
      json.id = annotation.key; json.attachmentItemID = attachment.id;
      nativeReferences.push(Z.EditorInstanceUtilities.serializeAnnotations([json]).html);
    }
    const reference = i => nativeReferences[i];
    const makeNote = async (title, html, child = true) => {
      const note = new Z.Item('note'); note.libraryID = attachment.libraryID;
      if (child) note.parentID = parent.id;
      note.setNote('<div data-schema-version="9"><h1>' + title + '</h1>' + html + '</div>');
      await note.saveTx(); return note;
    };
    const a = await makeNote('A 重复引用', reference(0) + '<p>解释一</p>'.repeat(20) + reference(0));
    const b = await makeNote('B 独立笔记', reference(0), false);
    const c = await makeNote('C 唯一笔记', reference(1));
    const reader = await Z.Reader.open(attachment.id);
    await reader._initPromise;
    await wait(() => reader._internalReader?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfViewer?._pages?.[0]?.div, 'PDF page not ready');
    await Z.Promise.delay(2000); app.scan();
    const panel = () => reader._iframeWindow.document.querySelector('.highlight-notes-popup');
    const activeID = () => win.ZoteroContextPane.activeEditor?.item?.id;
    const noSidebarPanel = () => assert(!win.document.querySelector('.highlight-notes-panel'), 'sidebar UI must not exist');
    report.popupEvents = [];
    const originalPopup = app.popup;
    app.popup = function (...args) {
      report.popupEvents.push({ type: 'show', text: args[1], time: Date.now() });
      const node = originalPopup.call(this, ...args);
      const remove = node.remove;
      node.remove = function () {
        report.popupEvents.push({ type: 'remove', stack: new Error().stack, time: Date.now() });
        return remove.call(node);
      };
      return node;
    };
    const text = () => panel()?.textContent || '';
    const preference = HighlightNotes.Settings.key;
    const modifier = Z.isMac ? Components.interfaces.nsIDOMWindowUtils.MODIFIER_META : Components.interfaces.nsIDOMWindowUtils.MODIFIER_CONTROL;
    const setMode = mode => Z.Prefs.set(preference, mode, true);
    setMode('click');
    const click = async (index, { drag = false, modifiers = 0 } = {}) => {
      // Bring the target into view and dismiss the native floating comment card,
      // which can otherwise intercept a click on the following highlighted line.
      await reader.navigate({ annotationID: annotations[index].key });
      reader._internalReader._updateState({ primaryViewAnnotationPopup: null, secondaryViewAnnotationPopup: null });
      await Z.Promise.delay(150);
      const view = reader._internalReader._primaryView;
      const pdfWin = view._iframeWindow;
      const page = pdfWin.PDFViewerApplication.pdfViewer._pages[0];
      const [px, py] = page.viewport.convertToViewportPoint(170, 717 - index * 65);
      const box = page.div.getBoundingClientRect();
      const x = box.left + px, y = box.top + py;
      const utils = Components.utils.unwaiveXrays(pdfWin).windowUtils;
      const events = [];
      const capture = e => events.push({ type: e.type, trusted: e.isTrusted, button: e.button,
        pointer: e.pointerId, page: !!e.target.closest?.('.page') });
      pdfWin.addEventListener('pointerdown', capture, true);
      pdfWin.addEventListener('pointerup', capture, true);
      utils.sendMouseEvent('mousedown', x, y, 0, 1, modifiers);
      if (drag) utils.sendMouseEvent('mousemove', x + 30, y + 2, 0, 1, modifiers);
      utils.sendMouseEvent('mouseup', x + (drag ? 30 : 0), y + (drag ? 2 : 0), 0, 1, modifiers);
      await Z.Promise.delay(500);
      pdfWin.removeEventListener('pointerdown', capture, true);
      pdfWin.removeEventListener('pointerup', capture, true);
      report.lastClick = { events, selected: Array.from(reader._internalReader._state.selectedAnnotationIDs), expected: annotations[index].key,
        attached: app.adapter.bindings.has(reader), active: app.adapter.isActive(reader), text: text() };
      await write();
      assert(events.length >= 2, 'test click did not reach PDF view');
    };
    await check('zero matches stay silent and leave a collapsed sidebar collapsed', async () => {
      win.ZoteroContextPane.collapsed = true;
      await click(2);
      assert(!panel(), 'empty popup must not appear');
      assert(win.ZoteroContextPane.collapsed, 'unmatched highlight opened sidebar');
      noSidebarPanel();
    });
    await check('multiple matches appear beside highlight without opening sidebar', async () => {
      await click(0);
      await wait(() => panel()?.querySelectorAll('button').length === 2, 'candidate popup missing');
      assert(win.ZoteroContextPane.collapsed, 'candidate popup expanded sidebar');
      assert(panel().ownerDocument === reader._iframeWindow.document, 'popup not in reader');
      const rect = panel().getBoundingClientRect();
      assert(rect.width > 100 && rect.width <= 310 && rect.height < 320, 'popup is not compact');
      assert(rect.left >= 0 && rect.right <= reader._iframeWindow.innerWidth + 1, 'popup overflows reader');
      assert(rect.top >= 0 && rect.bottom <= reader._iframeWindow.innerHeight + 1, 'popup overflows vertically');
      noSidebarPanel();
    });
    await check('choosing a candidate opens native note and removes popup', async () => {
      Array.from(panel().querySelectorAll('button')).find(n => n.textContent.includes('A 重复引用')).click();
      await wait(() => activeID() === a.id, 'wrong note');
      await Z.Promise.delay(300);
      assert(!panel(), 'chooser remained open'); noSidebarPanel();
    });
    await check('single match opens directly without a title or switching panel', async () => {
      await click(1); await wait(() => activeID() === c.id, 'single note not opened');
      assert(!panel(), 'single note produced popup'); noSidebarPanel();
      await app.activate(reader, annotations[1].key);
      const editor = win.ZoteroContextPane.activeEditor;
      const id = HighlightNotes.identity(attachment.libraryID, attachment.key, annotations[1].key);
      assert(app.adapter.referenceNodes(app.adapter.editorDocument(editor), id, uri => app.resolveURI(uri)).length === 1, 'reference identity missing');
    });
    await check('unmatched highlight keeps currently open note and no message', async () => {
      await click(2); assert(activeID() === c.id, 'existing note was replaced');
      assert(!panel(), 'unmatched highlight produced UI'); noSidebarPanel();
    });
    await check('drag and modified click do not change the current note', async () => {
      await click(0, { drag: true }); assert(activeID() === c.id && !panel(), 'drag navigated');
      await click(1, { modifiers: 4 }); assert(activeID() === c.id && !panel(), 'modified click navigated');
    });
    await check('Escape and user PDF scrolling dismiss the chooser', async () => {
      await click(0); await wait(() => panel(), 'popup missing');
      const doc = panel().ownerDocument;
      doc.dispatchEvent(new reader._iframeWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(!panel(), 'Escape did not dismiss');
      await click(0); await wait(() => panel(), 'popup missing on second click');
      const pdf = reader._internalReader._primaryView._iframeWindow;
      pdf.document.dispatchEvent(new pdf.WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
      assert(!panel(), 'scroll did not dismiss');
    });
    await check('standalone candidate opens without consuming sidebar space', async () => {
      await click(0); await wait(() => panel(), 'popup missing');
      Array.from(panel().querySelectorAll('button')).find(n => n.textContent.includes('B 独立笔记')).click();
      await wait(() => activeID() === b.id, 'standalone note not opened');
      assert(!panel(), 'chooser remains after selection'); noSidebarPanel();
    });
    await check('native preferences pane is registered and default trigger remains click', async () => {
      assert(Z.PreferencePanes.pluginPanes.some(p => p.id === 'pdf2notelink-preferences'), 'preferences pane missing');
      assert(HighlightNotes.Settings.mode(Z) === 'click', 'wrong default');
    });
    await check('modifier mode ordinary click keeps the note and shows the native annotation comment', async () => {
      annotations[1].annotationComment = 'COMMENT_SENTINEL'; await annotations[1].saveTx();
      await Z.Promise.delay(300);
      setMode('modifier');
      await click(1);
      assert(activeID() === b.id && !panel(), 'ordinary click changed note');
      assert(reader._iframeWindow.document.querySelector('.annotation-popup')?.textContent.includes('COMMENT_SENTINEL'), 'native comment missing');
    });
    await check('modifier click opens a single note and can repeat on an already selected highlight', async () => {
      await click(1, { modifiers: modifier });
      await wait(() => activeID() === c.id, 'modifier single note not opened');
      await app.activate(reader, annotations[0].key);
      panel().querySelector('button').click(); await wait(() => activeID() === a.id, 'setup note not opened');
      await click(1, { modifiers: modifier });
      await wait(() => activeID() === c.id, 'repeat modifier click failed');
      assert(reader._internalReader._state.selectedAnnotationIDs.length === 1, 'modifier toggled selection off');
    });
    await check('modifier zero and multiple matches preserve collapsed sidebar and native comment popup', async () => {
      win.ZoteroContextPane.collapsed = true;
      await click(2, { modifiers: modifier });
      assert(!panel() && win.ZoteroContextPane.collapsed, 'zero match changed sidebar');
      await click(0, { modifiers: modifier });
      await wait(() => panel()?.querySelectorAll('button').length === 2, 'modifier chooser missing');
      assert(win.ZoteroContextPane.collapsed, 'modifier chooser expanded sidebar');
      assert(reader._iframeWindow.document.querySelector('.annotation-popup'), 'native popup lost');
    });
    await check('changing preference closes chooser, invalidates pending requests and applies immediately', async () => {
      const token = app.state(reader).token;
      setMode('click');
      assert(!panel() && app.state(reader).token > token, 'preference did not cancel old UI/request');
      await click(1); await wait(() => activeID() === c.id, 'click mode did not resume');
      setMode('modifier');
      await click(0); assert(!panel() && activeID() === c.id, 'mode change not immediate');
    });
    await check('modifier drag and extra keys do not navigate; annotation sidebar retains native multi-selection', async () => {
      await click(0, { modifiers: modifier, drag: true });
      assert(!panel() && activeID() === c.id, 'modifier drag navigated');
      await click(0, { modifiers: modifier | Components.interfaces.nsIDOMWindowUtils.MODIFIER_SHIFT });
      assert(!panel() && activeID() === c.id, 'extra modifier navigated');
      const internal = reader._internalReader;
      const ids = key => Components.utils.cloneInto([key], reader._iframeWindow);
      internal.setSelectedAnnotations(ids(annotations[0].key), false, new reader._iframeWindow.MouseEvent('mousedown'));
      internal.setSelectedAnnotations(ids(annotations[1].key), false, new reader._iframeWindow.MouseEvent('mousedown', { metaKey: Z.isMac, ctrlKey: !Z.isMac }));
      assert(internal._state.selectedAnnotationIDs.length === 2, 'sidebar multi-selection was overridden');
      setMode('click');
    });
    await check('incremental edits/deletion/new notes update matches silently', async () => {
      b.setNote('<p>reference removed</p>'); await b.saveTx(); await app.queue;
      await app.activate(reader, annotations[0].key);
      assert(activeID() === a.id && !panel(), 'edited note still a candidate');
      await a.eraseTx(); await app.queue;
      win.ZoteroContextPane.collapsed = true;
      await app.activate(reader, annotations[0].key);
      assert(win.ZoteroContextPane.collapsed && !panel(), 'deleted note produced UI');
      const d = await makeNote('D 新增', reference(0)); await app.queue;
      await app.activate(reader, annotations[0].key); assert(activeID() === d.id, 'new note not indexed');
    });
    await check('rapid requests keep the last requested note', async () => {
      await Promise.all([app.activate(reader, annotations[0].key), app.activate(reader, annotations[1].key)]);
      assert(activeID() === c.id && !panel(), 'stale navigation won');
    });
    await check('native edits save and retain annotation metadata', async () => {
      const editor = win.ZoteroContextPane.activeEditor;
      editor.getCurrentInstance()._postMessage({ action: 'insertHTML', pos: null, html: '<p>EDIT_SAVE_SENTINEL</p>' });
      await wait(() => editor._iframe.contentDocument.body.textContent.includes('EDIT_SAVE_SENTINEL'), 'edit not inserted');
      await app.activate(reader, annotations[0].key);
      await wait(() => c.getNote().includes('EDIT_SAVE_SENTINEL'), 'edit not saved');
      assert(c.getNote().includes('data-annotation') && !c.getNote().includes('highlight-notes-popup'), 'metadata lost or UI persisted');
    });
    await check('multiple tabs remain isolated and close stale chooser', async () => {
      await makeNote('E 第二候选', reference(0)); await app.queue;
      await click(0); await wait(() => panel(), 'popup missing');
      const attachment2 = await Z.Attachments.importFromFile({ file: root + '/fixture.pdf', parentItemID: parent.id });
      const reader2 = await Z.Reader.open(attachment2.id); await reader2._initPromise;
      await Z.Promise.delay(500); app.scan();
      assert(!panel(), 'stale popup survived tab switch');
      win.ZoteroContextPane.collapsed = true;
      await app.activate(reader2, annotations[0].key);
      assert(win.ZoteroContextPane.collapsed, 'matched another attachment');
      win.Zotero_Tabs.select(reader.tabID); await Z.Promise.delay(200);
      await app.activate(reader, annotations[1].key);
      assert(activeID() === c.id && !panel(), 'wrong note after tab return');
    });
    await check('locating failure uses floating feedback and preserves correct note', async () => {
      const find = app.adapter.referenceNodes; app.adapter.referenceNodes = () => [];
      try {
        await app.activate(reader, annotations[1].key);
        assert(text().includes(app.strings.locationFailed) && activeID() === c.id, 'failure feedback incorrect');
        noSidebarPanel();
      } finally { app.adapter.referenceNodes = find; }
    });
    await check('stop removes floating UI/listeners; restart opens single note silently', async () => {
      const wrapped = reader._internalReader.setSelectedAnnotations;
      app.stop(); assert(!panel(), 'popup leaked');
      assert(reader._internalReader.setSelectedAnnotations !== wrapped, 'wrapper leaked');
      app = new HighlightNotes.App(Z); app.start();
      await app.activate(reader, annotations[1].key);
      assert(activeID() === c.id && !panel(), 'restart failed'); noSidebarPanel();
    });
    report.fixture = { parentID: parent.id, attachmentID: attachment.id, annotationKeys: annotations.map(x => x.key), noteIDs: [a.id, b.id, c.id] };
    report.status = 'complete'; await write();
  } catch (e) {
    report.status = 'error'; report.error = String(e); report.stack = e.stack; await write();
  }
})();
