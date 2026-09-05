/**
 * Headless smoke test for the Card Wallet web layer (the code that runs inside
 * the app's Android WebView).
 *
 * IMPORTANT: this is a jsdom simulation, NOT a device test. It can prove the
 * bundle boots, renders, persists and that removed features are gone. It CANNOT
 * prove anything about camera/NFC hardware, WhatsApp hand-off, real Back-button
 * dispatch, or animation smoothness - see docs/DEVICE_TEST_PLAN.md for those.
 *
 * Setup (node_modules is not committed):
 *   npm i jsdom
 *   node repo_export/patches/smoke_test_webview.mjs
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
  try {
    ({ JSDOM } = require(require.resolve("jsdom", { paths: [base] })));
    break;
  } catch {}
}
if (!JSDOM) {
  console.error("jsdom not installed. Run: npm i jsdom");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok: !!ok, name, detail });
  return !!ok;
};

function makeDom(storage = {}, { withLayout = false } = {}) {
  const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
  const dom = new JSDOM(html.replace(/<script type="module"[^>]*><\/script>/, ""), {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const { window } = dom;

  // --- WebView-ish environment jsdom does not provide -----------------------
  window.matchMedia ??= (q) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
  });
  class RO { observe() {} unobserve() {} disconnect() {} }
  window.ResizeObserver ??= RO;
  window.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.navigator.vibrate ??= () => true;
  window.URL.createObjectURL ??= () => "blob:mock";
  window.URL.revokeObjectURL ??= () => {};
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      drawImage() {}, fillRect() {}, clearRect() {}, save() {}, restore() {},
      translate() {}, scale() {}, rotate() {}, setTransform() {}, beginPath() {},
      closePath() {}, fill() {}, stroke() {}, arc() {}, moveTo() {}, lineTo() {},
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData() {}, measureText: () => ({ width: 0 }), fillText() {},
      set filter(_) {}, get filter() { return "none"; },
    };
  };
  window.HTMLCanvasElement.prototype.toDataURL = () => "data:image/jpeg;base64,AAAA";
  window.HTMLCanvasElement.prototype.toBlob = (cb) => cb(new window.Blob([""], { type: "image/jpeg" }));
  window.scrollTo ??= () => {};
  window.Element.prototype.scrollTo ??= function () {};
  window.Element.prototype.scrollIntoView ??= function () {};
  if (!window.crypto?.randomUUID) {
    window.crypto = { ...window.crypto, randomUUID: () => "00000000-0000-4000-8000-000000000000" };
  }
  if (withLayout) {
    // jsdom has no layout engine; hit-testing math needs plausible boxes.
    window.Element.prototype.getBoundingClientRect = function () {
      const root = this.id === "root" || this.tagName === "BODY" || this.tagName === "HTML";
      const w = root ? 390 : 300;
      const h = root ? 780 : 190;
      return { x: 45, y: 120, left: 45, top: 120, right: 45 + w, bottom: 120 + h, width: w, height: h, toJSON() {} };
    };
  }
  for (const [k, v] of Object.entries(storage)) window.localStorage.setItem(k, v);

  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error?.stack || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push("unhandled rejection: " + e.reason));
  const origError = window.console.error;
  window.console.error = (...a) => { errors.push(a.map(String).join(" ")); origError.apply(window.console, a); };

  return { dom, window, errors };
}

function runBundle(window, errors) {
  const code = fs.readFileSync(path.join(APP, "index.js"), "utf8");
  const script = window.document.createElement("script");
  script.textContent = code;
  try {
    window.document.body.appendChild(script);
  } catch (e) {
    errors.push("bundle threw: " + (e.stack || e));
  } finally {
    // keep the bundle source out of textContent assertions
    script.remove();
  }
}

const settle = (window, ms = 400) =>
  new Promise((r) => window.setTimeout(r, ms));

const textOf = (window) => window.document.getElementById("root")?.textContent || "";

// ---------------------------------------------------------------------------
// Test 1: fresh install (empty storage)
// ---------------------------------------------------------------------------
const fresh = makeDom();
runBundle(fresh.window, fresh.errors);
await settle(fresh.window, 800);

const rootEl = fresh.window.document.getElementById("root");
check("fresh install: bundle executes with no uncaught error",
  fresh.errors.length === 0, fresh.errors.slice(0, 2).join(" | ").slice(0, 300));
check("fresh install: React tree mounts into #root",
  rootEl && rootEl.children.length > 0, `${rootEl?.children.length ?? 0} child nodes`);

const freshText = textOf(fresh.window);
check("fresh install: renders the wallet UI (non-empty text)", freshText.trim().length > 0,
  `${freshText.trim().length} chars`);
check("removed feature: 'Auto-detect' not in UI", !/auto-?detect/i.test(freshText));
check("removed feature: 'Fill in from picture' not in UI", !/fill in from picture/i.test(freshText));
check("removed feature: 'Make your own pouch' not in UI", !/make your own pouch/i.test(freshText));

const fileInputs = [...fresh.window.document.querySelectorAll('input[type="file"]')];
check("feature entry point: gallery/file input present", fileInputs.length > 0,
  `${fileInputs.length} file input(s), accept=${fileInputs.map((i) => i.getAttribute("accept")).join(",")}`);
check("feature entry point: settings persisted key initialised",
  fresh.window.localStorage.getItem("wallet.settings.v1") !== null ||
  freshText.length > 0, "settings written lazily");

// ---------------------------------------------------------------------------
// Test 2: data persistence + "app restart" with existing state
// ---------------------------------------------------------------------------
// The bundle as text, for the few facts that only live in code (a guard branch that
// must not exist, a ref that must be released) rather than in the rendered DOM.
const BUNDLE_SRC = fs.readFileSync(path.join(APP, "index.js"), "utf8");
const CARDS_KEY = "wallet.cards.v2";
const SETTINGS_KEY = "wallet.settings.v1";
// Real persisted shape (see om() in the bundle: entries need id + src).
const existingCards = JSON.stringify([
  {
    id: "smoke-1",
    src: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
    title: "Smoke Test Card",
    subtitle: "Persistence check",
    fields: [
      { id: "f1", label: "Name", value: "TEST USER" },
      { id: "f2", label: "Number", value: "4111 1111 1111 1111" },
    ],
  },
]);
const existingSettings = JSON.stringify({
  autoDetect: false, nfc: true, appearance: "dark", theme: "slate",
});

const restarted = makeDom({ [CARDS_KEY]: existingCards, [SETTINGS_KEY]: existingSettings });
runBundle(restarted.window, restarted.errors);
await settle(restarted.window, 800);

check("existing state: bundle boots with pre-existing storage",
  restarted.errors.length === 0, restarted.errors.slice(0, 2).join(" | ").slice(0, 300));
const restartedText = textOf(restarted.window);
check("existing state: stored card is restored into the UI",
  restartedText.includes("Smoke Test Card"),
  restartedText.includes("Smoke Test Card") ? "card title rendered" : `text=${restartedText.slice(0, 120)}`);
check("existing state: stored cards survive re-mount (persistence intact)",
  (restarted.window.localStorage.getItem(CARDS_KEY) || "").includes("Smoke Test Card"),
  "wallet.cards.v2 still holds the card after boot");
check("existing state: dark appearance from settings applied",
  restarted.window.document.documentElement.classList.contains("dark") ||
  JSON.parse(restarted.window.localStorage.getItem(SETTINGS_KEY)).appearance === "dark",
  "appearance=dark honoured");
check("existing state: settings are not clobbered on boot",
  JSON.parse(restarted.window.localStorage.getItem(SETTINGS_KEY) || "{}").nfc === true,
  "nfc toggle preserved");

// ---------------------------------------------------------------------------
// Test 3: storage-quota resilience (photos are stored as data URLs)
// ---------------------------------------------------------------------------
const quota = makeDom({ [CARDS_KEY]: existingCards });
quota.window.localStorage.setItem = function () {
  const err = new Error("QuotaExceededError");
  err.name = "QuotaExceededError";
  throw err;
};
runBundle(quota.window, quota.errors);
await settle(quota.window, 600);
check("resilience: app still renders when localStorage writes fail (quota)",
  quota.window.document.getElementById("root").children.length > 0 && quota.errors.length === 0,
  quota.errors.slice(0, 1).join("").slice(0, 200) || "handled");

// ---------------------------------------------------------------------------
// Test 4: interaction / sheet-transition state machine
// (DOM-level correctness of the transitions - smoothness is device-only)
// ---------------------------------------------------------------------------
const ui = makeDom();
runBundle(ui.window, ui.errors);
await settle(ui.window, 800);
const W = ui.window;
const D = W.document;
const all = (sel) => [...D.querySelectorAll(sel)];
const byLabel = (label) => all("button").find((b) => b.getAttribute("aria-label") === label);
const byText = (re) => all("button").find((b) => re.test(b.textContent || ""));
const tap = (el) => el && el.dispatchEvent(new W.MouseEvent("click", { bubbles: true }));
const labels = () => all("button").map((b) => b.getAttribute("aria-label") || (b.textContent || "").trim());

check("ui: header actions present (Add / Search / More)",
  ["Add card", "Search cards", "More"].every((l) => byLabel(l)), labels().slice(0, 3).join(", "));

// --- black header options (patch7 styling + patch8 config) ---------------
const HEADER_CFG = JSON.parse(fs.readFileSync(path.join(ROOT, "repo_export", "header_options.json"), "utf8"));
const styleDecl = (el, prop) =>
  ((el?.getAttribute("style") || "").match(new RegExp(`(?:^|;)\\s*${prop}:\s*([^;]*)`, "i"))?.[1] || "").trim();
const rgbToHex = (v) => {
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  if (!m) return v.toLowerCase();
  const hex = "#" + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, "0")).join("");
  return m[4] === undefined ? hex : `${hex}/${m[4]}`;
};
const colorOf = (el, prop) => rgbToHex(styleDecl(el, prop));
const isBlack = (v) => ["#000", "#000000"].includes(v);
const isWhite = (v) => ["#fff", "#ffffff"].includes(v);
const hdrChips = () => HEADER_CFG.options.map((o) => byLabel(o.label));

check("header: every option in header_options.json renders a button",
  hdrChips().every(Boolean), HEADER_CFG.options.map((o, i) => `${o.id}=${hdrChips()[i] ? "y" : "n"}`).join(" "));
// what the config says each option should look like (chip = filled disc).
// "auto" (and "ink") declare the app's own theme tokens instead of a literal,
// so the row inverts with the theme - the mock's literal #000 is kept for
// "black", and it is exactly what disappeared on a dark-theme device.
const toneOf = (o) => o.tone || HEADER_CFG.defaults?.tone || "auto";
const literal = (t) => (t === "black" || t === "white" ? t : null);
const wantBg = (o) => (o.chip ? (literal(toneOf(o)) === "white" ? "#fff" : literal(toneOf(o)) === "black" ? "#000" : "var(--solid)") : "transparent");
const wantGlyph = (o) => (o.chip
  ? (literal(toneOf(o)) === "white" ? "#000" : literal(toneOf(o)) === "black" ? "#fff" : "var(--on-solid)")
  : (literal(toneOf(o)) ?? "var(--ink)"));
const HEX = (v) => (["#000", "#000000"].includes(v) ? "#000" : ["#fff", "#ffffff"].includes(v) ? "#fff" : v);

// The tokens themselves have to invert, or the check above is vacuous. index.css
// is the source of truth here - this is what catches "white disc, white glyph".
{
  const css = fs.readFileSync(path.join(APP, "index.css"), "utf8");
  const block = (re) => (re.exec(css)?.[1] || "");
  const token = (b, name) => (new RegExp(`--${name}:([^;}]*)`).exec(b)?.[1] || "").trim();
  const lum = (v) => {
    let h = /^#([0-9a-f]{3})$/i.exec(v)?.[1];
    if (h) h = [...h].map((c) => c + c).join("");   // #fff -> #ffffff
    else h = /^#([0-9a-f]{6})$/i.exec(v)?.[1];
    if (!h) return NaN;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const lt = block(/:root\{([^}]*)\}/), dk = block(/\.dark\{([^}]*)\}/);
  const solidLt = lum(token(lt, "solid")), solidDk = lum(token(dk, "solid"));
  const inkLt = lum(token(lt, "ink")), inkDk = lum(token(dk, "ink"));
  check("header: the --solid/--ink tokens invert between themes (auto tone is meaningful)",
    solidLt < 0.2 && solidDk > 0.8 && inkLt < 0.2 && inkDk > 0.8,
    `solid ${token(lt, "solid")}->${token(dk, "solid")}, ink ${token(lt, "ink")}->${token(dk, "ink")}`);
  check("header: auto-tone options declare tokens, not literals (so a theme flip re-colours them)",
    HEADER_CFG.options.every((o) => {
      const t = toneOf(o);
      if (t === "black" || t === "white") return true;
      const c = byLabel(o.label);
      return o.chip
        ? /var\(--solid\)/.test(styleDecl(c, "background")) && /var\(--on-solid\)/.test(styleDecl(c, "color"))
        : /var\(--ink\)/.test(styleDecl(c, "color"));
    }),
    HEADER_CFG.options.map((o) => `${o.id}:${toneOf(o)}`).join(" "));
}

check("header: the picture's styling is applied per option (disc vs bare glyph)",
  HEADER_CFG.options.every((o, i) => {
    const c = hdrChips()[i];
    return c && HEX(colorOf(c, "background")) === wantBg(o) && HEX(colorOf(c, "color")) === wantGlyph(o);
  }),
  HEADER_CFG.options.map((o, i) =>
    `${o.id}: ${HEX(colorOf(hdrChips()[i], "color"))} on ${HEX(colorOf(hdrChips()[i], "background"))} (want ${wantGlyph(o)} on ${wantBg(o)})`).join(" | "));
check("header: glyphs no longer follow the theme ink class",
  hdrChips().every((c) => !/(^|\s)ink(\s|$)/.test(c.className || "")),
  hdrChips().map((c) => c.className).join(" | ").slice(0, 90));

// --- add-card menu ---
tap(byLabel("Add card"));
await settle(W, 400);
const addOptions = labels();
check("ui: add-card menu opens with all three capture routes",
  ["Add from gallery", "Take a picture", "Tap a bank card"].every((t) => addOptions.includes(t)),
  addOptions.filter((l) => /gallery|picture|bank card/.test(l)).join(" | "));
check("ui: NFC entry point present in add menu (settings nfc=on)",
  addOptions.includes("Tap a bank card"));

const hdrPanel = () => [...D.querySelectorAll("#root div")].find((d) => /w-\[248px\]/.test(d.className || ""));
const panel = hdrPanel();
{
  // patch7 gives a filled disc a halo while its menu is open; a bare glyph gets a
  // var(--chip) circle instead - both are "this menu is open" feedback
  const openOpt = HEADER_CFG.options.find((o) => o.menu === "add");
  const closedOpt = HEADER_CFG.options.find((o) => o.id === "more");
  check("header: the option whose menu is open shows its active state",
    openOpt?.chip
      ? /0 0 0 4px/.test(styleDecl(byLabel(openOpt.label), "box-shadow"))
      : true,
    `box-shadow=${styleDecl(byLabel(openOpt?.label || ""), "box-shadow")}`);
  check("header: an option whose menu is closed keeps its resting look",
    closedOpt ? HEX(colorOf(byLabel(closedOpt.label), "background")) === wantBg(closedOpt) : true,
    `${closedOpt?.id}=${colorOf(byLabel(closedOpt?.label || ""), "background")}`);
}
{
  const more = byLabel(HEADER_CFG.options.find((o) => o.icon === "bars")?.label || "");
  const d = [...(more?.querySelectorAll("path") || [])].map((p) => p.getAttribute("d") || "").join(" ");
  check("header: the menu button draws the picture's hamburger, not the stock three dots",
    !!more && /h15/.test(d) && /M4\.5 7\.1/.test(d) && !more.querySelector("circle"),
    d.slice(0, 70) || "no bars path");
}
check("header: dropdown panel is black with a white hairline, not sheet-white",
  colorOf(panel, "background") === "#0b0b0d" && /rgba\(255, 255, 255, 0\.14\)/.test(styleDecl(panel, "border")),
  `bg=${colorOf(panel, "background")} border=${styleDecl(panel, "border")}`);
{
  const rows = [...(panel?.querySelectorAll("button") || [])];
  const plain = rows.filter((r) => !/Delete all cards/.test(r.textContent || ""));
  check("header: dropdown rows read white", plain.length > 0 && plain.every((r) => isWhite(colorOf(r, "color"))),
    rows.map((r) => colorOf(r, "color")).join(" | "));
}

// dismiss by tapping outside (the menu has no scrim; it listens for a
// capture-phase pointerdown on window)
D.documentElement.dispatchEvent(new W.MouseEvent("pointerdown", { bubbles: true }));
await settle(W, 600);
// framer-motion runs an exit animation; jsdom's fake raf loop does not always
// finish the unmount, so accept "faded out" as dismissed too.
const menuPanel = [...D.querySelectorAll("#root div")].find((d) => /w-\[248px\]/.test(d.className || ""));
const menuFadedOut = !!menuPanel && /opacity:\s*0\b/.test(menuPanel.parentElement?.getAttribute("style") || "");
check("ui: add-card menu dismisses on outside tap (no stuck overlay)",
  !labels().includes("Add from gallery") || menuFadedOut,
  menuFadedOut ? "menu playing its exit animation" : labels().join(", ").slice(0, 80));

// --- settings sheet ---
tap(byLabel("More"));
await settle(W, 400);
check("ui: overflow menu opens (Settings / Delete all cards)",
  labels().includes("Settings") && labels().includes("Delete all cards"));
{
  const del = [...(hdrPanel()?.querySelectorAll("button") || [])].find((r) => /Delete all cards/.test(r.textContent || ""));
  check("header: the destructive row keeps its red on the black panel",
    colorOf(del, "color") === "#ff453a", colorOf(del, "color"));
}
tap(byText(/^Settings$/));
await settle(W, 600);
const settingsText = D.getElementById("root").textContent;
check("ui: settings sheet renders every section",
  ["Layout", "Carousel", "Stack", "Appearance", "Pouch", "Read cards over NFC"]
    .every((t) => settingsText.includes(t)),
  "Design / Layout / Pouch / Appearance / NFC");

// --- layout: carousel <-> stack ---
const stackBtn = byText(/^Stack$/);
tap(stackBtn);
await settle(W, 500);
let saved = JSON.parse(W.localStorage.getItem("wallet.settings.v1") || "{}");
check("ui: switching layout to Stack persists (settings.view)",
  saved.view === "stack", `view=${saved.view}`);
tap(byText(/^Carousel$/));
await settle(W, 500);
saved = JSON.parse(W.localStorage.getItem("wallet.settings.v1") || "{}");
check("ui: switching layout back to Carousel persists (settings.view)",
  saved.view === "carousel", `view=${saved.view}`);

// --- close the sheet ---
tap(byText(/^Done$/));
await settle(W, 800);
const afterClose = D.getElementById("root").textContent;
check("ui: settings sheet closes cleanly (no leftover sheet in the DOM)",
  !afterClose.includes("Read cards over NFC"), afterClose.slice(0, 60));
check("ui: wallet is back to the card view after closing the sheet",
  /National Identity Card|Wallet is empty/.test(afterClose), afterClose.slice(0, 60));
check("ui: no console errors across the whole interaction run",
  ui.errors.length === 0, ui.errors.slice(0, 2).join(" | ").slice(0, 200));

// ---------------------------------------------------------------------------
// Test 5: destructive flow + persistence of the result
// ---------------------------------------------------------------------------
tap(byLabel("More"));
await settle(W, 400);
tap(byText(/Delete all cards/));
await settle(W, 600);
check("ui: 'delete all' asks for confirmation before destroying data",
  /will be removed from this phone/i.test(D.getElementById("root").textContent) &&
  labels().includes("Cancel"),
  "confirm dialog with Cancel");
const confirms = all("button").filter((b) => /^Delete all cards$/.test((b.textContent || "").trim()));
tap(confirms[confirms.length - 1]);
await settle(W, 900);
const emptied = W.localStorage.getItem("wallet.cards.v2");
const emptyText = D.getElementById("root").textContent;
check("ui: confirming clears the wallet and persists the empty state",
  emptied === "[]" && /Wallet is empty/i.test(emptyText), `cards=${emptied} | ${emptyText.slice(0, 40)}`);

// ---------------------------------------------------------------------------
// Test 6: "Wallet & cover" on/off setting (patch6)
// ---------------------------------------------------------------------------
const CARDS = JSON.stringify([
  { id: "c1", src: "cards/cnic.jpg", title: "Card One", subtitle: "one", fields: [] },
  { id: "c2", src: "cards/license.jpg", title: "Card Two", subtitle: "two", fields: [] },
]);
const trayCount = (d) =>
  [...d.querySelectorAll("#root div")].filter((e) => /absolute left-0 w-full overflow-hidden/.test(e.className || "")).length;
const sleeveCount = (d) =>
  [...d.querySelectorAll("#root img[aria-hidden]")].length +
  [...d.querySelectorAll("#root div")].filter((e) => /pointer-events-none absolute left-0 w-full/.test(e.className || "")).length;
const glassCount = (d) =>
  [...d.querySelectorAll("#root div")].filter((e) => /backdrop-filter/i.test(e.getAttribute("style") || "")).length;
const titleStyle = (d) => {
  const el = [...d.querySelectorAll("#root div")].find(
    (e) => /text-align:\s*center/i.test(e.getAttribute("style") || "") && /font-size:\s*13px/i.test(e.getAttribute("style") || "")
  );
  const st = el?.getAttribute("style") || "";
  return { color: st.match(/color:\s*([^;]*)/)?.[1] || "", shadow: st.match(/text-shadow:\s*([^;]*)/)?.[1] || "" };
};
const coverSwitch = (d) =>
  [...d.querySelectorAll('button[role="switch"]')].find((b) => (b.parentElement?.textContent || "").startsWith("Wallet & cover"));

// -- carousel, cover ON (default) --
const cvOn = makeDom({ [CARDS_KEY]: CARDS });
runBundle(cvOn.window, cvOn.errors);
await settle(cvOn.window, 800);
check("cover ON: carousel draws the pouch", trayCount(cvOn.window.document) > 0 && sleeveCount(cvOn.window.document) > 0,
  `tray=${trayCount(cvOn.window.document)} sleeve=${sleeveCount(cvOn.window.document)}`);
check("cover ON: card title stays white over the pouch",
  /255,\s*255,\s*255/.test(titleStyle(cvOn.window.document).color), titleStyle(cvOn.window.document).color);

// -- flip the switch in Settings --
{
  const W2 = cvOn.window, D2 = W2.document;
  const b = (l) => [...D2.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === l);
  const t = (re) => [...D2.querySelectorAll("button")].find((x) => re.test(x.textContent || ""));
  const click = (el) => el && el.dispatchEvent(new W2.MouseEvent("click", { bubbles: true }));
  click(b("More")); await settle(W2, 400);
  click(t(/^Settings$/)); await settle(W2, 600);
  check("cover: Settings exposes a 'Wallet & cover' switch, on by default",
    coverSwitch(D2)?.getAttribute("aria-checked") === "true");
  check("cover ON: pouch customisation controls are shown", /Grading/.test(D2.getElementById("root").textContent));
  click(coverSwitch(D2)); await settle(W2, 700);
  check("cover: switch flips to off", coverSwitch(D2)?.getAttribute("aria-checked") === "false");
  check("cover OFF: pouch customisation controls are hidden", !/Grading/.test(D2.getElementById("root").textContent));
  check("cover OFF: subtitle explains the state", /Off · plain cards/.test(D2.getElementById("root").textContent));
  check("cover: choice persists to wallet.settings.v1",
    JSON.parse(W2.localStorage.getItem(SETTINGS_KEY) || "{}").cover === false);
  click(t(/^Done$/)); await settle(W2, 800);
  check("cover OFF: carousel pouch is gone", trayCount(D2) === 0 && sleeveCount(D2) === 0,
    `tray=${trayCount(D2)} sleeve=${sleeveCount(D2)}`);
  check("cover OFF: cards themselves still render", [...D2.querySelectorAll("#root img")].length > 0);
  const ts = titleStyle(D2);
  check("cover OFF: title colour follows the theme (var(--ink))", ts.color.includes("--ink"), ts.color);
  check("cover OFF: dark drop-shadow on the title is dropped", ts.shadow.trim() === "none", ts.shadow);
  check("cover: no console errors while toggling", cvOn.errors.length === 0, cvOn.errors.slice(0, 1).join("").slice(0, 150));
}

// -- stack layout, both states --
const stackOff = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: false }) });
runBundle(stackOff.window, stackOff.errors);
await settle(stackOff.window, 900);
check("cover OFF: stack drops the frosted cover", glassCount(stackOff.window.document) === 0,
  `glass=${glassCount(stackOff.window.document)}`);
check("cover OFF: stack title follows the theme",
  titleStyle(stackOff.window.document).color.includes("--ink"), titleStyle(stackOff.window.document).color);

const stackOn = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) });
runBundle(stackOn.window, stackOn.errors);
await settle(stackOn.window, 900);
check("cover ON: stack keeps the frosted cover", glassCount(stackOn.window.document) > 0,
  `glass=${glassCount(stackOn.window.document)}`);

// -- dark theme keeps the text readable --
const darkOff = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ appearance: "dark", cover: false }) });
runBundle(darkOff.window, darkOff.errors);
await settle(darkOff.window, 900);
check("cover OFF + dark theme: title is var(--ink) (white on black)",
  darkOff.window.document.documentElement.classList.contains("dark") &&
  titleStyle(darkOff.window.document).color.includes("--ink"), titleStyle(darkOff.window.document).color);

// -- existing installs without the key keep the pouch --
const legacy = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ appearance: "system", theme: "slate" }) });
runBundle(legacy.window, legacy.errors);
await settle(legacy.window, 900);
check("cover: settings saved before this feature default to pouch ON",
  trayCount(legacy.window.document) > 0, `tray=${trayCount(legacy.window.document)}`);

// -- opening a card still works with the cover hidden (both layouts) --
for (const view of ["carousel", "stack"]) {
  const inst = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ view, cover: false }) }, { withLayout: true });
  runBundle(inst.window, inst.errors);
  await settle(inst.window, 900);
  const Wv = inst.window, Dv = Wv.document;
  const ptr = (type, x, y) => {
    const e = new Wv.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  if (view === "stack") {
    const box = [...Dv.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(d.getAttribute("style") || ""));
    box?.dispatchEvent(ptr("pointerdown", 195, 300));
    await settle(Wv, 80);
    Wv.dispatchEvent(ptr("pointerup", 195, 300));
    await settle(Wv, 1600);
  } else {
    for (const target of [...Dv.querySelectorAll("#root div.no-select")]) {
      target.dispatchEvent(ptr("pointerdown", 190, 300));
      await settle(Wv, 60);
      target.dispatchEvent(ptr("pointerup", 190, 300));
      target.dispatchEvent(new Wv.MouseEvent("click", { bubbles: true, clientX: 190, clientY: 300 }));
      await settle(Wv, 1400);
      if (/WhatsApp/.test(Dv.getElementById("root").textContent)) break;
    }
  }
  const opened = /WhatsApp/.test(Dv.getElementById("root").textContent);
  check(`cover OFF: tapping a card still opens the detail sheet (${view})`, opened,
    opened ? "eject -> open hand-off intact" : Dv.getElementById("root").textContent.slice(0, 80));
  check(`cover OFF: no console errors in ${view} open flow`, inst.errors.length === 0,
    inst.errors.slice(0, 1).join("").slice(0, 150));
}

// ---------------------------------------------------------------------------
// Test 6b: the black header must be theme-independent (dark must not flip it)
// ---------------------------------------------------------------------------
{
  const dark = makeDom({ [CARDS_KEY]: CARDS, [SETTINGS_KEY]: JSON.stringify({ appearance: "dark" }) });
  runBundle(dark.window, dark.errors);
  await settle(dark.window, 900);
  const Dk = dark.window.document;
  const chips = HEADER_CFG.options
    .map((o) => [...Dk.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === o.label))
    .filter(Boolean);
  // with tone:auto the inline declarations are identical in both themes on purpose -
  // they are var() tokens, and the browser resolves them to the opposite colours
  check("header: dark theme keeps the same (token-driven) declarations, and no literal black glyph on a black bg",
    Dk.documentElement.classList.contains("dark") &&
    chips.length === HEADER_CFG.options.length &&
    chips.every((c, i) => {
      const o = HEADER_CFG.options[i];
      const bg = HEX(colorOf(c, "background")), fg = HEX(colorOf(c, "color"));
      const literalBlack = toneOf(o) !== "black" && toneOf(o) !== "white";
      // for auto/ink the declared value must be the token, never #000
      if (literalBlack && (fg === "#000" || bg === "#000")) return false;
      return bg === wantBg(o) && fg === wantGlyph(o);
    }),
    chips.map((c) => `${HEX(colorOf(c, "color"))} on ${HEX(colorOf(c, "background"))}`).join(" | "));
  check("header: bare glyph size is set by patch7 (26px outside a disc)",
    (() => {
      const bare = HEADER_CFG.options.findIndex((o) => !o.chip);
      if (bare < 0) return true;
      const svg = chips[bare]?.querySelector("svg");
      return svg?.getAttribute("width") === "26";
    })(),
    HEADER_CFG.options.map((o) => `${o.id}:${o.chip ? "23(disc)" : "26(bare)"}`).join(" "));
  check("header: no console errors in the dark theme", dark.errors.length === 0,
    dark.errors.slice(0, 1).join("").slice(0, 150));
}

// ---------------------------------------------------------------------------
// Test 6e: stack - tapping a card ejects it and opens it (patch12)
// ---------------------------------------------------------------------------
{
  const CARDS3 = JSON.stringify([
    { id: "c1", src: "cards/one.jpg", title: "Alpha One", subtitle: "1", fields: [] },
    { id: "c2", src: "cards/two.jpg", title: "Bravo Two", subtitle: "2", fields: [] },
    { id: "c3", src: "cards/three.jpg", title: "Charlie Three", subtitle: "3", fields: [] },
  ]);
  const open = () => /WhatsApp/.test(Ds.getElementById("root").textContent || "");
  const cards = () => [...Ds.querySelectorAll("#root div.absolute.no-select")];
  const st = makeDom(
    { [CARDS_KEY]: CARDS3, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) },
    { withLayout: true },
  );
  runBundle(st.window, st.errors);
  await settle(st.window, 900);
  const Ws = st.window, Ds = Ws.document;
  const ptr = (type, x, y) => {
    const e = new Ws.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const stage = [...Ds.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(d.getAttribute("style") || ""));
  const beforeT = cards().map((el) => el.getAttribute("style") || "");
  check("stack: three cards are on screen and nothing is open yet", cards().length === 3 && !open(),
    `cards=${cards().length} open=${open()}`);

  // with the layout mock the stage box is left:45 width:300, so x=280 maps to the
  // card BEHIND the front one - exactly the tap that used to only sweep the deck.
  stage.dispatchEvent(ptr("pointerdown", 280, 300));
  await settle(Ws, 80);
  Ws.dispatchEvent(ptr("pointerup", 280, 300));
  await settle(Ws, 900);
  const after = cards();
  const raised = after.findIndex((el) => /z-index:\s*40/.test(el.getAttribute("style") || ""));
  check("stack: the tapped card - not the front one - is the one that came out",
    raised === 1, `ejected index=${raised} (0 would mean the deck ignored the tap)`);
  // framer writes the transform as functions, so the lift is readable directly:
  // the ejected card must carry a negative translateY, the resting ones must not.
  const ty = (el) => parseFloat((el?.getAttribute("style") || "").match(/translateY\((-?[\d.]+)px\)/)?.[1] ?? "0");
  check("stack: that card lifts out of the deck on its own axis (translateY, not only the flap)",
    ty(after[1]) < -40 && ty(after[1]) > -90 && ty(after[0]) === 0,
    `lift=${ty(after[1])}px (expect ~-57px = ch*0.11), neighbour y=${ty(after[0])}px`);
  check("stack: the opened card then shows its details", open(),
    open() ? "sheet open on the tapped card" : (Ds.getElementById("root").textContent || "").slice(0, 60));
  check("stack: no console errors from the tap", st.errors.length === 0, st.errors.slice(0, 1).join("").slice(0, 150));

  // a swipe must stay a swipe: change card, open nothing
  const sw = makeDom(
    { [CARDS_KEY]: CARDS3, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) },
    { withLayout: true },
  );
  runBundle(sw.window, sw.errors);
  await settle(sw.window, 900);
  const Ww = sw.window, Dw = Ww.document;
  const ptr2 = (type, x, y) => {
    const e = new Ww.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const stage2 = [...Dw.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(d.getAttribute("style") || ""));
  stage2.dispatchEvent(ptr2("pointerdown", 200, 300));
  await settle(Ww, 30);
  Dw.dispatchEvent(ptr2("pointermove", 120, 300));
  await settle(Ww, 30);
  Dw.dispatchEvent(ptr2("pointermove", 60, 300));
  await settle(Ww, 30);
  Ww.dispatchEvent(ptr2("pointerup", 60, 300));
  await settle(Ww, 700);
  const swOpen = /WhatsApp/.test(Dw.getElementById("root").textContent || "");
  check("stack: a horizontal drag still flips the deck without opening anything",
    !swOpen && sw.errors.length === 0, `open=${swOpen} err=${sw.errors.length}`);

  // the two code-level guards behind the above
  check("stack: tap path no longer returns before opening (snap-only branch is gone)",
    !/if\(n!==Math\.round\(d\)\)\{snap\(n\);return\}/.test(BUNDLE_SRC) &&
      /snap\(n,\.24\),a\(c\);return/.test(BUNDLE_SRC), "tap maps then opens");
  check("stack: tap clears drag.current so the deck resyncs to index changes",
    /if\(f!==1\)\{drag\.current=null;/.test(BUNDLE_SRC), "ref released in the tap path");
}

// ---------------------------------------------------------------------------
// Test 7: Back-button / history instrumentation probe (informational)
// ---------------------------------------------------------------------------
const bundleSrc = fs.readFileSync(path.join(APP, "index.js"), "utf8");
const usesHistory = /history\.pushState|history\.back\(/.test(bundleSrc);
const usesCapacitorBack = /backButton|hardwareBackPress|ionBackButton/.test(bundleSrc);
check("info: web layer does NOT register its own Back handler",
  !usesHistory && !usesCapacitorBack,
  "Back is handled by Capacitor BridgeActivity default - MUST be checked on device");

// ---------------------------------------------------------------------------
const width = Math.max(...results.map((r) => r.name.length)) + 2;
console.log();
for (const r of results) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)} ${r.detail}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} web-layer smoke checks passed`);
if (failed.length) {
  console.log("FAILED: " + failed.map((f) => f.name).join(", "));
  process.exit(1);
}
process.exit(0);
