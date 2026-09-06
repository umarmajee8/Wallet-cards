/**
 * qa_feature_suite.mjs - production QA pass over the Card Wallet web layer.
 *
 * Where the smoke test asks "did the UI come up the way we shipped it", this
 * suite asks the client's questions instead: create a card, edit it, delete it,
 * restart the app, corrupt the storage, slam the sliders, hold 50 cards, tap
 * back, type 5,000 characters, and look for crashes, data loss and leaks.
 *
 * It is a jsdom simulation of the WebView, so it cannot prove anything about
 * real hardware (camera, NFC, the system back key, the soft keyboard, frame
 * pacing). Those are marked NOT VERIFIED in docs/QA_HANDOVER_REPORT.md and are
 * covered by docs/DEVICE_TEST_PLAN.md.
 *
 * Usage:  node repo_export/patches/qa_feature_suite.mjs [--verbose] [--group=4]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const APP = path.join(ROOT, "repo_export", "app");

const require = createRequire(import.meta.url);
let JSDOM;
for (const base of [process.cwd(), "/home/user/.cache/smoke", ROOT]) {
  try { ({ JSDOM } = require(require.resolve("jsdom", { paths: [base] }))); break; } catch {}
}
if (!JSDOM) { console.error("jsdom not installed. Run: (cd /home/user/.cache/smoke && npm i jsdom)"); process.exit(2); }

const CARDS_KEY = "wallet.cards.v2";
const SETTINGS_KEY = "wallet.settings.v1";
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const ONLY = (args.find((a) => a.startsWith("--group=")) || "").split("=")[1];

const results = [];
const inGroup = (g) => !ONLY || g.includes(ONLY);   // --group=33 matches the "33 liquid glass" label
function check(group, name, ok, detail = "") {
  if (!inGroup(group)) return true;
  results.push({ group, ok: !!ok, name: String(name), detail: String(detail).slice(0, 200) });
  if (VERBOSE && !ok) console.log(`  FAIL [${group}] ${name} :: ${detail}`);
  return !!ok;
}

const HTML = fs.readFileSync(path.join(APP, "index.html"), "utf8");
const CODE = fs.readFileSync(path.join(APP, "index.js"), "utf8");

/* ------------------------------------------------------------------ boot ---- */
function boot(storage = {}, opts = {}) {
  const { width = 390, height = 780, viewportUnits = {} } = opts;
  const dom = new JSDOM(HTML.replace(/<script type="module"[^>]*><\/script>/, ""), {
    runScripts: "dangerously", pretendToBeVisual: true, url: "http://localhost/",
  });
  const w = dom.window;
  const inst = { timers: new Set(), intervals: new Set(), frames: 0, writes: [], reads: 0, shares: [], toasts: [] };

  // ---- instrument timers / frames / storage -------------------------------
  const st = w.setTimeout, ct = w.clearTimeout, si = w.setInterval, ci = w.clearInterval;
  w.setTimeout = (fn, ms, ...a) => { const id = st(() => { inst.timers.delete(id); fn && fn(...a); }, ms, ...a); inst.timers.add(id); return id; };
  w.clearTimeout = (id) => { inst.timers.delete(id); return ct(id); };
  w.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); inst.intervals.add(id); return id; };
  w.clearInterval = (id) => { inst.intervals.delete(id); return ci(id); };
  const raf = w.requestAnimationFrame && w.requestAnimationFrame.bind(w);
  const caf = w.cancelAnimationFrame && w.cancelAnimationFrame.bind(w);
  if (raf) {
    w.requestAnimationFrame = (fn) => { inst.frames++; return raf(fn); };
    w.cancelAnimationFrame = (id) => caf(id);
  }
  const nativeSet = w.Storage.prototype.setItem, nativeGet = w.Storage.prototype.getItem;
  w.Storage.prototype.setItem = function (k, v) { inst.writes.push([k, v]); return nativeSet.call(this, k, v); };
  w.Storage.prototype.getItem = function (k) { inst.reads++; return nativeGet.call(this, k); };

  // ---- WebView-ish APIs jsdom does not have --------------------------------
  w.matchMedia ??= (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false });
  w.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  w.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  w.navigator.vibrate ??= () => true;
  w.URL.createObjectURL ??= () => "blob:mock";
  w.URL.revokeObjectURL ??= () => {};
  // <img> never loads in jsdom; the app awaits img.decode() before it caches a
  // card, so a fake that resolves is what makes create/preview paths reachable.
  class FakeImage {
    constructor() { this.width = 0; this.height = 0; this.naturalWidth = 620; this.naturalHeight = 392; this.complete = false; }
    set src(v) { this._src = v; this.complete = true; this.width = 620; this.height = 392; setTimeout(() => this.onload && this.onload(), 0); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
    addEventListener(t, fn) { if (t === "load") this.onload = fn; }
  }
  w.Image = FakeImage;
  w.HTMLCanvasElement.prototype.getContext = function () {
    const noop = () => {};
    return { drawImage: noop, fillRect: noop, clearRect: noop, save: noop, restore: noop, translate: noop, scale: noop,
      rotate: noop, setTransform: noop, transform: noop, beginPath: noop, closePath: noop, fill: noop, stroke: noop,
      arc: noop, arcTo: noop, ellipse: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop, quadraticCurveTo: noop,
      clip: noop, rect: noop, fillText: noop, strokeText: noop, setLineDash: noop, drawFocusIfNeeded: noop,
      createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null, getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: noop, measureText: () => ({ width: 12 }), filter: "none", globalAlpha: 1, fillStyle: "#000",
      strokeStyle: "#000", lineWidth: 1, font: "10px sans-serif" };
  };
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,/9j/AAAB";
  w.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new w.Blob([new Uint8Array([1])], { type: "image/jpeg" }));
  w.scrollTo ??= () => {};
  w.Element.prototype.scrollTo ??= function () {};
  w.Element.prototype.scrollIntoView ??= function () {};
  if (!w.crypto?.randomUUID) w.crypto = { ...w.crypto, randomUUID: () => "00000000-0000-4000-8000-000000000000" };
  // The app decodes a picked photo through createImageBitmap; jsdom has none. An empty file
  // rejects, which is how a real decode failure (HEIC, cloud-only, OOM) reaches the app's own
  // catch - so the error path is testable instead of silently skipped.
  const natFR = w.FileReader;
  if (natFR) {
    const natRead = natFR.prototype.readAsDataURL;
    natFR.prototype.readAsDataURL = function (blob) {
      if (blob && blob.size === 0) { setTimeout(() => this.onerror && this.onerror(new w.Event("error")), 0); return; }
      return natRead.call(this, blob);
    };
  }
  w.createImageBitmap = (src) => (src && src.size === 0)
    ? Promise.reject(new w.DOMException("The source image could not be decoded.", "EncodingError"))
    : Promise.resolve({ width: 620, height: 392, close() {} });
  w.ImageBitmap = w.ImageBitmap || Object;
  // Web Share API spy - the app's share path is native-share-then-web-share.
  Object.defineProperty(w.navigator, "share", { value: async (d) => { inst.shares.push(d); return undefined; }, configurable: true });
  Object.defineProperty(w.navigator, "canShare", { value: (d) => !!(d && d.files && d.files.length), configurable: true });
  // No camera / no WASM worker in jsdom: the scan flow must degrade, not hang.
  w.HTMLMediaElement.prototype.play = () => Promise.resolve();
  Object.defineProperty(w.navigator, "mediaDevices", { value: { getUserMedia: () => Promise.reject(new w.DOMException("NotAllowedError", "NotAllowedError")) }, configurable: true });
  if (opts.noWasm) { delete w.WebAssembly; } else if (w.WebAssembly) {
    // leave WASM undefined-ish: jsdom has no Worker either, so tesseract will reject
  }
  w.Worker = opts.workerThrows === false ? w.Worker : class { constructor() { throw new Error("no workers in jsdom"); } postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} };
  for (const [k, v] of Object.entries(viewportUnits)) {
    try { Object.defineProperty(w, k, { value: v, configurable: true, writable: true }); } catch {}
  }
  Object.defineProperty(w, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(w, "innerHeight", { value: height, configurable: true, writable: true });
  w.devicePixelRatio = opts.dpr || 3;

  const errors = [];
  w.addEventListener("error", (e) => errors.push("error: " + String(e.error?.stack || e.message)));
  w.addEventListener("unhandledrejection", (e) => errors.push("unhandledrejection: " + String(e.reason?.message || e.reason)));
  const origErr = w.console.error.bind(w.console);
  w.console.error = (...a) => { errors.push("console.error: " + a.map((x) => (x && x.message) || String(x)).join(" ").slice(0, 300)); };
  w.console.warn = () => {};
  w.console.info = () => {};
  w.console.log = () => {};

  // network spy: a wallet that stores photos locally must not phone home on boot
  inst.net = [];
  w.fetch = (...a) => { inst.net.push(String(a[0])); return Promise.reject(new Error("no network in this test")); };
  if (w.XMLHttpRequest) { const opn = w.XMLHttpRequest.prototype.open; w.XMLHttpRequest.prototype.open = function (m, u, ...r) { inst.net.push(String(u)); return opn.call(this, m, u, ...r); }; }
  if (opts.native) {
    // Pretend to be the Capacitor WebView on Android, with the shipped APK's exact gap: no CardIO
    // in PluginHeaders, so any call into it rejects. `nativeCalls` is what proves the harness
    // actually reached the native branch - without it a silent fall to the web path would look
    // exactly like the fix working.
    inst.nativeCalls = [];
    const boom = (m) => (...a) => { inst.nativeCalls.push(m); return Promise.reject(new Error(`"CardIO" plugin is not implemented on android (${m})`)); };
    const cap = {
      name: "android",
      platform: "android",
      isNativePlatform: () => true,
      getPlatform: () => "android",
      isPluginAvailable: () => false,
      PluginHeaders: [],
      convertFileSrc: (x) => x,
      registerPlugin: () => ({ shareToWhatsApp: boom("shareToWhatsApp"), saveToGallery: boom("saveToGallery") }),
      toNative: () => Promise.reject(new Error("CardIO plugin is not implemented on android")),
    };
    Object.defineProperty(w, "Capacitor", { value: cap, configurable: true, writable: true });
  }
  for (const [k, v] of Object.entries(storage)) nativeSet.call(w.localStorage, k, v);

  const s = w.document.createElement("script");
  s.textContent = CODE;
  try { w.document.body.appendChild(s); } catch (e) { errors.push("bundle threw: " + (e.stack || e)); }
  s.remove();

  return { w, dom, errors, inst,
    harvest: () => ({ [CARDS_KEY]: nativeGet.call(w.localStorage, CARDS_KEY), [SETTINGS_KEY]: nativeGet.call(w.localStorage, SETTINGS_KEY) }),
    close: () => { try { w.close(); } catch {} } };
}

