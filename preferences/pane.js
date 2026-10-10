/* Loaded in Zotero's isolated preference-pane scope. */
var pdf2notelinkPreferences = {
  init() {
    const strings = HighlightNotes.Settings.strings(Zotero);
    document.getElementById("pdf2notelink-heading").textContent = strings.heading;
    document.getElementById("pdf2notelink-click").label = strings.click;
    document.getElementById("pdf2notelink-modifier").label = Zotero.isMac ? strings.modifierMac : strings.modifierOther;
    document.getElementById("pdf2notelink-description").textContent = strings.description;
    document.getElementById("pdf2notelink-conflict").textContent = strings.conflict;
    const group = document.getElementById("pdf2notelink-trigger-mode");
    group.value = HighlightNotes.Settings.mode(Zotero);
    group.addEventListener("command", () => this.change());
  },
  change() {
    const value = document.getElementById("pdf2notelink-trigger-mode").value;
    Zotero.Prefs.set(HighlightNotes.Settings.key, value === "modifier" ? "modifier" : "click", true);
  },
};
