/* =====================================================================================
   Round 19 - the customization gate.

   One switch in the Custom Pouch card: the look of the cards (colours, cover, stack and
   carousel geometry) is editable *only* while it is on, and it turns itself off again
   the moment the sheet closes or the app goes to the background. Nothing is persisted:
   the gate is per-visit by design, because "remembered on" is the same as "off that you
   forgot about", and because the app's own settings object belongs to React - a second
   writer there would fight it.

   The gate is a class toggle, not a React state: `html[data-cw-custom="off"]` plus one
   CSS rule hides the block that holds the controls. So a slider keeps working while the
   sheet re-renders, and if this module ever fails to run the controls stay visible -
   losing the gate is worse than losing the lock.
   ===================================================================================== */
(function () {
  "use strict";
  if (window.__cwCust) return;

  var ATTR = "data-cw-custom";
  var ON = "on";
  var OFF = "off";
  var OFF_COPY = "Turn on to change card colours, the cover and how the deck is arranged. It switches off by itself when you close Settings.";
  var ON_COPY = "Editing is open. The card look changes as you drag; the gate closes itself when you leave Settings.";
  var POLLS = 400;                       /* ms; watching the slot beats a document-wide observer */

  var on = false;
  var slot = null;
  var row = null;
  var sw = null;
  var cap = null;
  var timer = 0;

  function el(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }

  function paint() {
    document.documentElement.setAttribute(ATTR, on ? ON : OFF);
    if (sw) {
      sw.classList.toggle("cw-vault-on", on);
      sw.setAttribute("aria-checked", on ? "true" : "false");
    }
    if (cap) cap.textContent = on ? ON_COPY : OFF_COPY;
  }

  function set(next) {
    on = !!next;
    paint();
    if (on && !timer) {
      timer = setInterval(function () {
        /* the node React handed us leaving the document is the sheet closing */
        if (!slot || !slot.isConnected) set(false);
      }, POLLS);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  function build(host) {
    while (host.firstChild) host.removeChild(host.firstChild);
    var lead = el("div", "cw-vault-lead");
    lead.appendChild(el("div", "cw-vault-label", "Customize cards"));
    cap = el("div", "cw-vault-note", on ? ON_COPY : OFF_COPY);
    lead.appendChild(cap);
    sw = el("button", "cw-vault-switch" + (on ? " cw-vault-on" : ""), "");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.setAttribute("aria-label", "Customize cards");
    sw.onclick = function () { set(!on); };
    row = el("div", "cw-vault-row");
    row.appendChild(lead);
    row.appendChild(sw);
    host.appendChild(row);
  }

  /* React calls an inline ref with null and then with the node on every re-render, so a
     null here is a re-render, not a close: the slot reference is kept and only the
     isConnected poll decides when the gate shuts. */
  function mount(node) {
    if (!node) return;
    slot = node;
    if (node.__cwCust && node.firstChild) { paint(); return; }
    node.__cwCust = 1;
    build(node);
    paint();
  }

  function onHide() { if (document.hidden && on) set(false); }
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", function () { if (on) set(false); });

  window.__cwCust = {
    mount: mount,
    isOn: function () { return on; },
    set: set,
    copy: { off: OFF_COPY, on: ON_COPY },
  };
  paint();
})();
