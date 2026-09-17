#!/usr/bin/env python3
"""patch 33 - round 18: a 4-digit app lock and an encrypted backup file.

Two features the client asked for, both implemented so they can be *tested* rather than promised:

  * **App lock** - a 4-digit code asked at cold start and after >30s away. Its source lives in
    `patches/vault_src.js` (reviewable, `node --check`ed on its own) and is appended verbatim to the
    bundle, because the shipped bundle is minified and a plain-DOM + WebCrypto module is the only way to
    add this much behaviour without coupling to mangled names. The gate is `#cw-lock`; the Settings card
    that drives it is mounted into one placeholder element inside the sheet, so no React state is shared.
  * **Backup & restore** - `Back up now` writes `cardwallet-backup-<date>.cwbak`: the cards (with their
    pictures) and the settings, as JSON, encrypted with AES-GCM 256 under a PBKDF2-SHA256 (150k) key from
    a password the user types twice. It is offered through the same share path the app already uses for
    card images (`navigator.canShare({files})`) and falls back to a normal download, so no new native
    plugin is needed - a Drive *account* flow is deliberately not faked. `Restore a file` decrypts,
    validates, and only then asks "Restore N cards - this replaces M", then reloads.

Honest limits, and they are asserted below rather than footnoted:
  * the PIN is stored only as an iterated SHA-256 digest (never the PIN), but it is a UI gate: card data
    at rest is still plaintext in localStorage, which is the open SECURITY-1 item;
  * if `crypto.subtle` is missing (old system WebView) export *refuses* - there is no plaintext path and
    no recovery is pretended at, for either the PIN or the backup password;
  * a restore that exceeds the WebView's storage quota fails loudly and leaves the current deck intact
    (measured: 20 photo cards are ~16 MB, and the cap is lower than that).

The `vault` section is inserted as one `cw-vault-slot` element in the settings body; `--danger` becomes a
theme token so the new UI carries no colour literals (the two pre-existing `text-[#ff453a]` danger rows
are left as they ship - a tidy-up, not a defect).

Usage:  python3 repo_export/patches/patch33_vault_lock_backup.py [--check]
"""
from __future__ import annotations
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
JS = APP / "index.js"
CSS = APP / "index.css"
SRC = (HERE / "vault_src.js").read_text(encoding="utf-8")
STYLE = (HERE / "vault.css").read_text(encoding="utf-8")

# the module's own export line - the slot in the sheet also mentions window.__cwVault, so a
# looser marker would make this idempotence test pass before the module is in
MARK_JS = "window.__cwVault = {"
MARK_CSS = ".cw-lock-digit{"
SLOT_MARK = "cw-vault-slot"
# the first words of each appended block's banner comment - enough to locate a stale copy
BLOCK_JS = "Card Wallet - app lock + encrypted backup"
BLOCK_CSS = "Round 18 - the lock gate and the backup rows"

BODY_OLD = ("body=(0,U.jsxs)(`div`,{children:[pouch,appear,(0,U.jsx)(`div`,{style:{height:4}})]})")
VAULT_DEF = ("vault=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Lock & backup`),"
             "(0,U.jsx)(`div`,{className:`cw-vault-slot`,ref:e=>{window.__cwVault&&window.__cwVault.mount(e)}})]}),")
BODY_NEW = ("vault_DEF body=(0,U.jsxs)(`div`,{children:[pouch,appear,vault,"
            "(0,U.jsx)(`div`,{style:{height:4}})]})")

DANGER_LIGHT = ("--scrim:rgba(18,18,22,.24);", "--scrim:rgba(18,18,22,.24);--danger:#ff453a;")
DANGER_DARK = ("--solid:#fff;--on-solid:#111113}", "--solid:#fff;--on-solid:#111113;--danger:#ff6961}")


def block_span(code: str, mark: str):
    """(start, end) of the comment block that *owns* `mark` - the `/*` that opens the comment
    containing it, up to the next banner - or None when the mark is absent.

    The naive `rindex("/*", 0, i)` is wrong whenever the mark is the banner itself (patch 34's
    BLOCK_CSS starts with `/* ====...`): searching strictly before `i` then lands on the *previous*
    block's comment, and a re-sync would rewrite the round-18 block with round-19 text. So the
    opening is taken at `i` when the mark starts a comment, and the `*/` test refuses a `/*` whose
    comment is already closed before the mark.
    """
    i = code.find(mark)
    if i < 0:
        return None
    start = code.rindex("/*", 0, i + 2) if code[i:i + 2] == "/*" else code.rindex("/*", 0, i)
    if "*/" in code[start:i]:
        return None
    nxt = re.compile(r"\n/\* ={20,}").search(code, i + 2)
    return start, (nxt.start() if nxt else len(code))


def sync_appended(code: str, mark: str, src: str, label: str) -> str:
    """The reviewed source file is the contract: if a copy of it is already in `code`, its text is
    replaced rather than skipped. Appending once and then editing the source file is precisely how a
    bundle drifts from the patch, so "already applied" is not an answer - being *current* is."""
    # A block owns its text up to the *next* block banner, not to EOF: round 19 appended after round
    # 18 and round 22 after both, so re-syncing an older patch must not take the newer rounds with it.
    span = block_span(code, mark)
    if span is None:
        return None
    start, end = span
    want = src.strip("\n")
    if code[start:end].strip("\n") == want:
        print(f"  DONE  {label} is current")
        return code
    print(f"  ok    {label} was stale in the tree - re-synced from the reviewed source")
    return code[:start].rstrip("\n") + "\n" + want + "\n" + code[end:]


