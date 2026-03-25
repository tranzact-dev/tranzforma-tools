// auth-guard.js - Redirect to portal if not authenticated
// Include this in each tool page AFTER auth.js

(function () {
  if (!window.tfIsAuthed || !tfIsAuthed()) {
    window.location.replace('../index.html');
  }
})();
