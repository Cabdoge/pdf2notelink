(function (global) {
  "use strict";
  const H = global.HighlightNotes;
  const NS = "http://www.w3.org/1999/xhtml";
  const UI_STRINGS = {
    en: {
      relatedNotes: "Linked notes",
      untitledNote: "Untitled note",
      locationFailed: "The note is open, but the reference could not be located.",
      openFailed: "Unable to open the linked note. Please try again.",
    },
    zh: {
      relatedNotes: "关联笔记",
      untitledNote: "无标题笔记",
      locationFailed: "笔记已打开，但未能定位引用。",
      openFailed: "关联笔记打开失败，请重试。",
    },
  };
  class App {
    constructor(Z) {
      this.Z = Z;
      this.index = new H.ReverseIndex();
      this.libraries = new Map();
      this.windows = new Map();
      this.queue = Promise.resolve();
      this.alive = false;
      this.adapter = new H.Adapter(Z,
        (reader, key, point) => this.activate(reader, key, point).catch(e => this.error(reader, e)),
        reader => this.cancel(reader), () => H.Settings.mode(this.Z));
    }
    get strings() {
      return UI_STRINGS[/^zh(?:[-_]|$)/i.test(this.Z.locale || "") ? "zh" : "en"];
    }
    start() {
      if (this.alive) return;
      this.alive = true;
      this.prefObserver = this.Z.Prefs.registerObserver(H.Settings.key, () => {
        this.adapter.cancelGestures();
        for (const state of this.windows.values()) { state.token++; state.dismiss?.(); }
      }, true);
      this.observer = this.Z.Notifier.registerObserver({ notify: (event, type, ids) => {
        if (type === "tab") {
          for (const [win, state] of this.windows) {
            state.token++;
            state.dismiss?.();
          }
          this.scan();
          return;
        }
        // Do not await an index job inside a database notification transaction.
        this.enqueue(async () => {
          for (const id of ids) {
            if (event === "delete") { this.index.remove(id); continue; }
            const item = await this.Z.Items.getAsync(id);
            if (!item) continue;
            if (item.isNote() && this.libraries.has(item.libraryID)) this.indexNote(item);
            else if (item.isRegularItem()) this.libraries.delete(item.libraryID);
          }
        });
      } }, ["item", "tab"], "highlight-notes");
      const { setInterval, clearInterval } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
      this.clearInterval = clearInterval;
      this.timer = setInterval(() => this.scan(), 500);
      this.scan();
    }
    scan() {
      if (!this.alive) return;
      try {
        this.adapter.scan();
        for (const [win, state] of this.windows) if (win.closed) {
          state.token++; state.dismiss?.(); this.windows.delete(win);
        }
      } catch (e) { this.Z.logError(e); }
    }
    enqueue(job) {
      const result = this.queue.then(() => this.alive && job());
      this.queue = result.catch(e => this.Z.logError(e));
      return result;
    }
    resolveURI(uri) { return this.Z.URI.getURIItemLibraryKey(uri); }
    indexNote(note) {
      if (note.deleted || note.parentItem?.deleted) { this.index.remove(note.id); return; }
      const win = this.Z.getMainWindow();
      const doc = new win.DOMParser().parseFromString(note.getNote(), "text/html");
      this.index.replace({ id: note.id, libraryID: note.libraryID, title: note.getNoteTitle() || this.strings.untitledNote },
        H.extractReferences(doc, uri => this.resolveURI(uri)));
    }
    async ensureLibrary(libraryID) {
      if (!this.libraries.has(libraryID)) {
        const promise = this.enqueue(async () => {
          this.index.clearLibrary(libraryID);
          const search = new this.Z.Search();
          search.libraryID = libraryID;
          search.addCondition("itemType", "is", "note");
          const ids = await search.search();
          for (let i = 0; i < ids.length && this.alive; i += 50) {
            for (const note of await this.Z.Items.getAsync(ids.slice(i, i + 50))) this.indexNote(note);
            await this.Z.Promise.delay(0);
          }
        });
        this.libraries.set(libraryID, promise);
        promise.catch(() => { if (this.libraries.get(libraryID) === promise) this.libraries.delete(libraryID); });
      }
      await this.libraries.get(libraryID);
      await this.queue;
    }
    state(reader) {
      const win = this.adapter.window(reader);
      if (!this.windows.has(win)) this.windows.set(win, { token: 0, panel: null });
      return this.windows.get(win);
    }
    cancel(reader) { const state = this.state(reader); state.token++; state.dismiss?.(); }
    valid(reader, token) { return this.alive && this.adapter.isActive(reader) && this.state(reader).token === token; }
    element(doc, tag, text) {
      const element = doc.createElementNS(NS, tag);
      if (text) element.textContent = text;
      return element;
    }
    popup(reader, text, point) {
      const state = this.state(reader);
      state.dismiss?.();
      const { host, x, y, view } = this.adapter.popupAnchor(reader, point || state.point);
      const doc = host.document;
      const panel = this.element(doc, "section");
      panel.className = "highlight-notes-popup";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", this.strings.relatedNotes);
      panel.style.cssText = "position:fixed;z-index:2147483647;box-sizing:border-box;width:290px;max-width:calc(100vw - 16px);max-height:min(320px, calc(100vh - 16px));overflow:auto;padding:8px;border:1px solid color-mix(in srgb, CanvasText 22%, transparent);border-radius:10px;background:Canvas;color:CanvasText;color-scheme:light dark;box-shadow:0 6px 22px #0003;font:13px/1.5 system-ui,sans-serif;";
      const title = this.element(doc, "div", text);
      title.style.cssText = "font-weight:600;padding:4px 6px 8px;border-bottom:1px solid color-mix(in srgb, CanvasText 15%, transparent);margin-bottom:4px;";
      panel.append(title);
      doc.body.append(panel);
      state.panel = panel;
      const cleanups = [];
      const dismiss = () => {
        for (const cleanup of cleanups) cleanup();
        panel.remove();
        if (state.panel === panel) { state.panel = null; state.dismiss = null; }
      };
      state.dismiss = dismiss;
      const listen = (target, type, fn) => {
        if (!target) return;
        target.addEventListener(type, fn, true);
        cleanups.push(() => target.removeEventListener(type, fn, true));
      };
      for (const win of new Set([host, view, this.adapter.window(reader)].filter(Boolean))) {
        listen(win, "pointerdown", event => { if (!panel.contains(event.target)) dismiss(); });
        listen(win, "keydown", event => {
          if (event.key === "Escape" || (!panel.contains(event.target) &&
              ["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key))) dismiss();
        });
        listen(win, "resize", dismiss);
      }
      // Native annotation focus can animate PDF.js scrolling for several frames.
      // Reposition on that scroll; dismiss on actual user navigation input.
      listen(view, "wheel", dismiss);
      listen(view, "scroll", () => position());
      // Position next to the native annotation card when possible, like a related-note menu.
      // Only read its bounds; never alter Zotero or another plugin's popup.
      const position = () => {
        if (!panel.isConnected) return;
        const native = doc.querySelector(".annotation-popup");
        const rect = native?.getBoundingClientRect();
        const width = panel.getBoundingClientRect().width;
        const height = panel.getBoundingClientRect().height;
        let left = x + 12, top = y + 16;
        if (rect?.width && rect.height) {
          if (rect.right + width + 16 <= host.innerWidth) { left = rect.right + 8; top = rect.top; }
          else if (rect.left - width - 8 >= 8) { left = rect.left - width - 8; top = rect.top; }
          else { left = rect.left; top = rect.bottom + 8; }
        }
        panel.style.left = Math.max(8, Math.min(left, host.innerWidth - width - 8)) + "px";
        panel.style.top = Math.max(8, Math.min(top, host.innerHeight - height - 8)) + "px";
      };
      panel.reposition = position;
      position();
      host.requestAnimationFrame(position);
      return panel;
    }
    async activate(reader, annotationKey, point) {
      if (!this.alive || !this.adapter.isActive(reader)) return;
      const state = this.state(reader);
      state.dismiss?.();
      state.point = point;
      const token = ++state.token;
      const attachment = this.Z.Items.get(reader.itemID);
      const id = H.identity(attachment.libraryID, attachment.key, annotationKey);
      if (!id) return;
      await this.ensureLibrary(attachment.libraryID);
      if (!this.valid(reader, token)) return;
      const matches = this.index.find(id);
      if (matches.length === 1) return this.open(reader, token, id, matches[0]);
      if (matches.length > 1) this.candidates(reader, token, id, matches);
      // Zero matches: no UI and no changes to the current sidebar/note.
    }
    candidates(reader, token, id, matches) {
      const panel = this.popup(reader, `${this.strings.relatedNotes} · ${matches.length}`);
      for (const match of matches) {
        const button = this.element(panel.ownerDocument, "button");
        button.type = "button";
        button.style.cssText = "display:block;width:100%;box-sizing:border-box;border:0;border-radius:6px;margin:2px 0;padding:8px;text-align:start;background:transparent;color:inherit;cursor:pointer;font:inherit;";
        button.append(this.element(panel.ownerDocument, "div", "▤  " + match.title));
        const snippet = this.element(panel.ownerDocument, "div", match.snippets[0]);
        snippet.style.cssText = "font-size:12px;opacity:.65;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:3px;";
        button.append(snippet);
        const highlight = () => { button.style.background = "color-mix(in srgb, CanvasText 9%, transparent)"; };
        const reset = () => { button.style.background = "transparent"; };
        button.addEventListener("mouseenter", highlight);
        button.addEventListener("mouseleave", reset);
        button.addEventListener("focus", highlight);
        button.addEventListener("blur", reset);
        button.addEventListener("click", () => {
          if (!panel.isConnected || !this.valid(reader, token)) return;
          this.open(reader, token, id, match).catch(e => this.error(reader, e));
        });
        panel.append(button);
      }
      panel.reposition();
    }
    async open(reader, token, id, match) {
      if (!this.valid(reader, token)) return;
      token = ++this.state(reader).token;
      this.state(reader).dismiss?.();
      const note = await this.Z.Items.getAsync(match.id);
      if (!this.valid(reader, token)) return;
      if (!note || note.deleted || note.parentItem?.deleted) return;
      const editor = this.adapter.openNote(reader, note);
      for (let tries = 0; tries < 100; tries++) {
        if (!this.valid(reader, token) || editor.item?.id !== note.id) return;
        const doc = this.adapter.editorDocument(editor);
        if (doc?.querySelector(".ProseMirror")) {
          const nodes = this.adapter.referenceNodes(doc, id, uri => this.resolveURI(uri));
          if (nodes.length) {
            nodes[0].scrollIntoView({ block: "center", behavior: "instant" });
            nodes[0].animate?.([{ outline: "2px solid #e49b16" }, { outline: "2px solid transparent" }], { duration: 1300 });
            return;
          }
        }
        await this.Z.Promise.delay(50);
      }
      if (this.valid(reader, token)) this.popup(reader, this.strings.locationFailed);
    }
    error(reader, error) {
      this.Z.logError(error);
      if (this.alive && this.adapter.isActive(reader)) this.popup(reader, this.strings.openFailed);
    }
    stop() {
      this.alive = false;
      if (this.prefObserver) this.Z.Prefs.unregisterObserver(this.prefObserver);
      this.prefObserver = null;
      if (this.timer) this.clearInterval(this.timer);
      if (this.observer) this.Z.Notifier.unregisterObserver(this.observer);
      this.adapter.stop();
      for (const state of this.windows.values()) { state.token++; state.dismiss?.(); }
      this.windows.clear(); this.libraries.clear();
    }
  }
  H.App = App;
})(typeof module !== "undefined" ? globalThis : this);