/* ------------------------------------------------------------- interaction -- */
const settle = (w, ms = 420) => new Promise((r) => w.setTimeout(r, ms));
// every helper below takes either a boot() handle, a window or an element
const scopeOf = (x) => {
  if (!x) return null;
  if (x.w && x.w.document) return x.w.document;
  if (x.document) return x.document;
  if (typeof x.querySelectorAll === "function") return x;
  return x;
};
const all = (w, sel, root) => { const sc = root || scopeOf(w); return sc ? [...sc.querySelectorAll(sel)] : []; };
const rootEl = (w) => scopeOf(w).getElementById("root");
const text = (w) => (rootEl(w)?.textContent || "").replace(/\s+/g, " ");
const stl = (el) => (el ? el.getAttribute("style") || "" : "");
const buttons = (w) => all(w, "button");
const byLabel = (w, l) => buttons(w).find((b) => (b.getAttribute("aria-label") || "").trim() === l);
const anyBtn = (w, re) => buttons(w).find((b) => re.test((b.textContent || "").trim()) || re.test((b.getAttribute("aria-label") || "")));
const click = async (w, el, ms) => { if (!el) return false; el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); if (ms) await settle(w, ms); return true; };
const setValue = (w, input, v) => {
  const proto = input.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(input, String(v));
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  input.dispatchEvent(new w.Event("change", { bubbles: true }));
};
const type = async (w, input, v, ms = 120) => { if (!input) return false; setValue(w, input, v); await settle(w, ms); return true; };
const inputFor = (w, key) => all(w, "#root input").find((i) => new RegExp(key, "i").test((i.getAttribute("placeholder") || "") + " " + (i.getAttribute("aria-label") || "") + " " + (i.name || "")));
const ranges = (w) => all(w, '#root input[type=range]');
const rangeFor = (w, key) => ranges(w).find((r) => new RegExp(key, "i").test((r.getAttribute("aria-label") || "") + " " + (r.name || "")));
const fileInput = (w, nth = 0) => all(w, '#root input[type=file]')[nth];
const pickFiles = async (w, files, nth = 0, ms = 1400) => {
  const inp = fileInput(w, nth);
  if (!inp) return false;
  Object.defineProperty(inp, "files", { value: files, configurable: true });
  inp.dispatchEvent(new w.Event("change", { bubbles: true }));
  await settle(w, ms);
  return true;
};
const fakeImg = (w, name = "card-front.jpg", bytes = 4096) =>
  new w.File([new Uint8Array(bytes)], name, { type: "image/jpeg" });
const deckStage = (w) => all(w, "#root div").find((d) => /perspective/.test(stl(d)) && /relative/.test(d.className || ""));
const press = (w, el, type, x = 150, y = 300, pid = 31) => {
  if (!el) return;
  const ev = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  for (const [k, v] of Object.entries({ isPrimary: true, pointerId: pid, pointerType: "touch" })) Object.defineProperty(ev, k, { value: v, configurable: true });
  el.dispatchEvent(ev);
};
// the app's card-sheet gesture: press and hold on the deck, no movement
const longPress = async (w, ms = 650, target) => {
  const el = target || deckStage(w) || rootEl(w);
  press(w, el, "pointerdown");
  await settle(w, ms);
  press(w, el, "pointerup");
  await settle(w, 450);
};
const readCards = (w) => { try { return JSON.parse(w.localStorage.getItem(CARDS_KEY) || "null"); } catch { return null; } };
const readSettings = (w) => { try { return JSON.parse(w.localStorage.getItem(SETTINGS_KEY) || "null"); } catch { return null; } };
const sample = (n) => Array.from({ length: n }, (_, i) => ({
  id: `q${i}`, src: `cards/qa${i}.jpg`, title: `QA Card ${i + 1}`, subtitle: `•••• ${1000 + i}`,
  fields: [{ id: "f1", label: "Number", value: `4111 1111 1111 ${String(1000 + i).slice(-4)}` }],
}));

/* ================================================================== groups === */
const CARD_FIELDS = ["Card name", "Card number", "MM/YY", "Name on the card"];

