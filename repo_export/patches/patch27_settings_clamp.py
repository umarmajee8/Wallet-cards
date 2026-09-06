#!/usr/bin/env python3
"""Patch 27 - never let stored numbers talk the deck out of existence.

Found by the QA pass (docs/QA_HANDOVER_REPORT.md, section 23). `$p()` merges whatever is in
localStorage over the defaults and trusts it. The sliders cannot produce an out-of-range value, but
the storage file can: a half-written value, a restore from another app version, a debug poke, or a
line of hand-edited JSON is enough. With `custom.stack.size = 1e9` the app computes a card 226,229,508,197
px wide (measured in jsdom - the deck is still in the DOM, just off the planet), and with negative
sizes every card collapses to 0px: an empty wallet that looks exactly like a crash. There is no
recovery path, because the bad value is written straight back.

`cwClamp()` now runs on the merged `custom` object at load time. The bounds are the sliders' own
ranges, so a value a user could have produced is never altered - only values no slider can produce
are pulled back inside. `visible` additionally rounds, and a `stack`/`carousel` block that is not an
object (a string, an array - things a corrupted file can hold) is dropped instead of being spliced
into the render path. A *number* there is not corruption: it is the pre-per-view layout multiplier
(`custom.stack: 1.5`) that the legacy fold in `$p()` still reads, so `cwClamp` leaves numbers alone.
The first version of this patch deleted them, and the existing smoke test caught it as two pouch
checks that stopped moving - a clamp must never eat a field another code path is about to read.

The second half is data loss in the card loader: `om()` kept only entries with `e.src`, so a card
that for any reason has no photo (a truncated write, a future pouch-only card, an import interrupted
mid-save) simply vanished on the next launch, with the storage then rewritten without it. The filter
now keeps anything with an id and *something to show* (`src`, `back` or a title), which the render
path already handles (the image just stays empty) - losing a card is worse than a blank card face.

Run:  python3 repo_export/patches/patch27_settings_clamp.py [--check]
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

MERGE_OLD = "n={...Qp,...t,custom:{...Xu,...t?.custom??{}}}"
MERGE_NEW = "n={...Qp,...t,custom:cwClamp({...Xu,...t?.custom??{}})}"

LOADER_OLD = ("if(Array.isArray(t))return t.filter(e=>e&&typeof e==`object`&&e.id&&e.src)"
              "}catch{}return Ld}")
LOADER_NEW = ("if(Array.isArray(t))return t.filter(e=>e&&typeof e==`object`&&e.id&&(e.src||e.back||e.title))"
              "}catch{}return Ld}")

HELPER = (
    "function cwClamp(o){let lim={depth:[.55,1.4],radius:[.4,1.9],shadow:[0,1.9],material:[.4,1.8],"
    "border:[0,1.8],grade:[.4,1.6],grain:[0,1],size:[.8,1.14],gap:[0,44],overlap:[0,1.1],spacing:[0,44],"
    "vOff:[0,26],shrink:[0,2],rot:[0,1.6],visible:[3,8],side:[.15,1],peek:[.7,1.5],pos:[-.22,.22]},"
    "cx=(v,k)=>{let r=lim[k];if(!r)return v;let n=+v;"
"if(typeof n!=`number`||!isFinite(n))return r[0];"
    "n=Math.min(r[1],Math.max(r[0],n));return k===`visible`?Math.round(n):n};"
    "if(!o||typeof o!=`object`)return{...Xu};"
    "let out={...o};"
    "for(let k in lim)if(k in out&&out[k]!=null)out[k]=cx(out[k],k);"
    "for(let ns of [`stack`,`carousel`]){let s=out[ns];"
    "if(s&&typeof s==`object`&&!Array.isArray(s)){let q={...s};"
    "for(let k in lim)if(k in q&&q[k]!=null)q[k]=cx(q[k],k);out[ns]=q}"
    "else if(s!=null&&typeof s!=`number`)delete out[ns]}"
    "return out}"
)

EDITS = [("merge", MERGE_OLD, MERGE_NEW), ("loader", LOADER_OLD, LOADER_NEW)]


def main() -> int:
    global data
    if "function cwClamp(" in data:
        print("patch27: already applied" + (" (check)" if CHECK else ""))
        return 0
    for label, old, _ in EDITS:
        if data.count(old) != 1:
            msg = f"patch27{'' if not CHECK else ' --check'}: {label} anchor found {data.count(old)}x, need 1"
            raise SystemExit(msg)
    if CHECK:
        print("patch27 --check: anchors ok (nothing written)")
        return 0
    data = data.replace("function $p(){", HELPER + "function $p(){", 1)
    for label, old, new in EDITS:
        if old == new:
            raise SystemExit(f"patch27: {label} edit is a no-op - check the anchors")
        data = data.replace(old, new, 1)
    for junk in ("if False", "undefined;", ",,"):
        if junk in data:
            raise SystemExit(f"patch27: suspicious fragment in output: {junk!r}")
    JS.write_text(data, encoding="utf-8")
    print(f"patch27: applied - settings clamped at load, src-less cards kept ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
