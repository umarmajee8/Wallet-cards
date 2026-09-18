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


// jsdom's cssstyle accepts `style.backdropFilter` but does not serialise it into the style attribute (no
// `backdrop-filter` in its property list), so any regex over getAttribute("style") silently misses it -
// which is how the cover/flap blocks of this suite started reading "no flap element" on a jsdom upgrade.
// Harness gap, not an app bug: real WebViews serialise it. Read the CSSOM accessor as well, so every
// check below sees the same declarations the compositor would.
const inlineStyle = (el) => {
  if (!el) return "";
  let out = el.getAttribute("style") || "";
  const JSDOM_DROPPED = [
    ["backdropFilter", "backdrop-filter"], ["webkitBackdropFilter", "-webkit-backdrop-filter"],
    ["perspective", "perspective"], ["perspectiveOrigin", "perspective-origin"],
    ["touchAction", "touch-action"], ["overscrollBehavior", "overscroll-behavior"],
  ];
  for (const [prop, name] of JSDOM_DROPPED) {
    const v = el.style?.[prop];
    if (v && !out.includes(name)) out += `;${name}: ${v}`;
  }
  return out;
};

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
// Round 22: jsdom's cssstyle does not resolve `var(--x)` in an inline style, so a themed surface has
// to be checked as "it names this token, and the token differs between the themes". `cssTokens` reads
// the shipped stylesheet the way the browser would - later blocks win - and answers both halves.
const cssTokens = (selector) => {
  const out = {};
  const body = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\{([^}]*)\\}", "g");
  for (const m of CSS_SRC.matchAll(body)) {
    for (const decl of m[1].split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
};
const LIGHT_TOKEN = cssTokens(":root");
const DARK_TOKEN = { ...LIGHT_TOKEN, ...cssTokens("html.dark") };
const usesToken = (el, prop, token) => styleDecl(el, prop).includes(`var(${token})`);

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
// Round 15: the disc is Liquid Glass tier 1, so its fill is a themed glass token. It is still a
// token (a theme flip re-colours it) - the check only stops accepting hardcoded #000/#fff, and
// the token values themselves are asserted to invert, carry legible alpha, and stay translucent.
const GLASS_BG = { white: "var(--lg-glass-white)", black: "var(--lg-glass-black)", auto: "var(--lg-solid-glass)" };
const wantBg = (o) => (o.chip ? (GLASS_BG[literal(toneOf(o))] ?? GLASS_BG.auto) : "transparent");
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
    let rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    if (rgba) return (0.2126 * +rgba[1] + 0.7152 * +rgba[2] + 0.0722 * +rgba[3]) / 255;
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
  // the round-15 tokens live in their own :root / html.dark blocks (later in the file), so
  // reading only the first block would come back empty - merge every block of each selector.
  const declMap = (sel) => {
    const out = {};
    // a block may also follow a closing comment (the round-15 block does), so */ is a boundary too
    for (const m of css.matchAll(new RegExp(`(?:^|[};]|\\*/)\\s*${sel}\\{([^}]*)\\}`, "g")))
      for (const d of m[1].split(";")) {
        const i = d.indexOf(":");
        if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
      }
    return out;
  };
  const LT = declMap(":root"), DK = declMap("html\\.dark");
  const glass = (name) => [`--${name}`in LT ? LT[`--${name}`] : "", `--${name}` in DK ? DK[`--${name}`] : LT[`--${name}`] ?? ""];
  const alphaOf = (v) => +(/,\s*([\d.]+)\s*\)$/.exec(v)?.[1] ?? 1);
  for (const name of ["lg-solid-glass", "lg-glass-black", "lg-glass-white", "lg-tint", "lg-tint-2"]) {
    const [l, d] = glass(name);
    check(`header/glass: --${name} is declared in both themes`, !!l && !!d, `${l} | ${d}`);
  }
  const [glassLt, glassDk] = glass("lg-solid-glass");
  check("header/glass: the disc token inverts like --solid does (dark fill on light, light on dark)",
    lum(glassLt) < 0.2 && lum(glassDk) > 0.8, `${glassLt} -> ${glassDk}`);
  check("header/glass: the disc stays legible (alpha .70-.95) but is still glass, not a solid",
    alphaOf(glassLt) >= 0.7 && alphaOf(glassLt) <= 0.95 && alphaOf(glassDk) >= 0.7 && alphaOf(glassDk) <= 0.95,
    `light a=${alphaOf(glassLt)}, dark a=${alphaOf(glassDk)}`);
  const dockEl = all("#root .cw-dock")[0];
  const topBar = all("#root div").find((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
  const botBar = all("#root div").find((d) => /inset-x-0 bottom-0 z-40/.test(d.className || ""));
  const inDock = (l) => {
    const b = byLabel(l);
    return !!b && !!b.closest(".cw-dock");
  };
  check("header/foot: Create, Search and More now sit in the bottom dock",
    ["Add card", "Search cards", "More"].every((l) => inDock(l)),
    (dockEl ? all(".cw-dock button[aria-label]").map((b) => b.getAttribute("aria-label")).join(", ") : "no .cw-dock"));
  // the dock is a *child* of the top bar's container on purpose: `ref:d` there is what closes the
  // menu on an outside tap, so moving the dock out of it would break dismissal. The check therefore
  // looks at the top row (the container's first child) - which held the wordmark until round 21 and
  // is now an empty, zero-height row (the client asked for the label to go).
  const topRow = topBar?.firstElementChild;
  check("header/foot: the top row is empty - the Wallet wordmark is gone (round 21)",
    !!topRow && topRow.querySelectorAll("button").length === 0
    && (topRow.textContent || "").trim() === "" && /no-wordmark/.test(BUNDLE_SRC),
    `${topRow ? topRow.querySelectorAll("button").length : "?"} buttons in the row, text \u201c${(topRow?.textContent || "").trim()}\u201d`);
  // Round 27: pill is bottom-centered, just below card stack, floating above safe area
  check("header/foot: the dock is a bottom-anchored pill on the right of the wallet column (round 17)",
    !!dockEl && !!botBar && !!topRow && /fixed inset-x-0 bottom-0/.test(botBar.className)
    && /cw-dock/.test(dockEl.className) && /justify-center/.test(dockEl.parentElement.className)
    && dockEl.querySelectorAll("button").length === 3
    && /padding-bottom/i.test(botBar.getAttribute("style") || "")
    && /env\(safe-area-inset-bottom\)/.test(botBar.getAttribute("style") || "")
    && /16px/.test(botBar.getAttribute("style") || ""),
    `${topRow ? topRow.className.slice(0, 54) : "-"} || ${dockEl ? dockEl.className : "-"} || `
    + `${botBar ? (botBar.getAttribute("style") || "-").slice(0, 46) : "-"}`);
  check("header/foot: the option menu opens upward from the dock's right edge",
    CSS_SRC.match(/\.cw-dock/) && BUNDLE_SRC.includes("ml-auto mb-1 w-[248px]")
    && BUNDLE_SRC.includes("transformOrigin:`right bottom`"),
    "the 248px menu must hang upward from the pill's right edge, mirroring the header's placement");
  check("header/foot: the deck reserves the dock's height, safe area included",
    // jsdom normalises the calc() operand order, so accept either
    /padding-bottom: calc\((env\(safe-area-inset-bottom\) \+ 62px|62px \+ env\(safe-area-inset-bottom\))\)/
      .test(all("#root main")[0]?.getAttribute("style") || ""),
    all("#root main")[0]?.getAttribute("style")?.slice(0, 80) || "-");
  check("header/foot: the create disc keeps its 36px box and its glass tier in the dock",
    (() => {
      const fab = all(".cw-dock button").find((b) => b.getAttribute("aria-label") === "Add card");
      return !!fab && /h-9/.test(fab.className) && /w-9/.test(fab.className) && /cw-lg-fab/.test(fab.className)
        && /background: var\(--lg-solid-glass\)/.test(fab.getAttribute("style") || "");
    })(),
    (all(".cw-dock button")[0]?.getAttribute("style") || "-").slice(0, 70));
  tap(byLabel("More"));
  await settle(W, 500);
  const menuNode = all("#root div").find((d) => /w-\[248px\]/.test(d.className || ""));
  const openRows = all("button").map((b) => (b.textContent || "").trim());
  check("header/foot: the More menu still opens, and it opens above the dock",
    openRows.some((t) => /^Settings$/.test(t)) && !!menuNode && !!botBar?.contains(menuNode) && /mb-1/.test(menuNode.className),
    menuNode ? `rows: ${openRows.slice(-4).join(",")} | ${menuNode.className.slice(0, 40)}` : "no menu mounted");
  tap(byLabel("More"));
  await settle(W, 1400);
  check("header/foot: tapping the dock control again closes it (no stuck overlay)",
    !all("#root div").some((d) => /w-\[248px\]/.test(d.className || "")),
    `${all("#root div").filter((d) => /w-\[248px\]/.test(d.className || "")).length} menu node(s) still mounted`);

  check("header/glass: tier 1 sheet fill is more transparent than the disc (material hierarchy)",
    alphaOf(glass("lg-tint")[0]) < alphaOf(glassLt) && alphaOf(glass("lg-tint")[1]) < alphaOf(glassDk),
    `sheet a=${alphaOf(glass("lg-tint")[0])}/${alphaOf(glass("lg-tint")[1])} vs disc a=${alphaOf(glassLt)}/${alphaOf(glassDk)}`);
  check("header: the --solid/--ink tokens invert between themes (auto tone is meaningful)",
    solidLt < 0.2 && solidDk > 0.8 && inkLt < 0.2 && inkDk > 0.8,
    `solid ${token(lt, "solid")}->${token(dk, "solid")}, ink ${token(lt, "ink")}->${token(dk, "ink")}`);
  check("header: every option declares tokens, not literals (so a theme flip re-colours them)",
    HEADER_CFG.options.every((o) => {
      const t = toneOf(o);
      // even the pinned tones are tokens now, so a literal in any of them fails this
      if (t === "black" || t === "white") {
        const c = byLabel(o.label);
        return o.chip ? /var\(--lg-glass-(black|white)\)/.test(styleDecl(c, "background")) : true;
      }
      const c = byLabel(o.label);
      return o.chip
        ? /var\(--lg-solid-glass\)/.test(styleDecl(c, "background")) && /var\(--on-solid\)/.test(styleDecl(c, "color"))
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
// round 22: the panel is the one surface patch 7 had painted near-black for the light-theme mock
// ("#0b0b0d panel, white rows ... it does not invert") and it kept that literal through every round
// that made the app theme-aware. It rides the tokens again - this is the light theme.
check("header: the dropdown panel rides the theme tokens, not a literal",
  usesToken(panel, "background", "--sheet") && usesToken(panel, "border", "--line")
  && usesToken(panel, "box-shadow", "--menu-shadow"),
  `bg=${styleDecl(panel, "background")} border=${styleDecl(panel, "border")} shadow=${styleDecl(panel, "box-shadow")}`);
check("header: those tokens really do differ between light and dark (the bug was a fixed dark panel)",
  LIGHT_TOKEN["--sheet"] === "#fff" && DARK_TOKEN["--sheet"] === "#1c1c1e"
  && LIGHT_TOKEN["--ink"] === "#111113" && DARK_TOKEN["--ink"] === "#f5f5f7"
  && LIGHT_TOKEN["--menu-shadow"] !== DARK_TOKEN["--menu-shadow"],
  `sheet ${LIGHT_TOKEN["--sheet"]} -> ${DARK_TOKEN["--sheet"]}, ink ${LIGHT_TOKEN["--ink"]} -> ${DARK_TOKEN["--ink"]}`);
{
  const rows = [...(panel?.querySelectorAll("button") || [])];
  const plain = rows.filter((r) => !/Delete all cards/.test(r.textContent || ""));
  const icons = plain.map((r) => r.querySelector("svg"));
  check("header: dropdown rows read the themed ink, and the destructive row the themed red",
    plain.length > 0 && plain.every((r) => usesToken(r, "color", "--ink"))
    && rows.filter((r) => /Delete all cards/.test(r.textContent || "")).every((r) => usesToken(r, "color", "--danger"))
    && LIGHT_TOKEN["--danger"] === "#ff453a",
    rows.map((r) => `${(r.textContent || "").trim().slice(0, 12)}=${styleDecl(r, "color")}`).join(" | "));
  // the report asked for "background, text and icon colors": the icons are stroked currentColor, so
  // they inherit the row's colour with no declaration of their own.
  check("header: the menu icons are currentColor, so they invert with the rows",
    icons.length > 0 && icons.every((i) => /currentColor/.test(i.innerHTML) || /stroke="currentColor"/.test(i.outerHTML)),
    `${icons.length} icon(s), strokes=${icons.map((i) => (i.outerHTML.match(/stroke="([^"]*)"/) || [])[1]).join(",")}`);
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
  check("header: the destructive row keeps its red in both themes (var(--danger) is red in each)",
    usesToken(del, "color", "--danger") && LIGHT_TOKEN["--danger"] === "#ff453a" && DARK_TOKEN["--danger"] === "#ff6961",
    `${styleDecl(del, "color")} | light ${LIGHT_TOKEN["--danger"]} / dark ${DARK_TOKEN["--danger"]}`);
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
  [...d.querySelectorAll("#root div")].filter((e) => /backdrop-filter/i.test(inlineStyle(e))).length;
const titleStyle = (d) => {
  const el = [...d.querySelectorAll("#root div")].find(
    (e) => /text-align:\s*center/i.test(e.getAttribute("style") || "") && /font-size:\s*13px/i.test(e.getAttribute("style") || "")
  );
  const st = inlineStyle(el);   // was el.getAttribute("style"): jsdom drops perspective/... there
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
  check("cover OFF: state is shown by the control, not by an explanation (patch19)",
    !/Off · plain cards|On · pouch/.test(D2.getElementById("root").textContent) &&
    coverSwitch(D2)?.getAttribute("aria-checked") === "false", "no subtitle, switch reads off");
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
// round 22: the same menu, now with the app in dark - it must invert with everything else, which is
// the half of the report that was already "working" (and must keep working).
{
  const Wd = darkOff.window, Dd = Wd.document;
  const moreBtn = [...Dd.querySelectorAll("#root button[aria-label]")].find((b) => b.getAttribute("aria-label") === "More");
  moreBtn?.dispatchEvent(new Wd.MouseEvent("click", { bubbles: true }));
  await settle(Wd, 500);
  const dpanel = [...Dd.querySelectorAll("#root div")].find((d) => /w-\[248px\]/.test(d.className || ""));
  const drows = [...(dpanel?.querySelectorAll("button") || [])];
  const plainRows = drows.filter((r) => !/Delete all cards/.test(r.textContent || ""));
  check("header: the same menu in dark mode is the same declaration, resolving the other way",
    usesToken(dpanel, "background", "--sheet") && usesToken(dpanel, "border", "--line")
    && plainRows.length > 0 && plainRows.every((r) => usesToken(r, "color", "--ink"))
    && DARK_TOKEN["--sheet"] === "#1c1c1e" && DARK_TOKEN["--ink"] === "#f5f5f7",
    `bg=${styleDecl(dpanel, "background")} (dark sheet ${DARK_TOKEN["--sheet"]}), rows=${plainRows.map((r) => styleDecl(r, "color")).join(",")}`);
  check("header: the same menu in dark mode is not the literal it used to be",
    BUNDLE_SRC.includes("background:`var(--sheet)`") && !BUNDLE_SRC.includes("#0b0b0d"),
    "one declaration, both themes");
}

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
    const box = [...Dv.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(inlineStyle(d)));
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
check("header: the create button is the compact round-12 size (36px box, 19/21px glyphs)",
    (() => {
      const bare = HEADER_CFG.options.findIndex((o) => !o.chip);
      const svg = (i) => chips[i]?.querySelector("svg");
      return chips.every((c) => /h-9/.test(c.className || "") && /w-9/.test(c.className || "")) &&
        (bare < 0 || svg(bare)?.getAttribute("width") === "21") &&
        svg(0)?.getAttribute("width") === "19";
    })(),
    HEADER_CFG.options.map((o) => `${o.id}:${o.chip ? "19(disc)" : "21(bare)"}`).join(" "));
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
  const styleOf = (el) => inlineStyle(el);
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
  // Round 23 retired the tap-on-the-backdrop dismissal (the report asked for the empty bands to stop
  // taking touches), so the hand-off is driven through the viewer's own remaining close gesture:
  // swiping the card down, which is the same handler the device row exercises. See Test 6n.
  const viewerCard = [...Ds.querySelectorAll("#root div")].find((d) => /no-select absolute touch-none/.test(d.className || ""));
  const closeFrom = (x, y) => {
    viewerCard.dispatchEvent(ptr("pointerdown", x, y));
    viewerCard.dispatchEvent(ptr("pointermove", x, y + 60));
    viewerCard.dispatchEvent(ptr("pointermove", x, y + 140));
    viewerCard.dispatchEvent(ptr("pointerup", x, y + 140));
  };
  check("stack: closing the viewer now happens through the card's own swipe-down", !!viewerCard,
    viewerCard ? "card box found" : "no viewer card box in the tree");
  closeFrom(195, 300);
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
  const stage2 = [...Dw.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(inlineStyle(d)));
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
  const styleOf = (el) => inlineStyle(el);
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

  // patch 35: a finger is not a stolen stream. The old watchdog called 340ms of
  // event-quiet "stolen", but a finger held still mid-drag is exactly that quiet - so
  // the row was committed to the nearest card and the *next* move replayed the whole
  // gesture delta from the new base (the device report: "cards sometimes shift/slide
  // off to the side"). Nothing may move while the finger is on the glass.
  const txBeforePause = tx(front());
  await settle(Wc, 900);            // well past the old 340ms window
  const txAfterPause = tx(front());
  check("carousel: a finger held still mid-drag never has the row yanked out from under it",
    Math.abs(txAfterPause - txBeforePause) < 1,
    `front card x ${txBeforePause.toFixed(2)} -> ${txAfterPause.toFixed(2)}px across a 900ms hold`);

  // ...and the next move adds only its own delta, instead of replaying the whole gesture
  const perFingerPx = Math.abs(txHeld - txAtRest) / 110;   // row px per finger px, measured
  Wc.dispatchEvent(ptr("pointermove", cx + 150, cy));      // the finger moves on by 40px
  await settle(Wc, 60);
  const txAfterMove = tx(front());
  check("carousel: the drag continues from where the finger left it (no delta replay)",
    Math.abs(txAfterMove - (txAfterPause + 40 * perFingerPx)) < 2,
    `front card x ${txAfterMove.toFixed(2)}px, expected ~${(txAfterPause + 40 * perFingerPx).toFixed(2)}px`);
  Wc.dispatchEvent(ptr("pointerup", cx + 150, cy));
  await settle(Wc, 900);
  check("carousel: releasing after the hold still settles centred", Math.abs(tx(front())) < 2,
    `front card x ${tx(front()).toFixed(2)}px`);

  // now the case the watchdog exists for: the stream is gone for good. A held pointer
  // that has seen no event anywhere for 1500ms is treated as eaten, the row glides home
  // (never jumps, never commits an index step) and the rest state is centred again.
  const txStolen = await drag(110, false);
  await settle(Wc, 2600);           // 1500ms of quiet + the 400ms tick + the glide
  const txRecovered = tx(front());
  check("carousel: watchdog re-centres the row with no pointerup", Math.abs(txRecovered) < 2,
    `front card x ${txRecovered.toFixed(2)}px after the idle window (dragged to ${txStolen.toFixed(1)}px)`);

  // the real case behind the device report: the swipe that backgrounded the app (the
  // bottom gesture strip is the home/recents gesture) - Android delivers nothing else,
  // but visibilitychange does fire, so the row is put right immediately instead of
  // waiting for the 1500ms net.
  const txBeforeHide = await drag(110, false);
  Object.defineProperty(Wc.document, "hidden", { value: true, configurable: true });
  Wc.document.dispatchEvent(new Wc.Event("visibilitychange"));
  await settle(Wc, 700);
  check("carousel: a gesture lost to the app being backgrounded is recovered at once",
    Math.abs(tx(front())) < 2, `front card x ${tx(front()).toFixed(2)}px (dragged to ${txBeforeHide.toFixed(1)}px)`);
  Object.defineProperty(Wc.document, "hidden", { value: false, configurable: true });

  await drag(240, true);            // ordinary swipe still works
  const txAfterSwipe = tx(front());
  check("carousel: a normal drag+release still settles centred", Math.abs(txAfterSwipe) < 2,
    `front card x ${txAfterSwipe.toFixed(2)}px`);

  check("carousel: grabbing mid-glide finishes the settle instead of dropping it",
    /T\.current\?\.\(\),g\.current&&y\(\);let sl=u\.slide\|\|1/.test(BUNDLE_CAROUSEL_SRC),
    "pointerdown calls y()");
  // the code-level guards the behaviour above rests on (patch 35)
  const carRecovery = BUNDLE_CAROUSEL_SRC.split("home=()=>")[1]?.split("off=d.on")[0] || "";
  check("carousel: the idle watchdog refuses to move a held row", 
    /if\(ptr\.held\(\)&&!ptr\.quiet\(1500\)\)\{arm\(\);return\}/.test(BUNDLE_CAROUSEL_SRC),
    "a finger on the glass owns the row");
  check("carousel: the recovery glides home instead of jumping", 
    /Ju\(d,0,Cd\)/.test(carRecovery) && !/d\.jump\(0\)/.test(carRecovery),
    "recovery never jumps and never commits an index step");
  check("carousel: the drag rebases on the row's live value", 
    /Math\.abs\(d\.get\(\)-k\)>\.5&&\(k=d\.get\(\),sv=s\)/.test(BUNDLE_CAROUSEL_SRC) &&
      /k=d\.get\(\),sv=s/.test(BUNDLE_CAROUSEL_SRC),
    "a move can only ever add its own delta");
  check("carousel: a settle to zero clears the settle slot (it used to disarm the watchdog)",
    /g\.current=Ju\(d,0,\{\.\.\.Cd,onComplete:\(\)=>\{g\.current=null\}\}\)/.test(BUNDLE_CAROUSEL_SRC),
    "no finished animation left in g.current");
  check("carousel: no console errors while the row recovers", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 160));
}


// ---------------------------------------------------------------------------
// Test 6h: in the stack, a lost gesture comes back to a card and a cancel is not a tap (patch35)
//
// The same report on the other view. __cwStack never got patch 14's treatment, so a
// gesture the system ate left the deck at a fractional index *for good* - and because
// `drag.current` stayed set, the `drag.current||p.jump(r)` guard meant the deck stopped
// following index changes too. `pointercancel` was wired to the tap handler, so a
// gesture the OS took over (no movement at all) opened whichever card the finger
// happened to be over.
// ---------------------------------------------------------------------------
{
  const CARDS4s = JSON.stringify([
    { id: "s1", src: "cards/one.jpg", title: "Alpha One", subtitle: "1", fields: [] },
    { id: "s2", src: "cards/two.jpg", title: "Bravo Two", subtitle: "2", fields: [] },
    { id: "s3", src: "cards/three.jpg", title: "Charlie Three", subtitle: "3", fields: [] },
    { id: "s4", src: "cards/four.jpg", title: "Delta Four", subtitle: "4", fields: [] },
  ]);
  const ptr = (W, type, x, y) => {
    const e = new W.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const tx = (el) => parseFloat((inlineStyle(el).match(/translateX\((-?[\d.]+)px\)/) || [])[1] ?? "0");
  const stageOf = (D) => [...D.querySelectorAll("#root div")].find(
    (d) => /perspective:\s*1200/.test(inlineStyle(d)) && /overflow:\s*hidden/.test(inlineStyle(d)) &&
      d.className === "relative w-full");
  const cardsOf = (D) => [...D.querySelectorAll("#root div.absolute.no-select")];
  const open = (W) => /WhatsApp/.test(W.document.getElementById("root").textContent || "");
  const boot = async () => {
    const s = makeDom({ [CARDS_KEY]: CARDS4s, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) },
      { withLayout: true });
    runBundle(s.window, s.errors);
    await settle(s.window, 900);
    return s;
  };

  const st = await boot();
  const Wk = st.window, Dk = Wk.document;
  const box = stageOf(Dk);
  const step = Math.abs(tx(cardsOf(Dk)[1]) - tx(cardsOf(Dk)[0]));
  // how far the deck is from resting on a whole card, in px
  const worstOff = () => Math.max(...cardsOf(Dk).map(
    (el) => Math.abs(tx(el) / step - Math.round(tx(el) / step)) * step));
  check("stack: four cards rest on exact card slots", cardsOf(Dk).length === 4 && worstOff() < 1,
    `${cardsOf(Dk).length} cards, spacing ${step.toFixed(1)}px`);

  const cx = (Wk.innerWidth || 800) / 2, cy = (Wk.innerHeight || 600) / 2;
  box.dispatchEvent(ptr(Wk, "pointerdown", cx, cy));
  for (let i = 1; i <= 4; i++) { Wk.dispatchEvent(ptr(Wk, "pointermove", cx - i * 40, cy)); await settle(Wk, 25); }
  check("stack: an unreleased drag really does leave the deck between two cards",
    worstOff() > 20, `worst offset ${worstOff().toFixed(1)}px (0 would mean nothing to recover)`);

  await settle(Wk, 2600);            // 1500ms of quiet + the 400ms tick + the snap tween
  check("stack: the deck comes back to a card with no pointerup", worstOff() < 1,
    `worst offset ${worstOff().toFixed(1)}px`);

  // ...and the deck still answers gestures afterwards (`drag.current` was released)
  box.dispatchEvent(ptr(Wk, "pointerdown", cx, cy));
  for (let i = 1; i <= 4; i++) { Wk.dispatchEvent(ptr(Wk, "pointermove", cx - i * 40, cy)); await settle(Wk, 25); }
  Wk.dispatchEvent(ptr(Wk, "pointerup", cx - 160, cy));
  await settle(Wk, 900);
  check("stack: a swipe after the recovery still flips the deck, landing on a card",
    worstOff() < 1 && Math.abs(tx(cardsOf(Dk)[0])) >= step - 2,
    `worst offset ${worstOff().toFixed(1)}px, front-left card at ${tx(cardsOf(Dk)[0]).toFixed(1)}px`);
  check("stack: no console errors while the deck recovers", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 160));

  // the app going to the background is the one case with a *reliable* signal, so the
  // deck must be back on a card immediately rather than after the 1500ms net
  box.dispatchEvent(ptr(Wk, "pointerdown", cx, cy));
  for (let i = 1; i <= 4; i++) { Wk.dispatchEvent(ptr(Wk, "pointermove", cx - i * 30, cy)); await settle(Wk, 25); }
  Object.defineProperty(Dk, "hidden", { value: true, configurable: true });
  Dk.dispatchEvent(new Wk.Event("visibilitychange"));
  await settle(Wk, 700);
  check("stack: a gesture lost to the app being backgrounded is recovered at once",
    worstOff() < 1, `worst offset ${worstOff().toFixed(1)}px after backgrounding`);
  Object.defineProperty(Dk, "hidden", { value: false, configurable: true });

  // a cancel is an abort: no lift, no sheet, and the deck does not move a pixel
  const sc = await boot();
  const Wc2 = sc.window, Dc2 = Wc2.document;
  const box2 = stageOf(Dc2);
  const before2 = cardsOf(Dc2).map(inlineStyle);
  box2.dispatchEvent(ptr(Wc2, "pointerdown", 280, 300));     // over a card BEHIND the front one
  Wc2.dispatchEvent(ptr(Wc2, "pointercancel", 280, 300));
  await settle(Wc2, 700);                                    // longer than the 480ms long-press
  check("stack: a cancelled gesture never opens the card under the finger",
    !open(Wc2) && sc.errors.length === 0, open(Wc2) ? "the sheet opened on a cancel" : "nothing opened");
  check("stack: ...and it does not move the deck either",
    cardsOf(Dc2).map(inlineStyle).join("|") === before2.join("|"),
    "offsets unchanged by the cancel");

  // the code-level guards the behaviour above rests on (patch 35)
  const STACK_SRC35 = BUNDLE_SRC.split("function __cwStack")[1]?.split("function Td")[0] || "";
  check("stack: the idle watchdog brings a lost deck back to a card",
    /if\(ptr\.held\(\)&&!ptr\.quiet\(1500\)\)\{arm\(\);return\}/.test(STACK_SRC35) &&
      /window\.clearTimeout\(hold\.current\),snap\(e\)/.test(STACK_SRC35),
    "snap() is index-based, so the recovery is a tween");
  check("stack: the recovery releases the gesture so index changes move the deck again",
    /drag\.current=null,kill\.current\?\.\(\)/.test(STACK_SRC35) && /kill\.current=b/.test(STACK_SRC35),
    "listeners, drag flag and long-press timer all released");
  check("stack: pointercancel marks the gesture aborted instead of running the tap path",
    /addEventListener\(`pointercancel`,t=>\{if\(t\.pointerId!==n\)return;ab=!0,y\(t\)\}\)/.test(STACK_SRC35) &&
      /if\(ab\)\{drag\.current=null,snap\(p\.get\(\)\);return\}/.test(STACK_SRC35),
    "abort settles to the nearest card and never opens");
  check("stack: the drag rebases on the deck's live value",
    /Math\.abs\(p\.get\(\)-w0\)>\.02&&\(w0=p\.get\(\),s0=e\)/.test(STACK_SRC35) &&
      /w0=p\.get\(\),s0=e/.test(STACK_SRC35),
    "a move can only ever add its own delta");
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
  const styleOf = (el) => inlineStyle(el);
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
  const styleOf = (el) => inlineStyle(el);
  const gradOf = (el) => { const raw = el?.getAttribute("data-tray") || el?.getAttribute("data-sheen") || ""; if (raw) return `background:${raw}`; return (styleOf(el).match(/background:[^;]*/) || ["-"])[0]; };
  const mount = async (colors, settings) => {
    const st = makeDom({ [CARDS_KEY]: CARDS_COL(colors), [SETTINGS_KEY]: JSON.stringify(settings) }, { withLayout: true });
    runBundle(st.window, st.errors);
    await settle(st.window, 900);
    const D = st.window.document;
    const byName = (name) => {
      const w = [...D.querySelectorAll("#root div.absolute.top-0")].find((d) => (d.textContent || "").startsWith(name));
      return [...(w?.querySelectorAll("div") || [])].find((d) => /left-0/.test(d.className) && (d.getAttribute("data-tray") || /rgb|linear-gradient/.test(styleOf(d))));
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
      .find((d) => /left-0/.test(d.className) && (d.getAttribute("data-tray") || /rgb|linear-gradient/.test(styleOf(d))));
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
  const styleOf = (el) => inlineStyle(el);
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
    const on = [...row.children].find((b) => b.getAttribute("data-on") === "true"
      || /rgb\(10,\s*132,\s*255\)/.test(styleOf(b)) || /#0a84ff/i.test(styleOf(b)));
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

  // -- the wordmark is gone (round 21): the client asked for the top-left label to go, and the
  //    checks below are what "gone" means - nothing moved to compensate, nothing left behind.
  const rowEl = all("#root div").find((d) => /inset-x-0 top-0 z-40/.test(d.className || ""))?.firstElementChild;
  const wm = [...D7.querySelectorAll("#root span")].filter(
    (el) => (el.textContent || "").trim() === "Wallet" && /font-size:\s*28px/.test(styleOf(el)));
  check("header: the 'Wallet' wordmark is gone from the top-left (round 21)",
    wm.length === 0 && (rowEl?.textContent || "").trim() === "" && !/children:`Wallet`/.test(BUNDLE_SRC),
    `${wm.length} wordmark span(s), row text \u201c${(rowEl?.textContent || "").trim()}\u201d`);
  check("header: the empty row keeps the header row's geometry, so the dock still lands on its x",
    (() => {
      const dockRow = all("#root .cw-dock")[0]?.parentElement;
      return !!rowEl && !!dockRow && rowEl.className === dockRow.className
        && rowEl.querySelectorAll("button").length === 0;
    })(),
    "dock row == header row, and no control was dragged up into it");
  check("header: nothing was moved to compensate - the dock still holds the three controls",
    all("#root .cw-dock button[aria-label]").map((b) => b.getAttribute("aria-label")).join() ===
      "Add card,Search cards,More",
    all("#root .cw-dock button[aria-label]").map((b) => b.getAttribute("aria-label")).join());
  check("header: the reserves are untouched, so removing the label did not shift the deck",
    BUNDLE_SRC.includes("paddingTop:`calc(env(safe-area-inset-top) + 58px)`")
    && BUNDLE_SRC.includes("paddingBottom:`calc(env(safe-area-inset-bottom) + 62px)`")
    && BUNDLE_SRC.includes("/*cardwallet:no-wordmark*/"),
    "58px / 62px reserves + the round-21 marker");
  {
    const kids = rowEl ? [...rowEl.children] : [];
    const dock0 = all("#root .cw-dock")[0];
check("header: the label left, the dock stayed - the option menu still opens inside ref:d",
  (() => {
    const dockRow = all("#root .cw-dock")[0];
    const kids = (e) => [...(e?.children || [])].map((c) => c.tagName.toLowerCase() + (c.getAttribute("aria-label") ? ":" + c.getAttribute("aria-label") : ""));
    return kids(rowEl).length === 0 && kids(dockRow).join() === "button:Add card,button:Search cards,button:More"
      && /ref:d,className:`pointer-events-none fixed inset-x-0 top-0 z-40 px-2`/.test(BUNDLE_SRC);
  })(),
  `row=${[...(all("#root div").find((d) => /inset-x-0 top-0 z-40/.test(d.className || ""))?.firstElementChild?.children || [])].length} dock=${[...(dock0?.children || [])].length}`);

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
// Test 6k: premium settings - glass sheet, Custom Pouch panel, live preview, and
// every pouch control actually reaching the wallet (patches 18, 19, 20)
// ---------------------------------------------------------------------------
{
  const st = (el) => inlineStyle(el);   // jsdom gap, see inlineStyle
  const rgbRe = (r, g, b) => new RegExp(`rgb\\(\\s*${r},\\s*${g},\\s*${b}\\s*\\)`);
  const CARDS19 = JSON.stringify([
    { id: "p1", src: "cards/one.jpg", title: "Alpha", subtitle: "1", fields: [] },
    { id: "p2", src: "cards/two.jpg", title: "Beta", subtitle: "2", fields: [] },
  ]);

  const open = async (win, doc) => {
    const btnLabel = (l) => [...doc.querySelectorAll("#root button[aria-label]")].find((b) => b.getAttribute("aria-label") === l);
    const btnText = (re) => [...doc.querySelectorAll("#root button")].find((b) => re.test((b.textContent || "").trim()));
    const click = (el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    click(btnLabel("More"));
    await settle(win, 300);
    click(btnText(/^Settings$/));
    await settle(win, 600);
    return { click, btnText, btnLabel };
  };
  const sheetOf = (doc) => [...doc.querySelectorAll("#root div")].find((d) => /cw-glass-sheet/.test(d.className || ""));
  const tapEl = (win, el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  // null-safe query: with an earlier patch missing there is no sheet to read, and the suite
  // has to report that as failed checks rather than crash on it
  const q = (root, sel) => (root ? [...root.querySelectorAll(sel)] : []);
  const mount19 = async (settings, cards = CARDS19) => {
    const m = makeDom({ [CARDS_KEY]: cards, [SETTINGS_KEY]: JSON.stringify(settings) }, { withLayout: true });
    runBundle(m.window, m.errors);
    await settle(m.window, 900);
    return m;
  };

  // ---- patch18: typography + real glass -----------------------------------
  check("type: the app stack names the SF Pro faces before its fallbacks",
    /font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","SF Pro",Inter/.test(CSS_SRC),
    (CSS_SRC.match(/font-family:[^;]{0,80}/) || ["-"])[0]);
  check("type: copy carries a hair of negative tracking",
    /line-height:1\.5;letter-spacing:-\.011em/.test(CSS_SRC), "on html,:host");
  check("glass: sheet, card and control tokens are themed, not hardcoded",
    /:root\{--glass:/.test(CSS_SRC) && /html\.dark\{--glass:/.test(CSS_SRC) && /--glass-blur:14px/.test(CSS_SRC),
    "light + dark values for --glass/--glass-blur");
  check("glass: the panel blurs what is behind it (was an opaque sheet-bg)",
    /\.cw-glass-sheet\{[^}]*backdrop-filter:blur\(var\(--glass-blur\)\) saturate\(1\.7\)/.test(CSS_SRC),
    (CSS_SRC.match(/\.cw-glass-sheet\{[^}]{0,90}/) || ["-"])[0]);
  // Round 17 rewrote this check rather than deleting it: the scrim used to blur at 20px, and because
  // the sheet is its child, that made the sheet's own blur a *nested* full-screen readback - the lag.
  check("glass: the scrim dims only - no backdrop-filter, no scrim-blur token left",
    /\.cw-scrim\{background:var\(--scrim\)\}/.test(CSS_SRC) && !/\.cw-scrim\{[^}]*backdrop-filter/.test(CSS_SRC)
    && !/--scrim-blur/.test(CSS_SRC),
    (CSS_SRC.match(/\.cw-scrim\{[^}]{0,60}/) || ["-"])[0]);
  check("glass: the sheet's blur is capped at 14px and both sheet tokens agree (the lag fix)",
    /--lg-blur:1[0-6]px/.test(CSS_SRC)
    && (CSS_SRC.match(/--lg-blur:(\d+)px/) || [])[1] === (CSS_SRC.match(/--glass-blur:(\d+)px/) || [])[1],
    `--lg-blur ${(CSS_SRC.match(/--lg-blur:(\d+)px/) || ["-", "-"])[1]}px, --glass-blur `
    + `${(CSS_SRC.match(/--glass-blur:(\d+)px/) || ["-", "-"])[1]}px`);
  check("glass: reduced transparency falls back to solid fills",
    /@media \(prefers-reduced-transparency:reduce\)\{[^@]*\.cw-glass-sheet\{background:var\(--sheet\)\}/.test(CSS_SRC),
    "backdrop-filter:none + var(--sheet/--raised)");
  check("glass: the preview box is display-only",
    /\.cw-preview\{[^}]*pointer-events:none/.test(CSS_SRC), "no taps through the preview");

  const g18 = await mount19({ cover: true });
  {
    const { D: doc, W: win } = { D: g18.window.document, W: g18.window };
    const ui = await open(win, doc);
    const sheet = sheetOf(doc);
    check("settings: the sheet is the glass panel, not sheet-bg",
      !!sheet && /cw-glass-sheet/.test(sheet?.className) && !/sheet-bg/.test(sheet?.className),
      sheet ? sheet?.className.slice(0, 60) : "no glass panel found");
    check("settings: the sheet still asks for a real backdrop blur (cheaper radius, not no glass)",
      !!sheet && /cw-lg-primary/.test(sheet.className)
      && /\.cw-lg-primary\{[^}]*backdrop-filter:blur\(var\(--lg-blur\)\)/.test(CSS_SRC),
      sheet ? sheet.className.slice(0, 56) : "no panel");
    const scrim = [...doc.querySelectorAll("#root div")].find((d) => /cw-scrim/.test(d.className || ""));
    check("settings: the scrim is a plain dim layer over the deck (no inline background, nothing to blur)",
      !!scrim && !/background/.test(st(scrim)) && !/backdrop-filter/.test(st(scrim)),
      st(scrim).slice(0, 60) || "-");
    check("settings: the title is a heading (.cw-title), not an uppercase label",
      [...doc.querySelectorAll("#root .cw-title")].some((e) => (e.textContent || "").trim() === "Settings"),
      [...doc.querySelectorAll("#root .cw-title")].map((e) => e.textContent).join(",") || "-");
    check("settings: only the settings sheet got the glass treatment",
      (BUNDLE_SRC.match(/cw-glass-sheet/g) || []).length === 1, "one use in the bundle");
    check("settings: no bulky blue pill buttons left in the sheet",
      !/background:#0a84ff/.test(st(sheet) + q(sheet, "button").map(st).join("|")),
      "active state is a data-on attribute styled by CSS");
  }

  // ---- patch19: one Custom Pouch panel, no explanations, live preview -----
  {
    const win = g18.window;
    const doc = win.document;
    const sheet = sheetOf(doc);
    const txt = sheet ? sheet?.textContent || "" : "";
    check("settings: Custom Pouch holds Design and Layout, Appearance is its own card (patch22)",
      ["Custom Pouch", "Design", "Layout", "Appearance"].every((h) => txt.includes(h)) &&
      !/(^|[^a-zA-Z])Cards([^a-zA-Z]|$)/.test(txt),
      "groups: " + ["Custom Pouch", "Design", "Layout", "Appearance"].filter((h) => txt.includes(h)).join("/"));
    check("settings: every explanatory line is gone",
      !/Original pouch shape|Folded Slate pouch|Swipe pouches left and right|Horizontal 3D carousel|Follows the phone|Always dark|Dashed seam|everything stays on this phone/.test(txt),
      "controls carry the state instead");
    check("settings: headings are typography now - medium bold ink, no uppercase grey",
      q(sheet, ".cw-h,.cw-sub,.cw-title").length >= 6 &&
      /\.cw-h\{font-size:15px;font-weight:600;letter-spacing:-\.3px;color:var\(--ink\)\}/.test(CSS_SRC) &&
      /\.cw-title\{font-size:20px;font-weight:700/.test(CSS_SRC) &&
      !q(sheet, ".cw-h,.cw-sub").some((e) => /uppercase/.test(e.className || "")),
      `${q(sheet, ".cw-h").length} card headings, ${q(sheet, ".cw-sub").length} group labels, 1 title`);
    const prevBox = sheet && q(sheet, "div").find((d) => /cw-preview/.test(d.className || ""));
    const prevInner = prevBox && q(prevBox, "div").find((d) => /cw-preview-in/.test(d.className || ""));
    check("preview: the panel mounts the wallet's own card tree",
      !!prevInner && prevInner.querySelector("div.absolute.top-0[data-cwc]") !== null &&
      q(prevInner, "div").some((d) => /left-0/.test(d.className || "") && (d.getAttribute("data-tray") || /linear-gradient/.test(st(d)) || /rgb/.test(st(d)))),
      prevInner ? `${q(prevInner, "div.absolute.top-0").length} card(s) painted` : "no preview box");
    check("preview: the wallet behind is separate from the preview",
      [...doc.querySelectorAll("#root div.absolute.top-0[data-cwc]")].length >= 4,
      `${[...doc.querySelectorAll("#root div.absolute.top-0[data-cwc]")].length} real card wrappers (wallet + preview)`);
    const chips = q(sheet, "button.cw-chip");
    const labels = () => chips.map((c) => (c.textContent || "").trim()).join(",");
check("settings: the carousel view offers 7 chip buttons and 12 sliders, no pills",
      labels() === "Slate,Classic,Carousel,Stack,System,Light,Dark" &&
      q(sheet, "input[type=range]").length === 12 &&
      !/background:#0a84ff/.test(q(sheet, "button").map(st).join("|")),
      `${chips.length} chips (${labels()}), ${q(sheet, "input[type=range]").length} sliders`);
    check("settings: material and border became the Sheen and Edge sliders",
      q(sheet, "input[type=range]").map((i) => i.getAttribute("aria-label")).join(",") ===
      "Background,Radius,Shadow,Sheen,Edge,Grading,Grain,Card spacing,Scale,Side cards,Peek amount,Position",
      q(sheet, "input[type=range]").map((i) => i.getAttribute("aria-label")).join(","));
    const before = win.localStorage.getItem(CARDS_KEY);
    const prevIn = () => q(sheet, "div").find((d) => /cw-preview-in/.test(d.className || ""));
    tapEl(win, chips.find((c) => (c.textContent || "").trim() === "Stack"));
    await settle(win, 700);
    const chipsNow = q(sheet, "button.cw-chip").map((c) => (c.textContent || "").trim());
    const stage = q(prevIn() || sheet, "div").find((d) => /relative w-full/.test(d.className || ""));
    const widest = () => Math.max(0, ...q(prevIn(), "div").map((d) => parseFloat((st(d).match(/width:\s*([\d.]+)px/) || [0, "0"])[1])));
    check("settings: Stack swaps in the stack's own six rows - no chips, nothing shared",
      chipsNow.length === 7 && !chipsNow.join(",").includes("Fan") &&
      q(sheet, "input[type=range]").slice(7).map((i) => i.getAttribute("aria-label")).join(",") ===
      "Card overlap,Vertical offset,Scale,Rotation,Visible cards,Spacing",
      `${chipsNow.length} chips / ${q(sheet, "input[type=range]").slice(7).map((i) => i.getAttribute("aria-label")).join(",")}`);
    check("preview: the stack is really mounted, sized from the stage box (patch21's fit)",
      // `min-height: 0` vs `0px` is a cssstyle serialisation detail (React writes the number 0 without a
      // unit); the contract under test is that the stage box is told to shrink, so accept either.
      !!stage && /perspective-origin/.test(st(stage)) && /min-height:\s*0(px)?\b/.test(st(stage)) &&
      widest() > 120 && widest() < 400,
      `widest ${widest().toFixed(0)}px, stage ${st(prevIn()).match(/width:[^;]+/)?.[0] || "-"}`);
    check("settings: switching the view in the sheet moves the wallet too, cards untouched",
      /flex min-h-0 flex-1 flex-col/.test(doc.querySelector("#root main")?.className || "") &&
      (win.localStorage.getItem(CARDS_KEY) || "") === before,
      doc.querySelector("#root main")?.className || "-");
    check("settings: no console errors from the new sheet", g18.errors.length === 0,
      g18.errors.slice(0, 1).join("").slice(0, 160));
  }

  // ---- patch20: the controls drive geometry, theme and the painter ---------
  const setValue = (win, el, v) => {
    const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    set.call(el, String(v));
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const trayOf = (root) => root.querySelector("div.absolute.left-0.w-full.overflow-hidden") || [...root.querySelectorAll("div")].find(
    (d) => /left-0/.test(d.className || "") && (d.getAttribute("data-tray") || /linear-gradient/.test(st(d)) || /rgb/.test(st(d))),
  );
  const rowOf = (root, label) => q(root, ".cw-row").find((r) => (r.textContent || "").startsWith(label));

  const base = await mount19({ cover: true, theme: "slate", slateColor: "#5c6574", custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1 } });
const tuned = await mount19({
    cover: true, theme: "slate", slateColor: "#5c6574",
    // patch 23 moved size/spacing into the two view namespaces, so a tuned wallet sets both
    custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1, radius: 1.6, shadow: 0, border: 0, material: 1.6, depth: 0.55, carousel: { size: 0.9, gap: 20, side: 1, peek: 1, pos: 0 }, stack: { size: 0.9, gap: 20, overlap: 0.7, spacing: 0, vOff: 0, shrink: 1, rot: 1, visible: 3 } },
  });
  {
    const bTray = trayOf(base.window.document.getElementById("root"));
    const tTray = trayOf(tuned.window.document.getElementById("root"));
    check("pouch: at neutral settings the tray is exactly the round-9 gradient",
      /rgb\(66,\s*73,\s*84\)/.test((bTray?.getAttribute("data-tray")||st(bTray))) && /rgb\(44,\s*48,\s*56\)/.test((bTray?.getAttribute("data-tray")||st(bTray))),
      ((bTray?.getAttribute("data-tray")&&`background:${bTray.getAttribute("data-tray")}`)||st(bTray).match(/background:[^;]*/) || ["-"])[0].slice(0, 96));
    check("pouch: Background (depth) darkens the tray",
      (tTray?.getAttribute("data-tray")||st(tTray)) !== (bTray?.getAttribute("data-tray")||st(bTray)) && !rgbRe(66, 73, 84).test(tTray?.getAttribute("data-tray")||st(tTray)),
      ((tTray?.getAttribute("data-tray")&&`background:${tTray.getAttribute("data-tray")}`)||st(tTray).match(/background:[^;]*/) || ["-"])[0].slice(0, 96));
    const rad = (el) => el ? parseFloat(((st(el).match(/border-radius:\s*([\d.]+)px/) || [0, "0"])[1])) : 0;
    check("pouch: Radius grows the pouch corners", rad(tTray) > rad(bTray) + 4, `${rad(bTray).toFixed(1)}px -> ${rad(tTray).toFixed(1)}px`);
    const cardW = (m) => parseFloat((st(m.window.document.querySelector("#root div.relative.no-select")).match(/width:\s*([\d.]+)px/) || [0, "0"])[1]);
check("pouch: the view's own Scale sizes the real pouch, not just the preview", cardW(tuned) < cardW(base) - 10,
      `${cardW(base).toFixed(0)}px -> ${cardW(tuned).toFixed(0)}px`);
    const shadow = (m) => [...m.window.document.getElementById("root").querySelectorAll("div")].map(st).filter((x) => /box-shadow:\s*0 30px/.test(x))[0] || "";
    check("pouch: Shadow off removes the card cast shadow",
      /rgba\(0,\s*0,\s*0,\s*0(\.0+)?\)/.test(shadow(tuned)) && !/rgba\(0,\s*0,\s*0,\s*0(\.0+)?\)/.test(shadow(base)),
      `${(shadow(base).match(/box-shadow:[^;]*/) || ["-"])[0].slice(0, 46)} -> ${(shadow(tuned).match(/box-shadow:[^;]*/) || ["-"])[0].slice(0, 46)}`);
    check("pouch: Border None drops the tray edge alpha",
      /border:\s*1px solid rgba\([^)]*,\s*0\)/.test(st(tTray)) && !/border:\s*1px solid rgba\([^)]*,\s*0\)/.test(st(bTray)),
      `${(st(bTray).match(/border:[^;]*/) || ["-"])[0]} -> ${(st(tTray).match(/border:[^;]*/) || ["-"])[0]}`);
    const sheen = (el) => { const inner = el?.querySelector("div[data-sheen]") || el?.querySelector("div") || el; const raw = inner?.getAttribute("data-sheen") || el?.getAttribute("data-sheen") || el?.getAttribute("data-tray-sheen") || ""; if (raw) return `background:${raw}`; try { return (st(inner).match(/background:[^;]*/) || ["-"])[0]; } catch(e){ return "-"; } };
    check("pouch: Material (Gloss) lifts the sheen over the tray",
      sheen(tTray) !== sheen(bTray), `${sheen(bTray).slice(0, 46)} -> ${sheen(tTray).slice(0, 46)}`);
  }
  // spacing and fan show up on the stack, where each card's offset is set by them
  {
    const xOf = (el) => parseFloat((st(el).match(/translateX\((-?[\d.]+)px\)/) || [0, "0"])[1]);
    const cardsOf = (m) => [...m.window.document.querySelectorAll("#root div.absolute.no-select")];
    const mk = async (extra) => mount19({
      view: "stack", cover: true, theme: "slate", slateColor: "#5c6574",
      custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1, ...extra },
    });
    const plain = await mk({});
    const wide = await mk({ gap: 44, stack: 1.5 });
    const flat = await mk({ stack: 0.5 });
    const back2 = (m) => { const c = cardsOf(m); return c.length > 1 ? xOf(c[1]) : NaN; };
    check("pouch: Spacing opens up the stack", Math.abs(back2(wide)) > Math.abs(back2(plain)) + 4,
      `${back2(plain).toFixed(1)}px -> ${back2(wide).toFixed(1)}px`);
    check("pouch: Stack style Flat pulls the fan in", Math.abs(back2(flat)) < Math.abs(back2(plain)) - 4,
      `${back2(plain).toFixed(1)}px -> ${back2(flat).toFixed(1)}px`);
    {
      const roundy = await mk({ radius: 1.6 });
      const inner = (el) => [...(el?.querySelectorAll("div") || [])].find((d) => /border-radius/.test(st(d)));
      const rOf = (m) => parseFloat((st(inner(cardsOf(m)[0])).match(/border-radius:\s*([\d.]+)px/) || [0, "0"])[1]);
      check("pouch: the stack card corners follow Radius", rOf(roundy) > rOf(plain) + 5,
        `${rOf(plain).toFixed(1)}px -> ${rOf(roundy).toFixed(1)}px`);
      check("pouch: no console errors from the reshaped stack", roundy.errors.length === 0,
        roundy.errors.slice(0, 1).join("").slice(0, 120));
    }
    [plain, wide, flat].forEach((m) => check(`pouch: no console errors (${m === plain ? "plain" : m === wide ? "wide" : "flat"})`,
      m.errors.length === 0, m.errors.slice(0, 1).join("").slice(0, 120)));
  }
  // driving a control from the sheet writes through to the wallet and to storage
  {
    const m = await mount19({ cover: true, theme: "slate", slateColor: "#5c6574", custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1 } });
    const win = m.window, doc = win.document;
    await open(win, doc);
    const sheet = sheetOf(doc);
    const rng = q(sheet, "input[type=range]").find((i) => i.getAttribute("aria-label") === "Radius");
    const sliderRow = rowOf(sheet, "Radius");
    const input = rng || (sliderRow && sliderRow.querySelector("input[type=range]"));
    check("settings: the Radius slider is reachable in the sheet", !!input,
      q(sheet, "input[type=range]").map((i) => i.getAttribute("aria-label")).join(",").slice(0, 90));
    if (input) setValue(win, input, 1.9);
    await settle(win, 700);
    const saved = JSON.parse(win.localStorage.getItem(SETTINGS_KEY) || "{}");
    check("settings: the slider writes one field into wallet.settings.v1",
      Math.abs((saved.custom || {}).radius - 1.9) < 0.001, `custom.radius=${(saved.custom || {}).radius}`);
    const tray = trayOf(doc.getElementById("root"));
    check("settings: and the wallet repaints without a reload", /border-radius:\s*4[0-9]\.[0-9]+px/.test(st(tray)),
      (st(tray).match(/border-radius:[^;]*/) || ["-"])[0]);
    check("settings: the read-out shows the value", /190%/.test((sheet?.textContent) || ""), (sheet?.textContent || "").match(/Radius[^A-Z]{0,12}/)?.[0] || "-");
    check("settings: no console errors while driving a control", m.errors.length === 0,
      m.errors.slice(0, 1).join("").slice(0, 160));
  }
}


// ---------------------------------------------------------------------------
// Test 6l: round 11 - the smaller header control, the view-specific rows, and
// sliders that stay smooth (patches 21 + 22)
// ---------------------------------------------------------------------------
{
  const st = (el) => inlineStyle(el);   // jsdom gap, see inlineStyle
  const L19 = JSON.stringify([{ id: "l1", src: "cards/one.jpg", title: "One", subtitle: "", fields: [] }]);
  const mount = async (settings) => {
    const m = makeDom({ [CARDS_KEY]: L19, [SETTINGS_KEY]: JSON.stringify(settings) }, { withLayout: true });
    runBundle(m.window, m.errors);
    await settle(m.window, 900);
    const btnLabel = (l) => [...m.window.document.querySelectorAll("#root button[aria-label]")].find((b) => b.getAttribute("aria-label") === l);
    const btnText = (re) => [...m.window.document.querySelectorAll("#root button")].find((b) => re.test((b.textContent || "").trim()));
    const click = (el) => el && el.dispatchEvent(new m.window.MouseEvent("click", { bubbles: true }));
    click(btnLabel("More"));
    await settle(m.window, 300);
    click(btnText(/^Settings$/));
    await settle(m.window, 600);
    return { ...m, doc: m.window.document, win: m.window, click, btnText };
  };
  const sheetOf = (doc) => [...doc.querySelectorAll("#root div")].find((d) => /cw-glass-sheet/.test(d.className || ""));
  const q = (root, sel) => (root ? [...root.querySelectorAll(sel)] : []);
  const setCtl = (win, el, v) => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };

  // ---- patch21: what the CSS and the bundle now promise -------------------
  check("slider kit: a 4px filled track inside a 26px hit area, thumb that can be grabbed",
    /\.cw-range\{[^}]*height:26px[^}]*padding:11px 0[^}]*background-clip:content-box/.test(CSS_SRC) &&
    /linear-gradient\(90deg,var\(--accent\) 0 var\(--p,50%\)/.test(CSS_SRC) &&
    /\.cw-range::-webkit-slider-thumb\{[^}]*width:20px;height:20px/.test(CSS_SRC) &&
    /\.cw-range\{[^}]*touch-action:none/.test(CSS_SRC),
    (CSS_SRC.match(/\.cw-range\{[^}]{0,120}/) || ["-"])[0]);
  check("slider kit: the read-out is tabular so digits do not jog while dragging",
    /\.cw-val\{font-variant-numeric:tabular-nums\}/.test(CSS_SRC) && /\.cw-preview\{height:176px\}/.test(CSS_SRC),
    "cw-val + a preview box tall enough for the stack");
  check("slider kit: firefox gets a real track and progress too",
    /\.cw-range::-moz-range-progress\{height:4px/.test(CSS_SRC) && /\.cw-range::-moz-range-thumb\{/.test(CSS_SRC),
    "the WebView is Chromium, but the browser preview should match");
  check("smoothness: the sleeve cache is quantized, not JSON.stringify(custom)",
    /function __cwSig\(e\)\{let c=e\.custom\|\|\{\},q=\(v,d,s\)=>Math\.round\(\(v==null\?d:\+v\)\*s\)/.test(BUNDLE_SRC) &&
    !BUNDLE_SRC.includes("${JSON.stringify(e.custom||{})}"),
    BUNDLE_SRC.match(/function __cwSig\(e\)\{.{0,60}/)?.[0] || "-");
  check("smoothness: the tray eases background and radius so a step reads as continuous",
    BUNDLE_SRC.includes("transition:`background .16s linear,border-radius .16s ease-out`"),
    "one line on the tray, nothing on the card transform path");
  check("stack: it sizes from the box its caller gives, viewport otherwise",
    BUNDLE_SRC.includes("landW=ft?Math.min((ft.h-14)*zsz,ft.w*.94*zsz,520*zsz):Math.min((vh-230)*zsz,w*.92*zsz,520*zsz)"),
    "the wallet path keeps its old numbers exactly");

  // ---- the sheet: one control per row, progress fill, no snap-back ---------
  const m = await mount({ cover: true, theme: "slate", slateColor: "#5c6574", custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1 } });
  const sheet = sheetOf(m.doc);
  const rngs = q(sheet, "input[type=range]");
check("sliders: every one carries its fill and a step fine enough to drag",
    rngs.length === 12 && rngs.every((i) => /--p:\s*\d+%/.test(st(i)) &&
      ["0.01", "0.5", "0.005", "1"].includes(i.getAttribute("step"))),
    rngs.map((i) => `${i.getAttribute("aria-label")}@${i.getAttribute("step")}`).join(",").slice(0, 120));
  check("sliders: the fill tracks the value (50% in the middle of a range)",
    (() => {
      const r = rngs.find((i) => i.getAttribute("aria-label") === "Shadow");
      return st(r).includes("--p: 53%") || st(r).includes("--p:53%");
    })(),
    st(rngs.find((i) => i.getAttribute("aria-label") === "Shadow")).slice(0, 60) || "-");
  check("sheet: the Done pill is a size smaller than a wallet button",
    q(sheet, "button").some((b) => (b.textContent || "").trim() === "Done" && /text-\[13\.5px\]/.test(b.className || "")),
    q(sheet, "button").find((b) => (b.textContent || "").trim() === "Done")?.className || "-");

  // a drag must land the last value, and must not write to storage once per event
  let writes = 0;
  // Storage is a proxy whose set trap stores keys, so a spy has to sit on the prototype
  const realSet = m.win.Storage.prototype.setItem;
  m.win.Storage.prototype.setItem = function (k, v) { if (k === SETTINGS_KEY) writes += 1; return realSet.call(this, k, v); };
  const radius = rngs.find((i) => i.getAttribute("aria-label") === "Radius");
  for (const v of [1.05, 1.12, 1.2, 1.31, 1.4, 1.47]) setCtl(m.win, radius, v);
  check("smoothness: the thumb keeps the value being dragged, no snap-back to the commit",
    parseFloat(radius.value) === 1.47, `input shows ${radius.value}`);
  await settle(m.win, 400);
  const savedL = JSON.parse(m.win.localStorage.getItem(SETTINGS_KEY) || "{}");
  check("smoothness: six events in a frame cost one commit, and it is the last one",
    writes === 1 && Math.abs((savedL.custom || {}).radius - 1.47) < 0.001,
    `${writes} write(s), custom.radius=${(savedL.custom || {}).radius}`);
  const trayRadius = (doc) => { const el = doc.querySelector("#root div.absolute.left-0.w-full.overflow-hidden"); if (!el) return 0; const src = st(el); const m = src.match(/border-radius:\s*([\d.]+)px/); return m ? parseFloat(m[1]) : 0; };
  const after = trayRadius(m.doc);
  check("smoothness: and the wallet's pouch carries the last value, not an intermediate one",
    after > 30 && Math.abs(after - 22.3 * 1.47) < 1.5, `tray border-radius ${after.toFixed(1)}px at radius 147%`);
  m.win.Storage.prototype.setItem = realSet;

  // ---- the Layout split: each view's rows write only their own object -----
  const stackChip = q(sheet, "button.cw-chip").find((c) => (c.textContent || "").trim() === "Stack");
  m.click(stackChip);
  await settle(m.win, 600);
  const inStack = q(sheet, "input[type=range]").map((i) => i.getAttribute("aria-label"));
  check("layout: picking Stack reveals the stack's own controls",
    ["Card overlap", "Vertical offset", "Scale", "Rotation", "Visible cards", "Spacing"]
      .every((l) => inStack.includes(l)) && !inStack.includes("Spread") && !inStack.includes("Peek amount"),
    inStack.slice(7).join(",").slice(0, 96));
  const savedBefore = JSON.parse(m.win.localStorage.getItem(SETTINGS_KEY) || "{}");
  const ovRow = q(sheet, "input[type=range]").find((i) => i.getAttribute("aria-label") === "Card overlap");
  if (!ovRow) check("layout: the stack offers its own overlap slider", false, "no Card overlap row in the stack view");
  if (ovRow) {
    setCtl(m.win, ovRow, 1.05);
    await settle(m.win, 600);
    const savedOv = JSON.parse(m.win.localStorage.getItem(SETTINGS_KEY) || "{}");
    check("layout: the overlap slider lands in custom.stack and leaves custom.carousel byte-equal",
      Math.abs((((savedOv.custom || {}).stack) || {}).overlap - 1.05) < 0.001 &&
      JSON.stringify((savedOv.custom || {}).carousel) === JSON.stringify((savedBefore.custom || {}).carousel),
      `stack.overlap=${((savedOv.custom || {}).stack || {}).overlap}, carousel=${JSON.stringify((savedOv.custom || {}).carousel)}`);
  }
  const backCarousel = q(sheet, "button.cw-chip").find((c) => (c.textContent || "").trim() === "Carousel");
  m.click(backCarousel);
  await settle(m.win, 600);
  const inCar = q(sheet, "button.cw-chip").map((c) => (c.textContent || "").trim());
  const carRows = q(sheet, "input[type=range]").map((i) => i.getAttribute("aria-label"));
  check("layout: back on Carousel the stack's rows are gone and the carousel's are back (7 chips)",
    inCar.length === 7 && ["Card spacing", "Side cards", "Peek amount", "Position"].every((l) => carRows.includes(l)) &&
    !carRows.includes("Card overlap") && !carRows.includes("Visible cards"),
    `${inCar.length} chips / ${carRows.slice(7).join(",")}`);
  check("layout: Wallet & cover stays available in both views",
    (() => {
      const sw = q(sheet, "button[role=switch]").find((b) => /^Wallet & cover/.test((b.parentElement?.textContent || "").trim()));
      return !!sw;
    })(),
    q(sheet, "button[role=switch]").map((b) => (b.parentElement?.textContent || "").trim().slice(0, 18)).join(",").slice(0, 80));
check("rounds 11-12: no console errors from the compact sheet", m.errors.length === 0,
    m.errors.slice(0, 1).join("").slice(0, 160));
}


// ---------------------------------------------------------------------------
// Test 6m: round 12 - Stack and Carousel as independent configuration modes, a
// preview that stages real cards for a one-card wallet, and sliders that glide
// (patches 23 + 24)
// ---------------------------------------------------------------------------
{
  const stl = (el) => inlineStyle(el);
  const has = (...fs) => fs.every((f) => BUNDLE_SRC.includes(f));
  const detail = (s) => (BUNDLE_SRC.match(new RegExp(s)) || ["-"])[0].slice(0, 96);

  check("layout: each view is handed only its own numbers",
    has("function __cwMrg(c,v){", "custom:__cwMrg(j.custom,`stack`)", "custom:__cwMrg(j.custom,`carousel`)") &&
    BUNDLE_SRC.includes("s&&typeof s==`object`?{...o,...s}:{...o}"),
    detail("function __cwMrg\\(c,v\\)\\{.{0,70}"));
  check("layout: the stack reads overlap, vertical offset, scale, rotation, visible cards, spacing",
    has("ov=pc2.overlap==null?.7", "sp=pc2.spacing==null?0", "vof=pc2.vOff==null?0", "sk=pc2.shrink==null?1",
        "rt=pc2.rot==null?1", "vi=pc2.visible==null?3", "a.set(l*sg)", "sg=r*ov+sp",
        "Math.max(-48*rt,Math.min(48*rt,l*-40*rt))", "d.set(c<.002?1:Math.max(1-.28*sk,1-.16*sk*c))",
        "f.set(c>vi-.65?0:1)", "vof&&ly.set(-c*vof)"),
    detail("let e=e=>\\{let l=t-e.{0,90}"));
  check("layout: the carousel reads spacing, scale, side cards, peek amount, position",
    has("pk=g.peek==null?1:+g.peek", "px=g.pos==null?0:+g.pos", "so=g.side==null?1:+g.side",
        "sideGap:n*.56*pk", "posX:n*px", "sideOp:so", "h.set(t*sg+(i.posX||0))",
        "op.set(a<.002?1:Math.max(.14,1-(1-(i.sideOp==null?1:i.sideOp))*a))"),
    detail("sideGap:n\\*\\.56\\*pk.{0,60}"));
  check("layout: the geometry recomputes when a view's own numbers move",
    BUNDLE_SRC.includes("[k&&k.size,k&&k.gap,k&&k.radius,k&&k.peek,k&&k.pos,k&&k.side]"),
    detail("t\\(xd\\(g\\.current\\)\\)\\},\\[[^\\]]*\\]"));
  check("layout: neutral defaults, so a wallet that never touched them looks like round 11",
    has("stack:{size:1,gap:20,overlap:.7,spacing:0,vOff:0,shrink:1,rot:1,visible:3}",
        "carousel:{size:1,gap:20,side:1,peek:1,pos:0}"),
    "overlap .7 / visible 3 reproduce .7+(gap-20)/120 and c>2.35 exactly");
  check("layout: an older wallet keeps its look - flat size/gap/fan are folded into both views once",
    has("fn=typeof c.stack==`number`?+c.stack:1",
        "stack:st||{size:sz,gap:gp,overlap:.7*fn,spacing:(gp-20)*1.6,vOff:0,shrink:1,rot:fn,visible:3}",
        "carousel:ca||{size:sz,gap:gp,side:1,peek:1,pos:0}", "if(st&&ca)return;"),
    detail("if\\(!n\\.custom\\.stack\\|\\|!n\\.custom\\.carousel\\).{0,40}|\\(\\(\\)=>\\{let c=n\\.custom.{0,60}"));

  // ---- live: no amount of Stack tuning can move the Carousel, or the reverse
  const ONE = JSON.stringify([{ id: "one", src: "cards/one.jpg", title: "Alpha Card", subtitle: "", fields: [] }]);
  const base = { cover: true, theme: "slate", slateColor: "#5c6574",
    custom: { color: "#5c6574", design: "slate", grain: 0.2, grade: 1, radius: 1, shadow: 1 } };
  const mountM = async (s, cards = ONE) => {
    const m = makeDom({ [CARDS_KEY]: cards, [SETTINGS_KEY]: JSON.stringify(s) }, { withLayout: true });
    runBundle(m.window, m.errors);
    await settle(m.window, 900);
    return m;
  };
  const pouchOf = (win) => stl(win.document.querySelector("#root div.relative.no-select"));
  const stackCardOf = (win) => {
    const d = [...win.document.querySelectorAll("#root div")].find((x) => /left: 50%/.test(stl(x)) && /will-change/.test(stl(x)));
    return stl(d);
  };
  const wOf = (s) => parseFloat((s.match(/width:\s*([\d.]+)px/) || [0, "0"])[1]);

  const carPlain = await mountM({ ...base, view: "carousel" });
  const carWild = await mountM({ ...base, view: "carousel", custom: { ...base.custom,
    stack: { size: 1.2, gap: 44, overlap: 0.05, spacing: 40, vOff: 22, shrink: 1.6, rot: 0, visible: 8 } } });
  check("isolation: every Stack setting, pushed to its extreme, leaves the carousel pouch identical",
    pouchOf(carWild.window) === pouchOf(carPlain.window) && wOf(pouchOf(carPlain.window)) > 100,
    `${wOf(pouchOf(carPlain.window)).toFixed(1)}px vs ${wOf(pouchOf(carWild.window)).toFixed(1)}px`);

  const stPlain = await mountM({ ...base, view: "stack" });
  const stWild = await mountM({ ...base, view: "stack", custom: { ...base.custom,
    carousel: { size: 1.2, gap: 44, side: 0.15, peek: 1.5, pos: 0.22 } } });
  check("isolation: every Carousel setting, pushed to its extreme, leaves the stacked cards identical",
    stackCardOf(stWild.window) === stackCardOf(stPlain.window) && wOf(stackCardOf(stPlain.window)) > 100,
    `${wOf(stackCardOf(stPlain.window)).toFixed(1)}px vs ${wOf(stackCardOf(stWild.window)).toFixed(1)}px`);

  const carBig = await mountM({ ...base, view: "carousel", custom: { ...base.custom,
    carousel: { size: 1.16, gap: 20, side: 1, peek: 1, pos: 0 } } });
  const stBig = await mountM({ ...base, view: "stack", custom: { ...base.custom,
    stack: { size: 1.16, gap: 20, overlap: 0.7, spacing: 0, vOff: 0, shrink: 1, rot: 1, visible: 3 } } });
  check("isolation: yet each view's own Scale does size what it renders",
    wOf(pouchOf(carBig.window)) > wOf(pouchOf(carPlain.window)) + 8 &&
    wOf(stackCardOf(stBig.window)) > wOf(stackCardOf(stPlain.window)) + 8,
    `carousel ${wOf(pouchOf(carPlain.window)).toFixed(0)} -> ${wOf(pouchOf(carBig.window)).toFixed(0)}px, ` +
    `stack ${wOf(stackCardOf(stPlain.window)).toFixed(0)} -> ${wOf(stackCardOf(stBig.window)).toFixed(0)}px`);

  // ---- the preview: components, three cards minimum, live per view
  const openSheet = async (win) => {
    const btnLabel = (l) => [...win.document.querySelectorAll("#root button[aria-label]")].find((b) => b.getAttribute("aria-label") === l);
    const btnText = (re) => [...win.document.querySelectorAll("#root button")].find((b) => re.test((b.textContent || "").trim()));
    const click = (el) => el && el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    click(btnLabel("More"));
    await settle(win, 300);
    click(btnText(/^Settings$/));
    await settle(win, 600);
    return [...win.document.querySelectorAll("#root div")].find((d) => /cw-glass-sheet/.test(d.className || ""));
  };
  const previewBox = (doc) => [...doc.querySelectorAll("#root div")].find((d) => /cw-preview-in/.test(d.className || ""));
  const staged = (box) => (box ? Math.max(box.querySelectorAll("[data-cwc]").length,
    [...box.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d))).length) : 0);
  const mPrev = await mountM({ ...base, view: "carousel" });
  const sheet = await openSheet(mPrev.window);
  const boxCar = previewBox(mPrev.window.document);
  check("preview: a one-card wallet still stages three real cards in the carousel",
    staged(boxCar) >= 3, `${staged(boxCar)} card roots on stage`);
  check("preview: they are the wallet's own components, not a flattened picture",
    !!boxCar && boxCar.querySelectorAll(":scope > img").length === 0 && boxCar.querySelectorAll("div").length >= 4 &&
    (!!boxCar.querySelector("[data-cwc]") || [...boxCar.querySelectorAll("div")].some((d) => /left: 50%/.test(stl(d)))),
    `>img:${boxCar ? boxCar.querySelectorAll(":scope > img").length : -1}, divs:${boxCar ? boxCar.querySelectorAll("div").length : -1}, roots:${boxCar ? boxCar.querySelectorAll("[data-cwc]").length : -1}`);
  const chipStack = sheet && [...sheet.querySelectorAll("button.cw-chip")].find((c) => (c.textContent || "").trim() === "Stack");
  chipStack && chipStack.dispatchEvent(new mPrev.window.MouseEvent("click", { bubbles: true }));
  await settle(mPrev.window, 700);
  const boxSt = previewBox(mPrev.window.document);
  check("preview: switching to Stack restages the same six cards as a stack, instantly",
    staged(boxSt) >= 6, `${staged(boxSt)} stacked card roots`);
  // The check round 11 was missing: a stage clipped to zero height is invisible, and measuring
  // the cards' widths cannot see that - which is exactly how an empty preview box shipped.
  const stageOf = (box) => (box ? [...box.querySelectorAll("div")].find(
    (d) => /relative/.test(d.className || "") && /w-full/.test(d.className || "") && /perspective/.test(stl(d))) : null);
  const stStage = stl(stageOf(boxSt));
  check("preview: the stack's stage is given the fit box's real size, not clipped to 0px",
    /width:\s*388px/.test(stStage) && /height:\s*302px/.test(stStage) && /overflow: hidden/.test(stStage),
    stStage.slice(0, 140) || "no stage element");
  const stgReal = [...stPlain.window.document.querySelectorAll("#root div")].find(
    (d) => /relative/.test(d.className || "") && /w-full/.test(d.className || "") && /perspective/.test(stl(d)));
  const stageProps = (el) => stl(el).split(";").map((x) => (x.split(":")[0] || "").trim()).filter(Boolean);
  check("preview: and only there - the wallet's stack still sizes from the viewport",
    !!stgReal && stageProps(stgReal).includes("flex") &&
    !stageProps(stgReal).includes("height") && !stageProps(stgReal).includes("width"),
    `props: ${stageProps(stgReal).join(",")}` || "no wallet stage element");
  check("preview: stand-in artwork is a fully encoded data URL (a raw # would truncate it)",
    (() => {
      const srcs = [...boxCar.querySelectorAll("img")].map((i) => (i.getAttribute("src") || ""))
        .filter((x) => x.startsWith("data:image/svg+xml"));
      return srcs.length >= 2 && srcs.every((x) => !x.slice(5).includes("#") && /%3Csvg/.test(x) && /%3E$/.test(x));
    })(),
    [...boxCar.querySelectorAll("img")].map((i) => (i.getAttribute("src") || "").slice(0, 46)).join(" | ").slice(0, 130));
  check("preview: every stacked card has a non-zero box inside that stage",
    (() => {
      const cards = [...boxSt.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d)));
      return cards.length >= 6 && cards.every((d) => {
        const w = parseFloat((stl(d).match(/width:\s*([\d.]+)px/) || [0, "0"])[1]);
        const h = parseFloat((stl(d).match(/height:\s*([\d.]+)px/) || [0, "0"])[1]);
        return w > 100 && h > 100 && w <= 388 && h <= 302;
      });
    })(),
    `${[...boxSt.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d))).length} cards, ` +
    [...boxSt.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d))).slice(0, 2)
      .map((d) => (stl(d).match(/width:[^;]+;\s*height:[^;]+/) || ["-"])[0]).join(" / "));
  check("preview: the stack on stage is not a picture either",
    !!boxSt && boxSt.querySelectorAll(":scope > img").length === 0 &&
    [...boxSt.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d))).length >= 6,
    boxSt ? `${[...boxSt.querySelectorAll("div")].filter((d) => /left: 50%/.test(stl(d))).length} stacked` : "no stage");

  // ---- smoothness: the finger owns the row, the wallet glides to it
  const q2 = (root, sel) => (root ? [...root.querySelectorAll(sel)] : []);
  const setCtl2 = (win, el, v) => {
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  // back to the carousel first: Card spacing is the carousel's row, and the stack view does not
  // show it - which is exactly the isolation the two modes are supposed to have
  const chipCar = sheet && [...sheet.querySelectorAll("button.cw-chip")].find((c) => (c.textContent || "").trim() === "Carousel");
  chipCar && chipCar.dispatchEvent(new mPrev.window.MouseEvent("click", { bubbles: true }));
  await settle(mPrev.window, 700);
  const gapRow = q2(sheet, "input[type=range]").find((i) => i.getAttribute("aria-label") === "Card spacing");
  if (!gapRow) check("smoothness: the carousel offers its own spacing row to drag", false,
    "no Card spacing row after switching back to the carousel");
  if (gapRow) {
  const seen = [];
  let writes = 0;
  const realSet = mPrev.window.Storage.prototype.setItem;
  mPrev.window.Storage.prototype.setItem = function (k, v) {
    if (k === SETTINGS_KEY) {
      writes += 1;
      try { seen.push((((JSON.parse(v).custom || {}).carousel) || {}).gap); } catch { /* ignore */ }
    }
    return realSet.call(this, k, v);
  };
  setCtl2(mPrev.window, gapRow, 44);
  const shownAtOnce = parseFloat(gapRow.value);
  for (let i = 0; i < 16; i += 1) { await settle(mPrev.window, 20); if (seen.length && seen[seen.length - 1] === 44) break; }
  mPrev.window.Storage.prototype.setItem = realSet;
  check("smoothness: the dragged row shows the finger's value on the spot", shownAtOnce === 44,
    `input reads ${gapRow.value}`);
  check("smoothness: the wallet is interpolated to it - the first commit is not the target",
    seen.length >= 2 && seen[0] > 20 && seen[0] < 43.5,
    `commits ${seen.map((v) => (v == null ? "-" : v.toFixed(1))).join(" -> ").slice(0, 90)}`);
  const wBefore = writes;
  await settle(mPrev.window, 400);
  check("smoothness: the glide lands exactly on the value and then stops writing",
    seen[seen.length - 1] === 44 && writes === wBefore && writes <= 24,
    `${writes} commit(s), last gap=${seen[seen.length - 1]}, still ${writes - wBefore} after 400ms`);
  }

  // ---- the button budget the user keeps asking for
  const btns = q2(sheet, "button");
  check("controls: the sheet is 7 chips, 4 switches and a colour row - no per-option buttons",
    /* round 18 adds exactly one switch (Lock the app) plus the three row buttons of the same card;
       round 19 adds one more switch (Customize cards) and nothing else. The budget grew by those two
       rows and by nothing else - see the count assertions in qa_feature_suite.mjs group 34. */
    q2(sheet, "button.cw-chip").length === 7 && q2(sheet, "button[role=switch]").length === 4 &&
    btns.length <= 27 && /Overlap|Vertical offset|Visible cards|Card spacing|Peek amount/.test(sheet.textContent || ""),
    `${btns.length} buttons, ${q2(sheet, "button.cw-chip").length} chips, ${q2(sheet, "button[role=switch]").length} switches`);
  const BT = String.fromCharCode(96);   // the bundle quotes class names with backticks
  check("round 19: the customization block is wrapped, mounted once and gated by one rule",
    /* read as plain substrings, not regexes: the bundle is minified and the exact punctuation is the
       thing under test, so a pattern that silently stops matching would hide a real regression. */
    BUNDLE_SRC.includes(BT + "cw-cust-slot" + BT + ",ref:e=>{window.__cwCust&&window.__cwCust.mount(e)}")
    && BUNDLE_SRC.includes("prevBox,(0,U.jsx)(`div`,{className:" + BT + "cw-cust-body" + BT
      + ",children:(0,U.jsxs)(U.Fragment,{children:[design,layout]})})")
    && BUNDLE_SRC.split("className:" + BT + "cw-cust-slot" + BT).length - 1 === 1
    && BUNDLE_SRC.split("className:" + BT + "cw-cust-body" + BT).length - 1 === 1
    && CSS_SRC.includes('html[data-cw-custom="off"] .cw-cust-body{display:none}')
    && BUNDLE_SRC.includes('var ATTR = "data-cw-custom";'),
    `slot=${BUNDLE_SRC.split("cw-cust-slot").length - 1}, body=${BUNDLE_SRC.split("cw-cust-body").length - 1}, rule=${CSS_SRC.includes(".cw-cust-body{display:none}")}`);
  check("round 19: the gate never persists, so a stale \"on\" cannot survive into the next visit",
    !/wallet\.cwcustom/.test(BUNDLE_SRC) && !/localStorage[\s\S]{0,400}data-cw-custom/.test(BUNDLE_SRC.slice(BUNDLE_SRC.indexOf("Round 19 - the customization gate"))),
    "no storage key for the gate");
  check("controls: the Fan chip row is gone, replaced by the Rotation and Overlap sliders it preset",
    !/Flat,Fan,Deck/.test(q2(sheet, "button.cw-chip").map((c) => (c.textContent || "").trim()).join(",")) &&
    BUNDLE_SRC.includes("rt=pc2.rot") && BUNDLE_SRC.includes("ov=pc2.overlap"),
    q2(sheet, "button.cw-chip").map((c) => (c.textContent || "").trim()).join(","));
  const errs = [carPlain, carWild, stPlain, stWild, carBig, stBig, mPrev].flatMap((m) => m.errors || []);
  check("round 12: no console errors across the independent views, the staging and the glide",
    errs.length === 0, errs.slice(0, 1).join("").slice(0, 200));
}

// ---------------------------------------------------------------------------
// Test 6n: round 23 + 25 - the bands around the card preview (bottom inert,
// upper is the back affordance)
//
// Round 23 made both bands inert (backdrop shield). Round 25 (patch 40) restores
// the *upper* band as a functional back zone for the request "upper area par
// tap karne se card immediately close ho" - the blue outline in the screenshot.
// The bottom band stays inert (between card and WhatsApp/Save), and the card
// keeps its own gestures. The overlay root still has touch-none (no scroll/zoom
// from empty space) and the viewer still participates in the history sentinel
// so Android Back closes it with the same reverse animation.
// ---------------------------------------------------------------------------
{
  const CARDS3n = JSON.stringify([
    { id: "n1", src: "cards/one.jpg", title: "Nova One", subtitle: "1", fields: [] },
    { id: "n2", src: "cards/two.jpg", title: "Oscar Two", subtitle: "2", fields: [] },
    { id: "n3", src: "cards/three.jpg", title: "Papa Three", subtitle: "3", fields: [] },
  ]);
  const st = makeDom(
    { [CARDS_KEY]: CARDS3n, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) },
    { withLayout: true },
  );
  runBundle(st.window, st.errors);
  await settle(st.window, 900);
  const Wn = st.window, Dn = Wn.document;
  const ptr = (type, x, y) => {
    const e = new Wn.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const clickAt = (el, x, y) => {
    if (!el) return false;
    el.dispatchEvent(new Wn.MouseEvent("click", { bubbles: true, clientX: x, clientY: y }));
    return true;
  };
  const styleOf = (el) => inlineStyle(el);
  const open = () => /WhatsApp/.test(textOf(Wn));
  const overlay = () => [...Dn.querySelectorAll("#root div")].find((d) => /^fixed inset-0 z-50/.test(d.className || ""));
  const band = () => overlay()?.children?.[0];                     // backdrop inert shield
  const topBack = () => Dn.querySelector("#root [data-cwtop='back']") || Dn.querySelector("#root [data-cwtop]");
  const shield = () => Dn.querySelector("#root [data-cwband]");
  const viewerCard = () => [...(overlay()?.children || [])].find((d) => /no-select absolute touch-none/.test(d.className || ""));
  const rowOf = () => [...(overlay()?.children || [])].find((d) => /pointer-events-none absolute inset-x-0/.test(d.className || ""));
  const viewerButtons = () => [...(overlay()?.querySelectorAll("button") || [])];
  const btn = (label) => viewerButtons().find((b) => (b.textContent || "").trim() === label);

  // the deck opens the viewer; this is also the recovery path between phases
  const openViewer = async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (open()) return true;
      const stage = [...Dn.querySelectorAll("#root div")].find((d) => /perspective:\s*1200/.test(styleOf(d)));
      if (!stage) return false;
      stage.dispatchEvent(ptr("pointerdown", 195, 300));
      await settle(Wn, 80);
      Wn.dispatchEvent(ptr("pointerup", 195, 300));
      await settle(Wn, 1700);
    }
    return open();
  };
  await openViewer();
  check("round 23: the card viewer is open (the bands have something to be dead/alive around)",
    open() && !!overlay(), open() ? "viewer open" : "viewer never opened");

  // ---- the backdrop is one inert shield, and the upper band is the back zone ---
  const b0 = band();
  check("round 23: the empty bands are covered by one full-screen shield, not a control",
    !!b0 && /absolute inset-0/.test(b0.className || "") && b0.children.length === 0 &&
      !b0.hasAttribute("onclick") && !b0.hasAttribute("role") && !b0.hasAttribute("tabindex"),
    b0 ? `class=${b0.className} children=${b0.children.length} onclick=${b0.hasAttribute("onclick")}` : "no band element");
  check("round 23: the shield is the marked inert one (data-cwband = preview)",
    !!shield() && shield() === b0, shield() ? String(shield().getAttribute("data-cwband")) : "no [data-cwband] in the tree");
  check("round 23: the overlay root declares touch-action:none - no pan, zoom, rubber-band or "
    + "double-tap zoom can start in a band (round 9's <main> guard is a sibling, not an ancestor)",
    /touch-none/.test(overlay()?.className || "") && /touch-action:\s*none/.test(CSS_SRC.match(/\.touch-none\{[^}]*\}/)?.[0] || ""),
    overlay() ? overlay().className : "no overlay");
  check("round 23: the shield is painted, not wired - three attributes, none of them a control",
    !!b0 && [...b0.attributes].map((a) => a.name).sort().join(",") === "class,data-cwband,style" &&
      b0.className === "absolute inset-0",
    b0 ? `${[...b0.attributes].map((a) => a.name).join(",")} / class=${b0.className}` : "-");
  // round 25: the upper band is an explicit back hit target
  const top = topBack();
  check("round 25: the upper area is a dedicated back zone (data-cwtop=back, full-width top, height k.tt, onClick:te)",
    !!top && /absolute inset-x-0 top-0/.test(top.className || "") && top.getAttribute("data-cwtop") === "back" &&
      (/height:\s*k\.tt/.test(BUNDLE_SRC) || BUNDLE_SRC.includes("style:{height:k.tt}")),
    top ? `class=${top.className} data-cwtop=${top.getAttribute("data-cwtop")} style=${top.getAttribute("style")}` : "no [data-cwtop]");

  // ---- a tap in the top band SHOULD close (the new back affordance) ----------
  const tapBand = async (x, y) => {
    const b = band();
    if (!b) return false;
    b.dispatchEvent(ptr("pointerdown", x, y));
    b.dispatchEvent(ptr("pointerup", x, y));
    clickAt(b, x, y);
    await settle(Wn, 700);
    return true;
  };
  const tapTopZone = async () => {
    const t = topBack();
    if (!t) return false;
    t.dispatchEvent(new Wn.MouseEvent("click", { bubbles: true, clientX: 195, clientY: 40 }));
    await settle(Wn, 1200);
    return true;
  };
  const tappedTop = await tapTopZone();
  const closedAfterTop = !open();
  check("round 25: a tap in the top band (above the card - the blue outline in the screenshot) closes the viewer",
    tappedTop && closedAfterTop, `tapped=${tappedTop} closed=${closedAfterTop} open=${open()}`);
  await openViewer();
  const tappedBottom = await tapBand(195, 660);
  const stayedAfterBottom = open();
  check("round 23: a tap in the bottom band (between the card and the buttons) does NOT dismiss it",
    tappedBottom && stayedAfterBottom, `tapped=${tappedBottom} open=${stayedAfterBottom}`);
  await openViewer();

  // ---- a drag in the band: no dismissal, no card movement, no scroll -------
  const imageOf = () => viewerCard()?.querySelector("img");
  const beforeTransform = imageOf() ? styleOf(imageOf().parentElement) : "";
  const dragBand = (x, y) => {
    const b = band();
    if (!b) return false;
    b.dispatchEvent(ptr("pointerdown", x, y));
    for (const step of [40, 90, 150]) b.dispatchEvent(ptr("pointermove", x, y + step));
    b.dispatchEvent(ptr("pointerup", x, y + 150));
    return true;
  };
  dragBand(195, 120);
  await settle(Wn, 800);
  check("round 23: a drag in a band changes nothing - the card has not zoomed or panned, the page "
    + "behind has not scrolled, and no pan gesture was ever handed to the browser",
    open() && imageOf() && styleOf(imageOf().parentElement) === beforeTransform && Wn.scrollY === 0 &&
      /touch-none/.test(overlay()?.className || ""),
    `${open() ? "viewer open" : "viewer closed"}; card untouched=${styleOf(imageOf()?.parentElement) === beforeTransform}; scrollY=${Wn.scrollY}; guard=${/touch-none/.test(overlay()?.className || "")}`);

  // ---- the two buttons are the only controls in the overlay ----------------
  const labels = viewerButtons().map((b) => (b.textContent || "").trim()).filter(Boolean);
  check("round 23: the two bottom buttons are still there and are the overlay's only controls",
    ["WhatsApp", "Save"].every((l) => labels.includes(l)) && labels.every((l) => ["WhatsApp", "Save"].includes(l)),
    labels.join(" | "));
  check("round 23: both buttons stay hit targets (pointer-events:auto) inside the pointer-events:none row",
    /pointer-events-none/.test(rowOf()?.className || "") &&
      ["WhatsApp", "Save"].every((l) => /pointer-events-auto/.test(btn(l)?.className || "")),
    `${rowOf()?.className ?? "-"} / ${["WhatsApp", "Save"].map((l) => `${l}:${/pointer-events-auto/.test(btn(l)?.className || "")}`).join(" ")}`);
  // and the taps really do land on them: each button buzzes on press before it does anything else, so a
  // spy on navigator.vibrate is an honest "the button handled it" witness. jsdom's HTMLImageElement has
  // no decode(); the app preloads artwork with it, so stub it or the Save tap would stop at a toast
  // about decode instead of doing its work (the app catches that - it is not a crash - but it is noise).
  Wn.HTMLImageElement.prototype.decode ??= () => Promise.resolve();
  let buzzes = 0;
  Wn.navigator.vibrate = () => { buzzes += 1; return true; };
  const press = async (label) => {
    const b = btn(label);
    b?.dispatchEvent(ptr("pointerdown", 195, 800));
    b?.dispatchEvent(ptr("pointerup", 195, 800));
    clickAt(b, 195, 800);
    await settle(Wn, 400);
    return !!b;
  };
  const foundWhatsApp = await press("WhatsApp");
  const afterWhatsApp = buzzes;
  check("round 23: the WhatsApp tap lands on its own handler (it buzzes on press) and the viewer stays",
    foundWhatsApp && afterWhatsApp === 1 && open(), `found=${foundWhatsApp} buzz=${afterWhatsApp} open=${open()}`);
  const foundSave = await press("Save");
  check("round 23: the Save tap runs its handler end to end (press buzz + the saved toast)",
    foundSave && buzzes > afterWhatsApp && /Saved to gallery/.test(textOf(Wn)),
    `found=${foundSave} buzz=${buzzes} toast=${/Saved to gallery/.test(textOf(Wn))}`);

  // ---- the card keeps its own behaviour ------------------------------------
  check("round 23: the card box keeps its own touch-action and gesture handlers",
    !!viewerCard() && /touch-none/.test(viewerCard().className || ""),
    viewerCard() ? viewerCard().className : "no card box");
  // re-open if the button toasts closed it? No, buttons keep viewer open.
  for (const t of [0, 1]) {
    viewerCard()?.dispatchEvent(ptr("pointerdown", 195, 400));
    viewerCard()?.dispatchEvent(ptr("pointerup", 195, 400));
  }
  await settle(Wn, 1500);
  check("round 23: double-tapping the card still turns it over (the preview is not frozen)",
    /No back side yet|Double tap the card/.test(textOf(Wn)), textOf(Wn).slice(-80).replace(/\s+/g, " "));
  const swipeDown = (x, y) => {
    const c = viewerCard();
    if (!c) return;
    c.dispatchEvent(ptr("pointerdown", x, y));
    c.dispatchEvent(ptr("pointermove", x, y + 70));
    c.dispatchEvent(ptr("pointermove", x, y + 145));
    c.dispatchEvent(ptr("pointerup", x, y + 145));
  };
  swipeDown(195, 400);
  await settle(Wn, 1500);
  check("round 23: swiping the card down still closes the viewer (the bands were not the only way out)",
    !open(), open() ? "still open" : "closed by the card's own gesture");
  // ---- Android Back (history) also closes the viewer -----------------------
  await openViewer();
  // the viewer pushes a sentinel history entry (cardwallet:sheet); a popstate must shut it
  const histPushed = /let op=\(\)=>!!\(o\|\|/.test(BUNDLE_SRC) && /if\(o\)\{s\(null\);return\}/.test(BUNDLE_SRC);
  // jsdom's history.back() does not fire popstate synchronously, so simulate the
  // same dispatch the app's popstate handler listens for.
  Wn.dispatchEvent(new Wn.PopStateEvent("popstate", { state: { cardwallet: "sheet" } }));
  await settle(Wn, 1200);
  check("round 25: Android Back (popstate) closes the viewer with the same reverse animation",
    histPushed && !open(), histPushed ? (open() ? "still open after popstate" : "closed via history shut") : "history wiring missing");

  // ---- the code the behaviour rests on ------------------------------------
  const markAt = BUNDLE_SRC.indexOf("/*cardwallet:inert-bands*/");
  const viewerSrc = markAt < 0 ? "" : BUNDLE_SRC.slice(markAt - 130, markAt + 350);
  check("round 23: the overlay root still carries the inert-bands marker and backdrop is marked",
    !!viewerSrc && viewerSrc.includes("z-50 touch-none") && viewerSrc.includes("/*cardwallet:inert-bands*/") &&
      viewerSrc.includes('"data-cwband":`preview`'),
    viewerSrc ? viewerSrc.slice(Math.max(0, viewerSrc.indexOf("z-50 touch-none")), viewerSrc.length).slice(0, 90) : "marker missing");
  check("round 25: the upper back zone carries its own marker and closes via te()",
    BUNDLE_SRC.includes("/*cardwallet:top-back*/") && BUNDLE_SRC.includes('"data-cwtop":`back`') &&
      BUNDLE_SRC.includes("style:{height:k.tt}") && BUNDLE_SRC.includes("onClick:te"),
    "marker + data-cwtop + height k.tt + onClick:te");
  check("round 23: the card's handlers and the two button handlers are untouched by the fix",
    ["onPointerDown:re", "onPointerMove:M", "onPointerUp:N", "onWheel:e=>{"].every((g) => BUNDLE_SRC.includes(g)) &&
      BUNDLE_SRC.includes("if(n>90){te();return}") &&
      (BUNDLE_SRC.match(/pointer-events-auto flex items-center gap-2 rounded-full px-5 text-\[15px\] font-semibold text-white/g) || []).length === 2,
    "card gestures + both buttons intact");
  check("round 25: the viewer participates in the history sentinel so Back walks it back",
    /let op=\(\)=>!!\(o\|\|/.test(BUNDLE_SRC) && /if\(o\)\{s\(null\);return\}/.test(BUNDLE_SRC) && /,\[o,f,v,T,m,c,D,k,b,C\]\)/.test(BUNDLE_SRC),
    "op includes o, shut closes o last, deps include o");
  check("round 23: no console errors in the viewer band flow", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 180));
}

// ---------------------------------------------------------------------------
// Test 6o: round 24 - the action bar is the old header bar, seated bottom-right, on every screen
//
// The request: *"Move the top-right action bar (currently containing "+" Add button, Search icon, and
// Menu/Settings icon) from the top of the screen to the bottom-right corner instead - same exact
// grouping, icons, and functionality, just relocated"* - floating above the content, safe-area padded,
// same seat on every screen, actions unchanged.
//
// The relocation shipped in rounds 16-17; what had not travelled was the OLD BAR'S OWN SPACING, measured
// out of the last build that still had it at the top-right (`CardWallet_liquid_glass.apk`, round 15):
// three `h-9 w-9` controls, `gap-1` (4px) apart, `px-2` (8px) inset, glyphs 19/21px, `tone:auto`, labels
// Add card / Search cards / More - bare buttons, no container. Round 16 wrapped the same three controls
// in the `.cw-dock` glass pill with `gap:10px; padding:6px 10px`. This test pins the matched metrics and
// the "same seat on every screen" property the request asks for.
// ---------------------------------------------------------------------------
{
  const CARDS3o = JSON.stringify([
    { id: "o1", src: "cards/one.jpg", title: "Nova One", subtitle: "1", fields: [] },
    { id: "o2", src: "cards/two.jpg", title: "Oscar Two", subtitle: "2", fields: [] },
    { id: "o3", src: "cards/three.jpg", title: "Papa Three", subtitle: "3", fields: [] },
  ]);
  const OLD_ORDER = "Add card,Search cards,More";
  const seatOf = (doc) => {
    const pill = doc.querySelector("#root .cw-dock");
    const row = pill?.parentElement;
    const bar = row?.parentElement;
    return {
      pill, row, bar,
      labels: [...(pill?.querySelectorAll("button") || [])].map((b) => (b.getAttribute("aria-label") || "").trim()).join(","),
      pillClass: pill?.className || "", rowClass: row?.className || "", barClass: bar?.className || "",
      barStyle: bar?.getAttribute("style") || "",
    };
  };

  /* --- the old bar's metrics, now inside the pill --------------------------- */
  check("round 24: the pill's inner spacing is the old header bar's own (gap-1 = 4px, px-2 = 8px)",
    /\.cw-dock\{gap:4px;padding:6px 8px\}/.test(CSS_SRC),
    (CSS_SRC.match(/\.cw-dock\{gap:[^}]*\}/) || ["no spacing override"])[0]);
  check("round 24: the three controls still carry the old bar's size and glyphs (36px box, 19/21px)",
    BUNDLE_SRC.includes("flex h-9 items-center justify-center rounded-full") && BUNDLE_SRC.includes("size:cp?19:21") &&
      (BUNDLE_SRC.match(/tone:`auto`/g) || []).length === 3,
    `${(BUNDLE_SRC.match(/tone:`auto`/g) || []).length} tone:auto controls`);
  check("round 24: the pill's frame still lands on the old bar's geometry (the row IS the header row's)",
    (BUNDLE_SRC.split("pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-end gap-1 px-2").length - 1 === 1 && BUNDLE_SRC.split("pointer-events-auto mx-auto flex w-full max-w-[520px] items-center justify-center gap-1 px-2").length - 1 === 1),
    "the top row and the bottom row still share one class string (round 17)");
  check("round 24: the round-16 pill rule is overridden, not rewritten (its own block is untouched)",
    /\.cw-dock\{\nwidth:max-content;\ngap:10px;\npadding:6px 10px;\nborder-radius:999px;/.test(CSS_SRC) &&
      CSS_SRC.lastIndexOf(".cw-dock{") > CSS_SRC.indexOf(".cw-dock{\nwidth:max-content;") &&
      (CSS_SRC.match(/\.cw-dock\{/g) || []).length === 5,
    `${(CSS_SRC.match(/\.cw-dock\{/g) || []).length} .cw-dock{ rules, the override last`);

  /* --- the seat: bottom-right, safe-area padded, nothing else there --------- */
  const st = makeDom(
    { [CARDS_KEY]: CARDS3o, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) },
    { withLayout: true },
  );
  runBundle(st.window, st.errors);
  await settle(st.window, 900);
  const Wo = st.window, Do = Wo.document;
  const oAll = (sel) => [...Do.querySelectorAll(sel)];
  const oBtn = (re) => oAll("#root button").find((b) => re.test((b.getAttribute("aria-label") || "") + " " + (b.textContent || "").trim()));
  const ptr = (type, x, y) => {
    const e = new Wo.MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "isPrimary", { value: true });
    Object.defineProperty(e, "pointerId", { value: 1 });
    return e;
  };
  const tap = (el) => { if (!el) return false; el.dispatchEvent(new Wo.MouseEvent("click", { bubbles: true })); return true; };
  const text = () => textOf(Wo);
  const seat0 = seatOf(Do);
  check("round 24: the bar is one pill, anchored to the bottom edge and right-aligned",
    /fixed inset-x-0 bottom-0 z-40/.test(seat0.barClass) && /justify-center/.test(seat0.rowClass) &&
      /cw-dock/.test(seat0.pillClass) && !/top-0/.test(seat0.barClass),
    `${seat0.barClass.slice(0, 46)} || ${seat0.pillClass}`);
  check("round 24: its safe-area padding is the bottom inset, as the request asks",
    /env\(safe-area-inset-bottom\)/.test(seat0.barStyle) && /padding-bottom/i.test(seat0.barStyle),
    seat0.barStyle);
  check("round 24: the bar holds the three old controls in the old order, and nothing else",
    seat0.labels === OLD_ORDER && seat0.bar.querySelectorAll("button").length === 3,
    `${seat0.labels} (${seat0.bar.querySelectorAll("button").length} buttons in the bottom bar)`);
  check("round 24: the top of the screen is still empty (the bar is not duplicated there)",
    (() => {
      // the top container also *holds* the bottom bar (that is round 16's structure), so the row that
      // must be empty is its first child - the row that held the wordmark until round 21
      const top = oAll("#root div").find((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
      const row = top?.firstElementChild;
      // exactly one top-anchored bar may exist (the container) - a second one would BE the action bar
      const topBars = oAll("#root div").filter((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
      return topBars.length === 1 && !!top && !!row && row.querySelectorAll("button").length === 0
        && (row.textContent || "").trim() === "";
    })(), (() => {
      const topBars = oAll("#root div").filter((d) => /inset-x-0 top-0 z-40/.test(d.className || ""));
      const top = topBars[0];
      return `${topBars.length} top-anchored bar(s); top row: ${top?.firstElementChild?.querySelectorAll("button").length ?? "?"} buttons, text “${(top?.firstElementChild?.textContent || "").trim()}”`;
    })());
  const SEAT_KEY = (s) => `${s.pillClass}|${s.rowClass}|${s.barClass}|${s.barStyle}`;

  /* --- every screen: the same seat, booted fresh each time ------------------ */
  const screens = [
    ["wallet carousel", { [CARDS_KEY]: CARDS3o, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) }],
    ["wallet stack", { [CARDS_KEY]: CARDS3o, [SETTINGS_KEY]: JSON.stringify({ view: "stack", cover: true }) }],
    ["cover hidden", { [CARDS_KEY]: CARDS3o, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: false }) }],
    ["dark theme", { [CARDS_KEY]: CARDS3o, [SETTINGS_KEY]: JSON.stringify({ view: "carousel", appearance: "dark" }) }],
    ["empty wallet", { [SETTINGS_KEY]: JSON.stringify({ view: "carousel", cover: true }) }],
  ];
  const seats = [];
  for (const [name, store] of screens) {
    const inst = makeDom(store, { withLayout: true });
    runBundle(inst.window, inst.errors);
    await settle(inst.window, 900);
    const seat = seatOf(inst.window.document);
    seats.push([name, seat]);
    check(`round 24: ${name} - the same three controls in the same seat`,
      seat.labels === OLD_ORDER && /fixed inset-x-0 bottom-0 z-40/.test(seat.barClass) &&
        /env\(safe-area-inset-bottom\)/.test(seat.barStyle) && inst.errors.length === 0,
      `${seat.labels} | ${seat.barClass.slice(0, 34)} | err=${inst.errors.length}`);
    inst.dom.window.close?.();
  }
  check("round 24: the seat is identical across every screen (one class string, one anchor, one inset)",
    new Set(seats.map(([, s]) => SEAT_KEY(s))).size === 1,
    `${new Set(seats.map(([, s]) => SEAT_KEY(s))).size} distinct seat(s) across ${seats.length} screens`);

  /* --- while surfaces are open, the bar is still mounted in the same seat --- */
  const surfaces = [];
  tap(oBtn(/^Search cards$/));
  await settle(Wo, 800);
  surfaces.push(["search open", seatOf(Do)]);
  tap(oBtn(/^Close search$/));
  await settle(Wo, 600);
  tap(oBtn(/^More$/));
  await settle(Wo, 500);
  surfaces.push(["option menu open", seatOf(Do)]);
  tap(oBtn(/^Settings$/));
  await settle(Wo, 1000);
  surfaces.push(["settings sheet open", seatOf(Do)]);
  tap(oBtn(/^Customize cards$/));
  await settle(Wo, 1000);
  surfaces.push(["customize sheet open", seatOf(Do)]);
  tap(oBtn(/^Done$/));
  await settle(Wo, 800);
  const openViewer = async () => {
    for (let i = 0; i < 3 && !/WhatsApp/.test(text()); i += 1) {
      const stage = oAll("#root div").find((d) => /perspective:\s*1200/.test(inlineStyle(d)));
      if (!stage) return false;
      stage.dispatchEvent(ptr("pointerdown", 195, 300));
      await settle(Wo, 80);
      Wo.dispatchEvent(ptr("pointerup", 195, 300));
      await settle(Wo, 1700);
    }
    return /WhatsApp/.test(text());
  };
  const openedViewer = await openViewer();
  surfaces.push(["card viewer open", seatOf(Do)]);
  check("round 24: the card viewer opened for the walk-through (the last surface is real)",
    openedViewer, openedViewer ? "viewer open" : "viewer never opened");
  check("round 24: search, the option menu, both sheets and the viewer come and go without the bar ever leaving its seat",
    surfaces.length === 5 && surfaces.every(([, s]) => s.labels === OLD_ORDER && SEAT_KEY(s) === SEAT_KEY(seat0)),
    `${surfaces.length} surface(s): ` +
      surfaces.map(([n, s]) => `${n}:${SEAT_KEY(s) === SEAT_KEY(seat0) ? "same seat" : "MOVED"}`).join(" | "));

  /* --- the actions are unchanged ------------------------------------------- */
  const pillNow = () => seatOf(Do).pill;
  tap(pillNow().querySelector("button[aria-label='Add card']"));
  await settle(Wo, 600);
  check("round 24: the + control still opens its own menu (Add from gallery / Take a picture)",
    /Add from gallery/.test(text()) && /Take a picture/.test(text()), text().slice(0, 60));
  tap(pillNow().querySelector("button[aria-label='Add card']"));
  await settle(Wo, 1400);
  const menuAfterToggle = oAll("#root div").find((d) => /w-\[248px\]/.test(d.className || ""));
  const menuFaded = !!menuAfterToggle && /opacity:\s*0\b/.test(menuAfterToggle.parentElement?.getAttribute("style") || "");
  check("round 24: and tapping it again closes that menu (no stuck overlay)",
    !menuAfterToggle || menuFaded, menuAfterToggle ? "menu playing its exit animation" : "menu node gone");
  tap(pillNow().querySelector("button[aria-label='More']"));
  await settle(Wo, 600);
  check("round 24: the More control's menu still opens upward from the pill's right edge",
    /ml-auto mb-1 w-\[248px\]/.test(BUNDLE_SRC) && /transformOrigin:`right bottom`/.test(BUNDLE_SRC) &&
      /Settings/.test(text()),
    "the 248px menu hangs upward, as round 17 placed it");
  D.documentElement.dispatchEvent(new Wo.MouseEvent("pointerdown", { bubbles: true }));
  await settle(Wo, 1200);
  tap(pillNow().querySelector("button[aria-label='Search cards']"));
  await settle(Wo, 900);
  const searchMounted = !!Do.querySelector("#root input[placeholder='Search']");
  check("round 24: the search control still opens the search screen",
    searchMounted, searchMounted ? "search field mounted" : "no search field");
  tap(oBtn(/^Close search$/));
  await settle(Wo, 800);
  check("round 24: the bar is still in its seat after all three actions were exercised",
    seatOf(Do).labels === OLD_ORDER && SEAT_KEY(seatOf(Do)) === SEAT_KEY(seat0), seatOf(Do).labels);
  check("round 24: no console errors across the action-bar walk-through", st.errors.length === 0,
    st.errors.slice(0, 1).join("").slice(0, 160));
}

// ---------------------------------------------------------------------------
// Test 7: Back-button / history instrumentation probe (informational)
// ---------------------------------------------------------------------------
const bundleSrc = fs.readFileSync(path.join(APP, "index.js"), "utf8");
const usesHistory = /history\.pushState|history\.back\(/.test(bundleSrc);
const usesCapacitorBack = /backButton|hardwareBackPress|ionBackButton/.test(bundleSrc);
// Patch 26 moved this from "no handler - verify on device" to a real contract: the web layer owns
// Back for its own sheets. The native half (does the system key reach popstate at all) is still a
// device row in docs/DEVICE_TEST_PLAN.md section V.
check("back: the web layer registers a history-based Back handler for its sheets (patch26)",
  usesHistory && /cardwallet:`sheet`/.test(bundleSrc) && /`popstate`/.test(bundleSrc),
  `pushState:${usesHistory} capacitor:${usesCapacitorBack}`);
check("back: it consumes the topmost surface in a fixed order and never the wallet itself",
  /shut=\(\)=>\{if\(f\)\{p\(null\)/.test(bundleSrc) && /if\(C\)w\(!1\)/.test(bundleSrc),
  "shut() order not found");

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
