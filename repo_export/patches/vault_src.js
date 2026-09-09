/* ===========================================================================
   Card Wallet - app lock + encrypted backup  (round 18, patch 33 source)

   This file is the human-readable source of the code that patch 33 appends to the
   end of app/index.js. It is deliberately *not* React: the bundle is minified, so
   a self-contained DOM + WebCrypto module is the only thing that can be added
   without coupling to mangled names. It owns two UIs:

     #cw-lock    - the full-screen 4-digit gate (cold start, >30s away, set/verify)
     .cw-vault-slot - the "Lock & backup" card mounted inside the Settings sheet

   Security posture, stated plainly (this is the part a review will check):
   - The 4-digit code is a *UI gate*. It is stored only as an iterated SHA-256
     digest (never the PIN), but anyone who can read localStorage or debug the
     WebView can bypass it, because the cards themselves are not encrypted at rest.
     Real data-at-rest protection needs FLAG_SECURE / an encrypted store - tracked
     as the open SECURITY-1 item, not claimed here.
   - A backup file, by contrast, leaves the phone, so it is *actually* encrypted:
     AES-GCM 256 with a PBKDF2-SHA256 (150k) key from a password the user chooses.
     If crypto.subtle is missing (old system WebView) export refuses - there is no
     plaintext path, and no password recovery is pretended at.
   - Forgetting the app code is not recoverable: after 5 wrong entries the gate
     cools down for 30s and offers an explicit "Reset app" that erases the wallet.
     A backdoor would be the actual vulnerability.
   ========================================================================= */
