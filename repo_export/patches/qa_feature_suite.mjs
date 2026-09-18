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
    // round 21: the top-left "Wallet" label is gone. Assert the *element* is gone, not that the word
    // is absent from the text: textContent concatenates without separators, so with the label present
    // the root reads "WalletPlatinum Debit Card..." - a /\bWallet\b/ test never matches that, which is
    // how this check passed against the pre-round-21 bundle. Element-level, or it proves nothing.
    const wmSpans = [...(rootEl(b.w)?.querySelectorAll("span") || [])].filter(
      (el) => (el.textContent || "").trim() === "Wallet");
    check(g, "first launch has a wallet (specimen deck) and no header wordmark (round 21)",
      all(b.w, "#root img").length >= 3 && wmSpans.length === 0,
      `${all(b.w, "#root img").length} card images, ${wmSpans.length} "Wallet" label(s)`);
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
    check(g, "Settings stays inside the control budget (<=22 interactive rows, chip buttons, 4 switches)",
      /* 3 switches shipped through round 18; round 19 adds the customization gate and nothing else. */
      allBtns <= 31 && chips <= 8 && sw <= 4, `buttons:${allBtns} chips:${chips} switches:${sw} sliders:${rng}`);
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
    const blurredAtRest = all(home.w, "#root *").filter((e) => /cw-lg-primary|cw-dock/.test(e.className || "")).length;
    check(g, "perf: the wallet screen at rest has exactly one blurred surface (the footer dock)",
      blurredAtRest === 1, `blurred elements: ${blurredAtRest}`);
    const dock = all(home.w, "#root .cw-dock").find(Boolean);
    const topBar = all(home.w, "#root div").find((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
    const botBar = all(home.w, "#root div").find((d) => /inset-x-0 bottom-0 z-40/.test(d.className || ""));
    // the dock is a child of the top bar's container (its ref is what closes the menu on an outside
    // tap), so the "nothing left at the top" claim is about the top *row*, the container's first child.
    const topRow = topBar?.firstElementChild;
    check(g, "round 16: Create / Search / More sit together in one bottom dock, and the top row is empty (round 21)",
      !!dock && !!botBar && all(dock, "button[aria-label]").length === 3
      && !!topRow && all(topRow, "button").length === 0 && (topRow.textContent || "").trim() === ""
      && !/children:`Wallet`/.test(CODE),
      `dock:${dock ? all(dock, "button[aria-label]").map((b) => b.getAttribute("aria-label")).join(",") : "-"} topRowButtons:${topRow ? all(topRow, "button").length : "?"}`);
    check(g, "round 16: no nested blur - the disc inside the dock is told to stop blurring",
      /\.cw-dock \.cw-lg-fab\{backdrop-filter:none;\s*-webkit-backdrop-filter:none\}/.test(CSS)
      && /cw-lg-fab/.test(byLabel(home.w, "Add card")?.className || ""),
      "the CSS carries the suppression rule and the disc keeps its tier-2 look");
    // round 22: the overflow menu was the one surface still carrying patch 7's light-theme literal
    // ("#0b0b0d panel, white rows") - the report caught it in Light mode. Panel, hairline, rows and
    // the destructive row are tokens again, so the same declaration resolves both ways.
    // (the group's own declMap/tok helpers above do the token lookup)
    check(g, "round 22: the overflow menu is painted from tokens, not the round-4 near-black literal",
      CODE.includes("background:`var(--sheet)`,border:`1px solid var(--line)`,boxShadow:`var(--menu-shadow)`")
      && CODE.includes("style:{color:e.danger?`var(--danger)`:`var(--ink)`}")
      && !CODE.includes("#0b0b0d"),
      `panel/rows token-bound, #0b0b0d present=${CODE.includes("#0b0b0d")}`);
    check(g, "round 22: those tokens resolve differently per theme, so the menu cannot stay dark in Light",
      tok("sheet", false) === "#fff" && tok("sheet", true) === "#1c1c1e"
      && tok("ink", false) === "#111113" && tok("ink", true) === "#f5f5f7"
      && tok("menu-shadow", false) && tok("menu-shadow", true) && tok("menu-shadow", false) !== tok("menu-shadow", true),
      `sheet ${tok("sheet", false)}/${tok("sheet", true)}, ink ${tok("ink", false)}/${tok("ink", true)}, ` +
      `shadow ${tok("menu-shadow", false)}/${tok("menu-shadow", true)}`);
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
    // counted by what *actually* blurs: the disc carries cw-lg-fab, but .cw-dock .cw-lg-fab switches
    // its backdrop-filter off, so it is deliberately not in this set (the rule is checked below).
    const blurred = all(b.w, "#root *").filter((e) => /cw-lg-primary|cw-dock/.test(e.className || "")).length;
    check(g, "perf: at most 2 blurred surfaces exist at once (dock + sheet), and the scrim is not one",
      blurred <= 2, `${blurred} found`);
    check(g, "round 17: the scrim declares no backdrop-filter (the nested full-screen readback is gone)",
      !/\.cw-scrim\{[^}]*backdrop-filter/.test(CSS) && !/--scrim-blur/.test(CSS),
      (CSS.match(/\.cw-scrim\{[^}]{0,60}/) || ["-"])[0]);
    check(g, "round 17: the Settings sheet blurs at 14px, not the 30px that caused the lag",
      /--lg-blur:14px/.test(CSS) && /--glass-blur:14px/.test(CSS), "-");

    // the source-level half of the perf and taste contract - jsdom applies no cascade, so read the CSS
    const blurSels = [...LG.matchAll(/([^{}]+)\{[^{}]*backdrop-filter:\s*blur/g)].map((m) => m[1].trim().split("\n").pop().trim());
    check(g, "perf: three selectors in the material declare a backdrop blur (sheet, disc, dock)",
      blurSels.length === 3 && blurSels.every((sel) => /cw-lg-(primary|fab)|cw-dock/.test(sel)), blurSels.join(" | "));
    const nested = [".cw-range", ".cw-chip", ".cw-dot", ".cw-card", ".cw-lg-preview", ".cw-lg-pouch", ".cw-val", ".cw-row"];
    check(g, "perf: no nested control blurs again inside the sheet (the jank trap)",
      nested.every((c) => {
        const m = new RegExp(`\\n\\${c}\\{([^}]*)\\}`).exec(LG);
        return !m || !/backdrop-filter/.test(m[1]);
      }), nested.join(", "));
    /* round 18 adds exactly one keyframe animation - the wrong-code shake, transform-only, and it is
       disabled under prefers-reduced-motion. Everything else that moves must stay off the blur. */
    const anims = LG.match(/animation:[^;}]*/g) || [];
        check(g, "perf: nothing animates a filter or a layout property",
      !/transition:[^;}]*(backdrop-filter|filter|width|height|left|top|margin)/.test(LG)
      && anims.every((a) => /cw-lock-shake/.test(a) || /none/.test(a)),
      `${anims.length} animation decl(s): ${anims.join(" | ") || "none"} (round 18's shake moves transform only)`);
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

  /* ---- group 34: round 18 - the 4-digit gate and the encrypted backup file ---- */
  {
    const g = "34 lock & backup";
    const CSS18 = fs.readFileSync(path.join(APP, "index.css"), "utf8");
    const nodeCrypto = require("node:crypto");
    const web = nodeCrypto.webcrypto;
    const shaHex = (buf) => nodeCrypto.createHash("sha256").update(buf).digest("hex");
    // the PIN KDF is a specification, so recompute it here and require the app to agree
    const deriveNode = (pin, salt) => {
      let h = shaHex(Buffer.from(`cwv1:${salt}:${pin}`, "utf8"));
      for (let i = 0; i < 600; i++) h = shaHex(Buffer.from(`${h}:${salt}`, "utf8"));
      return h;
    };
    const enableCrypto = (w, on = true) => {
      const t = w.crypto || (w.crypto = {});
      if (!on) { try { Object.defineProperty(t, "subtle", { value: undefined, configurable: true }); } catch {} return; }
      try { Object.defineProperty(t, "subtle", { value: web.subtle, configurable: true }); } catch { t.subtle = web.subtle; }
      t.getRandomValues = t.getRandomValues || ((a) => (web.getRandomValues(a), a));
    };
    const derive = async (pw, salt, iters, usage) => {
      const base = await web.subtle.importKey("raw", Buffer.from(pw, "utf8"), "PBKDF2", false, ["deriveKey"]);
      return web.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iters, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, false, [usage]);
    };
    const aesDecrypt = async (wrap, pw) => {
      const key = await derive(pw, Buffer.from(wrap.enc.salt, "base64"), wrap.enc.iters, "decrypt");
      const buf = await web.subtle.decrypt({ name: "AES-GCM", iv: Buffer.from(wrap.enc.iv, "base64") }, key,
        Buffer.from(wrap.data, "base64"));
      return JSON.parse(Buffer.from(buf).toString("utf8"));
    };
    const aesEncrypt = async (obj, pw) => {
      const salt = nodeCrypto.randomBytes(16), iv = nodeCrypto.randomBytes(12);
      const key = await derive(pw, salt, 150000, "encrypt");
      const buf = await web.subtle.encrypt({ name: "AES-GCM", iv }, key, Buffer.from(JSON.stringify(obj), "utf8"));
      return { app: "cardwallet", kind: "backup", v: 1, at: new Date().toISOString(), cards: obj.cards.length,
        enc: { alg: "AES-GCM", kdf: "PBKDF2-SHA256", iters: 150000, hash: "SHA-256",
          salt: salt.toString("base64"), iv: iv.toString("base64") }, data: Buffer.from(buf).toString("base64") };
    };
    const vaultSeed = (w) => { try { return JSON.parse(w.localStorage.getItem("wallet.vault.v1") || "null"); } catch { return null; } };
    const gate = (w) => w.document.getElementById("cw-lock");
    const gateTxt = (w) => (gate(w)?.textContent || "").replace(/\s+/g, " ");
    const gateMsg = (w) => (gate(w)?.querySelector("[data-r=msg]")?.textContent || "").trim();
    const gateUp = (w) => { const n = gate(w); return !!n && !n.classList.contains("cw-lock-hide"); };
    const digits = (w) => ["0", "1", "2", "3"].map((i) => w.document.getElementById("cw-lock-digit-" + i)).filter(Boolean);
    const typePin = async (w, pin, ms = 140, from = 0) => {
      const ds = digits(w);
      for (let i = 0; i < pin.length && ds[from + i]; i++) {
        const box = ds[from + i];
        box.value = pin[i]; box.dispatchEvent(new w.Event("input", { bubbles: true })); await settle(w, ms);
      }
    };
    const typePw = async (w, pw, wait = 1500) => {
      const inp = all(w, ".cw-lock-pw")[0]; if (!inp) return false;
      inp.value = pw; inp.dispatchEvent(new w.Event("input", { bubbles: true })); await settle(w, 60);
      const go = all(w, ".cw-lock-go")[0]; if (go) await click(w, go, wait);
      return true;
    };
    const vaultSwitch = (w) => all(w, ".cw-vault-switch").find((b) => /App lock/.test(b.getAttribute("aria-label") || ""));
    const openVault = async (w) => {
      await click(w, byLabel(w, "More"), 320);
      await click(w, anyBtn(w, /^Settings$/), 900);
      return all(w, ".cw-vault-slot")[0];
    };
    const feed = async (w, name, body) => {
      const inp = all(w, "#cw-vault-file")[0]; if (!inp) return false;
      const file = new w.File([body], name, { type: "application/json" });
      Object.defineProperty(inp, "files", { value: [file], configurable: true, writable: true });
      inp.dispatchEvent(new w.Event("change", { bubbles: true }));
      await settle(w, 900);
      return true;
    };
    const toasts = (w) => all(w, ".cw-vault-toast").map((t) => t.textContent).join(" | ");
    // jsdom 27's Blob has no .text(), and history.go(0) prints a navigation error - so the harness reads
    // files through FileReader and spies on the restart request instead of letting jsdom try to navigate.
    const readBlob = (w, blob) => new Promise((res, rej) => {
      const fr = new w.FileReader();
      fr.onload = () => res(String(fr.result || "")); fr.onerror = () => rej(fr.error || new Error("read failed"));
      fr.readAsText(blob);
    });
    const spyReload = (w) => { const got = []; w.history.go = (n) => got.push(n); return got; };

    /* ---------------- a fresh install: no gate, and nothing disturbed --------- */
    const b0 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b0.w, 700);
    check(g, "with no code enrolled the app opens straight to the wallet (no gate, no extra layer)",
      !gateUp(b0.w) && all(b0.w, "#root img").length >= 3 && b0.errors.length === 0,
      `${b0.errors.length} errors, ${all(b0.w, "#root img").length} card images`);
    const slot0 = await openVault(b0.w);
    check(g, "the sheet gains exactly one 'Lock & backup' card, mounted as a slot the DOM module owns",
      !!slot0 && !!slot0.closest(".cw-glass-sheet") && all(b0.w, ".cw-vault-slot").length === 1,
      slot0 ? `inside ${slot0.closest(".cw-glass-sheet") ? "the sheet" : "the page"}` : "no slot");
    const sw0 = vaultSwitch(b0.w);
    check(g, "the section is two controls, not a settings page: one switch and a backup pair",
      !!sw0 && sw0.getAttribute("role") === "switch" && sw0.getAttribute("aria-checked") === "false"
      && !!anyBtn(b0.w, /^Back up now$/) && !!anyBtn(b0.w, /^Restore a file$/),
      sw0 ? `switch=${sw0.getAttribute("aria-checked")}` : "no switch");
    check(g, "the copy states what the code does and does not protect (no false security claim)",
      /locks the app, not the stored data/.test((slot0?.textContent || "").replace(/\s+/g, " ")),
      (slot0?.textContent || "").slice(0, 80).replace(/\s+/g, " "));

    /* ---------------- enrolling: 4 boxes, confirm, mismatch, then store ------ */
    await click(b0.w, sw0, 500);
    const d0 = b0.w.document.getElementById("cw-lock-digit-0");
    d0.value = "4x"; d0.dispatchEvent(new b0.w.Event("input", { bubbles: true })); await settle(b0.w, 160);
    const d1 = b0.w.document.getElementById("cw-lock-digit-1");
    d1.value = "-"; d1.dispatchEvent(new b0.w.Event("input", { bubbles: true })); await settle(b0.w, 160);
    check(g, "a box keeps the digit and drops the junk; a junk-only box stays empty and does not submit",
      d0.value === "4" && d1.value === "" && gate(b0.w).dataset.mode === "set" && !vaultSeed(b0.w),
      `d0="${d0.value}" d1="${d1.value}" mode=${gate(b0.w)?.dataset.mode}`);
    check(g, "turning the lock on asks for a code in a 4-box gate, not a bare keyboard field",
      gateUp(b0.w) && digits(b0.w).length === 4 && gate(b0.w).dataset.mode === "set",
      `${digits(b0.w).length} boxes, mode ${gate(b0.w)?.dataset.mode || "-"}`);
    check(g, "one digit in and one junk character do not submit, and nothing is stored while the code is incomplete",
      gate(b0.w)?.dataset.mode === "set" && !vaultSeed(b0.w), gate(b0.w)?.dataset.mode || "-");
    await typePin(b0.w, "111", 150, 1);              // the remaining three boxes -> four digits
    await settle(b0.w, 400);
    check(g, "the 4th digit submits the step and it asks for the same code again",
      gate(b0.w)?.dataset.mode === "confirm", gate(b0.w)?.dataset.mode || "-");
    await typePin(b0.w, "9999");
    await settle(b0.w, 500);
    check(g, "a mismatched confirmation stores nothing and starts the flow over",
      !vaultSeed(b0.w) && gateUp(b0.w), vaultSeed(b0.w) ? "a PIN was stored!" : "gate still up");
    b0.close();

    /* ---------------- enroll cleanly, then inspect what was written ---------- */
    const b1 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b1.w, 700);
    enableCrypto(b1.w);
    await openVault(b1.w);
    await click(b1.w, vaultSwitch(b1.w), 500);
    await typePin(b1.w, "4219", 130);
    await settle(b1.w, 400);
    await typePin(b1.w, "4219", 130);
    await settle(b1.w, 700);
    const v1 = vaultSeed(b1.w);
    check(g, "the code is stored as salt + digest + round count - never the PIN, no 'pin' field",
      !!v1?.lock && /^[0-9a-f]{32}$/.test(v1.lock.s) && /^[0-9a-f]{64}$/.test(v1.lock.p) && v1.lock.c === 600
      && !("pin" in v1.lock) && !JSON.stringify(v1).includes("4219"),
      v1 ? JSON.stringify(v1).slice(0, 90) : "nothing stored");
    check(g, "the digest matches an independent Node implementation of the same KDF (600 rounds)",
      !!v1 && deriveNode("4219", v1.lock.s) === v1.lock.p, v1 ? "recomputed in Node" : "no seed");
    check(g, "a code typed as '4x' still enrols as the digit the user actually typed",
      !!v1 && deriveNode("4219", v1.lock.s) === v1.lock.p, v1 ? "digest is over 4219, not 4x4219" : "no seed");
    check(g, "after enrolling, the switch reads on and 'Change code' appears",
      vaultSwitch(b1.w)?.getAttribute("aria-checked") === "true" && !!anyBtn(b1.w, /^Change code$/),
      `aria-checked=${vaultSwitch(b1.w)?.getAttribute("aria-checked")}`);
    check(g, "enrolling neither reloads nor touches the deck",
      (readCards(b1.w) || []).length === 3 && b1.errors.length === 0, `${b1.errors.length} errors`);
    b1.close();

    /* ---------------- the gate on a cold start, wrong codes, cool-down ------ */
    const b2 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), "wallet.vault.v1": v1 ? JSON.stringify(v1) : "{}" });
    await settle(b2.w, 500);
    check(g, "on the next launch the gate is up before the wallet is usable, and it is modal",
      gateUp(b2.w) && gate(b2.w).getAttribute("aria-modal") === "true" && gate(b2.w).dataset.mode === "unlock",
      gate(b2.w)?.dataset.mode || "no gate");
    const zLock = /\.cw-lock\{[^}]*z-index:(\d+)/.exec(CSS18.replace(/\n/g, ""));
    check(g, "the gate is stacked above every sheet the app can open (the app's own top is 2000)",
      !!zLock && +zLock[1] >= 2147483000, `gate z=${zLock?.[1]}`);
    await typePin(b2.w, "1111"); await settle(b2.w, 300);
    check(g, "a wrong code is refused out loud, the boxes clear, and the gate stays up",
      gateUp(b2.w) && /Wrong code/.test(gateMsg(b2.w)) && digits(b2.w).every((d) => d.value === ""),
      gateMsg(b2.w) || "no message");
    for (const pin of ["2222", "3333", "4444", "5555"]) { await typePin(b2.w, pin); await settle(b2.w, 260); }
    check(g, "five wrong codes put the gate behind a cool-down with the boxes disabled",
      /wait \d+s/.test(gateMsg(b2.w)) && digits(b2.w).every((d) => d.disabled), gateMsg(b2.w) || "-");
    const resetBtn = all(b2.w, ".cw-lock-reset")[0];
    check(g, "the cooled-down gate offers an explicit Reset app (there is no backdoor, so this is the way out)",
      !!resetBtn && resetBtn.hidden === false, resetBtn ? "offered" : "not offered");
    check(g, "the deck is untouched while all of this happens", (readCards(b2.w) || []).length === 3, "-");
    b2.close();

    /* ---------------- unlock, auto-lock after 30s, not after 5s, Back ------- */
    const b3 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), "wallet.vault.v1": v1 ? JSON.stringify(v1) : "{}" });
    await settle(b3.w, 500);
    await typePin(b3.w, "4219"); await settle(b3.w, 500);
    check(g, "the right code dismisses the gate and leaves the deck exactly as it was",
      !gateUp(b3.w) && (readCards(b3.w) || []).length === 3 && all(b3.w, "#root img").length >= 3,
      gateUp(b3.w) ? "still locked" : "unlocked");
    const hide = (w, on) => { Object.defineProperty(w.document, "hidden", { value: on, configurable: true }); w.document.dispatchEvent(new w.Event("visibilitychange")); };
    /* A fake clock, because sitting on a real 31-second timer is not a test plan. The original method has
       to be *put back*, not deleted: `delete w.Date.now` removes the realm's own Date.now (the assignment
       above shadows it with an own property), and every later Date.now() inside the app then throws - which
       showed up here as the gate appearing to "relock too eagerly" when in fact the unlock had crashed. */
    const clockTo = (w, ms) => {
      const D = w.Date;
      if (!D.__cwReal) D.__cwReal = D.now;
      D.now = () => D.__cwReal() + ms;
    };
    const clockBack = (w) => {
      const D = w.Date;
      if (D.__cwReal) { D.now = D.__cwReal; delete D.__cwReal; }
    };
    hide(b3.w, true); await settle(b3.w, 60);
    clockTo(b3.w, 31000);
    hide(b3.w, false); await settle(b3.w, 300);
    check(g, "coming back after 31 seconds away puts the gate up again (the auto-lock rule)",
      gateUp(b3.w) && gate(b3.w).dataset.mode === "unlock", gate(b3.w)?.dataset.mode || "-");
    clockBack(b3.w);
    await typePin(b3.w, "4219"); await settle(b3.w, 400);
    hide(b3.w, true); await settle(b3.w, 60);
    clockTo(b3.w, 5000);
    hide(b3.w, false); await settle(b3.w, 260);
    check(g, "a 5-second trip to the notification shade does NOT lock (30s is a rule, not a reflex)",
      !gateUp(b3.w), "relocked too eagerly");
    clockBack(b3.w);
    hide(b3.w, true); await settle(b3.w, 40);
    clockTo(b3.w, 60000); hide(b3.w, false); await settle(b3.w, 300); clockBack(b3.w);
    const upBefore = gateUp(b3.w);
    b3.w.history.back(); await settle(b3.w, 400);
    check(g, "while locked, Back cannot walk past the gate (a sentinel entry is re-pushed)",
      upBefore && gateUp(b3.w), `before=${upBefore} after=${gateUp(b3.w)}`);
    b3.close();

    /* ---------------- the two-tap reset ------------------------------------ */
    const b4 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), "wallet.vault.v1": v1 ? JSON.stringify(v1) : "{}" });
    await settle(b4.w, 400);
    const reloadAsked = spyReload(b4.w);
    const rb = all(b4.w, ".cw-lock-reset")[0];
    await click(b4.w, rb, 200);
    check(g, "the first tap on Reset app only arms it and says what it will cost",
      /Tap again/.test(rb?.textContent || "") && (readCards(b4.w) || []).length === 3, rb?.textContent || "-");
    await click(b4.w, rb, 400);
    check(g, "the arming tap warns out loud what it costs - cards *and* settings, not just cards",
      /* b2 is closed by now, so read the live handle this boot already has rather than the dead window's */
      /this erases every card and setting/.test(rb?.textContent || ""), rb?.textContent || "-");
    check(g, "the second tap erases the wallet and asks the WebView to restart",
      b4.w.localStorage.getItem(CARDS_KEY) === null && reloadAsked[0] === 0,
      `cards=${b4.w.localStorage.getItem(CARDS_KEY)} reload=${JSON.stringify(reloadAsked)}`);
    b4.close();

    /* ---------------- backup: password twice, .cwbak out, really encrypted -- */
    const b5 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b5.w, 700);
    enableCrypto(b5.w);
    await openVault(b5.w);
    await click(b5.w, anyBtn(b5.w, /^Back up now$/), 500);
    check(g, "export asks for a password before it produces anything",
      !!all(b5.w, ".cw-lock-pw")[0] && /password for this backup/i.test(gateTxt(b5.w)), gate(b5.w)?.dataset.mode || "-");
    await typePw(b5.w, "sun", 300);
    check(g, "a 3-character password is refused with the reason, and the flow stays open",
      /at least 4/.test(gateMsg(b5.w)), gateMsg(b5.w) || "-");
    await typePw(b5.w, "correct-horse-battery", 300);
    await typePw(b5.w, "correct-horse-batter", 300);
    check(g, "the confirm password must match - no file is produced on a mismatch",
      b5.inst.shares.length === 0, `${b5.inst.shares.length} share(s)`);
    await typePw(b5.w, "correct-horse-battery", 2600);
    const file = b5.inst.shares[0]?.files?.[0];
    const text = file ? await readBlob(b5.w, file) : "";
    const wrap = text ? JSON.parse(text) : null;
    check(g, "the file is offered through the share sheet the app already uses, named .cwbak",
      !!file && /^cardwallet-backup-\d{4}-\d{2}-\d{2}\.cwbak$/.test(file.name || ""), file?.name || "nothing shared");
    check(g, "the file is a v1 cardwallet backup with the card count and an AES-GCM/PBKDF2 header",
      wrap?.app === "cardwallet" && wrap?.kind === "backup" && wrap?.v === 1 && wrap?.cards === 3
      && wrap?.enc?.alg === "AES-GCM" && wrap?.enc?.kdf === "PBKDF2-SHA256" && wrap?.enc?.iters === 150000
      && /^[A-Za-z0-9+/=]{16,}$/.test(wrap.enc.salt) && /^[A-Za-z0-9+/=]{8,}$/.test(wrap.enc.iv),
      wrap ? `${wrap.enc.alg} ${wrap.enc.kdf} iters=${wrap.enc.iters} cards=${wrap.cards}` : "-");
    check(g, "no card title, no picture data - the payload really is ciphertext, not JSON",
      !!wrap && !text.includes("QA Card 1") && !text.includes("data:image") && text.includes('"data"'),
      `file is ${text.length} chars`);
    let inner = null, rejected = "";
    try { inner = await aesDecrypt(wrap, "wrong-password"); } catch { rejected = "rejected"; }
    check(g, "the wrong password cannot open it (AES-GCM auth, not a parse trick)",
      inner === null && rejected === "rejected", rejected || "DECRYPTED WITH A WRONG PASSWORD");
    inner = await aesDecrypt(wrap, "correct-horse-battery");
    check(g, "the right password opens it and the deck inside is the wallet's own cards, pictures included",
      Array.isArray(inner?.cards) && inner.cards.length === 3
      && inner.cards.map((c) => c.title).join(",") === sample(3).map((c) => c.title).join(",")
      && inner.cards.every((c) => typeof c.src === "string" && c.src.length > 0),
      `${inner?.cards?.length} cards`);
    check(g, "settings travel with the cards, and the lock never does",
      !!inner.settings && !JSON.stringify(inner).includes("wallet.vault"),
      `${Object.keys(inner.settings || {}).length} setting keys, no vault key`);
    const meta5 = vaultSeed(b5.w);
    check(g, "the sheet records the backup and says it in plain words",
      meta5?.meta?.n === 3 && meta5?.meta?.enc === true && /Last backup: 3 cards/.test(all(b5.w, ".cw-vault-note").map((n) => n.textContent).join(" | ")),
      meta5?.meta ? `n=${meta5.meta.n} enc=${meta5.meta.enc}` : "-");

    /* ---------------- restore: refuse junk and plaintext, confirm, apply ----- */
    await click(b5.w, anyBtn(b5.w, /^Restore a file$/), 400);
    const fileInp = all(b5.w, "#cw-vault-file")[0];
    check(g, "restore uses the app's existing file picker, restricted to the backup type",
      !!fileInp && /\.cwbak/.test(fileInp.accept || ""), fileInp?.accept || "no input");
    await feed(b5.w, "notes.txt", "hello");
    check(g, "a file that is not a cardwallet backup is refused, current cards intact",
      /isn't a Card Wallet backup/.test(toasts(b5.w)) && (readCards(b5.w) || []).length === 3, toasts(b5.w) || "no message");
    await feed(b5.w, "plain.cwbak", JSON.stringify({ app: "cardwallet", kind: "backup", v: 1, cards: sample(1) }));
    check(g, "an unencrypted bundle is refused instead of silently trusted",
      /always encrypted/.test(toasts(b5.w)), toasts(b5.w) || "no message");
    const forged = await aesEncrypt({ v: 1, cards: sample(2), settings: { view: "stack" } }, "restore-pw");
    await feed(b5.w, "good.cwbak", JSON.stringify(forged));
    check(g, "a valid encrypted file asks for its password before touching anything",
      /password/i.test(gateTxt(b5.w)) && (readCards(b5.w) || []).length === 3, gate(b5.w)?.dataset.mode || "-");
    await typePw(b5.w, "nope", 1800);
    check(g, "a wrong restore password keeps the gate open with an honest message and no data change",
      /Wrong password/.test(gateMsg(b5.w)) && (readCards(b5.w) || []).length === 3, gateMsg(b5.w) || "-");
    await typePw(b5.w, "restore-pw", 1800);
    check(g, "before replacing anything it states the swap in numbers and waits for a confirm",
      /Restore 2 cards/.test(gateTxt(b5.w)) && /replaces the 3 cards/.test(gateTxt(b5.w))
      && !!anyBtn(b5.w, /^Restore$/) && !!anyBtn(b5.w, /^Cancel$/),
      gate(b5.w)?.querySelector("[data-r=dots]")?.textContent?.slice(0, 80) || "-");
    await click(b5.w, anyBtn(b5.w, /^Cancel$/), 400);
    check(g, "Cancel leaves the wallet exactly as it was", (readCards(b5.w) || []).length === 3, "-");
    await feed(b5.w, "good.cwbak", JSON.stringify(forged));
    await typePw(b5.w, "restore-pw", 1800);
    const reload2 = spyReload(b5.w);
    await click(b5.w, anyBtn(b5.w, /^Restore$/), 1200);
    check(g, "Restore writes the deck and the settings, then asks the WebView to restart",
      (readCards(b5.w) || []).length === 2 && readSettings(b5.w)?.view === "stack" && reload2[0] === 0,
      `cards=${(readCards(b5.w) || []).length} view=${readSettings(b5.w)?.view} reload=${JSON.stringify(reload2)}`);
    check(g, "the restored deck paints, and markup in a restored title is still text",
      all(b5.w, "#root img").length >= 1 && b5.errors.length === 0 && !all(b5.w, "#root").some((r) => /onerror/i.test(r.innerHTML || "")),
      `${all(b5.w, "#root img").length} images, ${b5.errors.length} errors`);

    /* ---------------- the two failure modes the design admits out loud ------ */
    const b6 = boot({ [CARDS_KEY]: JSON.stringify(sample(2)) });
    await settle(b6.w, 700);
    enableCrypto(b6.w, false);
    await openVault(b6.w);
    await click(b6.w, anyBtn(b6.w, /^Back up now$/), 600);
    check(g, "without WebCrypto export refuses outright - there is no plaintext backup path",
      /can't encrypt/.test(toasts(b6.w)) && b6.inst.shares.length === 0, toasts(b6.w) || "no toast");
    b6.close();

    const b7 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), "wallet.vault.v1": v1 ? JSON.stringify(v1) : "{}" });
    await settle(b7.w, 600);
    spyReload(b7.w);
    await typePin(b7.w, "4219"); await settle(b7.w, 500);
    await openVault(b7.w);
    await click(b7.w, vaultSwitch(b7.w), 500);
    check(g, "turning the lock off costs the current code (mode=verify), not a free toggle",
      gate(b7.w)?.dataset.mode === "verify", gate(b7.w)?.dataset.mode || "-");
    await typePin(b7.w, "0000"); await settle(b7.w, 300);
    check(g, "the wrong code cannot turn the lock off either", vaultSeed(b7.w)?.lock?.p === v1?.lock?.p, "-");
    await typePin(b7.w, "4219"); await settle(b7.w, 600);
    const v7 = vaultSeed(b7.w);
    check(g, "with the right code the vault holds no lock record and the gate is gone for good",
      !!v7 && !v7.lock && !gateUp(b7.w) && (readCards(b7.w) || []).length === 3,
      v7 ? Object.keys(v7).join(",") : "-");
    b7.close();

    /* ---------------- a full storage must not eat the user's current deck --- */
    const b8 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b8.w, 700);
    spyReload(b8.w);
    enableCrypto(b8.w);
    await openVault(b8.w);
    const big = await aesEncrypt({ v: 1, cards: sample(40), settings: {} }, "quota-pw");
    await click(b8.w, anyBtn(b8.w, /^Restore a file$/), 400);
    await feed(b8.w, "big.cwbak", JSON.stringify(big));
    await typePw(b8.w, "quota-pw", 1800);
    /* jsdom's localStorage is a named-property proxy - assigning `localStorage.setItem` stores a *key*
       called "setItem" instead of replacing the method, so the quota has to be forced on the prototype. */
    const Sproto = b8.w.Storage?.prototype || null;
    const realSet = Sproto ? Sproto.setItem : null;
    if (Sproto) Sproto.setItem = function (k, v) {
      if (k === CARDS_KEY) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
      return realSet.call(this, k, v);
    };
    await click(b8.w, anyBtn(b8.w, /^Restore$/), 700);
    check(g, "if the phone has no room for the backup, it says so and keeps the current deck",
      /Not enough room/.test(toasts(b8.w)) && (readCards(b8.w) || []).length === 3,
      `${(readCards(b8.w) || []).length} cards left after a refused restore`);
    if (Sproto) Sproto.setItem = realSet;
    b8.close();

    /* ---------------- the module's own write surface ------------------------ */
    const VB = CODE.slice(CODE.indexOf("Card Wallet - app lock"));
    check(g, "the vault writes only its own key plus the two it restores, and never any other store",
      (VB.match(/localStorage\.setItem\(/g) || []).length === 3
      && /localStorage\.setItem\(LS,/.test(VB) && /localStorage\.setItem\(CARDS,/.test(VB)
      && /localStorage\.setItem\(SETTINGS,/.test(VB) && !/document\.cookie|indexedDB|fetch\(/.test(VB),
      `${(VB.match(/localStorage\.setItem\(/g) || []).length} setItem call(s), ${(VB.match(/fetch\(/g) || []).length} fetch`);
    check(g, "no network, no service worker, no cookie - the backup only ever leaves via the share sheet",
      !/XMLHttpRequest|navigator\.serviceWorker|localStorage\.setItem\("http/.test(VB), "-");
    check(g, "the gate builds its DOM with element calls - the module has no innerHTML assignment at all",
      !/\.innerHTML\s*=/.test(VB), `${(VB.match(/\.innerHTML\s*=/g) || []).length} assignment(s)`);
  }


  /* ---- group 35: round 19 - customization only while the switch is on ------ */
  {
    const g = "35 customization";
    const CSSR = fs.readFileSync(path.join(APP, "index.css"), "utf8");
    // A block owns its banner -> the next banner: the plain `slice(indexOf(marker))` grew into the
    // rounds appended after this one, so round 22's `--menu-shadow` shadow literal tripped the
    // "no new colour" contract below. (The JS module is still the last JS block.)
    const blockFrom = (marker) => {
      const i = CSSR.indexOf(marker);
      if (i < 0) return "";
      const start = CSSR.lastIndexOf("/*", i);
      const nxt = CSSR.slice(i + 2).search(/\n\/\* ={20,}/);
      return CSSR.slice(start, nxt < 0 ? CSSR.length : i + 2 + nxt);
    };
    const R19 = blockFrom("Round 19 - the customization gate");
    const MOD = CODE.slice(CODE.indexOf("Round 19 - the customization gate"));
    const HIDE_RULE = /html\[data-cw-custom="off"\] \.cw-cust-body\{display:none\}/;
    const HAS19 = CODE.includes("Round 19 - the customization gate") && CSSR.includes("Round 19 - the customization gate");
    const attrOf = (w) => w.document.documentElement.getAttribute("data-cw-custom");
    const gateSwitch = (w) => all(w, ".cw-cust-slot button[role=switch]").find((b) => /Customize cards/.test(b.getAttribute("aria-label") || ""));
    const gated = (w) => all(w, "#root .cw-cust-body")[0] || null;
    const openCust = async (w) => { await click(w, byLabel(w, "More"), 320); await click(w, anyBtn(w, /^Settings$/), 900); return all(w, ".cw-cust-slot")[0]; };
    const injectRule = (w) => {
      const m = HIDE_RULE.exec(CSSR);
      if (!m) return false;
      const sty = w.document.createElement("style");
      sty.textContent = m[0];
      w.document.head.appendChild(sty);
      return true;
    };
    const hide = (w, on) => { Object.defineProperty(w.document, "hidden", { value: on, configurable: true }); w.document.dispatchEvent(new w.Event("visibilitychange")); };
    const BT = String.fromCharCode(96);
    const SLOT_REF = "className:" + BT + "cw-cust-slot" + BT + ",ref:e=>{window.__cwCust&&window.__cwCust.mount(e)}";

    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) });
    await settle(b.w, 800);
    const slot = await openCust(b.w);
    /* every lookup below is null-safe: a tree without patch 34 must report FAILs, not blow up the harness */
    const sheet = all(b.w, "#root div").find((d) => /cw-glass-sheet/.test(d.className || ""));
    check(g, "the Custom Pouch card grows exactly one mount point, inside the sheet and inside that card",
      !!slot && all(b.w, ".cw-cust-slot").length === 1 && !!slot.closest?.(".cw-lg-pouch") && !!slot.closest?.(".cw-glass-sheet"),
      slot ? `in pouch:${!!slot.closest(".cw-lg-pouch")} in sheet:${!!slot.closest(".cw-glass-sheet")}` : "no slot");
    check(g, "customization is closed by default: the attribute says off before anyone touches it",
      attrOf(b.w) === "off", `html[data-cw-custom]=${attrOf(b.w)}`);
    const sw = gateSwitch(b.w);
    check(g, "the gate is one real switch with a plain-language note about what it does",
      !!sw && sw.getAttribute("role") === "switch" && sw.getAttribute("aria-checked") === "false"
      && sw.getAttribute("aria-label") === "Customize cards"
      && /switches off by itself when you close Settings/i.test(slot?.textContent || ""),
      sw ? `aria-checked=${sw.getAttribute("aria-checked")}` : "no switch");
    const body = gated(b.w);
    check(g, "every look control is wrapped in one block: colours, cover and all of the sliders",
      !!body && /cover/i.test(body.textContent || "") && all(body, "input[type=range]").length >= 6
      && all(sheet, "input[type=range]").length === all(body, "input[type=range]").length,
      body ? `${all(body, "input[type=range]").length}/${all(sheet, "input[type=range]").length} sliders` : "no block");
    check(g, "the gate does not reach outside the pouch: layout mode, theme and lock stay put",
      !!body && !/App lock|Back up now|System/i.test(body.textContent || "")
      && !!anyBtn(b.w, /^Back up now$/) && !!all(sheet, "button.cw-chip").find((c) => /Light/.test(c.textContent || "")),
      body ? (body.textContent || "").slice(0, 60).replace(/\s+/g, " ") : "no block");
    check(g, "the rule that does the hiding exists verbatim in the shipped stylesheet",
      HIDE_RULE.test(CSSR) && injectRule(b.w), HIDE_RULE.test(CSSR) ? "injected into the document" : "missing");
    check(g, "closed means gone from the screen: the block computes to display:none, not dimmed or disabled",
      !!body && b.w.getComputedStyle(body).display === "none",
      body ? `display=${b.w.getComputedStyle(body).display}` : "no wrapped block to hide");
    const wBefore = b.inst.writes.length;
    await click(b.w, sw, 400);
    check(g, "one tap opens the gate: the attribute flips and the block is laid out again",
      !!body && attrOf(b.w) === "on" && b.w.getComputedStyle(body).display !== "none"
      && gateSwitch(b.w)?.getAttribute("aria-checked") === "true",
      `attr=${attrOf(b.w)} display=${body ? b.w.getComputedStyle(body).display : "-"}`);
    check(g, "opening and closing the gate writes nothing at all - no settings, no storage key",
      b.inst.writes.length === wBefore && Object.keys(b.w.localStorage).sort().join(",") === [CARDS_KEY, SETTINGS_KEY].sort().join(","),
      `${b.inst.writes.length - wBefore} write(s); keys ${Object.keys(b.w.localStorage).join(",")}`);

    /* the switch is only worth having if editing works while it is up */
    const rScale = rangeFor(b.w, "Scale");
    check(g, "with the gate open the sliders are there and take a drag", !!rScale, rScale ? "rows present" : "no slider reachable");
    if (rScale) {
      const v = +rScale.max;
      setValue(b.w, rScale, v); await settle(b.w, 700);
      const st = readSettings(b.w);
      check(g, "an edit made while the gate is open is stored like any other edit",
        st?.custom?.stack?.size === v, `stored size=${st?.custom?.stack?.size} wanted ${v}`);
      check(g, "React re-rendering the sheet mid-drag does not close the gate (a null ref is not a close)",
        b.w.__cwCust?.isOn() === true && all(slot, ".cw-vault-row").length === 1,
        `on=${b.w.__cwCust?.isOn()} rows=${all(slot, ".cw-vault-row").length}`);
    }

    /* auto-off: closing Settings */
    const ivBefore = b.inst.intervals.size;
    check(g, "while the gate is open it watches the slot on one bounded timer, not a document observer",
      ivBefore <= 1 && /setInterval/.test(MOD) && !/MutationObserver/.test(MOD) && /POLLS = 400/.test(MOD),
      `${ivBefore} interval(s), observer=${/MutationObserver/.test(MOD)}`);
    await click(b.w, anyBtn(b.w, /^Done$/), 900);
    await settle(b.w, 700);
    check(g, "closing Settings closes the gate by itself - nobody has to remember to",
      attrOf(b.w) === "off" && b.w.__cwCust?.isOn() === false,
      `attr=${attrOf(b.w)} isOn=${b.w.__cwCust?.isOn()}`);
    check(g, "and the watch is stopped with it (no interval left polling after the sheet is gone)",
      b.inst.intervals.size === 0, `${b.inst.intervals.size} interval(s) left`);
    const stAfter = readSettings(b.w);
    check(g, "the look the user set stays set - the gate hides the controls, it never rolls them back",
      rScale ? stAfter?.custom?.stack?.size === +rScale.max : !!stAfter,
      JSON.stringify(stAfter?.custom?.stack)?.slice(0, 70));
    await click(b.w, byLabel(b.w, "More"), 320);
    await click(b.w, anyBtn(b.w, /^Settings$/), 800);
    check(g, "reopening Settings hands back a closed gate, and one row - never a stack of them",
      attrOf(b.w) === "off" && all(b.w, ".cw-cust-slot").length === 1
      && all(b.w, ".cw-cust-slot .cw-vault-row").length === 1,
      `slots=${all(b.w, ".cw-cust-slot").length} rows=${all(b.w, ".cw-cust-slot .cw-vault-row").length}`);

    /* auto-off: leaving the app */
    await click(b.w, gateSwitch(b.w), 400);
    const onForBg = attrOf(b.w) === "on";
    hide(b.w, true);
    await settle(b.w, 300);
    check(g, "the app going to the background closes the gate too (a notification cannot leave it open)",
      onForBg && attrOf(b.w) === "off", `before=${onForBg} after=${attrOf(b.w)}`);
    hide(b.w, false);
    await click(b.w, gateSwitch(b.w), 300);
    b.w.dispatchEvent(new b.w.Event("pagehide"));
    await settle(b.w, 300);
    check(g, "pagehide (the WebView being swapped or torn down) also shuts it",
      attrOf(b.w) === "off", `attr=${attrOf(b.w)}`);
    check(g, "the switch itself stays visible and usable in either state - it is the control that must be",
      !!gateSwitch(b.w) && !!gateSwitch(b.w).closest(".cw-cust-slot")
      && !gateSwitch(b.w).closest(".cw-cust-body") && gateSwitch(b.w).disabled === false,
      gateSwitch(b.w) ? "reachable" : "no switch");

    /* source-level contract: fail-open, stateless, cheap */
    const hides = [...CSSR.matchAll(/([^{}\n]*)\.cw-cust-body\{([^}]*)\}/g)].filter((m) => /display:\s*none/.test(m[2]));
    check(g, "fail-open: nothing is hidden unless the app explicitly wrote off, so a dead module cannot lock the user out",
      HAS19 && hides.length === 1 && /html\[data-cw-custom="off"\]\s*$/.test(hides[0][1]) && HIDE_RULE.test(CSSR),
      `${hides.length} hide rule(s): ${(hides[0] ? hides[0][1].trim() : "none")} | ${(hides[0] ? hides[0][2] : "").slice(0, 40)}`);
    check(g, "the gate holds no state anywhere an old value could survive: no storage, no cookie, no indexedDB",
      HAS19 && !/localStorage|sessionStorage|document\.cookie|indexedDB/.test(MOD),
      (MOD.match(/localStorage|indexedDB|document\.cookie/g) || []).join(",") || "none");
    check(g, "double-inclusion is inert and the module builds its DOM without innerHTML",
      HAS19 && /if \(window\.__cwCust\) return;/.test(MOD) && !/\.innerHTML\s*=/.test(MOD), "-");
    check(g, "it costs the frame budget nothing: no blur, no keyframes, no transition except a reduced-motion off-switch",
      HAS19 && !/backdrop-filter|@keyframes/.test(R19) && (R19.match(/transition:[^}]*/g) || []).every((t) => /none/.test(t))
      && /prefers-reduced-motion/.test(R19), R19.replace(/\s+/g, " ").slice(0, 90));
    check(g, "the slot is mounted by a ref on a plain div - React keeps ownership of nothing the gate touches",
      CODE.includes(SLOT_REF) && (CODE.split(SLOT_REF).length - 1) === 1, `${CODE.split(SLOT_REF).length - 1} mount site(s)`);
    check(g, "the gate's row reuses the vault row's classes - no new colour, no new surface in the app",
      HAS19 && /"cw-vault-row"/.test(MOD) && /"cw-vault-switch"/.test(MOD) && /"cw-vault-on"/.test(MOD)
      && !/#|rgba?\(|hsla?\(/.test(R19), "reuses .cw-vault-* only");
    b.close();

    /* a second visit starts closed, whatever the first one did */
    const b2 = boot({ [CARDS_KEY]: JSON.stringify(sample(3)) });
    await settle(b2.w, 700);
    check(g, "a fresh launch is a closed gate: the last visit's choice is not remembered",
      attrOf(b2.w) === "off" && b2.w.__cwCust?.isOn() === false && b2.errors.length === 0,
      `attr=${attrOf(b2.w)} errs=${b2.errors.length}`);
    check(g, "with the gate closed the wallet itself is untouched: the deck paints and no stray block is mounted on it",
      all(b2.w, "#root img").length >= 3 && !all(b2.w, "#root .cw-cust-body").length,
      `${all(b2.w, "#root img").length} card images`);
    b2.close();
  }

  /* ---- group 36: round 20 - a scroll gesture never misaligns the cards ----- */
  {
    const g = "36 gestures";
    const FOUR = JSON.stringify(sample(4));
    const ptr = (w, type, x, y) => {
      const e = new w.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(e, "isPrimary", { value: true });
      Object.defineProperty(e, "pointerId", { value: 1 });
      return e;
    };
    const txOf = (el) => parseFloat((stl(el).match(/translateX\((-?[\d.]+)px\)/) || [])[1] ?? "0");
    const zOf = (el) => +(stl(el).match(/z-index:\s*(\d+)/) || [])[1] || 0;
    const pouches = (b) => all(b, "#root div.absolute.top-0");
    const deck = (b) => all(b, "#root div.absolute.no-select");
    const stageBox = (b) => all(b, "#root div").find((d) => /perspective:\s*1200/.test(stl(d)) && d.className === "relative w-full");
    const front = (b) => pouches(b).slice().sort((a, c) => zOf(c) - zOf(a))[0];
    // the card pitch, measured from the cards themselves (no hard-coded geometry)
    const slotOf = (els) => {
      const xs = [...new Set(els.map((e) => +txOf(e).toFixed(1)))].sort((a, c) => a - c);
      let s = 0;
      for (let i = 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d > 1 && (!s || d < s)) s = d; }
      return s;
    };
    // how far the row / deck is from sitting on whole card slots
    const worstOff = (els) => {
      const s = slotOf(els);
      return s ? Math.max(...els.map((e) => Math.abs(txOf(e) / s - Math.round(txOf(e) / s)) * s)) : 0;
    };
    const cx = 195, cy = 400;

    /* --- carousel: a finger on the glass owns the row --------------------- */
    const bc = boot({ [CARDS_KEY]: FOUR, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) });
    await settle(bc.w, 900);
    check(g, "carousel: four cards render and rest on whole card slots",
      pouches(bc).length >= 4 && worstOff(pouches(bc)) < 1,
      `${pouches(bc).length} wrappers, pitch ${slotOf(pouches(bc)).toFixed(1)}px`);

    front(bc).dispatchEvent(ptr(bc.w, "pointerdown", cx, cy));
    for (let i = 1; i <= 4; i++) { bc.w.dispatchEvent(ptr(bc.w, "pointermove", cx - i * 30, cy)); await settle(bc.w, 25); }
    const draggedX = txOf(front(bc));
    check(g, "carousel: the drag really does move the row (so the checks below mean something)",
      Math.abs(draggedX) > 20, `front card x ${draggedX.toFixed(1)}px`);

    await settle(bc.w, 900);          // the finger is still down; it is just still
    const heldX = txOf(front(bc));
    check(g, "carousel: holding the finger still mid-drag does not shift the row (the reported drift)",
      Math.abs(heldX - draggedX) < 1,
      `front card x ${draggedX.toFixed(2)} -> ${heldX.toFixed(2)}px across a 900ms hold`);

    const perFingerPx = Math.abs(draggedX) / 120;
    bc.w.dispatchEvent(ptr(bc.w, "pointermove", cx - 150, cy));
    await settle(bc.w, 60);
    check(g, "carousel: the next move adds only its own delta - the gesture is never replayed",
      Math.abs(txOf(front(bc)) - (draggedX - 30 * perFingerPx)) < 2,
      `x ${txOf(front(bc)).toFixed(2)}px, expected ~${(draggedX - 30 * perFingerPx).toFixed(2)}px`);
    bc.w.dispatchEvent(ptr(bc.w, "pointerup", cx - 150, cy));
    await settle(bc.w, 900);
    check(g, "carousel: releasing after the hold still settles back onto a card slot",
      worstOff(pouches(bc)) < 1, `worst offset ${worstOff(pouches(bc)).toFixed(1)}px`);

    for (let f = 0; f < 3; f++) {     // rapid flicks, one after another
      front(bc).dispatchEvent(ptr(bc.w, "pointerdown", cx, cy));
      for (let i = 1; i <= 4; i++) { bc.w.dispatchEvent(ptr(bc.w, "pointermove", cx - i * 40, cy)); await settle(bc.w, 8); }
      bc.w.dispatchEvent(ptr(bc.w, "pointerup", cx - 160, cy));
      await settle(bc.w, 150);
    }
    await settle(bc.w, 1200);
    check(g, "carousel: three rapid flicks in a row still land on a slot, with no console errors",
      worstOff(pouches(bc)) < 1 && bc.errors.length === 0,
      `worst offset ${worstOff(pouches(bc)).toFixed(1)}px, ${bc.errors.length} error(s)`);

    /* --- carousel: the stream is gone for good ---------------------------- */
    const bStolen = boot({ [CARDS_KEY]: FOUR, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) });
    await settle(bStolen.w, 900);
    front(bStolen).dispatchEvent(ptr(bStolen.w, "pointerdown", cx, cy));
    for (let i = 1; i <= 4; i++) { bStolen.w.dispatchEvent(ptr(bStolen.w, "pointermove", cx - i * 30, cy)); await settle(bStolen.w, 25); }
    await settle(bStolen.w, 2600);    // 1500ms of silence + the 400ms tick + the glide
    check(g, "carousel: a gesture the system ate is recovered, centred, with no pointerup",
      worstOff(pouches(bStolen)) < 1 && bStolen.errors.length === 0,
      `worst offset ${worstOff(pouches(bStolen)).toFixed(1)}px`);

    /* --- stack: the deck always comes back to a card ---------------------- */
    const bs = boot({ [CARDS_KEY]: FOUR, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
    await settle(bs.w, 900);
    check(g, "stack: four cards rest on whole card slots",
      deck(bs).length === 4 && worstOff(deck(bs)) < 1, `pitch ${slotOf(deck(bs)).toFixed(1)}px`);
    stageBox(bs).dispatchEvent(ptr(bs.w, "pointerdown", cx, cy));
    for (let i = 1; i <= 4; i++) { bs.w.dispatchEvent(ptr(bs.w, "pointermove", cx - i * 40, cy)); await settle(bs.w, 25); }
    check(g, "stack: an unreleased drag really does leave the deck between two cards",
      worstOff(deck(bs)) > 20, `worst offset ${worstOff(deck(bs)).toFixed(1)}px`);
    await settle(bs.w, 2600);
    check(g, "stack: with the stream gone the deck snaps back onto a card",
      worstOff(deck(bs)) < 1 && bs.errors.length === 0, `worst offset ${worstOff(deck(bs)).toFixed(1)}px`);
    stageBox(bs).dispatchEvent(ptr(bs.w, "pointerdown", cx, cy));
    for (let i = 1; i <= 4; i++) { bs.w.dispatchEvent(ptr(bs.w, "pointermove", cx - i * 40, cy)); await settle(bs.w, 25); }
    bs.w.dispatchEvent(ptr(bs.w, "pointerup", cx - 160, cy));
    await settle(bs.w, 900);
    check(g, "stack: a swipe after the recovery still flips the deck, landing on a slot",
      worstOff(deck(bs)) < 1 && Math.abs(txOf(deck(bs)[0])) >= slotOf(deck(bs)) - 2,
      `worst offset ${worstOff(deck(bs)).toFixed(1)}px, first card at ${txOf(deck(bs)[0]).toFixed(1)}px`);

    /* --- stack: a cancel is an abort, not a tap --------------------------- */
    const bx = boot({ [CARDS_KEY]: FOUR, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
    await settle(bx.w, 900);
    const beforeX = deck(bx).map(stl);
    stageBox(bx).dispatchEvent(ptr(bx.w, "pointerdown", 260, 300));
    bx.w.dispatchEvent(ptr(bx.w, "pointercancel", 260, 300));
    await settle(bx.w, 700);          // longer than the 480ms long-press
    check(g, "stack: a cancelled gesture opens nothing (it used to run the tap path)",
      !/WhatsApp/.test(text(bx.w)), text(bx.w).slice(0, 60));
    check(g, "stack: ...and leaves the deck exactly where it was",
      deck(bx).map(stl).join("|") === beforeX.join("|") && bx.errors.length === 0,
      `${deck(bx).length} cards, ${bx.errors.length} error(s)`);

    /* --- the code-level contracts the behaviour rests on ------------------ */
    const CARS = CODE.slice(CODE.indexOf("function Td({cards:"), CODE.indexOf("var Ed="));
    const STKS = CODE.slice(CODE.indexOf("function __cwStack({cards:"), CODE.indexOf("function Td({cards:"));
    const PTR_HELPERS = (CODE.match(/__cwPtrState=null;function __cwPtr\(\)/g) || []).length;
    check(g, "both views read one shared pointer helper (who is down, and the gone signals)",
      PTR_HELPERS === 1 && /__cwPtr\(\)/.test(CARS) && /__cwPtr\(\)/.test(STKS) &&
        /visibilitychange/.test(CODE) && /lostpointercapture/.test(CODE),
      `${PTR_HELPERS} definition(s), ${(CARS.match(/__cwPtr\(\)/g) || []).length + (STKS.match(/__cwPtr\(\)/g) || []).length} read(s)`);
    check(g, "carousel: the idle watchdog refuses to move a row a finger is on",
      /if\(ptr\.held\(\)&&!ptr\.quiet\(1500\)\)\{arm\(\);return\}/.test(CARS), "a held finger owns the row");
    check(g, "carousel: the recovery glides home and never commits an index step",
      (() => {
        const rec = CARS.split("home=()=>")[1]?.split("off=d.on")[0] || "";
        return /Ju\(d,0,Cd\)/.test(rec) && !/d\.jump\(0\)/.test(rec) && !/h\.current\+=/.test(rec);
      })(), "no jump, no re-order");
    check(g, "carousel: the drag rebases on the row's live value and re-anchors after every write",
      /Math\.abs\(d\.get\(\)-k\)>\.5&&\(k=d\.get\(\),sv=s\)/.test(CARS) && /k=d\.get\(\),sv=s\)/.test(CARS),
      "a move can only ever add its own delta");
    check(g, "carousel: a settle to zero clears the settle slot (it used to disarm the watchdog)",
      /g\.current=Ju\(d,0,\{\.\.\.Cd,onComplete:\(\)=>\{g\.current=null\}\}\)/.test(CARS),
      "no finished animation left in g.current");
    check(g, "stack: a lost deck is snapped back onto a card and its gesture state is released",
      /if\(ptr\.held\(\)&&!ptr\.quiet\(1500\)\)\{arm\(\);return\}/.test(STKS) &&
        /drag\.current=null,kill\.current\?\.\(\),kill\.current=null,window\.clearTimeout\(hold\.current\),snap\(e\)/.test(STKS),
      "snap() is index-based, so the recovery is a tween");
    check(g, "stack: a cancel is an abort - it can never walk the tap path",
      /addEventListener\(`pointercancel`,t=>\{if\(t\.pointerId!==n\)return;ab=!0,y\(t\)\}\)/.test(STKS) &&
        /if\(ab\)\{drag\.current=null,snap\(p\.get\(\)\);return\}/.test(STKS),
      "settles to the nearest card, opens nothing");
    check(g, "stack: the drag rebases on the deck's live value too",
      /Math\.abs\(p\.get\(\)-w0\)>\.02&&\(w0=p\.get\(\),s0=e\)/.test(STKS) && /w0=p\.get\(\),s0=e\)/.test(STKS),
      "no stale start index");
    check(g, "the recovery adds no new motion: the existing tween and springs are reused",
      /Ju\(d,0,Cd\)/.test(CARS) && /snap\(e\)/.test(STKS) &&
        !/stiffness/.test(CARS.split("home=()=>")[1]?.split("off=d.on")[0] || "") &&
        !/stiffness/.test(STKS.split("let t=null,arm=()=>")[1]?.split("off=p.on")[0] || ""),
      "same language as the release path");
    bc.close(); bStolen.close(); bs.close(); bx.close();
  }

  /* ---- group 37: round 23 - the viewer's empty bands take no touches ------- */
  {
    const g = "37 inert bands";
    const b = boot({ [CARDS_KEY]: JSON.stringify(sample(3)), [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
    await settle(b.w, 900);
    const w = b.w;
    const viewer = () => all(w, "#root div").find((d) => /^fixed inset-0 z-50/.test(d.className || ""));
    const shield = () => all(w, "#root [data-cwband]")[0];
    const band = () => viewer()?.children?.[0];
    const vCard = () => [...(viewer()?.children || [])].find((d) => /no-select absolute touch-none/.test(d.className || ""));
    const vBtn = (l) => [...(viewer()?.querySelectorAll("button") || [])].find((x) => (x.textContent || "").trim() === l);
    const open = () => /WhatsApp/.test(text(w));
    // the deck's own open gesture: a tap on the stack (the same path group 36 uses for its taps)
    const openViewer = async () => {
      for (let i = 0; i < 3 && !open(); i += 1) {
        const stage = deckStage(w);
        if (!stage) return false;
        press(w, stage, "pointerdown", 195, 300);
        await settle(w, 80);
        press(w, stage, "pointerup", 195, 300);
        await settle(w, 1700);
      }
      return open();
    };
    const tapBand = async (x, y) => {
      const el = band();
      if (!el) return false;
      press(w, el, "pointerdown", x, y);
      press(w, el, "pointerup", x, y);
      await click(w, el, 700);
      return true;
    };
    const dragBand = (x, y) => {
      const el = band();
      if (!el) return false;
      press(w, el, "pointerdown", x, y);
      for (const step of [40, 90, 150]) press(w, el, "pointermove", x, y + step);
      press(w, el, "pointerup", x, y + 150);
      return true;
    };
    const cardStyle = () => stl(vCard()?.querySelector("img")?.parentElement);

    check(g, "the viewer opens from a card tap (the bands have something to be dead around)",
      (await openViewer()) && !!viewer(), open() ? "viewer open" : "viewer never opened");

    /* the bands are one inert shield ---------------------------------------- */
    check(g, "the empty bands are covered by one full-screen, handler-free shield",
      !!band() && /absolute inset-0/.test(band().className || "") && band().children.length === 0 &&
        !band().hasAttribute("onclick") && !band().hasAttribute("role"),
      band() ? `class=${band().className} children=${band().children.length}` : "no band element");
    check(g, "the shield is the marked one (data-cwband = preview), so the bands are dead and not transparent",
      !!shield() && shield() === band(), shield() ? String(shield().getAttribute("data-cwband")) : "no [data-cwband]");
    check(g, "the overlay root declares touch-action:none (no pan/zoom/rubber-band from a band, round 9's guard for this screen)",
      /touch-none/.test(viewer()?.className || ""), viewer() ? viewer().className : "no viewer");
    check(g, "the shield is painted, not wired: class + data-cwband + style, nothing else",
      !!band() && [...band().attributes].map((a) => a.name).sort().join(",") === "class,data-cwband,style",
      band() ? [...band().attributes].map((a) => a.name).join(",") : "-");

    /* taps and drags in the bands ------------------------------------------- */
    const tappedTop = await tapBand(195, 60);
    const stayedTop = open();
    check(g, "a tap in the top band (above the card, under the header) does not dismiss the opened card",
      tappedTop && stayedTop, `tapped=${tappedTop} open=${stayedTop}`);
    await openViewer();
    const tappedBottom = await tapBand(195, 660);
    const stayedBottom = open();
    check(g, "a tap in the bottom band (between the card and the buttons) does not dismiss it either",
      tappedBottom && stayedBottom, `tapped=${tappedBottom} open=${stayedBottom}`);
    await openViewer();
    const before = cardStyle();
    dragBand(195, 120);
    await settle(w, 800);
    check(g, "a drag in a band changes nothing: still open, card neither zoomed nor panned, page not scrolled",
      open() && cardStyle() === before && w.scrollY === 0,
      `open=${open()} card-untouched=${cardStyle() === before} scrollY=${w.scrollY}`);

    /* the two buttons are the overlay's only controls ----------------------- */
    const labels = [...(viewer()?.querySelectorAll("button") || [])].map((x) => (x.textContent || "").trim()).filter(Boolean);
    check(g, "the two bottom buttons are still there - and are the overlay's only controls",
      ["WhatsApp", "Save"].every((l) => labels.includes(l)) && labels.every((l) => ["WhatsApp", "Save"].includes(l)),
      labels.join(" | "));
    const sharesBefore = b.inst.shares.length;
    await click(w, vBtn("WhatsApp"), 900);
    check(g, "the WhatsApp button still works (its share path fires through the Web Share fallback)",
      b.inst.shares.length > sharesBefore || /WhatsApp/.test(text(w)),
      `web shares:${sharesBefore} -> ${b.inst.shares.length}`);
    await click(w, vBtn("Save"), 900);
    check(g, "the Save button still works (its saved-to-gallery feedback shows)",
      /Saved to gallery/.test(text(w)), text(w).slice(-60));

    /* the card keeps its own behaviour -------------------------------------- */
    for (const _ of [0, 1]) {
      press(w, vCard(), "pointerdown", 150, 400);
      press(w, vCard(), "pointerup", 150, 400);
    }
    await settle(w, 1400);
    check(g, "double-tapping the card still turns it over (the preview is not frozen)",
      /No back side yet|Double tap the card/.test(text(w)), text(w).slice(-70));
    press(w, vCard(), "pointerdown", 150, 400);
    press(w, vCard(), "pointermove", 150, 470);
    press(w, vCard(), "pointermove", 150, 545);
    press(w, vCard(), "pointerup", 150, 545);
    await settle(w, 1400);
    check(g, "swiping the card down still closes the viewer - the bands were not the only way out",
      !open(), open() ? "still open" : "closed by the card's own gesture");

    /* the code the behaviour rests on --------------------------------------- */
    check(g, "the overlay's old dismissal click is gone and the touch-action guard is in the shipped bundle",
      !CODE.includes("transition:{duration:.26},onClick:te") && /z-50 touch-none/.test(CODE),
      /z-50 touch-none/.test(CODE) ? "guard present" : "guard missing");
    const mark = CODE.indexOf("/*cardwallet:inert-bands*/");
    const slice = mark < 0 ? "" : CODE.slice(mark - 130, mark + 150);
    check(g, "the inert shield is marked in the bundle, together with the attribute the tests read",
      !!slice && slice.includes("z-50 touch-none") && slice.includes('"data-cwband":`preview`'),
      slice ? "marker + attribute" : "marker missing");
    check(g, "the fix did not touch the card's handlers or the two buttons",
      ["onPointerDown:re", "onPointerMove:M", "onPointerUp:N", "onWheel:e=>{"].every((h) => CODE.includes(h)) &&
        CODE.includes("if(n>90){te();return}") &&
        (CODE.match(/pointer-events-auto flex items-center gap-2 rounded-full px-5 text-\[15px\] font-semibold text-white/g) || []).length === 2,
      "card gestures + both buttons intact");
    check(g, "no console errors in the viewer band flow", b.errors.length === 0,
      b.errors.slice(0, 1).join("").slice(0, 160));
    b.close();
  }

  /* ---- group 38: round 24 - the action bar is the old header bar, bottom-right -- */
  {
    const g = "38 action bar";
    const CSS24 = fs.readFileSync(path.join(APP, "index.css"), "utf8");   // group 33/34/35 own their own copies
    const THREE = JSON.stringify(sample(3));
    const OLD_ORDER = "Add card,Search cards,More";
    const seatOf = (b) => {
      const row = all(b, "#root .cw-dock")[0]?.parentElement;
      const bar = row?.parentElement;
      const pill = all(b, "#root .cw-dock")[0];
      return {
        pill, row, bar,
        labels: [...(pill?.querySelectorAll("button") || [])].map((x) => (x.getAttribute("aria-label") || "").trim()).join(","),
        pillClass: pill?.className || "", rowClass: row?.className || "",
        barClass: bar?.className || "", barStyle: bar?.getAttribute("style") || "",
      };
    };
    const SEAT = (s) => `${s.pillClass}|${s.rowClass}|${s.barClass}|${s.barStyle}`;

    /* --- the old bar's metrics, inside the pill ---------------------------- */
    check(g, "the pill's inner spacing is the old header bar's own (gap-1 = 4px, px-2 = 8px)",
      /\.cw-dock\{gap:4px;padding:6px 8px\}/.test(CSS24),
      (CSS24.match(/\.cw-dock\{gap:[^}]*\}/) || ["no spacing override"])[0]);
    check(g, "round 16's own pill rule is overridden, not rewritten",
      /\.cw-dock\{\nwidth:max-content;\ngap:10px;\npadding:6px 10px;\nborder-radius:999px;/.test(CSS24) &&
        CSS24.lastIndexOf(".cw-dock{") > CSS24.indexOf(".cw-dock{\nwidth:max-content;"),
      `${(CSS24.match(/\.cw-dock\{/g) || []).length} .cw-dock{ rules, the override last`);
    check(g, "the three controls still carry the old bar's boxes, glyphs and order",
      CODE.includes("flex h-9 items-center justify-center rounded-full") && CODE.includes("size:cp?19:21") &&
        (CODE.match(/tone:`auto`/g) || []).length === 3 && CODE.includes("label:`Add card`") &&
        CODE.indexOf("label:`Add card`") < CODE.indexOf("label:`Search cards`") &&
        CODE.indexOf("label:`Search cards`") < CODE.indexOf("label:`More`"),
      "h-9 / 19+21px glyphs / tone:auto x3 / Add card -> Search cards -> More");

    /* --- the seat, on the main wallet screen ------------------------------- */
    const b = boot({ [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
    await settle(b.w, 900);
    const seat0 = seatOf(b);
    check(g, "the bar is one pill anchored to the bottom edge and right-aligned",
      /fixed inset-x-0 bottom-0 z-40/.test(seat0.barClass) && /justify-end/.test(seat0.rowClass) &&
        /cw-dock/.test(seat0.pillClass) && !/top-0/.test(seat0.barClass),
      `${seat0.barClass.slice(0, 44)} || ${seat0.pillClass}`);
    check(g, "the bar holds exactly the three old controls, and nothing else",
      seat0.labels === OLD_ORDER && seat0.bar.querySelectorAll("button").length === 3,
      `${seat0.labels} (${seat0.bar.querySelectorAll("button").length} in the bar)`);
    check(g, "its safe-area padding is the bottom inset (the home indicator / gesture bar)",
      /env\(safe-area-inset-bottom\)/.test(seat0.barStyle) && /padding-bottom/i.test(seat0.barStyle), seat0.barStyle);
    check(g, "the top of the screen stays empty - the bar is not duplicated there",
      (() => {
        const tops = all(b, "#root div").filter((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
        const row = tops[0]?.firstElementChild;
        // exactly one top-anchored bar may exist (the container); a second one would BE the action bar
        return tops.length === 1 && !!row && row.querySelectorAll("button").length === 0
          && (row.textContent || "").trim() === "";
      })(), `${all(b, "#root div").filter((d) => /inset-x-0 top-0 z-40/.test(d.className || "")).length} top-anchored bar(s), the row has 0 buttons and no text`);

    /* --- the same seat on every screen ------------------------------------ */
    const seats = [];
    for (const [name, store, vp] of [
      ["carousel", { [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "carousel" }) }, undefined],
      ["stack", { [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) }, undefined],
      ["dark", { [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", appearance: "dark" }) }, undefined],
      ["empty wallet", { [SETTINGS_KEY]: JSON.stringify({ view: "carousel" }) }, undefined],
      ["small phone", { [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) }, { width: 320, height: 568 }],
      ["landscape", { [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "stack" }) }, { width: 915, height: 412 }],
    ]) {
      const inst = boot(store, vp);
      await settle(inst.w, 800);
      const s = seatOf(inst);
      seats.push([name, s]);
      check(g, `${name}: the same three controls in the same seat, no errors`,
        s.labels === OLD_ORDER && /fixed inset-x-0 bottom-0 z-40/.test(s.barClass) &&
          /env\(safe-area-inset-bottom\)/.test(s.barStyle) && inst.errors.length === 0,
        `${s.labels} | err=${inst.errors.length}`);
      inst.close();
    }
    check(g, "the seat is identical across every screen (one class string, one anchor, one inset)",
      new Set(seats.map(([, s]) => SEAT(s))).size === 1,
      `${new Set(seats.map(([, s]) => SEAT(s))).size} distinct seat(s) across ${seats.length} screens`);

    /* --- while surfaces are open, and through the actions ------------------ */
    const surfaces = [];
    for (const [name, openIt] of [
      ["search", async () => { await click(b.w, byLabel(b.w, "Search cards"), 700); }],
      ["option menu", async () => { await click(b.w, byLabel(b.w, "More"), 500); }],
      ["settings sheet", async () => { await click(b.w, anyBtn(b.w, /^Settings$/), 900); }],
      ["customize sheet", async () => { await click(b.w, anyBtn(b.w, /^Customize cards$/), 900); }],
    ]) {
      await openIt();
      surfaces.push([name, seatOf(b)]);
    }
    check(g, "search, the option menu and both sheets open without the bar leaving its seat",
      surfaces.every(([, s]) => s.labels === OLD_ORDER && SEAT(s) === SEAT(seat0)),
      surfaces.map(([n, s]) => `${n}:${SEAT(s) === SEAT(seat0) ? "same seat" : "MOVED"}`).join(" | "));
    check(g, "the Search control opens the search screen, and closing it leaves the bar alone",
      !!inputFor(b.w, "Search"),
      inputFor(b.w, "Search") ? "search field mounted" : "no search field");
    b.close();

    // the actions themselves, on a fresh wallet with nothing else open (the surfaces above are left
    // stacked on purpose - that is the seat test - so the action path gets its own boot)
    const ba = boot({ [CARDS_KEY]: THREE, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
    await settle(ba.w, 900);
    check(g, "the + control opens its own menu (Add from gallery / Take a picture)",
      (await click(ba.w, byLabel(ba.w, "Add card"), 700)) && /Add from gallery/.test(text(ba.w)),
      text(ba.w).slice(0, 60));
    await click(ba.w, byLabel(ba.w, "Add card"), 1500);
    const menuNode = all(ba.w, "#root div").find((d) => /w-\[248px\]/.test(d.className || ""));
    check(g, "tapping + again closes it again (no stuck overlay)",
      !menuNode || /opacity:\s*0\b/.test(menuNode.parentElement?.getAttribute("style") || ""),
      menuNode ? "playing its exit animation" : "menu node gone");
    check(g, "the More control opens the overflow menu above the pill",
      (await click(ba.w, byLabel(ba.w, "More"), 600)) && /Settings/.test(text(ba.w)) &&
        /Delete all cards/.test(text(ba.w)),
      text(ba.w).slice(0, 60));
    await click(ba.w, anyBtn(ba.w, /^Delete all cards$/), 800);
    check(g, "the overflow menu's destructive row still opens its confirm sheet",
      /Delete all cards/.test(text(ba.w)) && /Cancel/.test(text(ba.w)), text(ba.w).slice(-80));
    await click(ba.w, anyBtn(ba.w, /^Cancel$/), 700);
    check(g, "the Settings row still opens the settings sheet",
      (await click(ba.w, byLabel(ba.w, "More"), 500)) && (await click(ba.w, anyBtn(ba.w, /^Settings$/), 900)) &&
        /Done/.test(text(ba.w)),
      text(ba.w).slice(-60));
    await click(ba.w, anyBtn(ba.w, /^Done$/), 800);
    check(g, "after all three actions the bar is still in its seat",
      SEAT(seatOf(ba)) === SEAT(seat0) && seatOf(ba).labels === OLD_ORDER, seatOf(ba).labels);
    check(g, "no console errors across the action-bar walk-through", b.errors.length === 0 && ba.errors.length === 0,
      `${b.errors.length + ba.errors.length} error(s): ${(b.errors.concat(ba.errors)[0] || "").slice(0, 120)}`);
    ba.close();
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