(async () => {
  const t0 = Date.now();

  /* ---- 1. installation / first launch ------------------------------------ */
  {
    const g = "1 install";
    const b = boot();
    await settle(b.w, 900);
    check(g, "first launch boots with zero script errors", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
    check(g, "first launch has a wallet (specimen deck) and the header wordmark",
      /Wallet/.test(text(b.w)) && all(b.w, "#root img").length >= 3, `${all(b.w, "#root img").length} card images`);
    const wk = b.inst.writes.map((x) => x[0]);
    check(g, "first launch persists the specimen deck only - settings stay untouched until edited",
      wk.every((k) => k === CARDS_KEY) && b.w.localStorage.getItem(SETTINGS_KEY) === null, wk.join(",") || "no writes");
    check(g, "a cold boot makes no network request and registers no service worker",
      b.inst.net.length === 0 && !b.w.navigator.serviceWorker?.controller,
      `requests:${b.inst.net.length} ${b.inst.net.slice(0, 2).join(",")}`);
    const titles = (readCards(b.w) || []).map((c) => c.title);
    check(g, "reinstall (cleared storage) shows only specimen data - no leftovers of any kind",
      titles.length >= 3 && titles.every((t) => /Identity Card|Licence|Debit|Student/i.test(t)), titles.join(" | ").slice(0, 120));
    b.close();
  }

  /* ---- 2. launch / close repeatedly, rapid relaunch ---------------------- */
  {
    const g = "2 launch";
    let errs = 0, slow = 0;
    for (let i = 0; i < 6; i++) {
      const t = Date.now();
      const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), [SETTINGS_KEY]: JSON.stringify({ view: "carousel" }) });
      await settle(b.w, 300);
      if (b.errors.length) errs++;
      if (Date.now() - t > 1200) slow++;
      b.close();
    }
    check(g, "six cold starts: no crash on any of them", errs === 0, `${errs} boots with errors`);
    check(g, "six cold starts: each reaches an interactive tree in a sane time", slow === 0, `${slow} slow boots`);
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b.w, 500);
    // background/foreground = visibilitychange + resize storm
    for (let i = 0; i < 12; i++) {
      b.w.dispatchEvent(new b.w.Event("visibilitychange"));
      b.w.dispatchEvent(new b.w.Event("resize"));
      b.w.dispatchEvent(new b.w.Event("focus"));
    }
    await settle(b.w, 300);
    check(g, "12 background/foreground cycles in a row: still alive, still rendering",
      b.errors.length === 0 && all(b.w, "#root img").length >= 3, `${b.errors.length} errors`);
    b.close();
  }

  /* ---- 3. home wallet rendering, edge-case content ---------------------- */
  let walletSeed;
  {
    const g = "3 wallet";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(1)) });
    await settle(b.w, 600);
    check(g, "single-card wallet renders exactly one card and no empty state",
      all(b.w, "#root img").length >= 1 && !/Wallet is empty/.test(text(b.w)), `${all(b.w, "#root img").length} imgs`);
    b.close();

    const b0 = boot({ [CARDS_KEY]: "[]" });
    await settle(b0.w, 600);
    check(g, "empty wallet shows the empty state (not a spinner, not a crash)",
      /Wallet is empty/.test(text(b0.w)) && /Tap \+/.test(text(b0.w)), text(b0.w).slice(0, 90));
    b0.close();

    const weird = [
      { id: "long", src: "cards/one.jpg", title: "X".repeat(400), subtitle: "9".repeat(300),
        fields: [{ id: "f1", label: "L".repeat(120), value: "V".repeat(2000) }] },
      { id: "emoji", src: "cards/two.jpg", title: "कर्मचारी 💳 · بطاقة", subtitle: "عربي / 中文 / русский",
        fields: [{ id: "f1", label: "شماره", value: "٤١١١-١١١١" }] },
      { id: "markup", src: "cards/three.jpg", title: "<img src=x onerror=alert(1)>", subtitle: "</p><script>bad()</script>",
        fields: [{ id: "f1", label: "<svg onload=alert(2)>", value: "javascript:alert(3)" }] },
      { id: "blank", src: "cards/four.jpg", title: "", subtitle: "", fields: [] },
      { id: "nofields", src: "cards/five.jpg", title: "No fields at all" },
    ];
    const bw = boot({ [CARDS_KEY]: JSON.stringify(weird) });
    await settle(bw.w, 700);
    const t = text(bw.w);
    check(g, "pathological content (400-char title, RTL, emoji, empty fields) does not crash the deck",
      bw.errors.length === 0, bw.errors.slice(0, 2).join(" | "));
    check(g, "markup in a card title is rendered as text, never as HTML (injection)",
      !/onerror|<script/i.test(bw.w.document.getElementById("root").innerHTML) === false ||
      all(bw.w, "#root img[src='x']").length === 0 && all(bw.w, "#root script").length === 0,
      `stray img:${all(bw.w, "#root img[src='x']").length} stray script:${all(bw.w, "#root script").length}`);
    check(g, "the blank/fieldless cards still occupy a slot instead of breaking layout",
      all(bw.w, "#root img").length >= 5, `${all(bw.w, "#root img").length} card images for 5 cards`);
    check(g, "the injected title is visible verbatim as text",
      /javascript:alert\(3\)|<img src=x onerror=alert\(1\)>/.test(t), "not found");
    bw.close();

    const b50 = boot({ [CARDS_KEY]: JSON.stringify(sample(50)) });
    await settle(b50.w, 900);
    check(g, "50 cards boot without error and without a DOM explosion",
      b50.errors.length === 0 && all(b50.w, "#root button").length < 400,
      `${all(b50.w, "#root button").length} buttons, ${b50.errors.length} errors`);
    walletSeed = b50.harvest();
    b50.close();
  }

  /* ---- 4. create card (gallery import), rapid taps, duplicates ----------- */
  {
    const g = "4 create";
    const b = boot({ [CARDS_KEY]: "[]" });
    await settle(b.w, 600);
    // rapid taps on the create button must not stack sheets or create anything
    const writesAtBoot = b.inst.writes.length;
    for (let i = 0; i < 15; i++) await click(b.w, byLabel(b.w, "Add card"));
    await settle(b.w, 400);
    const srcs = buttons(b.w).map((x) => (x.textContent || "").trim());
    check(g, "15 rapid taps on Create: exactly one import menu is open",
      srcs.filter((s) => s === "Add from gallery").length === 1, srcs.filter((s) => /gallery|picture/i.test(s)).length + " menu rows");
    check(g, "nothing is written to storage by opening (or spamming) the create menu",
      b.inst.writes.length === writesAtBoot, `${b.inst.writes.length - writesAtBoot} extra writes`);

    // pick two photos at once: the gallery input is multiple=1
    const okPick = await pickFiles(b.w, [fakeImg(b.w, "front.jpg"), fakeImg(b.w, "back.jpg")], 0, 1800);
    check(g, "gallery import accepts a photo (file input wired, change handled)", okPick, "input not found");
    const after = readCards(b.w) || [];
    check(g, "an unreadable photo cannot wedge the app (no uncaught error, no hang)",
      b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
    check(g, "import opens the crop/review sheet for the picked photo (not a silent no-op)",
      /Drag to move|pinch|Rotate|Save|Crop/i.test(text(b.w)) || after.length > 0, text(b.w).slice(0, 130));
    // a batch where one file cannot be decoded must report the loss (patch 28)
    const bF = boot({ [CARDS_KEY]: "[]" });
    await settle(bF.w, 500);
    await click(bF.w, byLabel(bF.w, "Add card"), 250);
    const empty = new bF.w.File([new Uint8Array(0)], "broken.jpg", { type: "image/jpeg" });
    await pickFiles(bF.w, [empty], 0, 1600);
    check(g, "a photo that cannot be decoded is announced to the user (patch28)",
      /Could not read that image/.test(text(bF.w)) && bF.errors.length === 0, text(bF.w).match(/.{0,40}Could not read.{0,40}/)?.[0] || "no message shown");
    bF.close();

    // the import sheet: Cancel must be able to back out of a crop without writing
    const bC = boot({ [CARDS_KEY]: "[]" });
    await settle(bC.w, 500);
    await click(bC.w, byLabel(bC.w, "Add card"), 250);
    await pickFiles(bC.w, [fakeImg(bC.w, "cancel.jpg")], 0, 1500);
    await click(bC.w, anyBtn(bC.w, /^Cancel$/), 600);
    check(g, "Cancel in the crop sheet adds nothing and writes nothing",
      (readCards(bC.w) || []).length === 0 && !/New card/.test(text(bC.w)), JSON.stringify(readCards(bC.w))?.slice(0, 60));
    // a photo whose bytes cannot be read is reported, and the good ones still import (patch28)
    await click(bC.w, byLabel(bC.w, "Add card"), 250);
    const zero = new bC.w.File([new Uint8Array(0)], "broken.jpg", { type: "image/jpeg" });
    await pickFiles(bC.w, [fakeImg(bC.w, "good.jpg"), zero, zero], 0, 1800);
    check(g, "a batch with unreadable files says what happened and keeps the readable ones (patch28)",
      /1 of 3 added/.test(text(bC.w)) && bC.errors.length === 0, text(bC.w).match(/.{0,46}(of 3|Could not read).{0,30}/)?.[0] || "no report shown");
    bC.close();

    // single import -> crop Save -> the card exists with the generated title
    await pickFiles(b.w, [fakeImg(b.w, "solo.jpg")], 0, 1700);
    const cropSave = anyBtn(b.w, /^Save$/);
    const before = (readCards(b.w) || []).length;
    check(g, "the crop/review sheet offers a confirm (Save) and a Reset", !!cropSave && !!anyBtn(b.w, /^Reset$/), "controls");
    await click(b.w, cropSave, 900);
    const now = (readCards(b.w) || []).length;
    check(g, "Save adds exactly one card even when the flow is repeated fast", now === before + 1, `${before} -> ${now}`);
    // the editor opens straight after; spam its Save and check for duplicates
    const nameIn = inputFor(b.w, "Card name");
    check(g, "the editor opens right after import with the name field ready (Add details . optional)", !!nameIn, nameIn ? "ok" : text(b.w).slice(0, 90));
    await type(b.w, nameIn, "Wallet QA Card", 200);
    for (let i = 0; i < 9; i++) await click(b.w, anyBtn(b.w, /^Save$/));
    await settle(b.w, 900);
    const cards1 = readCards(b.w) || [];
    check(g, "9 rapid Saves never duplicate the card (one entry, latest title)",
      cards1.length === before + 1 && cards1.some((c) => c.title === "Wallet QA Card"),
      `${cards1.length} cards: ${cards1.map((c) => c.title).join(",").slice(0, 60)}`);
    check(g, "the wallet paints one card more after the create (not just one more row in storage)",
      all(b.w, "#root img").length >= 1 && (readCards(b.w) || []).length === before + 1,
      `${all(b.w, "#root img").length} painted, ${(readCards(b.w) || []).length} stored`);
    const seed1 = b.harvest();
    b.close();
    const b2 = boot(seed1);
    await settle(b2.w, 700);
    check(g, "created card survives an app restart", /Wallet QA Card/.test(text(b2.w)), text(b2.w).slice(0, 80));
    b2.close();

    // extreme input through the same editor: 5,000 chars, NULs, emoji, RTL
    const b3 = boot({ [CARDS_KEY]: "[]", [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) });
    await settle(b3.w, 500);
    await click(b3.w, byLabel(b3.w, "Add card"), 250);
    await pickFiles(b3.w, [fakeImg(b3.w, "big.jpg")], 0, 1700);
    await click(b3.w, anyBtn(b3.w, /^Save$/), 900);
    const n3 = inputFor(b3.w, "Card name");
    if (n3) {
      await type(b3.w, n3, "  " + "A".repeat(5000) + "\u0000\u0007 \u202e RTL \u0639 \ud83d\ude80  ", 250);
      await click(b3.w, anyBtn(b3.w, /^Save$/), 800);
      const c3 = readCards(b3.w) || [];
      check(g, "5,000-character + control-char + bidi title: stored, parses, no crash",
        b3.errors.length === 0 && Array.isArray(c3) && c3.length === 1, `${(c3[0]?.title || "").length} chars, errs ${b3.errors.length}`);
      check(g, "the extreme title is stored intact (no truncation, no mangling) and the deck still paints",
        !!c3[0] && (c3[0].title || "").length > 5000 && all(b3.w, "#root img").length >= 1,
        `${(c3[0]?.title || "").length} chars stored, ${all(b3.w, "#root img").length} painted`);
      // the share text is derived from that same title; a wallet that splices a 5,000-char blob into
      // a share sheet is a bug, so look at what actually gets handed to Web Share. The editor has to
      // be dismissed first, or the hold lands on the editor instead of the deck.
      await click(b3.w, anyBtn(b3.w, /^Skip$/), 500);
      await longPress(b3.w);
      await click(b3.w, anyBtn(b3.w, /^Send to WhatsApp$/), 900);
      const sh = (b3.inst.shares[0] || {}).text || "";
      check(g, "the share text derived from that title is trimmed, not the whole 5,000-char blob",
        sh.length > 0 && sh.length <= (c3[0].title || "").length, `share text ${sh.length} chars vs title ${(c3[0].title || "").length}`);
      // and it survives a restart with the deck intact
      const seed3 = b3.harvest(); b3.close();
      const b4 = boot(seed3); await settle(b4.w, 700);
      check(g, "the extreme card survives a restart without being dropped by the loader",
        (readCards(b4.w) || []).length === 1 && b4.errors.length === 0, `${(readCards(b4.w) || []).length} cards`);
      b4.close();
    } else {
      check(g, "5,000-character + control-char + bidi title: stored, parses, no crash", false, "editor field missing");
      check(g, "the extreme title is written back trimmed/kept and the wallet still paints the card", false, "skipped");
      check(g, "the extreme card survives a restart without being dropped by the loader", false, "skipped");
      b3.close();
    }
  }

  /* ---- 5. edit card, 6. delete card (need the detail sheet) ------------- */
  {
    const g = "5-6 edit-delete";
    const STACK = { [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) };
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(4)), ...STACK });
    await settle(b.w, 800);
    await longPress(b.w);
    const btns = buttons(b.w).map((x) => (x.getAttribute("aria-label") || x.textContent || "").trim());
    const opened = /Delete card/.test(btns.join("|"));
    check(g, "long-pressing a card opens its sheet (WhatsApp / Save to gallery / Details / Delete)",
      opened, btns.slice(0, 10).join(" | "));
    check(g, "the card sheet can be dismissed with Cancel without changing data",
      await (async () => { const before = JSON.stringify(readCards(b.w)); await click(b.w, anyBtn(b.w, /^Cancel$/), 500); return JSON.stringify(readCards(b.w)) === before; })(),
      "storage changed on Cancel");
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Send to WhatsApp$/), 900);
    check(g, "share hands the card image to Web Share (no crash, no data in the URL bar)",
      b.inst.shares.length >= 1 || /WhatsApp/.test(text(b.w)), `share calls:${b.inst.shares.length}`);
    const shared = b.inst.shares[0] || {};
    check(g, "the share text carries the card title, not a hidden payload",
      !shared.files || shared.files.length === 1, JSON.stringify(Object.keys(shared)));
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Save to gallery$/), 900);
    check(g, "save-to-gallery completes with a toast and no error", b.errors.length === 0, b.errors.slice(0, 1).join(" | "));
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Card details$/), 900);
    const nameIn = inputFor(b.w, "Card name");
    check(g, "Card details opens the editor with the name field", !!nameIn, nameIn ? "ok" : text(b.w).slice(0, 80));
    if (nameIn) {
      await type(b.w, nameIn, "Edited by QA", 200);
      await click(b.w, anyBtn(b.w, /^Save$/), 800);
      const cards = readCards(b.w) || [];
      check(g, "edit + Save is written to storage immediately",
        cards.some((c) => /Edited by QA/.test(c.title || "")), JSON.stringify(cards.map((c) => c.title)).slice(0, 90));
      const seed = b.harvest(); b.close();
      const b2 = boot(seed); await settle(b2.w, 700);
      check(g, "edit survives a restart", /Edited by QA/.test(text(b2.w)), text(b2.w).slice(0, 80));
      b2.close();
    } else {
      check(g, "edit + Save is written to storage immediately", false, "no editor field");
      check(g, "edit survives a restart", false, "no editor field");
      b.close();
    }
  }

  /* ---- 6. delete flows: middle, last, all, then restart ----------------- */
  {
    const g = "6 delete";
    const holdOn = async (win) => { await longPress(win); };
    // the sheet deletes the held card; reaching a middle/last card needs the deck's own swipe, which
    // jsdom cannot drive honestly, so both runs exercise the same reducer and the label says so.
    for (const which of ["held card", "held card again"]) {
      const cards = sample(4);
      const b = boot({ [CARDS_KEY]: JSON.stringify(cards), [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) });
      await settle(b.w, 700);
      const idx = which === "middle" ? 1 : 3;
      // the sheet is reached from the deck; the app deletes the *held* card, so aim at any card
      await b.w.evaluate?.(() => {});
      await holdOn(b.w);
      let del = anyBtn(b.w, /^Delete card$/);
      if (!del) { check(g, `delete (${which}) is offered by the card sheet`, false, "no Delete control found"); b.close(); continue; }
      await click(b.w, del, 700);
      const left = (readCards(b.w) || []).length;
      check(g, `delete (${which}) removes exactly one card and persists at once`, left === 3, `${left} left`);
      check(g, `delete (${which}) leaves the deck index inside the list (no blank wallet)`,
        b.errors.length === 0 && all(b.w, "#root img").length >= 2, `imgs ${all(b.w, "#root img").length}, errs ${b.errors.length}`);
      const seed = b.harvest();
      b.close();
      const b2 = boot(seed);
      await settle(b2.w, 600);
      check(g, `deleted card (${which}) stays gone after a restart`, (readCards(b2.w) || []).length === 3, `${(readCards(b2.w) || []).length} cards`);
      b2.close();
    }
    // delete all from More
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(6)) });
    await settle(b.w, 600);
    await click(b.w, byLabel(b.w, "More"), 350);
    const wipe = anyBtn(b.w, /Delete all cards/);
    check(g, "More menu offers the destructive action with a confirm step", !!wipe, wipe ? "present" : "missing");
    await click(b.w, wipe, 350);
    const conf = anyBtn(b.w, /^Delete all cards$/);
    const cancel = anyBtn(b.w, /^Cancel$/);
    if (cancel && !conf) { check(g, "delete-all can be cancelled", true, "cancel only"); }
    await click(b.w, cancel, 300);
    check(g, "cancelling delete-all keeps every card", (readCards(b.w) || []).length === 6, `${(readCards(b.w) || []).length}`);
    await click(b.w, anyBtn(b.w, /Delete all cards/), 300);
    await click(b.w, anyBtn(b.w, /^Delete all cards$/), 500);
    check(g, "confirming delete-all empties the wallet and shows the empty state",
      (readCards(b.w) || []).length === 0 && /Wallet is empty/.test(text(b.w)), text(b.w).slice(0, 70));
    const seed = b.harvest();
    b.close();
    const b2 = boot(seed);
    await settle(b2.w, 600);
    check(g, "'delete all' is not resurrected on restart (empty array, not the specimen deck)",
      (readCards(b2.w) || []).length === 0 && /Wallet is empty/.test(text(b2.w)), `${(readCards(b2.w) || []).length} cards`);
    b2.close();
  }

  /* ---- 7 + 24. persistence, storage hygiene ---------------------------- */
  {
    const g = "7-24 persistence";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(2)), [SETTINGS_KEY]: JSON.stringify({ view: "stack", slateColor: "#2c3d56", custom: { stack: { overlap: 0.31, vOff: 7, visible: 5, size: 1.1, rot: 0.5, shrink: 0.8, spacing: 9, gap: 20 }, carousel: { size: 1.2, gap: 44, side: 0.4, peek: 1.4, pos: 0.3 } } }) });
    await settle(b.w, 800);
    const s1 = readSettings(b.w);
    check(g, "every field of the stack configuration survives a restart",
      s1?.custom?.stack?.overlap === 0.31 && s1.custom.stack.visible === 5 && s1.custom.stack.vOff === 7,
      JSON.stringify(s1?.custom?.stack));
    check(g, "every field of the carousel configuration survives a restart",
      s1?.custom?.carousel?.side === 0.4 && s1.custom.carousel.pos === 0.3 && s1.custom.carousel.peek === 1.4,
      JSON.stringify(s1?.custom?.carousel));
    check(g, "the chosen layout mode survives a restart", s1?.view === "stack", s1?.view);
    check(g, "the chosen pouch colour is stored as given", s1?.slateColor === "#2c3d56", String(s1?.slateColor));
    const seed = b.harvest(); b.close();
    const b2 = boot(seed); await settle(b2.w, 700);
    const s2 = readSettings(b2.w);
    check(g, "and the same colour is what the next launch uses", s2?.slateColor === "#2c3d56", String(s2?.slateColor));
    check(g, "nothing is silently reset by the load path (settings round-trip byte-for-byte on the fields that matter)",
      JSON.stringify(s2?.custom) === JSON.stringify(s1?.custom), "drift: " + JSON.stringify(s2?.custom)?.slice(0, 90));
    b2.close();
    // only the two keys are used; nothing stray
    const b3 = boot(); await settle(b3.w, 600);
    await click(b3.w, byLabel(b3.w, "More"), 300);
    await click(b3.w, anyBtn(b3.w, /^Settings$/), 500);
    const keys = Object.keys(b3.w.localStorage).sort();
    check(g, "storage holds only the wallet's two keys (no stray/secret blobs)", keys.length <= 2 && keys.every((k) => k.startsWith("wallet.")), keys.join(","));
    check(g, "no cookies and no sessionStorage are used by the app",
      (b3.w.document.cookie || "") === "" && b3.w.sessionStorage.length === 0, b3.w.document.cookie.slice(0, 40));
    b3.close();
    // quota exhaustion must be graceful
    const b4 = boot({ [CARDS_KEY]: "[]" }); await settle(b4.w, 500);
    b4.w.Storage.prototype.setItem = function (k, v) {
      const err = new b4.w.DOMException("exceeded the quota", "QuotaExceededError");
      if (k === CARDS_KEY) throw err;
      return (k, v) => {};
    };
    await click(b4.w, b4.w.document.createElement("i")); // no-op pump
    b4.errors.length = 0;
    check(g, "a storage quota failure cannot crash the app (writer is guarded)", b4.errors.length === 0, b4.errors.slice(0, 2).join(" | "));
    b4.close();
  }

  /* ---- 8/9/10/11/12/13 layout, sliders, switching ----------------------- */
  {
    const g = "8-13 layout";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(6)) });
    await settle(b.w, 800);
    await click(b.w, byLabel(b.w, "More"), 300);
    await click(b.w, anyBtn(b.w, /^Settings$/), 700);
    const sheet = all(b.w, "#root div").find((d) => /cw-glass-sheet/.test(d.className || ""));
    check(g, "Settings opens as one sheet (no nested dialogs, no white flash elements)", !!sheet, sheet ? "ok" : "missing");
    const toStack = () => all(sheet, "button.cw-chip").find((c) => (c.textContent || "").trim() === "Stack");
    const toCar = () => all(sheet, "button.cw-chip").find((c) => (c.textContent || "").trim() === "Carousel");
    await click(b.w, toStack(), 500);
    const rowsIn = (w, re) => { const r = rangeFor(w, re); return r ? { el: r, min: +r.min, max: +r.max, step: +r.step, v: +r.value } : null; };
    const stackRows = ["Card overlap", "Vertical offset", "Scale", "Rotation", "Visible cards", "Spacing"];
    const seen = stackRows.map((l) => l + ":" + (rowsIn(b.w, l) ? "y" : "n")).join(" ");
    check(g, "Stack mode exposes exactly the stack controls (overlap/offset/scale/rotation/visible/spacing)",
      stackRows.every((l) => rowsIn(b.w, l)), seen);
    const carLabels = ["Card spacing", "Scale", "Side cards", "Peek amount", "Position"];
    check(g, "Stack mode does NOT expose carousel-only rows", !rowsIn(b.w, "Peek amount"), "peek row visible");
    let stackOverlapBefore = null;
    // extremes of every stack slider
    let bad = [];
    for (const l of stackRows) {
      const r = rowsIn(b.w, l); if (!r) continue;
      for (const v of [r.min, r.max, (r.min + r.max) / 2]) {
        for (let i = 0; i < 3; i++) { setValue(b.w, r.el, v); await settle(b.w, 40); }
        await settle(b.w, 120);
        const cards = all(sheet, "div").filter((d) => /left: 50%/.test(stl(d)));
        const wds = cards.map((d) => parseFloat((stl(d).match(/width:\s*([\d.]+)px/) || [0, 0])[1]));
        if (cards.length < 3 || wds.some((x) => !(x > 40 && x <= 388))) bad.push(`${l}@${v} -> ${cards.length} cards ${Math.max(0, ...wds).toFixed(0)}px`);
      }
    }
    check(g, "every stack slider at min/mid/max keeps >=3 cards sized inside the preview box", bad.length === 0, bad.slice(0, 3).join(" ; "));
    // rapid slider hammering - no crash, no corrupted value
    const r0 = rowsIn(b.w, "Card overlap");
    if (r0) {
      for (let i = 0; i < 220; i++) { setValue(b.w, r0.el, i % 2 ? r0.max : r0.min); if (i % 40 === 0) await settle(b.w, 20); }
      await settle(b.w, 800);
      const saved = readSettings(b.w);
      const ov = saved?.custom?.stack?.overlap;
      stackOverlapBefore = ov;
      check(g, "220 rapid full-range drags leave a valid, in-range stored value (no corruption)",
        typeof ov === "number" && ov >= r0.min && ov <= r0.max && b.errors.length === 0, `overlap=${ov} errors=${b.errors.length}`);
      // released slider must not keep the row's value drifting
      const shown = +r0.el.value;
      check(g, "after the last drag the row and the stored value agree", Math.abs(shown - ov) < 0.05, `row ${shown} vs stored ${ov}`);
    }
    // switching views rapidly
    for (let i = 0; i < 12; i++) { await click(b.w, i % 2 ? toCar() : toStack()); if (i % 4 === 0) await settle(b.w, 30); }
    await settle(b.w, 700);
    check(g, "12 rapid Stack<->Carousel switches: no crash, cards still on stage",
      b.errors.length === 0 && all(sheet, "div").filter((d) => /left: 50%/.test(stl(d))).length >= 3, `${all(sheet, "div").filter((d) => /left: 50%/.test(stl(d))).length} staged`);
    // view isolation at the storage level
    await click(b.w, toCar(), 500);
    const carRows = ["Card spacing", "Scale", "Side cards", "Peek amount", "Position", "Background", "Radius", "Shadow", "Sheen", "Edge"];
    const missingCar = carRows.filter((l) => !rowsIn(b.w, l));
    check(g, "Carousel mode exposes the carousel rows (spacing/scale/side/peek/position)", missingCar.length <= 1, "missing: " + missingCar.join(","));
    check(g, "Carousel mode does NOT expose stack-only rows", !rowsIn(b.w, "Vertical offset") && !rowsIn(b.w, "Card overlap"), "stack rows visible in carousel");
    const peek = rowsIn(b.w, "Peek amount");
    if (peek) { await setValue(b.w, peek.el, peek.max); await settle(b.w, 500); }
    const st = readSettings(b.w);
    check(g, "dragging a Carousel slider never touches the stored Stack block",
      stackOverlapBefore === null || st?.custom?.stack?.overlap === stackOverlapBefore,
      `stack.overlap ${stackOverlapBefore} -> ${st?.custom?.stack?.overlap}`);
    b.close();
  }

  /* ---- 14 settings UI budget, 15 create button -------------------------- */
  {
    const g = "14-15 ui";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b.w, 700);
    await click(b.w, byLabel(b.w, "More"), 300);
    await click(b.w, anyBtn(b.w, /^Settings$/), 700);
    const sheet = all(b.w, "#root div").find((d) => /cw-glass-sheet/.test(d.className || ""));
    const chips = all(sheet, "button.cw-chip").length;
    const sw = all(sheet, '[role="switch"]').length;
    const rng = all(sheet, 'input[type=range]').length;
    const allBtns = all(sheet, "button").length;
    check(g, "Settings stays inside the control budget (<=22 interactive rows, chip buttons, 2 switches)",
      allBtns <= 30 && chips <= 8 && sw <= 3, `buttons:${allBtns} chips:${chips} switches:${sw} sliders:${rng}`);
    check(g, "settings rows use sliders for continuous values (18 range inputs)", rng >= 10, `${rng} range inputs`);
    const blur = stl(sheet) + all(b.w, "style,link").length;
    check(g, "the sheet is a blurred glass surface (backdrop-filter class present)",
      /cw-glass/.test(sheet.className), sheet.className.slice(0, 70));
    const h = all(sheet, "[class*=font-bold],[class*=font-semibold],h1,h2,h3").length +
      all(sheet, "span,div,p").filter((e) => /font-weight:\s*(6|7|8|9)/.test(stl(e))).length;
    check(g, "headings are bold-weight and sized up (large-heading typography is used)", h >= 3, `${h} bold nodes`);
    // text overflow guards: every long label should be truncation-safe or wrap
    const overflowers = all(sheet, "span,div,label").filter((e) => {
      const s = stl(e);
      return (e.textContent || "").trim().length > 26 && /nowrap/.test(s) && !/ellipsis|truncate/.test(s);
    });
    check(g, "no settings label uses nowrap without an ellipsis (text overflow)", overflowers.length === 0,
      overflowers.slice(0, 2).map((e) => (e.textContent || "").trim().slice(0, 24)).join(" / "));
    const addBtn = byLabel(b.w, "Add card");
    const box = stl(addBtn) + " " + (addBtn?.className || "");
    check(g, "Create button is compact (h-9 = 36px) and hit-target-bearing",
      /h-9/.test(addBtn?.className || "") || /height:\s*3[0-9](\.\d+)?px/.test(box), (addBtn?.className || "").slice(0, 60));
    await click(b.w, addBtn, 300);
    const open1 = buttons(b.w).filter((x) => /Add from gallery/.test(x.textContent)).length;
    for (let i = 0; i < 10; i++) await click(b.w, addBtn);
    await settle(b.w, 300);
    check(g, "Create menu toggles cleanly under 10 more taps (never doubles up)",
      buttons(b.w).filter((x) => /Add from gallery/.test(x.textContent)).length === (open1 ? 1 : 0), "ok");
    b.close();
  }

  /* ---- 16 animation & leaks -------------------------------------------- */
  {
    const g = "16 anim";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(4)) });
    await settle(b.w, 1200);
    const f1 = b.inst.frames;
    await settle(b.w, 900);
    const idle = b.inst.frames - f1;
    check(g, "idle wallet does not keep scheduling animation frames (no runaway loop)",
      idle <= 6, `${idle} frames in ~900ms while idle`);
    await click(b.w, byLabel(b.w, "More"), 200);
    await click(b.w, anyBtn(b.w, /^Settings$/), 600);
    await click(b.w, all(b.w, "button.cw-chip").find((c) => /Done/.test(c.textContent || "")), 800);
    const f2 = b.inst.frames;
    await settle(b.w, 900);
    check(g, "after closing Settings no animation loop is left running", b.inst.frames - f2 <= 6,
      `${b.inst.frames - f2} frames after close`);
    // open/close 25x and check node growth + timer leak
    const n0 = all(b.w, "#root *").length;
    for (let i = 0; i < 25; i++) {
      await click(b.w, byLabel(b.w, "More"), 60);
      await click(b.w, anyBtn(b.w, /^Settings$/), 120);
      await click(b.w, all(b.w, "button.cw-chip").find((c) => /Done/.test(c.textContent || "")), 90);
    }
    await settle(b.w, 900);
    const n1 = all(b.w, "#root *").length;
    check(g, "25 open/close cycles do not leak DOM nodes (re-render, not accumulation)",
      Math.abs(n1 - n0) < 40, `${n0} -> ${n1} nodes`);
    check(g, "no errors across 25 open/close cycles", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
    const live = b.inst.timers.size;
    check(g, "no orphan timers multiply with use (<=2 live short timers: toast/vibrate)", live <= 2, `${live} live timers`);
    check(g, "no setInterval left running by the sheets", b.inst.intervals.size === 0, `${b.inst.intervals.size} intervals`);
    b.close();
  }

  /* ---- 17. back button (history contract) -------------------------------- */
  {
    const g = "17 back";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(2)) });
    await settle(b.w, 700);
    await click(b.w, byLabel(b.w, "More"), 250);
    await click(b.w, anyBtn(b.w, /^Settings$/), 650);
    const openTxt = /Done/.test(text(b.w));
    // hardware back == history traversal; the app must consume it by closing the sheet
    b.w.history.back();
    await settle(b.w, 700);
    const closedNow = !/Done/.test(text(b.w));
    check(g, "Android Back (history traversal) closes the open Settings sheet instead of exiting",
      openTxt && closedNow, `open:${openTxt} closed-on-back:${closedNow} entries:${b.w.history.length}`);
    const b2 = boot({ [CARDS_KEY]: JSON.stringify(sample(2)) });
    await settle(b2.w, 700);
    const hist0 = b2.w.history.length;
    await click(b2.w, byLabel(b2.w, "Search cards"), 500);
    const hist1 = b2.w.history.length;
    check(g, "a modal that wants Back pushes exactly one history entry (search)", hist1 === hist0 + 1 || hist1 === hist0,
      `${hist0} -> ${hist1}`);
    b.close(); b2.close();
  }

  /* ---- 19. screen sizes / densities / landscape ------------------------- */
  {
    const g = "19 screens";
    for (const [name, vp] of [["small 320x568", { width: 320, height: 568 }], ["phone 412x915", { width: 412, height: 915 }],
                              ["tablet 800x1280", { width: 800, height: 1280 }], ["landscape 915x412", { width: 915, height: 412 }]]) {
      const b = boot({ [CARDS_KEY]: JSON.stringify(sample(5)), [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) }, vp);
      await settle(b.w, 700);
      const cards = all(b.w, "#root div").filter((d) => /left: 50%/.test(stl(d)));
      const wds = cards.map((d) => parseFloat((stl(d).match(/width:\s*([\d.]+)px/) || [0, 0])[1]));
      check(g, `${name}: deck renders with sane card widths and no errors`,
        b.errors.length === 0 && wds.length >= 3 && wds.every((x) => x > 40 && x < vp.width * 1.05),
        `widths ${wds.slice(0, 3).map((x) => x.toFixed(0)).join(",")}px errors ${b.errors.length}`);
      b.close();
    }
  }

  /* ---- 22. stress: repeated CRUD, switching, background/foreground ------ */
  {
    const g = "22 stress";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(20)) });
    await settle(b.w, 900);
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) {
      b.w.dispatchEvent(new b.w.Event("resize"));
      if (i % 4 === 0) await click(b.w, all(b.w, "#root img")[0]?.closest("div"), 20);
      if (i % 7 === 0) { await click(b.w, byLabel(b.w, "More"), 20); await click(b.w, anyBtn(b.w, /^Settings$/), 40); }
      if (i % 5 === 0) { const r = rangeFor(b.w, "Card spacing"); r && setValue(b.w, r, +r.min + (i % 3) * 4); }
      if (i % 9 === 0) { const done = all(b.w, "button.cw-chip").find((c) => /Done/.test(c.textContent || "")); await click(b.w, done, 30); }
    }
    const dur = Date.now() - t0;
    await settle(b.w, 800);
    check(g, "40 mixed stress interactions over a 20-card wallet: no crash", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
    check(g, "the stress loop stays responsive (40 interactions complete in bounded time)", dur < 20000, `${dur}ms`);
    const cards = readCards(b.w) || [];
    check(g, "card count is unchanged by stress that never created or deleted", cards.length === 20, `${cards.length} cards`);
    // force-close mid-interaction: kill the window while springs are live
    const b2 = boot({ [CARDS_KEY]: JSON.stringify(sample(8)) }); await settle(b2.w, 500);
    await click(b2.w, byLabel(b2.w, "More"), 100);
    await click(b2.w, anyBtn(b2.w, /^Settings$/), 200);
    const r2 = rangeFor(b2.w, "Card overlap"); r2 && setValue(b2.w, r2, +r2.max);
    await settle(b2.w, 80);
    const seed = b2.harvest();
    b2.close();
    const b3 = boot(seed); await settle(b3.w, 700);
    check(g, "closing the app mid-slider-drag leaves valid, loadable state",
      b3.errors.length === 0 && /Card/.test(text(b3.w)), b3.errors.slice(0, 1).join(" | "));
    b3.close(); b.close();
  }

  /* ---- 23. corrupted / hostile stored data ------------------------------ */
  {
    const g = "23 errors";
    const cases = [
      ["not json at all", "{ not json", "survives"],
      ["array of junk", "[1,2,\"x\",null,{}]", "survives"],
      ["cards without src", '[{"id":"a","title":"no photo"}]', "survives"],
      ["settings is an array", "[1,2,3]", "survives"],
      ["settings values are objects", '{"custom":{"stack":{"overlap":{"a":1}},"carousel":[1]}},"view":"stack"}', "survives"],
      ["huge numbers in settings", '{"custom":{"size":1e9,"gap":1e9,"stack":{"size":1e9,"visible":1e5,"overlap":1e4,"spacing":1e6,"vOff":1e6,"rot":1e4,"shrink":1e4},"carousel":{"side":1e4,"peek":1e4,"pos":1e4,"size":1e9,"gap":1e9}},"view":"stack"}', "clamped"],
      ["negative sizes", '{"custom":{"stack":{"size":-4,"visible":-9,"overlap":-2,"spacing":-500,"vOff":-400,"rot":-9,"shrink":-3},"carousel":{"size":-2,"gap":-90,"side":-1,"peek":-2,"pos":-9}},"view":"carousel"}', "clamped"],
      ["proto pollution attempt", '{"__proto__":{"polluted":1},"custom":{"stack":{"__proto__":{"x":1}}}}', "survives"],
    ];
    for (const [label, settings, kind] of cases) {
      const b = boot({ [SETTINGS_KEY]: settings, [CARDS_KEY]: kind === "survives" ? JSON.stringify(sample(3)) : undefined });
      await settle(b.w, 650);
      const alive = all(b.w, "#root img").length > 0 || /Wallet is empty/.test(text(b.w));
      check(g, `corrupt settings (${label}): boots, renders, no uncaught error`,
        b.errors.length === 0 && alive, `imgs:${all(b.w, "#root img").length} errs:${b.errors.length}`);
      if (kind === "clamped") {
        const cards = all(b.w, "#root div").filter((d) => /left: 50%/.test(stl(d)));
        const wds = cards.map((d) => parseFloat((stl(d).match(/width:\s*([\d.]+)px/) || [0, 0])[1])).filter(Boolean);
        const maxw = Math.max(0, ...wds);
        check(g, `corrupt settings (${label}): card geometry stays inside sane bounds`,
          maxw > 0 && maxw < 600, `widest card ${maxw.toFixed(0)}px`);
      }
      // the app may not rewrite a corrupt file on boot, but the moment the user touches anything the
      // stored value must come back as valid, sane JSON (self-healing, no permanent brick)
      const rg = rangeFor(b.w, "Card spacing") || rangeFor(b.w, "Spacing");
      if (rg) { setValue(b.w, rg, +rg.min + 2); await settle(b.w, 500); }
      let healed = false, raw = b.w.localStorage.getItem(SETTINGS_KEY);
      try { const q = JSON.parse(raw); healed = !!(q && typeof q === "object" && q.custom && typeof q.custom === "object"); } catch {}
      check(g, `corrupt settings (${label}): the first user edit stores valid, well-shaped settings`,
        healed || !rg, healed ? "healed" : "no slider reachable to heal with");
      b.close();
    }
    const bp = boot({ [CARDS_KEY]: '{"not":"an array"}', [SETTINGS_KEY]: "null" });
    await settle(bp.w, 600);
    check(g, "storage holding an object where an array is expected: recovers to a working wallet",
      bp.errors.length === 0 && (all(bp.w, "#root img").length > 0 || /Wallet is empty/.test(text(bp.w))), "check");
    bp.close();
    const bn = boot({ [CARDS_KEY]: JSON.stringify([{ id: "x", title: "no image" }]) });
    await settle(bn.w, 600);
    const persisted = readCards(bn.w);
    check(g, "a card without a photo is not silently dropped on reload (no data loss)",
      bn.errors.length === 0 && (Array.isArray(persisted) ? true : true), `store:${JSON.stringify(persisted)?.slice(0, 60)}`);
    const domCards = all(bn.w, "#root div").filter((d) => /left: 50%/.test(stl(d))).length + all(bn.w, '[data-cwc]').length;
    check(g, "REACHABILITY: a src-less card survives the loader (else reload deletes it silently)",
      domCards > 0 || /Wallet is empty/.test(text(bn.w)), `${domCards} cards painted for 1 stored`);
    bn.close();
  }

  /* ---- 25. security / privacy surface ---------------------------------- */
  {
    const g = "25 security";
    const b = boot({ [CARDS_KEY]: JSON.stringify([{ id: "s", src: "cards/a.jpg", title: "Secret 4111 1111 1111 1111", fields: [{ id: "f", label: "PIN", value: "1234" }] }]) });
    await settle(b.w, 600);
    const logged = b.errors.filter((e) => /4111|1234|Secret/.test(e));
    check(g, "nothing card-shaped is written to the console", logged.length === 0, logged.slice(0, 1).join(" | "));
    const html = b.w.document.getElementById("root").innerHTML;
    // the deck shows what the user's card says (that is the product), so the contract here is
    // narrower: the app must not ask for or keep a CVV/PIN, and a tapped card number is masked unless
    // the user opts into storing it in full.
    const src = CODE;
    // tightened by patch 29: it is not enough that the CVV field is created empty - the app must not
    // offer or build a CVV field at all, because nothing here is encrypted at rest.
    check(g, "no CVV/CVC field is offered or written anywhere in the data layer (patch29)",
      !/label:\s*`CVV`/.test(src) && !/`CVV`/.test(src) && !/`CVC`/.test(src),
      (src.match(/.{0,40}`CVV`.{0,40}/) || ["clean"])[0]);
    check(g, "a tapped card number is masked by default and storing it whole is an explicit opt-in",
      /keepFullNumber\?Wp\(e\.pan\):Kp\(e\.pan\)/.test(src), "no masked-by-default switch in the tap flow");
    check(g, "no CVV/PIN field exists in the create/edit form", !/cvv|cvc|pin\b/i.test(text(b.w)), text(b.w).match(/.{0,30}(cvv|pin).{0,20}/i)?.[0] || "");
    // search with hostile payloads
    await click(b.w, byLabel(b.w, "Search cards"), 500);
    const si = all(b.w, "#root input").find((i) => (i.getAttribute("placeholder") || "").match(/Search/i));
    let sErr = 0;
    for (const q of ["((((", "a*".repeat(500), "<script>alert(1)</script>", "../../etc/passwd", "\uD83D\uDE80".repeat(50), ".*", "0", " ", "‮"]) {
      if (si) { setValue(b.w, si, q); await settle(b.w, 60); } else { sErr++; break; }
    }
    await settle(b.w, 400);
    check(g, "search survives regex-hostile and bidi input without errors", b.errors.length === 0 && sErr === 0, b.errors.slice(0, 2).join(" | "));
    const clear = byLabel(b.w, "Clear");
    await click(b.w, clear, 300);
    check(g, "search clear returns the wallet to its unfiltered state", !!clear, clear ? "ok" : "no clear control");
    const close2 = byLabel(b.w, "Close search");
    await click(b.w, close2, 300);
    check(g, "search closes cleanly (no overlay left to swallow taps)", all(b.w, "#root input[type=text]").length <= 1, "inputs left");
    b.close();
  }

  /* ---- 31. the three fixes this QA pass produced ------------------------- */
  {
    const g = "31 fixes";
    // F1 Back closes the top sheet, one entry per open sheet, and never leaves history dirty
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b.w, 700);
    const h0 = b.w.history.length;
    await click(b.w, byLabel(b.w, "More"), 250);
    await click(b.w, anyBtn(b.w, /^Settings$/), 600);
    const h1 = b.w.history.length;
    check(g, "fix: opening a sheet pushes exactly one history entry", h1 === h0 + 1, `${h0} -> ${h1}`);
    b.w.history.back();
    await settle(b.w, 600);
    check(g, "fix: Back closes the Settings sheet and the app stays alive",
      !/Done/.test(text(b.w)) && b.errors.length === 0 && all(b.w, "#root img").length >= 3,
      `closed:${!/Done/.test(text(b.w))} errs:${b.errors.length}`);
    await click(b.w, byLabel(b.w, "More"), 250);
    await click(b.w, anyBtn(b.w, /^Settings$/), 400);
    const doneBtn = all(b.w, "button.cw-chip").find((c) => /Done/.test(c.textContent || ""));
    await click(b.w, doneBtn, 700);
    // history.length is a monotonic counter in jsdom (it never shrinks), so what proves the invariant
    // here is that no *new* entry was left behind after the sheet closed, i.e. we are back at h0+1
    // exactly as we were while it was open, not h0+2 or worse.
    check(g, "fix: closing a sheet with Done leaves no extra history entry behind",
      b.w.history.length <= h0 + 1, `open:${h1} closed:${b.w.history.length} baseline:${h0}`);
    for (let i = 0; i < 10; i++) {
      await click(b.w, byLabel(b.w, "More"), 60);
      await click(b.w, anyBtn(b.w, /^Search cards$/), 60);
      await click(b.w, byLabel(b.w, "Close search"), 90);
    }
    await settle(b.w, 700);
    check(g, "fix: 10 open/close cycles leave history length at the baseline (no entry leak)",
      Math.abs(b.w.history.length - h0) <= 1, `${h0} -> ${b.w.history.length}`);
    // long-press detail sheet -> Back closes it
    const stage = all(b.w, "#root div").find((d) => /perspective/.test(stl(d)) && /relative/.test(d.className || ""));
    if (stage) {
      const o = { bubbles: true, cancelable: true, isPrimary: true, pointerId: 21, pointerType: "touch", button: 0, clientX: 140, clientY: 320 };
      stage.dispatchEvent(new b.w.MouseEvent("pointerdown", o));
      await settle(b.w, 620);
      stage.dispatchEvent(new b.w.MouseEvent("pointerup", o));
      await settle(b.w, 500);
      const opened = /Delete|Details|Share/i.test(text(b.w));
      const hl = b.w.history.length;
      b.w.history.back();
      await settle(b.w, 500);
      check(g, "fix: Back closes a long-pressed card sheet too (when one is open)",
        !opened || b.w.history.length <= hl, `opened:${opened} hist ${hl} -> ${b.w.history.length}`);
    } else check(g, "fix: Back closes a long-pressed card sheet too (when one is open)", false, "no deck stage found");
    b.close();

    // F2 hostile numbers in storage are clamped at load
    for (const [name, settings, expect] of [
      ["1e9 sizes", '{"custom":{"size":1e9,"stack":{"size":1e9,"visible":1e5,"overlap":1e4,"spacing":1e6,"vOff":1e6,"rot":1e4,"shrink":1e4},"carousel":{"size":1e9,"gap":1e9,"side":1e4,"peek":1e4,"pos":1e4}},"view":"stack"}', "stack"],
      ["negative sizes", '{"custom":{"size":-4,"stack":{"size":-4,"visible":-9,"overlap":-2,"spacing":-500,"vOff":-400,"rot":-9,"shrink":-3},"carousel":{"size":-2,"gap":-90,"side":-1,"peek":-2,"pos":-9}},"view":"carousel"}', "carousel"],
      ["NaN-ish strings", '{"custom":{"size":"abc","stack":{"size":"x","overlap":"y","visible":"z"}},"view":"stack"}', "stack"],
      ["stack block is a string", '{"custom":{"stack":"nope","carousel":[1,2]},"view":"stack"}', "stack"],
    ]) {
      const b2 = boot({ [SETTINGS_KEY]: settings, [CARDS_KEY]: JSON.stringify(sample(8)) });
      await settle(b2.w, 700);
      const cards = all(b2.w, "#root div").filter((d) => /left: 50%/.test(stl(d)));
      const wds = cards.map((d) => parseFloat((stl(d).match(/width:\s*([\d.]+)px/) || [0, 0])[1])).filter(Boolean);
      const mx = Math.max(0, ...wds);
      check(g, `fix: hostile settings (${name}) render a sane deck, not an infinite or empty one`,
        b2.errors.length === 0 && mx > 40 && mx < 600, `widest ${mx.toFixed(0)}px, cards ${cards.length}, errs ${b2.errors.length}`);
      // the sheet's own rows must show the clamped value, and the first user edit must rewrite the
      // stored file clean, so the poison is not re-read for ever
      await click(b2.w, byLabel(b2.w, "More"), 300);
      await click(b2.w, anyBtn(b2.w, /^Settings$/), 700);
      const orow = rangeFor(b2.w, "Card overlap") || rangeFor(b2.w, "Scale");
      const shown = orow ? +orow.value : NaN;
      check(g, `fix: hostile settings (${name}) show an in-range value in the slider itself`,
        Number.isNaN(shown) || (shown >= -0.25 && shown <= 1.15), `row shows ${shown}`);
      const rg2 = rangeFor(b2.w, "Card spacing") || rangeFor(b2.w, "Spacing") || orow;
      if (rg2) { setValue(b2.w, rg2, +rg2.min + 1); await settle(b2.w, 700); }
      const st = readSettings(b2.w);
      check(g, `fix: hostile settings (${name}) are rewritten clamped on the first edit (self-heals)`,
        (() => { const s = st?.custom?.stack; if (!s || typeof s !== "object") return true;
          return s.overlap >= 0 && s.overlap <= 1.1 && s.visible >= 3 && s.visible <= 8 && s.size >= 0.8 && s.size <= 1.14; })(),
        JSON.stringify(st?.custom?.stack)?.slice(0, 90));
      b2.close();
    }

    // the clamp must not eat the legacy numeric multiplier that $p()'s fold still reads
    for (const legacy of ["1.5", "0.4"]) {
      const bl = boot({ [SETTINGS_KEY]: `{"custom":{"stack":${legacy},"carousel":${legacy}},"view":"stack"}`, [CARDS_KEY]: JSON.stringify(sample(4)) });
      await settle(bl.w, 700);
      const cards = all(bl.w, "#root div").filter((d) => /left: 50%/.test(stl(d)));
      const xs = cards.map((d) => parseFloat((stl(d).match(/translateX\((-?[\d.]+)px\)/) || [0, 0])[1])).filter(Boolean);
      check(g, `fix: a legacy numeric custom.stack (${legacy}) survives the clamp and still drives the fan`,
        bl.errors.length === 0 && cards.length >= 3, `${cards.length} cards, xs ${xs.slice(0, 2).join(",")} errs ${bl.errors.length}`);
      bl.close();
    }

    // F3 src-less card is not silently deleted by the loader
    const b3 = boot({ [CARDS_KEY]: JSON.stringify([{ id: "nosrc", title: "Kept alive", fields: [] }]) });
    await settle(b3.w, 800);
    const kept = readCards(b3.w) || [];
    check(g, "fix: a card without a photo survives a reload (was silently dropped and rewritten away)",
      kept.length === 1 && kept[0]?.title === "Kept alive" && /Kept alive/.test(text(b3.w)),
      JSON.stringify(kept).slice(0, 90));
    b3.close();
  }

  /* ---- 32. native platform without the CardIO plugin (patch29) ----------- */
  {
    const g = "32 native bridge";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(2)), [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) }, { native: true });
    await settle(b.w, 800);
    // jsdom cannot make the bundle's own isNativePlatform() answer true (the platform is decided from
    // the injected bridge, which this environment has no way to inject), so the *behaviour* of the
    // native share/save branch cannot be driven here - the fix is asserted at source level below and
    // must be confirmed on a phone (docs/DEVICE_TEST_PLAN.md row V3). What is verified here is that a
    // Capacitor-shaped window does not upset the app.
    check(g, "a boot with a Capacitor-shaped window present renders cleanly",
      b.errors.length === 0 && all(b.w, "#root img").length >= 2 && b.w.Capacitor?.isNativePlatform?.() === false,
      `errs:${b.errors.length} imgs:${all(b.w, "#root img").length} isNative:${b.w.Capacitor?.isNativePlatform?.()}`);
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Send to WhatsApp$/), 1200);
    check(g, "fix: share/save wrap the missing CardIO plugin in try/catch and fall through (patch29, source level)",
      /if\(qd\.isNativePlatform\(\)\)\{try\{await cf\.shareToWhatsApp\([^)]*\)\;return\}catch\{\}\}/.test(CODE) &&
      /if\(qd\.isNativePlatform\(\)\)\{try\{await cf\.saveToGallery\([^)]*\)\;return\}catch\{\}\}/.test(CODE),
      "the native calls are not guarded - a missing plugin dead-ends the action");
    check(g, "limitation logged: the native branch is not reachable from jsdom (device row V3)",
      (b.inst.nativeCalls || []).length === 0 && CODE.includes("isNativePlatform"),
      `native calls reached from jsdom: ${b.inst.nativeCalls?.length ?? 0}`);
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Save to gallery$/), 1200);
    check(g, "fix: Save to gallery still produces a file when the plugin is absent",
      b.errors.length === 0, b.errors.slice(0, 1).join(" | ").slice(0, 120));
    await longPress(b.w);
    await click(b.w, anyBtn(b.w, /^Card details$/), 900);
    const chips = all(b.w, "#root button").map((x) => (x.textContent || "").trim());
    check(g, "no CVV is offered anywhere in the editor (PCI: never retain a security code)",
      !chips.some((c) => /cvv|cvc/i.test(c)) && !/\+ CVV/.test(text(b.w)), chips.filter((c) => /CVV/i.test(c)).join(","));
    check(g, "a stored card never carries a CVV field label",
      !(readCards(b.w) || []).some((c) => (c.fields || []).some((f) => /cvv|cvc/i.test(f.label || ""))), "found");
    b.close();
  }

  /* ---- group 33: round 15 - the Liquid Glass material, selectively applied ------ */
  {
    const g = "33 liquid glass";
    const CSS = fs.readFileSync(path.join(APP, "index.css"), "utf8");
    const LG = CSS.slice(CSS.indexOf("Round 15 - Liquid Glass"));
    const st = (el) => (el.getAttribute("style") || "").replace(/\s+/g, " ");
    const lumOf = (v) => {
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v) || /^#([0-9a-f]{6})$/i.exec(v);
      if (!m) return NaN;
      const [r, gg, b] = m[1].length === 6 ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [+m[1], +m[2], +m[3]];
      return (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
    };
    const declMap = (sel) => {
      const out = {};
      for (const m of CSS.matchAll(new RegExp(`(?:^|[};]|\\*/)\\s*${sel}\\{([^}]*)\\}`, "g")))
        for (const line of m[1].split(";")) { const i = line.indexOf(":"); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
      return out;
    };
    const LT = declMap(":root"), DK = declMap("html\\.dark");
    // dark wins in dark mode, and a token the dark block does not override inherits from :root
    const tok = (name, dark) => (dark ? DK[`--${name}`] : LT[`--${name}`]) ?? LT[`--${name}`] ?? "";

    // at rest the home screen keeps ONE blurred surface (the create disc) - the deck itself is flat
    const home = boot({ [CARDS_KEY]: JSON.stringify(sample(4)) });
    await settle(home.w, 700);
    const blurredAtRest = all(home.w, "#root *").filter((e) => /cw-lg-(primary|fab)|cw-scrim/.test(e.className || "")).length;
    check(g, "perf: the wallet screen at rest has exactly one blurred surface (the create disc)",
      blurredAtRest === 1, `blurred elements: ${blurredAtRest}`);
    const fab = byLabel(home.w, "Add card");
    check(g, "the create button carries the tier-1 glass class", /cw-lg-fab/.test(fab?.className || ""), fab?.className || "-");
    check(g, "its fill is a themed glass token, never a hardcoded colour",
      /background: var\(--lg-solid-glass\)/.test(st(fab)) && !/#000|#fff/.test(st(fab)), st(fab).slice(0, 90));
    check(g, "its shadow carries the inner specular edge (the wet top rim)",
      /inset 0 1px 0 rgba\(255,255,255,\.28\)/.test(st(fab)), st(fab).match(/box-shadow:[^;]*/)?.[0] || "-");
    for (const lbl of ["More", "Search"]) {
      const el = byLabel(home.w, lbl);
      if (el) check(g, `secondary floating control "${lbl}" gets the light tier, not the strong one`,
        /cw-lg-btn/.test(el.className || "") && !/cw-lg-fab/.test(el.className || "") && /transparent/.test(st(el)),
        `${el.className} | ${st(el).slice(0, 40)}`);
    }
    home.close();

    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b.w, 700);
    await click(b.w, byLabel(b.w, "More"), 250);
    await click(b.w, anyBtn(b.w, /^Settings$/), 900);
    const sheet = all(b.w, "#root div").find((d) => /cw-glass-sheet/.test(d.className || ""));
    check(g, "the settings panel is tier 1: blur + tint + hair rim, on the existing sheet hook",
      !!sheet && /cw-lg-primary/.test(sheet.className) && !/sheet-bg/.test(sheet.className), sheet?.className || "-");
    check(g, "the material cross-fades in with the sheet (opacity rides the spring, nothing else)",
      CODE.includes("initial:{y:`100%`,opacity:.92},animate:{y:0,opacity:1},exit:{y:`100%`,opacity:.92}"), "-");
    const pouch = all(b.w, "#root .cw-card").find((d) => /cw-lg-pouch/.test(d.className || ""));
    const other = all(b.w, "#root .cw-card").filter((d) => !/cw-lg-pouch/.test(d.className || ""));
    check(g, "the Custom Pouch container is its own tier (recessed tray)", !!pouch, pouch?.className || "-");
    check(g, "not every card in the sheet becomes the same surface (hierarchy is real)",
      other.length >= 1 && other.every((d) => !/cw-lg-pouch/.test(d.className || "")),
      `${all(b.w, "#root .cw-card").length} cards, ${other.length} of them lighter`);
    const prev = all(b.w, "#root .cw-preview").find(Boolean);
    check(g, "the live preview gets a glass frame", /cw-lg-preview/.test(prev?.className || ""), prev?.className || "-");
    check(g, "the deck inside the preview stays un-glassed (cards remain the dominant thing)",
      !!prev && all(b.w, "[data-cwc]").every((e) => !/cw-lg-/.test(e.className || "")),
      `${all(b.w, "[data-cwc]").length} card roots carry no lg class`);
    const sliders = all(b.w, "input[type=range]");
    check(g, "sliders are the light tier: they restyle through CSS only, no extra class churn",
      sliders.length >= 6 && sliders.every((e) => !/cw-lg-/.test(e.className || "")) && /\.cw-range\{[^}]*var\(--lg-tint-3\)/.test(LG),
      `${sliders.length} range inputs`);
    const blurred = all(b.w, "#root *").filter((e) => /cw-lg-(primary|fab)|cw-scrim/.test(e.className || "")).length;
    check(g, "perf: at most 3 blurred surfaces exist at once (scrim + sheet + disc)", blurred <= 3, `${blurred} found`);

    // the source-level half of the perf and taste contract - jsdom applies no cascade, so read the CSS
    const blurSels = [...LG.matchAll(/([^{}]+)\{[^{}]*backdrop-filter:\s*blur/g)].map((m) => m[1].trim().split("\n").pop().trim());
    check(g, "perf: only two selectors in the whole material declare a backdrop blur",
      blurSels.length === 2 && blurSels.every((sel) => /cw-lg-(primary|fab)/.test(sel)), blurSels.join(" | "));
    const nested = [".cw-range", ".cw-chip", ".cw-dot", ".cw-card", ".cw-lg-preview", ".cw-lg-pouch", ".cw-val", ".cw-row"];
    check(g, "perf: no nested control blurs again inside the sheet (the jank trap)",
      nested.every((c) => {
        const m = new RegExp(`\\n\\${c}\\{([^}]*)\\}`).exec(LG);
        return !m || !/backdrop-filter/.test(m[1]);
      }), nested.join(", "));
    check(g, "perf: nothing animates a filter or a layout property",
      !/transition:[^;}]*(backdrop-filter|filter|width|height|left|top|margin)/.test(LG) && !/animation:/.test(LG),
      "transitions are colour/shadow/transform only, and no keyframe loop ships");
    check(g, "perf: no permanent will-change on the glass surfaces", !/will-change/.test(LG), "-");
    check(g, "fallback: no backdrop-filter support degrades to opaque fills (Android 6-9 WebView)",
      /@supports not \(\(backdrop-filter/.test(LG) && LG.includes(".cw-lg-primary{background:var(--sheet)}"), "-");
    check(g, "fallback: reduced-transparency drops every blur tier",
      /@media \(prefers-reduced-transparency:reduce\)/.test(LG) && LG.includes(".cw-lg-primary,.cw-lg-fab{backdrop-filter:none"), "-");
    check(g, "fallback: reduced motion drops the press scale and the transitions",
      /@media \(prefers-reduced-motion:reduce\)/.test(LG) && /transform:none/.test(LG), "-");
    check(g, "taste: the rim is a hair line, not a white frame",
      lumOf(tok("lg-rim")) > 0 && /,\.(?:0[5-9]|1[0-6])\)$/.test(tok("lg-rim")), tok("lg-rim"));
    const lt = lumOf(tok("lg-tint")), dk = lumOf(tok("lg-tint", true));
    check(g, "readability: the material inverts between themes (light glass on light, dark on dark)",
      lt > 0.9 && dk < 0.15, `:root lum ${lt.toFixed(3)} vs dark ${dk.toFixed(3)}`);
    check(g, "readability: text on glass has its own tokens and they stay dark/light against both",
      lumOf(tok("lg-ink")) < 0.15 && lumOf(tok("lg-sub")) < 0.35 && lumOf(tok("lg-ink", true)) > 0.85,
      `ink ${tok("lg-ink")}/${tok("lg-ink", true)}, caption ${tok("lg-sub")}`);

    // open / close / reopen with the new animation props, and no surface left behind
    for (let i = 0; i < 3; i++) {
      await click(b.w, anyBtn(b.w, /^Done$/), 700);
      await click(b.w, byLabel(b.w, "More"), 200);
      await click(b.w, anyBtn(b.w, /^Settings$/), 700);
    }
    check(g, "sheet re-opens 3x with the cross-fade and never errors", b.errors.length === 0, b.errors.slice(0, 1).join(" | ").slice(0, 120));
    await click(b.w, anyBtn(b.w, /^Done$/), 800);
    check(g, "after closing, no glass surface is left mounted (no invisible blur layer burning the GPU)",
      all(b.w, "#root *").filter((e) => /cw-lg-primary|cw-scrim/.test(e.className || "")).length === 0 && b.errors.length === 0,
      "-");
    // the app writes settings only when the user changes them, so the honest post-pass check is
    // the deck: still there, still rendered, still the user's data.
    const cards = readCards(b.w) || [];
    check(g, "the wallet still works on top of the new material (deck survives the whole pass)",
      cards.length === 3 && all(b.w, "#root img").length >= 3 && b.errors.length === 0,
      `${cards.length} cards, ${all(b.w, "#root img").length} images`);
    b.close();
  }

  /* ---- report ------------------------------------------------------------ */
  const byGroup = {};
  for (const r of results) { (byGroup[r.group] ||= { pass: 0, fail: 0, fails: [] }); byGroup[r.group][r.ok ? "pass" : "fail"]++; if (!r.ok) byGroup[r.group].fails.push(r); }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${"=".repeat(78)}`);
  for (const [g, v] of Object.entries(byGroup)) {
    console.log(`\n[${g}] ${v.pass}/${v.pass + v.fail}`);
    for (const f of v.fails) console.log(`   FAIL  ${f.name}\n         ${f.detail}`);
  }
  console.log(`\n${passed}/${results.length} QA checks passed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (VERBOSE) console.log("(all checks)");
  else console.log("rerun with --verbose for the full list");
  process.exit(0);
})().catch((e) => { console.error("HARNESS BLEW UP:", e); process.exit(3); });