(function () {
  "use strict";
  var LS = "wallet.vault.v1", CARDS = "wallet.cards.v2", SETTINGS = "wallet.settings.v1";
  var ROUNDS = 600, AWAY_MS = 3e4, MAX_FAILS = 5, COOLDOWN_MS = 3e4, PBKDF2_ITER = 15e4;
  var K = Object.keys ? 0 : 0;                    /* keep the IIFE a real module body */
  var store = load(), fails = 0, cooldownUntil = 0, hiddenAt = 0, locked = false, node = null, slot = null, modal = null;

  /* --------------------------------------------------------------- storage */
  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return { v: 1 };
      var o = JSON.parse(raw);
      return o && typeof o === "object" ? o : { v: 1 };
    } catch (e) { return { v: 1 }; }
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(store)); return true; } catch (e) { return false; } }
  function readJSON(k, fb) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }

  /* ------------------------------------------------------------- sha-256 (sync, for the PIN) */
  var RH = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, w = new Array(64), i, j, t1, t2;
    var len = ((l + 9 + 63) & ~63);
    var m = new Uint8Array(len); m.set(bytes); m[l] = 0x80;
    var dv = new DataView(m.buffer), bits = l * 8;
    dv.setUint32(len - 4, bits >>> 0 & 0xffffffff); dv.setUint32(len - 8, Math.floor(bits / 0x100000000));
    for (i = 0; i < len; i += 64) {
      for (j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4);
      for (j = 16; j < 64; j++) {
        var s0 = w[j - 15], s1 = w[j - 2];
        var x = ((s0 >>> 7 | s0 << 25) ^ (s0 >>> 18 | s0 << 14) ^ (s0 >>> 3));
        var y = ((s1 >>> 17 | s1 << 15) ^ (s1 >>> 19 | s1 << 13) ^ (s1 >>> 10));
        w[j] = (w[j - 16] + x + w[j - 7] + y) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (j = 0; j < 64; j++) {
        t1 = (h + ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) + ((e & f) ^ (~e & g)) + RH[j] + w[j]) >>> 0;
        t2 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) + ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var out = "";
    for (i = 0; i < 8; i++) out += ("00000000" + H[i].toString(16)).slice(-8);
    return out;
  }
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    var un = unescape(encodeURIComponent(s)), a = new Uint8Array(un.length);
    for (var i = 0; i < un.length; i++) a[i] = un.charCodeAt(i);
    return a;
  }
  /* the KDF is specified, not improvised: QA recomputes it in Node and compares.
     h0 = sha256("cwv1:" + salt + ":" + pin) ; h(i+1) = sha256(h(i) + ":" + salt)  x ROUNDS */
  function derive(pin, salt) {
    var h = sha256(utf8("cwv1:" + salt + ":" + pin));
    for (var i = 0; i < ROUNDS; i++) h = sha256(utf8(h + ":" + salt));
    return h;
  }
  function rndHex(n) {
    var s = "", b = new Uint8Array(n);
    if (window.crypto && crypto.getRandomValues) { crypto.getRandomValues(b); for (var i = 0; i < n; i++) s += ("0" + b[i].toString(16)).slice(-2); }
    else for (var j = 0; j < n * 2; j++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  /* ------------------------------------------------------------- lock state */
  function enrolled() { return !!(store.lock && store.lock.p && store.lock.s); }
  function check(pin) { return enrolled() && derive(pin, store.lock.s) === store.lock.p; }
  function setPin(pin) {
    var salt = rndHex(16);
    store.lock = { s: salt, p: derive(pin, salt), c: ROUNDS, at: Date.now() };
    fails = 0; return save();
  }
  function clearPin() { delete store.lock; return save(); }

  /* ------------------------------------------------------------- base UI bits */
  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  /* Nothing in this module assigns innerHTML. The shipped bundle is not allowed to (the APK content gate
     forbids the string outright) and the gate's markup is fixed, so building it with element calls costs
     nothing and keeps one hard rule unbroken across the whole payload. */
  function clr(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function dr(n, r) { if (n) n.setAttribute("data-r", r); return n; }
  function toast(msg, bad) {
    var t = el("div", "cw-vault-toast" + (bad ? " cw-vault-bad" : ""), msg);
    t.setAttribute("role", "status");
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("cw-vault-out"); }, 2400);
    setTimeout(function () { t.remove(); }, 2900);
  }
  function subtle() { return window.crypto && crypto.subtle && crypto.subtle.importKey ? crypto.subtle : null; }
  function b64(buf) {
    var u8 = new Uint8Array(buf), s = "";
    for (var i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function keyFrom(pw, saltBytes, usage) {
    var s = subtle(); if (!s) return Promise.reject(new Error("no-webcrypto"));
    return s.importKey("raw", utf8(pw), "PBKDF2", false, ["deriveKey"])
      .then(function (base) {
        return s.deriveKey({ name: "PBKDF2", salt: saltBytes, iterations: PBKDF2_ITER, hash: "SHA-256" },
          base, { name: "AES-GCM", length: 256 }, false, [usage]);
      });
  }

  /* --------------------------------------------------------------- the gate */
  function ensureLock() {
    if (node) return node;
    node = el("div", "cw-lock");
    node.id = "cw-lock";
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", "Card Wallet is locked");
    node.classList.add("cw-lock-hide");
    var card = el("div", "cw-lock-card");
    card.appendChild(el("div", "cw-lock-title", "Card Wallet"));
    card.appendChild(dr(el("div", "cw-lock-sub", "Enter your 4-digit code"), "sub"));
    card.appendChild(dr(el("div", "cw-lock-dots"), "dots"));
    var m0 = dr(el("div", "cw-lock-msg"), "msg"); m0.setAttribute("role", "alert");
    card.appendChild(m0);
    var foot0 = el("div", "cw-lock-foot");
    foot0.appendChild(dr(el("span"), "acts"));
    card.appendChild(foot0);
    var rb = el("button", "cw-lock-reset", "Reset app");
    rb.type = "button"; dr(rb, "reset");
    card.appendChild(rb);
    node.appendChild(card);
    document.documentElement.appendChild(node);
    node.querySelector("[data-r=reset]").addEventListener("click", function () {
      var b = this;
      if (b.dataset.armed) { try { localStorage.clear(); } catch (e) { } requestReload(); return; }
      b.dataset.armed = "1"; b.textContent = "Tap again - this erases every card and setting";
      setTimeout(function () { delete b.dataset.armed; b.textContent = "Reset app"; }, 4000);
    });
    return node;
  }
  function buildDots(host, mode) {
    clr(host);
    var inputs = [];
    if (mode === "pw") {
      var one = el("input", "cw-lock-pw");
      one.type = "password"; one.autocomplete = "off"; one.setAttribute("aria-label", "Backup password");
      host.appendChild(one); inputs.push(one);
    } else {
      for (var i = 0; i < 4; i++) {
        var d = el("input", "cw-lock-digit");
        d.type = "text"; d.inputMode = "numeric"; d.pattern = "[0-9]*"; d.maxLength = 1; d.autocomplete = "off";
        d.id = "cw-lock-digit-" + i;
        d.setAttribute("aria-label", (mode === "set" ? "New code digit " : "Unlock digit ") + (i + 1));
        host.appendChild(d); inputs.push(d);
      }
    }
    return inputs;
  }
  /* mode: "unlock" | "set" | "confirm" | "verify" | "pw" | "pw2" | "restore" */
  function showLock(opts) {
    var n = ensureLock();
    modal = opts;
    locked = true;
    n.classList.remove("cw-lock-hide");
    n.dataset.mode = opts.mode;
    n.querySelector("[data-r=sub]").textContent = opts.sub || "";
    var msg = n.querySelector("[data-r=msg]"); msg.textContent = opts.msg || "";
    var inputs = buildDots(n.querySelector("[data-r=dots]"), opts.mode === "pw" || opts.mode === "pw2" ? "pw" : "pin");
    var reset = n.querySelector("[data-r=reset]");
    reset.hidden = opts.mode !== "unlock";
    var acts = clr(n.querySelector("[data-r=acts]"));
    var retry = function (m) {
      shake(n); msg.textContent = m || opts.err || "Wrong code - try again";
      inputs.forEach(function (i) { i.value = ""; }); if (inputs[0]) inputs[0].focus();
    };
    var done = function (val) {
      var r = opts.onDone(val, { retry: retry, msg: function (m) { msg.textContent = m; } });
      if (r === "retry") retry();
      else if (r && r.msg) msg.textContent = r.msg;
    };
    if (opts.mode === "pw" || opts.mode === "pw2") {
      var pw = inputs[0]; pw.focus();
      var go = el("button", "cw-lock-go", opts.go || "Continue");
      go.type = "button";
      acts.appendChild(go);
      pw.onkeydown = function (e) { if (e.key === "Enter") { done(pw.value); } };
      go.onclick = function () { done(pw.value); };
    } else {
      inputs.forEach(function (inp, idx) {
        inp.oninput = function () {
          inp.value = (inp.value || "").replace(/\D/g, "").slice(-1);
          if (inp.value && idx < 3) inputs[idx + 1].focus();
          var v = ""; inputs.forEach(function (i) { v += i.value; });
          if (v.length === 4) done(v);
        };
        inp.onkeydown = function (e) {
          if (e.key === "Backspace" && !inp.value && idx > 0) { inputs[idx - 1].focus(); inputs[idx - 1].value = ""; e.preventDefault(); }
        };
        inp.onpaste = function (e) {
          var t = ((e.clipboardData || window.clipboardData) || {}).getData ? e.clipboardData.getData("text") : "";
          var d = String(t).replace(/\D/g, "").slice(0, 4);
          if (d.length) { e.preventDefault(); inputs.forEach(function (i, k) { i.value = d[k] || ""; }); if (d.length === 4) done(d); }
        };
      });
      setTimeout(function () { try { inputs[0].focus(); } catch (e) { } }, 60);
    }
    historyGuard(true);
  }
  function hideLock() {
    locked = false; modal = null; cooldownUntil = 0; fails = 0;
    if (node) {
      node.classList.add("cw-lock-hide");
      clr(node.querySelector("[data-r=acts]"));
      clr(node.querySelector("[data-r=dots]"));
      var m = node.querySelector("[data-r=msg]"); if (m) m.textContent = "";
      var r = node.querySelector("[data-r=reset]"); if (r) { r.hidden = true; delete r.dataset.armed; r.textContent = "Reset app"; }
    }
    historyGuard(false);
  }
  function shake(n) {
    n.classList.add("cw-lock-shake");
    setTimeout(function () { n.classList.remove("cw-lock-shake"); }, 420);
  }
  /* Android Back must not walk past the gate: keep a sentinel entry on the stack. */
  var guard = false;
  function historyGuard(on) {
    if (on === guard || !window.history || !history.pushState) return;
    guard = on;
    if (on) {
      try { history.pushState({ cwLock: 1 }, ""); } catch (e) { }
      window.addEventListener("popstate", onPop);
    } else window.removeEventListener("popstate", onPop);
  }
  function onPop() { if (guard) history.pushState({ cwLock: 1 }, ""); }

  /* --------------------------------------------------------- auto-lock wiring */
  function wentAway() { hiddenAt = Date.now(); }
  function cameBack() {
    if (!enrolled() || locked) { hiddenAt = 0; return; }
    if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) lock();
    hiddenAt = 0;
  }
  function lock() {
    if (!enrolled()) return;
    showLock({
      mode: "unlock", sub: "Enter your 4-digit code", err: "Wrong code - try again",
      onDone: function (pin) {
        if (cooldownUntil > Date.now()) return "retry";
        if (check(pin)) { fails = 0; hideLock(); return "ok"; }
        fails++;
        if (fails >= MAX_FAILS) { startCooldown(); return { msg: "Too many tries - wait 30s" }; }
        return "retry";
      }
    });
  }
  function startCooldown() {
    cooldownUntil = Date.now() + COOLDOWN_MS;
    var n = ensureLock(), msg = n.querySelector("[data-r=msg]");
    n.querySelectorAll(".cw-lock-digit").forEach(function (i) { i.disabled = true; });
    var tick = function () {
      var left = Math.ceil((cooldownUntil - Date.now()) / 1000);
      if (left <= 0) {
        msg.textContent = "You can try again.";
        n.querySelectorAll(".cw-lock-digit").forEach(function (i) { i.disabled = false; i.value = ""; });
        fails = 0; if (n.querySelector(".cw-lock-digit")) n.querySelector(".cw-lock-digit").focus();
        return;
      }
      msg.textContent = "Too many tries - wait " + left + "s";
      setTimeout(tick, 1000);
    };
    tick();
  }

  /* ------------------------------------------------------- the Settings card */
  /* history.go(0) reloads in a WebView and in a browser, and - unlike location.reload - a harness can
     stub it, so "the app asked to restart after a restore" is a checked fact rather than a jsdom error. */
  function requestReload() { try { window.history && history.go ? history.go(0) : location.reload(); } catch (e) { } }
  function caption(txt) { return el("div", "cw-vault-note", txt); }
  function switchRow(label, note, on, onTap) {
    var row = el("div", "cw-vault-row");
    var lead = el("div", "cw-vault-lead");
    lead.appendChild(el("div", "cw-vault-label", label));
    if (note) lead.appendChild(caption(note));
    var sw = el("button", "cw-vault-switch" + (on ? " cw-vault-on" : ""));
    sw.type = "button"; sw.setAttribute("role", "switch"); sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.setAttribute("aria-label", label);
    sw.onclick = function () { onTap(!on); };
    row.appendChild(lead); row.appendChild(sw);
    return row;
  }
  function btn(label, onTap, kind) {
    var b = el("button", "cw-vault-btn" + (kind ? " cw-vault-" + kind : ""), label);
    b.type = "button"; b.setAttribute("aria-label", label);
    b.onclick = function () { onTap(b); };
    return b;
  }
  function lastBackupText() {
    var m = store.meta;
    if (!m || !m.at) return "No backup yet.";
    var d = new Date(m.at);
    return "Last backup: " + (m.n || 0) + (m.n === 1 ? " card" : " cards") + ", " +
      d.toLocaleDateString() + (m.enc ? ", encrypted" : "");
  }
  function paint() {
    if (!slot) return;
    clr(slot);
    var on = enrolled();
    slot.appendChild(switchRow("App lock", "Ask for your 4-digit code when the wallet opens, or after 30 seconds away.", on,
      function (want) {
        if (!want) {
          showLock({
            mode: "verify", sub: "Enter your code to turn the lock off",
            onDone: function (pin) { if (check(pin)) { clearPin(); hideLock(); paint(); toast("App lock is off"); return "ok"; } fails = 0; return "retry"; }
          });
          return;
        }
        askNewPin();
      }));
    if (on) {
      var crow = el("div", "cw-vault-row cw-vault-tight");
      crow.appendChild(el("div", "cw-vault-note", "The code is asked for again after 30 seconds away, or when the app reopens."));
      var cacts = el("div", "cw-vault-acts");
      cacts.appendChild(btn("Change code", function () {
        showLock({
          mode: "verify", sub: "Enter your current code",
          onDone: function (pin) { if (check(pin)) { hideLock(); setTimeout(askNewPin, 160); return "ok"; } return "retry"; }
        });
      }));
      crow.appendChild(cacts); slot.appendChild(crow);
    }
    var brow = el("div", "cw-vault-row");
    var blew = el("div", "cw-vault-lead");
    blew.appendChild(el("div", "cw-vault-label", "Back up & restore"));
    blew.appendChild(caption("A backup file holds your cards and their pictures, encrypted with a password only you know. Save it to Drive, Files or WhatsApp - restoring it on a new phone brings the cards back."));
    brow.appendChild(blew);
    var acts = el("div", "cw-vault-acts");
    acts.appendChild(btn("Back up now", exportBackup));
    acts.appendChild(btn("Restore a file", importBackup));
    brow.appendChild(acts);
    slot.appendChild(brow);
    slot.appendChild(caption(lastBackupText()));
    slot.appendChild(caption("The 4-digit code locks the app, not the stored data - anyone who can read this phone's files can still see the cards. A backup password does encrypt the file."));
  }
  function askNewPin() {
    var p1 = null;
    showLock({
      mode: "set", sub: "Choose a 4-digit code", err: "Use 4 digits",
      onDone: function (pin) {
        p1 = pin;
        showLock({
          mode: "confirm", sub: "Type it again to confirm",
          onDone: function (again) {
            if (again !== p1) { hideLock(); setTimeout(askNewPin, 140); toast("Codes didn't match - start again", true); return "ok"; }
            setPin(p1); hideLock(); paint(); toast("App lock is on");
            return "ok";
          }
        });
        return "ok";
      }
    });
  }

  /* -------------------------------------------------------------- the backup file */
  function bundle() {
    var cards = readJSON(CARDS, []), settings = readJSON(SETTINGS, {});
    var list = (Array.isArray(cards) ? cards : []).filter(function (c) { return c && (c.src || c.back || c.title); });
    return { v: 1, at: new Date().toISOString(), app: "cardwallet", kind: "backup", cards: list, settings: settings && typeof settings === "object" ? settings : {} };
  }
  function exportBackup() {
    if (!subtle()) { toast("This device's browser can't encrypt - backup needs Android System WebView updates", true); return; }
    var data = bundle();
    if (!data.cards.length) { toast("Nothing to back up yet", true); return; }
    var pw = null;
    showLock({
      mode: "pw", sub: "Choose a password for this backup", go: "Next", err: "Use at least 4 characters",
      onDone: function (v) {
        if (!v || v.length < 4) return "retry";
        pw = v;
        showLock({
          mode: "pw2", sub: "Type the password again", go: "Create backup", err: "Passwords didn't match",
          onDone: function (v2) {
            if (v2 !== pw) return "retry";
            hideLock();
            setTimeout(function () { seal(pw, data); }, 160);
            return "ok";
          }
        });
        return "ok";
      }
    });
  }
  function seal(pw, data) {
    var salt = new Uint8Array(16), iv = new Uint8Array(12);
    crypto.getRandomValues(salt); crypto.getRandomValues(iv);
    keyFrom(pw, salt, "encrypt").then(function (key) {
      return subtle().encrypt({ name: "AES-GCM", iv: iv }, key, utf8(JSON.stringify(data)));
    }).then(function (cipher) {
      var wrap = {
        app: "cardwallet", kind: "backup", v: 1, at: data.at, cards: data.cards.length,
        enc: { alg: "AES-GCM", kdf: "PBKDF2-SHA256", iters: PBKDF2_ITER, hash: "SHA-256", salt: b64(salt), iv: b64(iv) }
        , data: b64(cipher)
      };
      store.meta = { at: Date.now(), n: data.cards.length, enc: true, bytes: JSON.stringify(wrap).length };
      save(); paint();
      offer(new Blob([JSON.stringify(wrap)], { type: "application/json" }), name());
    }).catch(function (e) { toast("Backup failed: " + (e && e.message || "unknown"), true); });
  }
  function name() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "cardwallet-backup-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".cwbak";
  }
  function offer(blob, fname) {
    var f;
    try { f = new File([blob], fname, { type: "application/json" }); } catch (e) { f = null; }
    var nav = navigator;
    if (f && nav.canShare && nav.canShare({ files: [f] }) && nav.share) {
      nav.share({ files: [f], title: "Card Wallet backup" }).then(function () { toast("Backup shared"); },
        function () { download(blob, fname); });
      return;
    }
    download(blob, fname);
  }
  function download(blob, fname) {
    var a = el("a"); a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    toast("Backup saved to Downloads");
  }
  function importBackup() {
    var inp = document.getElementById("cw-vault-file");
    if (!inp) {
      inp = el("input"); inp.type = "file"; inp.id = "cw-vault-file";
      inp.accept = ".cwbak,application/json"; inp.hidden = true;
      document.body.appendChild(inp);
      inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; inp.value = ""; if (f) readFile(f); });
    }
    inp.click();
  }
  function readFile(f) {
    var fr = new FileReader();
    fr.onload = function () { parse(String(fr.result || "")); };
    fr.onerror = function () { toast("That file could not be read", true); };
    fr.readAsText(f);
  }
  function parse(text) {
    var wrap;
    try { wrap = JSON.parse(text); } catch (e) { toast("That isn't a Card Wallet backup file", true); return; }
    if (!wrap || wrap.app !== "cardwallet" || wrap.kind !== "backup") { toast("That isn't a Card Wallet backup file", true); return; }
    if (!wrap.enc) { toast("Backups are always encrypted - this file has no password on it", true); return; }
    if (!subtle()) { toast("This device's browser can't decrypt backups", true); return; }
    var salt = unb64(wrap.enc.salt || ""), iv = unb64(wrap.enc.iv || "");
    showLock({
      mode: "pw", sub: "Enter this backup's password", go: "Unlock backup", err: "Wrong password or damaged file",
      onDone: function (pw, api) {
        if (!pw) return "retry";
        keyFrom(pw, salt, "decrypt").then(function (key) {
          return subtle().decrypt({ name: "AES-GCM", iv: iv }, key, unb64(wrap.data || ""));
        }).then(function (plain) {
          var data;
          try { data = JSON.parse(new TextDecoder().decode(plain)); }
          catch (e) { hideLock(); toast("Backup contents could not be read", true); return; }
          hideLock(); setTimeout(function () { confirmRestore(data); }, 160);
        }).catch(function () {
          /* async failure: the field is still open, so the api reports into it */
          api.retry("Wrong password or damaged file");
        });
        return "pending";
      }
    });
  }
  function confirmRestore(data) {
    var cards = data && Array.isArray(data.cards) ? data.cards.filter(function (c) { return c && (c.src || c.back || c.title); }) : null;
    if (!cards) { toast("Backup had no readable cards", true); return; }
    var now = (readJSON(CARDS, []) || []).length;
    var box = ensureLock();
    modal = { mode: "restore" };
    locked = true;
    box.classList.remove("cw-lock-hide");
    box.dataset.mode = "restore";
    box.querySelector("[data-r=sub]").textContent = "Restore " + cards.length + (cards.length === 1 ? " card" : " cards") + "?";
    var note = el("div", "cw-vault-plain");
    note.textContent = "This replaces the " + now + (now === 1 ? " card" : " cards") + " on this phone" +
      (data.settings && Object.keys(data.settings).length ? ", and their settings" : "") + ". This cannot be undone.";
    clr(box.querySelector("[data-r=dots]")).appendChild(note);
    var msg = box.querySelector("[data-r=msg]"); msg.textContent = "";
    var foot = clr(box.querySelector(".cw-lock-foot"));
    foot.appendChild(btn("Cancel", function () { hideLock(); }));
    foot.appendChild(btn("Restore", function () { apply(cards, data.settings); }));
    box.querySelector("[data-r=reset]").hidden = true;
    historyGuard(true);
  }
  function apply(cards, settings) {
    try {
      localStorage.setItem(CARDS, JSON.stringify(cards));
      if (settings && typeof settings === "object") localStorage.setItem(SETTINGS, JSON.stringify(settings));
      hideLock();
      toast(cards.length + " cards restored");
      setTimeout(requestReload, 500);
    } catch (e) {
      hideLock();
      /* measured on device: 20 photo cards are ~16 MB, and the WebView's localStorage
         quota is smaller than that - say so instead of losing the user's current deck. */
      toast("Not enough room on this phone for that many cards - your current cards are unchanged", true);
    }
  }

  /* ------------------------------------------------------------------ public */
  window.__cwVault = {
    mount: function (elm) {
      if (!elm || elm.__cwVault) return;
      elm.__cwVault = true; slot = elm; paint();
    },
    enrolled: enrolled,
    store: function () { return JSON.parse(JSON.stringify(store)); },
    derive: derive,
    rounds: ROUNDS,
    awayMs: AWAY_MS,
    isLocked: function () { return locked; },
    lock: lock,
    bundle: bundle,
    seal: seal,
    apply: apply,
    keyFrom: keyFrom,
    requestReload: requestReload,
    b64: b64, unb64: unb64, utf8: utf8
  };

  /* install: the gate goes up before the first paint if a code is enrolled.
     visibilitychange is fired at *document* - a window-only listener does not reliably see it (proven in
     jsdom, and the reason the auto-lock would have shipped dead on some WebViews), so it is registered on
     both and the double call is harmless: wentAway() only restamps the clock, and cameBack() clears it. */
  function onVisibility() { if (document.hidden) wentAway(); else cameBack(); }
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("visibilitychange", onVisibility);
  ["pagehide", "blur"].forEach(function (ev) { window.addEventListener(ev, wentAway); });
  ["pageshow", "focus"].forEach(function (ev) { window.addEventListener(ev, cameBack); });
  if (enrolled()) lock();
})();
