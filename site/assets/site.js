/* The only script on the site: the theme switch, and one courtesy for the disclosure rows.
   Light is the default; the system setting is respected until the user overrides it, and the choice is kept
   in localStorage so the rest of the pages agree. No network, nothing else stored, and with JavaScript off
   the site is still fully readable in the light theme - the button simply does nothing. */
(function () {
  var root = document.documentElement;
  var KEY = "cw-site-theme";

  function sync(btn) {
    var dark = root.classList.contains("dark");
    if (!btn) return;
    btn.setAttribute("aria-pressed", dark ? "true" : "false");
    var lab = btn.querySelector(".t-lab");
    if (lab) lab.textContent = dark ? "Light" : "Dark";
    btn.setAttribute("aria-label", dark ? "Switch to the light theme" : "Switch to the dark theme");
    var meta = document.querySelector('meta[name="theme-color"]:not([media])');
    if (meta) meta.setAttribute("content", dark ? "#0b0b0d" : "#ffffff");
  }

  var btn = document.getElementById("themeBtn");
  if (btn) {
    sync(btn);
    btn.addEventListener("click", function () {
      var next = root.classList.contains("dark") ? "light" : "dark";
      root.classList.toggle("dark", next === "dark");
      sync(btn);
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: the choice just won't persist */ }
    });
  }

  /* Reading six open security rows at once is a wall of text; keep to one at a time. Rows inside a details
     element on the privacy/terms pages are unaffected because there are none. */
  var rows = Array.prototype.slice.call(document.querySelectorAll("details"));
  rows.forEach(function (d) {
    d.addEventListener("toggle", function () {
      if (!d.open) return;
      rows.forEach(function (o) { if (o !== d && o.parentElement === d.parentElement) o.removeAttribute("open"); });
    });
  });
})();