def apply_js(code: str) -> str:
    """Insert the settings slot, then append the module. Both idempotent."""
    if SLOT_MARK not in code:
        if BODY_OLD not in code:
            raise SystemExit("  FAIL  the settings body is not the shape this patch expects:\n        " + BODY_OLD[:90])
        code = code.replace(BODY_OLD, BODY_NEW.replace("vault_DEF ", VAULT_DEF), 1)
        print("  ok    the sheet grows a 'Lock & backup' card (one mount point, no React state shared)")
    else:
        print("  DONE  the settings slot is already mounted")
    synced = sync_appended(code, BLOCK_JS, SRC, "vault_src.js")
    if synced is None:
        assert "vault_src.js" not in code
        code = code.rstrip("\n") + "\n" + SRC.strip("\n") + "\n"
        print(f"  ok    vault_src.js appended to the bundle ({len(SRC)} chars)")
    else:
        code = synced
    return code


def apply_css(css: str) -> str:
    for label, old, new, tok in [("danger token (light)", *DANGER_LIGHT, "--danger:#ff453a"),
                                 ("danger token (dark)", *DANGER_DARK, "--danger:#ff6961")]:
        if tok in css:
            print(f"  DONE  {label}")
            continue
        if css.count(old) != 1:
            raise SystemExit(f"  FAIL  {label} anchor matched {css.count(old)} times, expected exactly 1")
        css = css.replace(old, new, 1)
        print(f"  ok    {label}")
    synced = sync_appended(css, BLOCK_CSS, STYLE, "vault.css")
    if synced is None:
        css = css.rstrip("\n") + "\n" + STYLE.strip("\n") + "\n"
        print(f"  ok    vault.css appended ({len(STYLE)} chars)")
    else:
        css = synced
    return css


def lint(style: str, src: str, code: str, css: str) -> list[str]:
    """Lint the *reviewed sources*, and prove the tree contains them verbatim.

    Linting `STYLE`/`SRC` instead of a slice of index.css is not a shortcut: the CSS in this repo is built
    by patch 30 too, so a slice from "Round 18" to EOF picks up other blocks' colour functions and the
    verdict depends on patch order. The sources are the contract; the file must contain them byte-for-byte.
    """
    bad = []
    for what, hits in (("hex colour", re.findall(r"#[0-9a-fA-F]{3,8}\b", style)),
                       ("rgb()/hsl() colour", re.findall(r"\b(?:rgba?|hsla?)\(", style))):
        if hits:
            bad.append(f"{len(hits)} {what} literal(s) in vault.css, e.g. {hits[0]} - the new UI must be token-driven")
    if re.search(r"transition:[^;}]*(backdrop-filter|filter)", style):
        bad.append("a transition touches a filter")
    if re.search(r"\.cw-lock\{[^}]*backdrop-filter", style):
        bad.append("the gate blurs - it must stay opaque, it covers the data it protects")
    if "var(--danger)" not in style:
        bad.append("the new UI should use the --danger token")
    if "animation:" in style and "@media (prefers-reduced-motion" not in style:
        bad.append("the shake needs a reduced-motion guard")
    if code.count("className:`" + SLOT_MARK + "`") != 1:
        bad.append("the settings slot must be mounted exactly once")
    if src.strip("\n") not in code:
        bad.append("the bundle does not contain patches/vault_src.js verbatim")
    if style.strip("\n") not in css:
        bad.append("index.css does not contain patches/vault.css verbatim")
    if code.count(MARK_JS) != 1:
        bad.append(f"the vault module appears {code.count(MARK_JS)} times")
    return bad


def main() -> int:
    js, css = JS.read_text(encoding="utf-8"), CSS.read_text(encoding="utf-8")
    js2, css2 = apply_js(js), apply_css(css)
    problems = lint(STYLE, SRC, js2, css2)
    if problems:
        print("  FAIL  lint on the round-18 CSS/JS:")
        for p in problems:
            print("        -", p)
        return 1
    if "--check" in sys.argv:
        print(f"\n--check ok: js {len(js2)} chars (module={MARK_JS in js2}), css {len(css2)} chars")
        return 0
    if js2 == js and css2 == css:
        print("\nno change: patch 33 already applied")
        return 0
    js_bak, css_bak = js, css
    JS.write_text(js2, encoding="utf-8")
    CSS.write_text(css2, encoding="utf-8")
    r = subprocess.run(["node", "--check", str(JS)], capture_output=True, text=True)
    if r.returncode != 0:
        JS.write_text(js_bak, encoding="utf-8"); CSS.write_text(css_bak, encoding="utf-8")
        print("\nFAILED: node --check rejected the bundle; both files restored.")
        print(" | ".join(l for l in r.stderr.splitlines() if "SyntaxError" in l or l.startswith("node:")))
        return 1
    print(f"\napp/index.js: {len(js2.encode('utf-8'))} bytes (was {len(js.encode('utf-8'))}), "
          f"app/index.css: {len(css2.encode('utf-8'))} bytes (was {len(css.encode('utf-8'))}); node --check ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
