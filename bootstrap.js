/* global Zotero, Services */
var scope;

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  scope = { Zotero, Services, ChromeUtils, Components };
  for (const file of ["core", "adapter", "main"]) {
    Services.scriptloader.loadSubScript(rootURI + "src/" + file + ".js", scope);
  }
  scope.app = new scope.HighlightNotes.App(Zotero);
  scope.app.start();
}

function shutdown() {
  scope?.app?.stop();
  scope = undefined;
}
function install() {}
function uninstall() {}
