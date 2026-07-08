/* ============================================================
   auth.js — Sign-in gate for the app.

   Plain English: this is the lock on the front door. The
   username and a scrambled "fingerprint" (hash) of the password
   are baked in below, so the login works on any device that
   opens the site — nothing needs to be set up per browser.

   To change the password later: take the new password, compute
   its SHA-256 hash, and replace PASSWORD_HASH below. (Or just
   ask Claude to do it.)

   Note on security: this is a static website with no server, so
   this lock keeps out casual visitors but is not bank-grade
   security. Don't store truly sensitive secrets in this app.
   ============================================================ */

const Auth = {
  SESSION_KEY: "overageCRM_session",

  // Baked-in credentials (password is stored only as a SHA-256 hash)
  USERNAME: "AidanH",
  PASSWORD_HASH: "2db833d395c7621fe7a5261492ab32a7181cf64ff0152e89db3df364a72b8ef2",

  async sha256(text) {
    const enc = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  },

  async isConfigured() {
    return true; // login is always on
  },

  isLoggedIn() {
    return sessionStorage.getItem(Auth.SESSION_KEY) === "yes";
  },

  async tryLogin(username, password) {
    const hash = await Auth.sha256(password);
    const ok = username.trim() === Auth.USERNAME && hash === Auth.PASSWORD_HASH;
    if (ok) sessionStorage.setItem(Auth.SESSION_KEY, "yes");
    return ok;
  },

  logout() {
    sessionStorage.removeItem(Auth.SESSION_KEY);
    location.reload();
  },
};
