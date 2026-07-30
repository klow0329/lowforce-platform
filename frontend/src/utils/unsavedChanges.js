// Lightweight cross-page "you have unsaved changes" guard. No data router
// is in use (plain <BrowserRouter>, see App.jsx), so React Router's
// useBlocker/usePrompt aren't available — this fills the gap with a
// module-level flag: record pages call setUnsavedChanges() as their dirty
// state changes, NavBar's links (the main "go to another screen" path)
// check it before letting a click through, and beforeunload covers a
// refresh/close/typed-URL navigation.
let dirty = false;
let message = 'You have unsaved changes that will be lost if you leave. Continue?';

export function setUnsavedChanges(isDirty, customMessage) {
  dirty = isDirty;
  if (customMessage) message = customMessage;
}

export function hasUnsavedChanges() {
  return dirty;
}

// Call before an in-app navigation you control. Returns true if it's safe
// to proceed (nothing dirty, or the user confirmed discarding it).
export function confirmDiscardIfDirty() {
  if (!dirty) return true;
  return window.confirm(message);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });
}
