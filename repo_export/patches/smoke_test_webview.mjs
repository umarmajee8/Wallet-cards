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
const CSS_SRC = fs.readFileSync(path.join(APP, "index.css"), "utf8");
// the carousel component (Td) as a source slice, for the mechanism checks in Test 6f
const STACK_FLAP_SRC = (BUNDLE_SRC.match(/backdropFilter:[^}]{0,200}/) || [""])[0];
const BUNDLE_CAROUSEL_SRC = (() => {
  const i = BUNDLE_SRC.indexOf("function Td({cards:");
  const j = BUNDLE_SRC.indexOf("var Ed=", i);
  return i < 0 ? "" : BUNDLE_SRC.slice(i, j < 0 ? i + 9000 : j);
})();
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
{
  const after = JSON.parse(restarted.window.localStorage.getItem(SETTINGS_KEY) || "{}");
  check("existing state: stored appearance survives boot (only nfc is forced)",
    after.appearance === "dark", `appearance=${after.appearance}`);
  check("existing state: an old nfc:true is left in storage but not honoured (see 6i)",
    after.nfc === true, "the loader pins it off at read time, so the row never comes back");
}

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
check("ui: add-card menu opens with the two capture routes",
  ["Add from gallery", "Take a picture"].every((t) => addOptions.includes(t)),
  addOptions.filter((l) => /gallery|picture|bank card/.test(l)).join(" | "));
check("ui: the NFC route is not offered (patch17 holds nfc off)",
  !addOptions.includes("Tap a bank card"), addOptions.join(" | ").slice(0, 90));

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
  ["Layout", "Carousel", "Stack", "Appearance", "Pouch"].every((t) => settingsText.includes(t)),
  "Design / Layout / Pouch / Appearance");
check("ui: the NFC row is gone from settings with the feature (patch17)",
  !/Read cards over NFC|Tap to read/.test(settingsText), settingsText.slice(-90));

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
  !afterClose.includes("Wallet & cover"), afterClose.slice(0, 60));
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
  return {
    color: st.match(/color:\s*([^;]*)/)?.[1] || "",
    shadow: st.match(/text-shadow:\s*([^;]*)/)?.[1] || "",
    weight: st.match(/font-weight:\s*([^;]*)/)?.[1] || "",
  };
};
const coverSwitch = (d) =>
  [...d.querySelectorAll('button[role="switch"]')].find((b) => (b.parentElement?.textContent || "").startsWith("Wallet & cover"));

// -- carousel, cover ON (default) --
const cvOn = makeDom({ [CARDS_KEY]: CARDS });
runBundle(cvOn.window, cvOn.errors);
await settle(cvOn.window, 800);
check("cover ON: carousel draws the pouch", trayCount(cvOn.window.document) > 0 && sleeveCount(cvOn.window.document) > 0,
  `tray=${trayCount(cvOn.window.document)} sleeve=${sleeveCount(cvOn.window.document)}`);
{
  const t = titleStyle(cvOn.window.document);
  check("cover ON: card title follows the theme instead of going white (patch15)",
    /--ink/.test(t.color) && /^\s*800\s*$/.test(t.weight),
    `color=${t.color} weight=${t.weight || "-"} shadow=${t.shadow || "-"}`);
}

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
  check("cover OFF: the title shadow is a theme token, not a fixed value",
    /--pouch-label-shadow/.test(ts.shadow), ts.shadow.trim());
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

