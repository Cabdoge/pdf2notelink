/* Pure identity/index logic; shared by Zotero and node:test. */
(function (global) {
  "use strict";
  const keyPattern = /^[A-Z0-9]{8}$/;
  function decodeAnnotation(raw) {
    if (typeof raw !== "string") return null;
    for (const decode of [x => x, decodeURIComponent]) {
      try {
        const value = JSON.parse(decode(raw));
        if (value && typeof value === "object" && !Array.isArray(value)) return value;
      } catch (_) { /* Malformed references are ignored individually. */ }
    }
    return null;
  }
  function identity(libraryID, attachmentKey, annotationKey) {
    if (!Number.isInteger(libraryID) || libraryID <= 0 ||
        !keyPattern.test(attachmentKey) || !keyPattern.test(annotationKey)) return null;
    return `${libraryID}/${attachmentKey}/${annotationKey}`;
  }
  function referenceIdentity(annotation, resolveURI) {
    if (!annotation || !keyPattern.test(annotation.annotationKey)) return null;
    const uri = annotation.attachmentURI || annotation.uri;
    if (typeof uri !== "string" || !/^https?:\/\/zotero\.org\/(users\/(?:local\/)?[A-Za-z0-9]+|groups\/\d+)\/items\/[A-Z0-9]{8}\/?$/.test(uri)) return null;
    try {
      const item = resolveURI(uri);
      return item ? identity(item.libraryID, item.key, annotation.annotationKey) : null;
    } catch (_) { return null; }
  }
  function extractReferences(doc, resolveURI) {
    const refs = [];
    for (const node of doc.querySelectorAll("[data-annotation]")) {
      const id = referenceIdentity(decodeAnnotation(node.getAttribute("data-annotation")), resolveURI);
      if (!id) continue;
      const paragraph = node.closest("p,li,blockquote") || node.parentElement || node;
      refs.push({ id, snippet: paragraph.textContent.replace(/\s+/g, " ").trim().slice(0, 180) });
    }
    return refs;
  }
  class ReverseIndex {
    constructor() { this.notes = new Map(); this.references = new Map(); }
    remove(noteID) {
      const old = this.notes.get(noteID);
      if (!old) return;
      for (const id of old.matches.keys()) {
        const bucket = this.references.get(id);
        bucket.delete(noteID);
        if (!bucket.size) this.references.delete(id);
      }
      this.notes.delete(noteID);
    }
    replace(note, refs) {
      this.remove(note.id);
      if (note.deleted) return;
      const matches = new Map();
      for (const ref of refs) {
        if (!ref.id.startsWith(`${note.libraryID}/`)) continue;
        if (!matches.has(ref.id)) matches.set(ref.id, []);
        matches.get(ref.id).push(ref.snippet);
      }
      this.notes.set(note.id, { ...note, matches });
      for (const id of matches.keys()) {
        if (!this.references.has(id)) this.references.set(id, new Set());
        this.references.get(id).add(note.id);
      }
    }
    clearLibrary(libraryID) {
      for (const [id, note] of this.notes) if (note.libraryID === libraryID) this.remove(id);
    }
    find(id) {
      return Array.from(this.references.get(id) || [], noteID => {
        const note = this.notes.get(noteID);
        return { id: note.id, title: note.title, snippets: note.matches.get(id) };
      }).sort((a, b) => a.title.localeCompare(b.title) || a.id - b.id);
    }
  }
  // Pointer input must originate in a PDF view and have no selection modifiers.
  function plainPointer(event) {
    return !!event && event.isTrusted && event.button === 0 &&
      !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
      /^(pointerdown|pointerup|mousedown|mouseup|click)$/.test(event.type);
  }
  const api = { decodeAnnotation, identity, referenceIdentity, extractReferences, ReverseIndex, plainPointer };
  global.HighlightNotes = Object.assign(global.HighlightNotes || {}, api);
  if (typeof module !== "undefined") module.exports = api;
})(typeof module !== "undefined" ? globalThis : this);
