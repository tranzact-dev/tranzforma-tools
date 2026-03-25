// auth.js - Simple password gate (client-side only)
//
// Password hash is SHA-256 of the plaintext password.
// To change the password, replace PASS_HASH with the new SHA-256 hex digest.
// Generate one at: console.log(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('yourpassword')).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))

(function () {
  const SESSION_KEY = 'tfAuth';
  // Default password: "tranzforma"
  const PASS_HASH = '2c6e851929b9ec5418000bb7412ae8935cf6bdf32ab691bdd24ef5c35acfabdf';

  // ── Compute SHA-256 hex digest ──
  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Public: check if authenticated ──
  window.tfIsAuthed = function () {
    return sessionStorage.getItem(SESSION_KEY) === 'ok';
  };

  // ── Public: attempt login, returns Promise<boolean> ──
  window.tfLogin = async function (password) {
    const hash = await sha256(password);
    if (hash === PASS_HASH) {
      sessionStorage.setItem(SESSION_KEY, 'ok');
      return true;
    }
    return false;
  };

  // ── Public: logout ──
  window.tfLogout = function () {
    sessionStorage.removeItem(SESSION_KEY);
  };
})();