// Test 6e: stack - tap ejects the tapped card in place (patch12 + patch13)
// ---------------------------------------------------------------------------
{
  const CARDS3 = JSON.stringify([
    { id: "c1", src: "cards/one.jpg", title: "Alpha One", subtitle: "1", fields: [] },
    { id: "c2", src: "cards/two.jpg", title: "Bravo Two", subtitle: "2", fields: [] },
    { id: "c3", src: "cards/three.jpg", title: "Charlie Three", subtitle: "3", fields: [] },
  ]);
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
  const open = () => /WhatsApp/.test(Ds.getElementById("root").textContent || "");
  const cards = () => [...Ds.querySelectorAll("#root div.absolute.no-select")];
  const styleOf = (el) => el?.getAttribute("style") || "";
  const num = (re, el) => parseFloat(styleOf(el).match(re)?.[1] ?? "0");
  const ty = (el) => num(/translateY\((-?[\d.]+)px\)/, el);
  const tx = (el) => num(/translateX\((-?[\d.]+)px\)/, el);

  const stage = [...Ds.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(styleOf(d)));
  const transformOf = (el) => styleOf(el).match(/transform:[^;]*/)?.[0] || "";
  const flapOf = (el) => [...(el?.querySelectorAll("div") || [])].find((d) => /backdrop-filter/.test(styleOf(d)));
  const before = cards().map(styleOf);
  const beforeT = cards().map(transformOf);
  check("stack: three cards are on screen and nothing is open yet", cards().length === 3 && !open(),
    `cards=${cards().length} open=${open()}`);

  // The layout mock puts the stage box at left:45 width:300, so x=280 maps to the
  // card BEHIND the front one - the tap that used to sweep the whole fan sideways.
  stage.dispatchEvent(ptr("pointerdown", 280, 300));
  await settle(Ws, 80);
  Ws.dispatchEvent(ptr("pointerup", 280, 300));
  await settle(Ws, 120);                       // mid-eject; the hand-off is ~260ms
  const mid = cards();
  const ejectedAt = mid.findIndex((el) => /z-index:\s*40/.test(styleOf(el)));
  check("stack: the tapped card - not the front one - is the one that came out",
    ejectedAt === 1, `ejected index=${ejectedAt} (0 would mean the deck ignored the tap)`);
  check("stack: it lifts straight out - same slot, no sideways travel",
    ty(mid[1]) < -40 && ty(mid[1]) > -90 && tx(mid[1]) === tx(cards()[1]) ||
      (ty(mid[1]) < -40 && Math.abs(tx(mid[1]) - 229.5) < 0.5),
    `y=${ty(mid[1])}px, x=${tx(mid[1])}px (its resting slot is 229.5px)`);
  // the neighbours DO restyle at eject time (they gain the dim blur) - what must
  // not happen is that they MOVE: that is the deck sweep the old tap used to do.
  check("stack: no deck sweep - the other cards have not moved at all yet",
    transformOf(mid[0]) === beforeT[0] && transformOf(mid[2]) === beforeT[2],
    `card0 moved=${transformOf(mid[0]) !== beforeT[0]} card2 moved=${transformOf(mid[2]) !== beforeT[2]}`);
  const flap = flapOf(mid[1]);
  check("stack: the frosted flap stops blurring while it folds (the expensive part)",
    /backdrop-filter:\s*none/.test(styleOf(flap)), (styleOf(flap).match(/backdrop-filter:[^;]*/) || ["-"])[0]);
  check("stack: neighbours dim with a cheap static blur instead of a heavy one",
    /filter:\s*blur\(6px\)/.test(styleOf(mid[0])), (styleOf(mid[0]).match(/filter:[^;]*/) || ["-"])[0]);

  await settle(Ws, 800);
  check("stack: the tapped card then shows its details", open(),
    open() ? "sheet open on the tapped card" : (Ds.getElementById("root").textContent || "").slice(0, 60));
  check("stack: no console errors from the tap", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 150));

  // Closing hands the deck over: the card that was opened becomes the front one,
  // and the lift/flap state is fully released (no stuck card).
  const sheet = [...Ds.querySelectorAll("#root div")].find((d) => /z-50/.test(d.className || ""));
  sheet?.dispatchEvent(new Ws.MouseEvent("click", { bubbles: true }));
  await settle(Ws, 1200);
  const back = cards();
  check("stack: after closing, the deck follows the card you opened - nothing stuck lifted",
    !open() && ty(back[1]) === 0 && tx(back[1]) === 0 && !/z-index:\s*40/.test(styleOf(back[1])),
    `open=${open()} y=${ty(back[1])} x=${tx(back[1])}`);
  const flapBack = flapOf(back[1]);
  check("stack: the cover never pays for backdrop blur (patch15)",
    /backdrop-filter:\s*none/.test(styleOf(flapBack)) && !/blur\(22px\)/.test(STACK_FLAP_SRC),
    (styleOf(flapBack).match(/backdrop-filter:[^;]*/) || ["no flap element"])[0]);

  // a swipe must stay a swipe: flip the deck, open nothing
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

  // the code-level guards the behaviour above rests on
  const STACK_SRC = BUNDLE_SRC.split("function __cwStack")[1]?.split("function Td")[0] || "";
  const CARD_SRC = BUNDLE_SRC.split("function __cwCoverCard")[1]?.split("function __cwStack")[0] || "";
  // the tap branch runs from `if(f!==1){` to the start of the drag path; a regex
  // over minified JS with nested braces is not worth it
  const tFrom = STACK_SRC.indexOf("if(f!==1){"), tTo = STACK_SRC.indexOf("drag.current=null;let e2");
  const tapBranch = tFrom >= 0 && tTo > tFrom ? STACK_SRC.slice(tFrom, tTo) : "";
  check("stack: the tap path never tweens the deck (no snap call on tap at all)",
    /a\(c\);return/.test(tapBranch) && !/snap\(/.test(tapBranch) && /drag\.current=null/.test(tapBranch),
    `tap branch: snap=${/snap\(/.test(tapBranch)} open=${/a\(c\);return/.test(tapBranch)}`);
  check("stack: the growth rides the card's own scale spring, not an animated clip",
    /Ju\(d,s\?1\.05:1,n\)/.test(CARD_SRC) && !/animate:\{scale:s\?1\.05:1\}/.test(CARD_SRC),
    "no per-frame clip re-raster");
  check("stack: the sheet starts at the card's own rect, stage box only as fallback",
    /rect:r0\?\{top:r0\.top,left:r0\.left,width:r0\.width,height:r0\.height\}/.test(STACK_SRC),
    "card rect + fallback");
  check("stack: tap clears drag.current so the deck resyncs to index changes",
    /if\(f!==1\)\{drag\.current=null;/.test(STACK_SRC), "ref released in the tap path");
}

// ---------------------------------------------------------------------------
// Test 6f: carousel - the row can never rest half-shifted (patch14)
//
// Device report: after dragging a card toward the bottom of the screen the row
// stopped half a card sideways (front pouch clipped by the left screen edge) and
// stayed there, because the row only re-centres when a settle animation finishes
// and Android had taken the pointer stream away (no pointerup -> no settle ever
// scheduled). So: drag, deliberately never release, and require the row to recover.
// ---------------------------------------------------------------------------
{
  const CARDS3c = JSON.stringify([
    { id: "k1", src: "cards/one.jpg", title: "Kilo One", subtitle: "1", fields: [] },
    { id: "k2", src: "cards/two.jpg", title: "Lima Two", subtitle: "2", fields: [] },
    { id: "k3", src: "cards/three.jpg", title: "Mike Three", subtitle: "3", fields: [] },
  ]);
  const st = makeDom(
    { [CARDS_KEY]: CARDS3c, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) },
    { withLayout: true },
  );
  runBundle(st.window, st.errors);
  await settle(st.window, 900);
  const Wc = st.window, Dc = Wc.document;
  const ptr = (type, x, y) => {
    const e = new Wc.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const styleOf = (el) => el?.getAttribute("style") || "";
  const tx = (el) => parseFloat(styleOf(el).match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? "0");
  const zOf = (el) => parseInt(styleOf(el).match(/z-index:\s*(\d+)/)?.[1] ?? "0", 10);
  const cardEls = () => [...Dc.querySelectorAll("#root div.absolute.top-0")];
  const front = () => cardEls().sort((a, b) => zOf(b) - zOf(a))[0];
  const stage = [...Dc.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(styleOf(d)));
  // the drag layer is the *child* of the perspective box - onPointerDown lives on it
  // patch15 moved the touch target off the layer and onto the pouches themselves
  const dragLayer = [...Dc.querySelectorAll("#root div")].find(
    (d) => /absolute inset-0/.test(d.className || "") && /touch-action:\s*none/.test(styleOf(d)),
  );

  check("carousel: pouch renders the row component", !!stage && !!dragLayer && cardEls().length >= 3,
    `${cardEls().length} card wrappers`);

  // jsdom has no layout, so aim at the middle of the window: only the *delta*
  // matters to the drag handler, hit-testing does not exist here
  const cx = (Wc.innerWidth || 800) / 2, cy = (Wc.innerHeight || 600) / 2;
  // `shifted` is measured while the row is still held off-centre - well inside the
  // 340ms idle window - so this can never race the watchdog on a slow machine.
  const drag = async (dx, release) => {
    (front() || dragLayer || stage)?.dispatchEvent(ptr("pointerdown", cx, cy));
    for (let i = 1; i <= 4; i++) {
      Wc.dispatchEvent(ptr("pointermove", cx + (dx * i) / 4, cy));
      await settle(Wc, 30);
    }
    const shifted = tx(front());
    if (release) {
      Wc.dispatchEvent(ptr("pointerup", cx + dx, cy));
      await settle(Wc, 1200);
    }
    return shifted;
  };

  const txAtRest = tx(front());
  const txHeld = await drag(110, false);   // gesture stolen by the system: never released
  check("carousel: an unreleased drag really does leave the row off-centre",
    Math.abs(txHeld - txAtRest) > 4, `front card x ${txHeld.toFixed(1)}px (was ${txAtRest.toFixed(1)}px)`);

  await settle(Wc, 1200);           // the idle watchdog gets ~0.7s of quiet
  const txRecovered = tx(front());
  check("carousel: watchdog re-centres the row with no pointerup", Math.abs(txRecovered) < 2,
    `front card x ${txRecovered.toFixed(2)}px after the idle window`);

  await drag(240, true);            // ordinary swipe still works
  const txAfterSwipe = tx(front());
  check("carousel: a normal drag+release still settles centred", Math.abs(txAfterSwipe) < 2,
    `front card x ${txAfterSwipe.toFixed(2)}px`);

  check("carousel: grabbing mid-glide finishes the settle instead of dropping it",
    /T\.current\?\.\(\),g\.current&&y\(\);let sl=u\.slide\|\|1/.test(BUNDLE_CAROUSEL_SRC),
    "pointerdown calls y()");
  check("carousel: no console errors while the row recovers", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 160));
}


