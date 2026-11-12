// Firefox only. Firefox's toolbar popup stops the page from scrolling while it is open, so in
// Firefox the toolbar button opens the analyzer in the sidebar instead, where the page stays
// usable. Chrome has no sidebarAction, so there the normal popup is kept and this does nothing.
const api = globalThis.browser ?? globalThis.chrome;

if (api.sidebarAction) {
  api.action.setPopup({ popup: "" });
  api.action.onClicked.addListener(() => {
    api.sidebarAction.toggle();
  });
}
