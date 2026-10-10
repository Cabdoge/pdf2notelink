/* global Zotero, Services */
var scope;

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  scope = { Zotero, Services, ChromeUtils, Components };
  for (const file of ["core", "settings", "adapter", "main"]) {
    Services.scriptloader.loadSubScript(rootURI + "src/" + file + ".js", scope);
  }
  scope.app = new scope.HighlightNotes.App(Zotero);
  scope.app.start();
  await Zotero.PreferencePanes.register({
    pluginID: "highlight-notes@local.zotero",
    id: "pdf2notelink-preferences",
    label: "pdf2notelink",
    src: rootURI + "preferences/pane.xhtml",
    scripts: [rootURI + "src/settings.js", rootURI + "preferences/pane.js"],
  });
}

function shutdown() {
  scope?.app?.stop();
  scope = undefined;
}
function install() {}
function uninstall() {}