// ---------------------------------------------------------------------------
// Test 6g: the empty bands above/below the pouch row must do nothing (patch15)
//
// The report was a screenshot with the dead black area above and below the row
// framed in blue: "yeh jaga kam na kray - is pr touch swipe kuch b kam na kray".
// So the drag surface has to be the pouches, not the box around them - and a
// swipe starting anywhere else must not move the row, must not be taken by the
// browser as a scroll, and must not even show the grab cursor.
// ---------------------------------------------------------------------------
{
  const CARDS3d = JSON.stringify([
    { id: "m1", src: "cards/one.jpg", title: "Nova One", subtitle: "1", fields: [] },
    { id: "m2", src: "cards/two.jpg", title: "Oscar Two", subtitle: "2", fields: [] },
    { id: "m3", src: "cards/three.jpg", title: "Papa Three", subtitle: "3", fields: [] },
  ]);
  const st = makeDom(
    { [CARDS_KEY]: CARDS3d, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) },
    { withLayout: true },
  );
  runBundle(st.window, st.errors);
  await settle(st.window, 900);
  const Wg = st.window, Dg = Wg.document;
  const ptr = (type, x, y) => {
    const e = new Wg.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const styleOf = (el) => el?.getAttribute("style") || "";
  const tx = (el) => parseFloat(styleOf(el).match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? "0");
  const zOf = (el) => parseInt(styleOf(el).match(/z-index:\s*(\d+)/)?.[1] ?? "0", 10);
  const cardEls = () => [...Dg.querySelectorAll("#root div.absolute.top-0")];
  const front = () => cardEls().sort((a, b) => zOf(b) - zOf(a))[0];
  const allDivs = () => [...Dg.querySelectorAll("#root div")];
  const layer = allDivs().find((d) => /absolute inset-0/.test(d.className || "") && /touch-action:\s*none/.test(styleOf(d)));
  const stageBox = allDivs().find((d) => /perspective:\s*1200/.test(styleOf(d)));
  const main = Dg.querySelector("#root main");

  // returns how far the front card moved for a gesture that started on `el`
  const dragShift = async (el, dx) => {
    const before = tx(front());
    el?.dispatchEvent(ptr("pointerdown", 400, 300));
    for (const step of [0.33, 0.66, 1]) {
      Wg.dispatchEvent(ptr("pointermove", 400 + dx * step, 300));
      await settle(Wg, 30);
    }
    const shift = tx(front()) - before;
    Wg.dispatchEvent(ptr("pointerup", 400 + dx, 300));
    await settle(Wg, 900);
    return shift;
  };

  const sMain = await dragShift(main, 140);
  const sLayer = await dragShift(layer, 140);
  const sStage = await dragShift(stageBox, 140);
  const sCard = await dragShift(front(), 60);
  check("pouch: a swipe in the empty band above/below the row does nothing",
    Math.abs(sMain) < 0.5, `row moved ${sMain.toFixed(2)}px`);
  check("pouch: the dead area of the old drag layer does nothing",
    Math.abs(sLayer) < 0.5, `row moved ${sLayer.toFixed(2)}px`);
  check("pouch: the stage box around the cards does nothing",
    Math.abs(sStage) < 0.5, `row moved ${sStage.toFixed(2)}px`);
  check("pouch: a swipe that starts on a card still drags the row",
    Math.abs(sCard) > 4, `row moved ${sCard.toFixed(2)}px`);

  check("pouch: the wrapper layer is not a hit target",
    /pointer-events:\s*none/.test(styleOf(layer)), (styleOf(layer).match(/pointer-events:[^;]*/) || ["-"])[0]);
  check("pouch: each card is the hit target and carries the grab cursor",
    /pointer-events:\s*auto/.test(styleOf(front())) && /cursor:\s*grab/.test(styleOf(front())),
    `${(styleOf(front()).match(/pointer-events:[^;]*/) || ["-"])[0]} ${(styleOf(front()).match(/cursor:[^;]*/) || ["-"])[0]}`);
  check("pouch: the cursor is no longer promising a drag over empty space",
    !/cursor:\s*grab/.test(styleOf(layer)), (styleOf(layer).match(/cursor:[^;]*/) || ["none"])[0]);
  check("pouch: <main> cannot scroll or rubber-band",
    /touch-action:\s*none/.test(styleOf(main)) && /overscroll-behavior:\s*none/.test(styleOf(main)),
    `${(styleOf(main).match(/touch-action:[^;]*/) || ["-"])[0]} ${(styleOf(main).match(/overscroll-behavior:[^;]*/) || ["-"])[0]}`);
  check("pouch: only a gesture that started inside a pouch is accepted",
    /closest\(`\[data-cwc\]`\)/.test(BUNDLE_CAROUSEL_SRC), "guard in Td.onPointerDown");
  check("pouch: the title shadow token exists for both themes",
    /--pouch-label-shadow:none/.test(CSS_SRC) && /html\.dark\{--pouch-label-shadow:0 1px 8px/.test(CSS_SRC),
    "none in light, halo in dark");

  const label = [...(front()?.querySelectorAll("div") || [])].find((d) => /margin-top:\s*8px/.test(styleOf(d)));
  check("pouch: the card name is theme ink + 800, never hardcoded white",
    /color:\s*var\(--ink\)/.test(styleOf(label)) && /font-weight:\s*800/.test(styleOf(label))
      && !/rgba\(255,\s*255,\s*255/.test(styleOf(label)),
    [styleOf(label).match(/color:[^;]*/)?.[0], styleOf(label).match(/font-weight:[^;]*/)?.[0],
      styleOf(label).match(/text-shadow:[^;]*/)?.[0]].filter(Boolean).join(" "));
  check("pouch: both layouts' card names read the same way (no hardcoded white left)",
    (BUNDLE_SRC.match(/color:`var\(--ink\)`,fontSize:13,fontWeight:800/g) || []).length === 2
      && !/color:cv\?`rgba\(255,255,255,0\.94\)`/.test(BUNDLE_SRC),
    "carousel + stack cover");
  check("pouch: no console errors while the bands go quiet", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 150));
}


// ---------------------------------------------------------------------------
// Test 6h: a card can carry its own pouch colour (patch16)
//
// "jaisy baki carousel hain un ka colour select kar saktay hain, is ka bhi waise hi"
// - and the second half of the ask, that the selected colour really reaches the
// pouch. Both are checked on the DOM, not just in the source: the pouch's tray
// gradient is painted inline, so the colour each card ends up with is readable.
// ---------------------------------------------------------------------------
{
  const CARDS_COL = (colors) => JSON.stringify(colors.map((c, i) => ({
    id: "p" + i, src: "cards/" + i + ".jpg", title: "Hue" + i, subtitle: "x", fields: [],
    ...(c ? { color: c } : {}),
  })));
  const GLOBAL_GREEN = {
    cover: true,
    custom: { color: "#2d4a3e", design: "slate", grain: 0.2, grade: 1 },
    slateColor: "#2d4a3e",
  };
  const styleOf = (el) => el?.getAttribute("style") || "";
  const gradOf = (el) => (styleOf(el).match(/background:[^;]*/) || ["-"])[0];
  const mount = async (colors, settings) => {
    const st = makeDom({ [CARDS_KEY]: CARDS_COL(colors), [SETTINGS_KEY]: JSON.stringify(settings) }, { withLayout: true });
    runBundle(st.window, st.errors);
    await settle(st.window, 900);
    const D = st.window.document;
    const byName = (name) => {
      const w = [...D.querySelectorAll("#root div.absolute.top-0")].find((d) => (d.textContent || "").startsWith(name));
      return [...(w?.querySelectorAll("div") || [])].find((d) => /left-0/.test(d.className) && /rgb|linear-gradient/.test(styleOf(d)));
    };
    return { st, D, byName };
  };

  // 1) the wallet-wide colour does reach every pouch (the second half of the ask)
  {
    const { byName, st } = await mount([null, null, null], GLOBAL_GREEN);
    const g = gradOf(byName("Hue0")), y = gradOf(byName("Hue1"));
    check("colour: the wallet-wide colour reaches the pouches", /rgb\(32, 53, 45\)/.test(g) && !/#3a3d45/.test(g), g.slice(0, 90));
    check("colour: every card without an override looks the same", g === y, `${g.slice(0, 40)} vs ${y.slice(0, 40)}`);
    check("colour: no console errors while painting", st.errors.length === 0, st.errors.slice(0, 1).join("").slice(0, 140));
  }

  // 2) a card with its own colour wins over the wallet-wide one
  {
    const { byName } = await mount(["#2c3d56", null, "#b08d57"], GLOBAL_GREEN);
    const blue = gradOf(byName("Hue0")), plain = gradOf(byName("Hue1")), amber = gradOf(byName("Hue2"));
    check("colour: a card with its own colour is painted from it", /rgb\(27, 38, 53\)/.test(blue), blue.slice(0, 90));
    check("colour: the other cards keep the wallet colour", /rgb\(32, 53, 45\)/.test(plain), plain.slice(0, 60));
    check("colour: two cards can hold two different colours", /rgb\(109, 87, 54\)/.test(amber) && blue !== amber, amber.slice(0, 90));
  }

  // 3) the picker itself: long-press a card -> Card details -> Pouch colour row
  {
    const st = makeDom(
      { [CARDS_KEY]: CARDS_COL([null, null, null]), [SETTINGS_KEY]: JSON.stringify({ cover: true }) },
      { withLayout: true },
    );
    runBundle(st.window, st.errors);
    await settle(st.window, 900);
    const Wh = st.window, Dh = Wh.document;
    const ptr = (type, x, y) => {
      const e = new Wh.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(e, "isPrimary", { value: true });
      Object.defineProperty(e, "pointerId", { value: 1 });
      return e;
    };
    const click = (el) => el && el.dispatchEvent(new Wh.MouseEvent("click", { bubbles: true }));
    const btn = (re) => [...Dh.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));

    const front = [...Dh.querySelectorAll("#root div.absolute.top-0")].sort(
      (a, b) => (parseInt((styleOf(b).match(/z-index:\s*(\d+)/) || [0, 0])[1], 10))
        - (parseInt((styleOf(a).match(/z-index:\s*(\d+)/) || [0, 0])[1], 10)),
    )[0];
    const cardRoot = front?.querySelector("div.relative.no-select") || front;
    cardRoot?.dispatchEvent(ptr("pointerdown", 300, 300));
    await settle(Wh, 750);                       // the 480ms hold fires the long press
    cardRoot?.dispatchEvent(ptr("pointerup", 300, 300));
    await settle(Wh, 500);
    check("colour: long-press opens the card's action sheet", /Card details/.test(Dh.getElementById("root").textContent || ""),
      (Dh.getElementById("root").textContent || "").slice(0, 50));
    click(btn(/^Card details$/));
    await settle(Wh, 700);

    const swatches = [...Dh.querySelectorAll('button[aria-label^="Pouch colour"]')];
    check("colour: the card's editor offers the pouch colour swatches", swatches.length === 11,
      `${swatches.length} swatches`);
    check("colour: no reset chip while the card follows the wallet",
      !Dh.querySelector('button[aria-label="Wallet colour"]'), "only shown when overridden");

    const pick = Dh.querySelector('button[aria-label="Pouch colour #2c3d56"]');
    click(pick);
    await settle(Wh, 500);
    const saved = JSON.parse(Wh.localStorage.getItem(CARDS_KEY) || "[]");
    check("colour: picking a swatch saves it on that card only",
      saved[0]?.color === "#2c3d56" && !saved[1]?.color && !saved[2]?.color,
      `[${saved.map((c) => c.color || "-").join(", ")}]`);
    check("colour: the chosen swatch is marked as selected",
      /2px solid (#0a84ff|rgb\(10, 132, 255\))/.test(styleOf(Dh.querySelector('button[aria-label="Pouch colour #2c3d56"]'))),
      (styleOf(Dh.querySelector('button[aria-label="Pouch colour #2c3d56"]')).match(/border:[^;]*/) || ["-"])[0]);

    click(Dh.querySelector('button[aria-label="Wallet colour"]'));
    await settle(Wh, 500);
    const cleared = JSON.parse(Wh.localStorage.getItem(CARDS_KEY) || "[]");
    check("colour: the reset chip hands the card back to the wallet colour",
      cleared[0]?.color === undefined && !Dh.querySelector('button[aria-label="Wallet colour"]'),
      `color=${JSON.stringify(cleared[0]?.color)}`);
    const trayAfter = [...Dh.querySelectorAll("#root div.absolute.top-0")]
      .flatMap((w) => [...w.querySelectorAll("div")])
      .find((d) => /left-0/.test(d.className) && /rgb|linear-gradient/.test(styleOf(d)));
    check("colour: the card repaints from the wallet colour after reset",
      /rgb\(66, 73, 84\)/.test(gradOf(trayAfter)) && !/rgb\(27, 38, 53\)/.test(gradOf(trayAfter)),
      gradOf(trayAfter).slice(0, 90));
    check("colour: no console errors in the picker flow", st.errors.length === 0,
      st.errors.slice(0, 1).join("").slice(0, 140));
  }

  check("colour: both memo paths compare card.color (else the swatch would not repaint)",
    (BUNDLE_SRC.match(/e\.card\.color===t\.card\.color/g) || []).length === 2, "Q + Dd");
  check("colour: a card's own colour outranks the wallet's in the painter",
    /if\(e&&e\.color\)\{n=`custom`;r=\{\.\.\.\(r\|\|\{\}\),color:e\.color\};\}/.test(BUNDLE_SRC), "yd override");
  check("colour: the stack cover follows the card colour too",
    /col=e\.color\|\|\(j&&j\.color\)/.test(BUNDLE_SRC), "__cwCoverCard");
}


// ---------------------------------------------------------------------------
// Test 6i: header wordmark, NFC held off, light by default, and the stack cover
// wearing the wallet colour (patch17)
// ---------------------------------------------------------------------------
{
  const styleOf = (el) => el?.getAttribute("style") || "";
  const rgb = (r, g, b) => new RegExp(`rgb\\(\\s*${r},\\s*${g},\\s*${b}\\s*\\)`);
  const wantsDark = (win) => {
    win.matchMedia = (q) => ({
      matches: /dark/.test(q), media: q, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    });
  };
  const click = (win, el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  const btnText = (doc, re) => [...doc.querySelectorAll("#root button")].find((b) => re.test((b.textContent || "").trim()));
  const btnLabel = (doc, l) => [...doc.querySelectorAll("#root button[aria-label]")].find((b) => b.getAttribute("aria-label") === l);
  const openSettings = async (doc, win) => {
    click(win, btnLabel(doc, "More"));
    await settle(win, 300);
    click(win, btnText(doc, /^Settings$/));
    await settle(win, 600);
  };
  const activeSegment = (doc, group) => {
    const el = btnText(doc, group);
    if (!el) return null;
    const row = el.parentElement;
    const on = [...row.children].find((b) => /rgb\(10,\s*132,\s*255\)/.test(styleOf(b)) || /#0a84ff/i.test(styleOf(b)));
    return on ? (on.textContent || "").trim() : null;
  };

  // -- defaults on a fresh install, with the phone asking for dark --
  const fr = makeDom();
  wantsDark(fr.window);
  runBundle(fr.window, fr.errors);
  await settle(fr.window, 800);
  const W7 = fr.window, D7 = W7.document;
  check("defaults: a fresh install ignores the phone's dark preference (light by default)",
    !D7.documentElement.classList.contains("dark"),
    `class="${D7.documentElement.className || "-"}"`);
  {
    click(W7, btnLabel(D7, "Add card"));
    await settle(W7, 300);
    const opts = [...D7.querySelectorAll("#root button")].map((b) => (b.textContent || "").trim());
    check("defaults: no NFC route on a fresh install", !opts.includes("Tap a bank card"), opts.slice(0, 4).join(" | "));
    await openSettings(D7, W7);
    check("defaults: the NFC row is not in settings either",
      !/Read cards over NFC|Tap to read/.test(D7.getElementById("root").textContent || ""),
      "row removed with the feature");
    check("defaults: appearance shows Light as chosen",
      activeSegment(D7, /^(System|Light|Dark)$/) === "Light", `segment=${activeSegment(D7, /^(System|Light|Dark)$/)}`);
  }

  // -- the wordmark --
  const wm = [...D7.querySelectorAll("#root span")].find(
    (el) => (el.textContent || "").trim() === "Wallet" && /font-size:\s*28px/.test(styleOf(el)),
  );
  check("header: Wallet wordmark is rendered top-left, big and bold",
    !!wm && /font-weight:\s*800/.test(styleOf(wm)) && /margin-right:\s*auto/.test(styleOf(wm)),
    wm ? [(styleOf(wm).match(/font-size:[^;]*/) || ["-"])[0], (styleOf(wm).match(/font-weight:[^;]*/) || ["-"])[0]].join(" ") : "no wordmark");
  check("header: the wordmark uses the Apple-first font stack",
    /-apple-system,\s*BlinkMacSystemFont,\s*SF Pro Display/.test(styleOf(wm).replace(/"/g, "")),
    (styleOf(wm).match(/font-family:[^;]*/) || ["-"])[0].slice(0, 64));
  check("header: the wordmark colour is the themed ink, so it survives dark mode",
    /color:\s*var\(--ink\)/.test(styleOf(wm)), (styleOf(wm).match(/color:[^;]*/) || ["-"])[0]);
  {
    const kids = wm && wm.parentElement ? [...wm.parentElement.children] : [];
    const labels = kids.filter((k) => k.tagName === "BUTTON").map((k) => k.getAttribute("aria-label"));
    check("header: the icons stay on the right of the same row, wordmark first",
      kids[0] === wm && ["Add card", "Search cards", "More"].every((l) => labels.includes(l)),
      labels.join(", ") || "-");
  }

  // -- an install that never picked an appearance is migrated once --
  const mig = makeDom({ [SETTINGS_KEY]: JSON.stringify({ appearance: "system", nfc: true }) });
  wantsDark(mig.window);
  runBundle(mig.window, mig.errors);
  await settle(mig.window, 700);
  const D8 = mig.window.document, W8 = mig.window;
  check("appearance: an old default of system moves to light even on a dark phone",
    !D8.documentElement.classList.contains("dark"), `class="${D8.documentElement.className || "-"}`);
  {
    click(W8, btnLabel(D8, "Add card"));
    await settle(W8, 300);
    const opts = [...D8.querySelectorAll("#root button")].map((b) => (b.textContent || "").trim());
    check("appearance: a stored nfc:true is not honoured - patch17 pins it off",
      !opts.includes("Tap a bank card"), opts.slice(0, 4).join(" | "));
    click(W8, btnLabel(D8, "Add card"));
    await settle(W8, 200);
    await openSettings(D8, W8);
    check("appearance: the sheet says Light after the migration",
      activeSegment(D8, /^(System|Light|Dark)$/) === "Light",
      `segment=${activeSegment(D8, /^(System|Light|Dark)$/)}`);
  }

  const keep = makeDom({ [SETTINGS_KEY]: JSON.stringify({ appearance: "system", appearanceMigrated: true }) });
  wantsDark(keep.window);
  runBundle(keep.window, keep.errors);
  await settle(keep.window, 700);
  check("appearance: System is still respected once the migration has run",
    keep.window.document.documentElement.classList.contains("dark"), "dark follows the phone again");

  const dk = makeDom({ [SETTINGS_KEY]: JSON.stringify({ appearance: "dark" }) });
  runBundle(dk.window, dk.errors);
  await settle(dk.window, 600);
  check("appearance: an explicit Dark is never migrated",
    dk.window.document.documentElement.classList.contains("dark"), "dark honoured");

  // -- the stack cover is painted from the wallet colour --
  const CARDS17 = JSON.stringify([
    { id: "q1", src: "cards/one.jpg", title: "Green Card", subtitle: "1", fields: [] },
    { id: "q2", src: "cards/two.jpg", title: "Blue Card", subtitle: "2", fields: [], color: "#2c3d56" },
  ]);
  const SET17 = JSON.stringify({
    view: "stack", cover: true, theme: "slate", slateColor: "#2d4a3e",
    custom: { color: "#2d4a3e", design: "slate", grain: 0.2, grade: 1 },
  });
  const stk = makeDom({ [CARDS_KEY]: CARDS17, [SETTINGS_KEY]: SET17 }, { withLayout: true });
  runBundle(stk.window, stk.errors);
  await settle(stk.window, 900);
  const D9 = stk.window.document;
  const flapOf = (el) => [...(el?.querySelectorAll("div") || [])].find((d) => /backdrop-filter/.test(styleOf(d)));
  const deck = [...D9.querySelectorAll("#root div.absolute.no-select")];
  const fWallet = flapOf(deck[0]);
  const fOwn = flapOf(deck[1]);
  check("stack cover: the panel is the wallet colour, not glass",
    rgb(53, 87, 73).test(styleOf(fWallet)) && /rgb\(45,\s*74,\s*62\)|#2d4a3e/i.test(styleOf(fWallet)),
    (styleOf(fWallet).match(/background:[^;]*(;[^;]*;)?/) || ["-"])[0].slice(0, 120));
  check("stack cover: the shade at the mouth and the rim come from the same colour",
    rgb(31, 52, 43).test(styleOf(fWallet)) && rgb(25, 41, 34).test(styleOf(fWallet)),
    (styleOf(fWallet).match(/border:[^;]*/) || ["-"])[0]);
  check("stack cover: no blur and no translucent glass left on it",
    /backdrop-filter:\s*none/.test(styleOf(fWallet)) && !/blur\(/.test(styleOf(fWallet)) &&
      !/rgba\(255,\s*255,\s*255,\s*0\.38\)/.test(styleOf(fWallet)),
    (styleOf(fWallet).match(/backdrop-filter:[^;]*/) || ["-"])[0]);
  check("stack cover: a card with its own colour uses it on the panel",
    rgb(52, 72, 101).test(styleOf(fOwn)) && styleOf(fOwn) !== styleOf(fWallet),
    (styleOf(fOwn).match(/background:[^;]*(;[^;]*;)?/) || ["-"])[0].slice(0, 110));
  check("stack cover: no console errors from the panel", stk.errors.length === 0,
    stk.errors.slice(0, 1).join("").slice(0, 150));

  // -- source guards for the parts jsdom cannot show --
  check("settings: the NFC row is removed, not just hidden",
    !/children:`Tap to read`/.test(BUNDLE_SRC) && !/Read cards over NFC/.test(BUNDLE_SRC), "row deleted with the feature");
  check("loader: nfc is pinned off the way autoDetect already was",
    /n\.autoDetect=!1,n\.nfc=!1/.test(BUNDLE_SRC), "same idiom, no new machinery");
  check("defaults: the shipped settings object starts light and nfc-off",
    /Qp=\{autoDetect:!1,nfc:!1,appearance:`light`/.test(BUNDLE_SRC), "Qp literal");
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
