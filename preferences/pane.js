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
    document.getElementById("pdf2notelink-position-heading").textContent = strings.positionHeading;
    document.getElementById("pdf2notelink-reference").label = strings.reference;
    document.getElementById("pdf2notelink-start").label = strings.start;
    document.getElementById("pdf2notelink-position-description").textContent = strings.positionDescription;
    const position = document.getElementById("pdf2notelink-reading-position");
    position.value = HighlightNotes.Settings.position(Zotero);
    position.addEventListener("command", () => {
      Zotero.Prefs.set(HighlightNotes.Settings.positionKey, position.value === "start" ? "start" : "reference", true);
    });
  },
  change() {
    const value = document.getElementById("pdf2notelink-trigger-mode").value;
    Zotero.Prefs.set(HighlightNotes.Settings.key, value === "modifier" ? "modifier" : "click", true);
  },
};
