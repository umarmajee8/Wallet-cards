#!/usr/bin/env python3
"""Patch 26 - Android's Back button has to close a sheet, not quit the app.

Found by the QA pass (docs/QA_HANDOVER_REPORT.md, section 17). The shipped build has no
`backbutton`/`popstate` handling anywhere in the bundle, and this APK contains no Capacitor
plugin classes at all (the dex only carries `com/getcapacitor/Plugin` and its util classes -
`cordova_plugins.js` is empty, and there is no `App` plugin), so the usual
`Capacitor.Plugins.App.addListener('backButton')` route is not available either. On a device that
means: open Settings, press Back -> the activity finishes, the process dies, and the half-dragged
slider state is gone. Same for the card editor, the crop/review sheet and the delete-all confirm.

The fix lives entirely in the web layer and works in any WebView: every open surface pushes exactly
one history entry, and Back (which the system turns into a `popstate`) closes the topmost sheet and
pops that entry. When nothing is open there is no entry to consume, so Back exits as it always did.

    f  crop/review   -> p(null) + flush the import queue      (mirrors Nd's own onClose)
    v  camera         -> y(!1) + re.current=null              (mirrors jf's own onClose)
    T  delete-all     -> E(!1)                                (Cancel, never the red button)
    m  card editor     -> the Rd onClose body, kept identical (a new card's queue still drains)
    c  card details    -> l(null)
    D  settings        -> O(!1)
    k  studio          -> A(!1)
    b  tap-to-add      -> S(!1)
    C  search           -> w(!1)

Closing a sheet with a tap (not with Back) pops the entry programmatically, with `ign` guarding the
resulting popstate so a close never double-closes the sheet underneath. That keeps one invariant that
is easy to reason about and easy to test: history entries pushed by the app == sheets open.

Run:  python3 repo_export/patches/patch26_android_back.py [--check]
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

ANCHOR = ("me=(0,x.useCallback)(e=>{fe(e),pe.current&&window.clearTimeout(pe.current),"
          "pe.current=window.setTimeout(()=>fe(null),2200)},[]);")
INSERT = (
    "let cwb=(0,x.useRef)({pushed:0,ign:0});"
    "(0,x.useEffect)(()=>{let op=()=>!!(f||v||T||m||c||D||k||b||C),"
    "shut=()=>{if(f){p(null);oe.current=[];return}"
    "if(v){y(!1);re.current=null;return}"
    "if(T){E(!1);return}"
    "if(m){let q=!!g&&g===m;h(null);_(null);if(q&&oe.current.length)window.setTimeout(_e,320);return}"
    "if(c){l(null);return}"
    "if(D){O(!1);return}"
    "if(k){A(!1);return}"
    "if(b){S(!1);return}"
    "if(C)w(!1)},"
    "st=cwb.current,"
    "sync=()=>{let n=op();"
    "if(n&&!st.pushed){st.pushed=1;try{history.pushState({cardwallet:`sheet`},``)}catch{}}"
    "else if(!n&&st.pushed){st.pushed=0;st.ign=1;try{history.back()}catch{}}},"
    "on=e=>{if(st.ign){st.ign=0;sync();return}"
    "if(op())shut();sync()};"
    "sync();window.addEventListener(`popstate`,on);"
    "return()=>window.removeEventListener(`popstate`,on)"
    "},[f,v,T,m,c,D,k,b,C]);"
)
GUARDS = [
    ("ref is free", "cwb=" not in data),
    ("the sheet-open flags are all in scope at the anchor", "op=()=>!!(f||v||T||m||c||D||k||b||C)" in INSERT),
    ("no popstate listener existed before", "popstate`,on" not in data),
    ("marker comment not needed; ref name is unique", data.count("cwb=(0,x.useRef)") == 0),
]


def main() -> int:
    global data
    if INSERT[:20] in data:
        print("patch26: already applied" + (" (check)" if CHECK else ""))
        return 0
    if CHECK:
        # a --check run validates the anchors and guards against the *current* tree and writes
        # nothing - it is what the replay harness uses to prove a patch is still applicable
        if data.count(ANCHOR) != 1:
            raise SystemExit(f"patch26 --check: anchor present {data.count(ANCHOR)}x, need 1 (and insert absent)")
        for label, ok in GUARDS:
            if not ok:
                raise SystemExit(f"patch26 --check: guard failed - {label}")
        print("patch26 --check: anchors and guards ok (nothing written)")
        return 0
    if data.count(ANCHOR) != 1:
        raise SystemExit(f"patch26: anchor found {data.count(ANCHOR)} times, need exactly 1")
    for label, ok in GUARDS:
        if not ok:
            raise SystemExit(f"patch26: guard failed - {label}")
    data = data.replace(ANCHOR, ANCHOR + INSERT, 1)
    JS.write_text(data, encoding="utf-8")
    print(f"patch26: applied - Back now closes the topmost sheet ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
