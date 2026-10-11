/* Zotero 10.0.5 private APIs live only in this adapter. */
(function (global) {
  "use strict";
  const H = global.HighlightNotes;
  class Adapter {
    constructor(Z, onClick, onActivity, getMode = () => "click") {
      this.Z = Z;
      this.onClick = onClick;
      this.onActivity = onActivity;
      this.getMode = getMode;
      this.bindings = new Map();
    }
    scan() {
      const readers = this.Z.Reader._readers || [];
      for (const [reader, binding] of this.bindings) {
        if (!readers.includes(reader) || reader._internalReader !== binding.internal) {
          binding.dispose(); this.bindings.delete(reader);
        }
      }
      for (const reader of readers) {
        if (!reader.tabID || reader._type !== "pdf" || !reader._internalReader) continue;
        if (!this.bindings.has(reader)) this.bind(reader);
        this.bindings.get(reader)?.attachViews();
      }
    }
    bind(reader) {
      const internal = reader._internalReader;
      if (typeof internal.setSelectedAnnotations !== "function") return;
      const original = internal.setSelectedAnnotations;
      const views = new Map();
      let alive = true;
      const self = this;
      function wrapped(ids, fromView, event) {
        const eventWindow = event?.target?.ownerDocument?.defaultView;
        const win = eventWindow && typeof Components !== "undefined" ? Components.utils.unwaiveXrays(eventWindow) : eventWindow;
        const g = views.get(win)?.gesture;
        const matches = alive && fromView && g && self.getMode() === g.mode &&
          H.triggerPointer(event, g.mode, self.Z.isMac) && ids.length === 1 && g.existing.has(ids[0]);
        // Only this recognized PDF gesture gets single-selection semantics.
        // Construct an event in the content compartment; never mutate the real
        // trusted event or the keyboard manager's modifier state.
        let nativeEvent = event;
        if (matches && g.mode === "modifier" && !g.moved) {
          nativeEvent = new win.MouseEvent(event.type, {
            button: event.button, buttons: event.buttons, detail: event.detail,
            clientX: event.clientX, clientY: event.clientY,
            bubbles: event.bubbles, cancelable: event.cancelable,
          });
        }
        // Do not pass a privileged `arguments` object to a content-compartment
        // Function.apply: Gecko hides its indexed properties from the reader.
        const result = original.call(this, ids, fromView, nativeEvent);
        if (matches) g.id = ids[0];
        return result;
      }
      internal.setSelectedAnnotations = wrapped;
      function attachViews() {
        const current = [internal._primaryView, internal._secondaryView].map(v => v?._iframeWindow).filter(Boolean)
          .map(win => typeof Components !== "undefined" ? Components.utils.unwaiveXrays(win) : win);
        for (const [win, state] of views) if (!current.includes(win)) { state.dispose(); views.delete(win); }
        for (const win of current) {
          if (views.has(win)) continue;
          const state = { gesture: null };
          const down = event => {
            state.gesture = null;
            self.onActivity(reader);
            const mode = self.getMode();
            if (!H.triggerPointer(event, mode, self.Z.isMac) || !event.target?.closest?.(".page")) return;
            state.gesture = { x: event.clientX, y: event.clientY, pointer: event.pointerId,
              existing: new Set(internal._state.annotations.filter(a => a.type === "highlight").map(a => a.id)),
              id: null, moved: false, mode };
          };
          const move = event => {
            const g = state.gesture;
            if (g && Math.hypot(event.clientX - g.x, event.clientY - g.y) > 4) g.moved = true;
          };
          const cancel = () => { state.gesture = null; };
          const up = event => {
            const g = state.gesture;
            if (!g) return;
            move(event);
            // Run after PDF.js finishes selection; do not steal focus during pointerdown.
            win.setTimeout(() => {
              if (!alive || state.gesture !== g) return;
              state.gesture = null;
              if (self.getMode() !== g.mode || !H.triggerPointer(event, g.mode, self.Z.isMac) ||
                  g.moved || g.pointer !== event.pointerId || !g.id) return;
              const selected = internal._state.selectedAnnotationIDs;
              if (selected.length === 1 && selected[0] === g.id) self.onClick(reader, g.id, { win, x: event.clientX, y: event.clientY });
            }, 0);
          };
          for (const [type, fn] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["dragstart", cancel]]) win.addEventListener(type, fn, true);
          state.cancel = cancel;
          state.dispose = () => {
            cancel();
            for (const [type, fn] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["dragstart", cancel]]) win.removeEventListener(type, fn, true);
          };
          views.set(win, state);
        }
      }
      this.bindings.set(reader, { internal, attachViews, cancel() {
        for (const state of views.values()) state.cancel();
      }, dispose() {
        alive = false;
        if (internal.setSelectedAnnotations === wrapped) internal.setSelectedAnnotations = original;
        for (const state of views.values()) state.dispose();
        views.clear();
      } });
    }
    cancelGestures() { for (const binding of this.bindings.values()) binding.cancel(); }
    stop() { for (const b of this.bindings.values()) b.dispose(); this.bindings.clear(); }
    window(reader) { return reader._window; }
    isActive(reader) { return reader._window?.Zotero_Tabs?.selectedID === reader.tabID; }
    popupAnchor(reader, point) {
      const host = Components.utils.unwaiveXrays(reader._iframeWindow);
      let view = point?.win;
      let x = point?.x ?? 24, y = point?.y ?? 48;
      while (view && view !== host) {
        const frame = view.frameElement;
        if (!frame) break;
        const rect = frame.getBoundingClientRect();
        x += rect.left + frame.clientLeft;
        y += rect.top + frame.clientTop;
        view = frame.ownerDocument.defaultView;
      }
      return { host, x, y, view: point?.win };
    }
    notesContext(reader) {
      const win = reader._window;
      const pane = win.ZoteroContextPane;
      const libraryID = this.Z.Items.get(reader.itemID).libraryID;
      pane.context._selectNotesContext(libraryID);
      pane.context.mode = "notes";
      pane.collapsed = false;
      return pane.context._getCurrentNotesContext();
    }
    openNote(reader, note) {
      const context = this.notesContext(reader);
      context._getCurrentEditor()?.saveSync();
      // Reuse one native editor per tab rather than appending a new editor on every click.
      const tabContainer = Array.from(context.tabNotesDeck.children).find(n => n.getAttribute("data-tab-id") === reader.tabID);
      const isChild = this.Z.Items.get(reader.itemID).parentItemID === note.parentItemID;
      if (isChild && tabContainer) {
        context.tabNotesDeck.selectedPanel = tabContainer;
        context.mode = "childNote";
        const editor = tabContainer.querySelector("note-editor");
        editor.mode = context.editable ? "edit" : "view";
        editor.item = note;
        context.updatePinnedNoteTitle();
        reader._window.ZoteroContextPane.updateAddToNote();
        return editor;
      }
      context._setPinnedNote(note);
      return context._getCurrentEditor();
    }
    editorDocument(editor) {
      const instance = editor.getCurrentInstance();
      if (!instance || instance._item?.id !== editor.item?.id) return null;
      return editor._iframe?.contentDocument;
    }
    scrollToStart(doc) {
      const content = doc.querySelector(".ProseMirror");
      if (!content) return false;
      // The editor may scroll its document or a containing element. Reset only
      // ancestors of the note body, without changing selection or note content.
      const containers = new Set([doc.scrollingElement]);
      for (let node = content; node; node = node.parentElement) containers.add(node);
      for (const node of containers) {
        if (!node) continue;
        node.scrollTop = 0;
      }
      return Array.from(containers).every(node => !node || Math.abs(node.scrollTop) < 1);
    }
    referenceNodes(doc, id, resolveURI) {
      // Zotero's highlight NodeView omits data-annotation in the editable DOM.
      // Read the ProseMirror node metadata via its view descriptor; never match text.
      return Array.from(doc.querySelectorAll(".ProseMirror .highlight, .ProseMirror [data-annotation]"))
        .filter(node => {
          const annotation = H.decodeAnnotation(node.getAttribute("data-annotation")) ||
            node.wrappedJSObject?.pmViewDesc?.node?.attrs?.annotation;
          return H.referenceIdentity(annotation, resolveURI) === id;
        });
    }
  }
  H.Adapter = Adapter;
})(typeof module !== "undefined" ? globalThis : this);
