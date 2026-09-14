#!/usr/bin/env python3
"""Patch 28 - a failed import has to say so. Silence is not an error message.

Found by the QA pass (docs/QA_HANDOVER_REPORT.md, section 4). The gallery import was:

    ye=async e=>{if(e.length){for(let t of e)if(t.type.startsWith(`image/`))
      try{oe.current.push(await Hd(t))}catch{}_e()}}

The `catch{}` swallows every failure of reading/decoding a picked image, and `_e()` then finds an
empty queue and closes the sheet. The user picked a photo, the sheet dismissed, and the wallet shows
nothing - with no message and nothing in the log. On a device this happens whenever the read fails:
an HEIC from a recent phone that the WebView cannot decode, a file the share sheet handed over with
no bytes, a photo still in cloud storage that cannot be materialised, or the WebView running out of
memory while decoding a 12-megapixel image. Same shape in `ve` (replace a card's photo), where the
crop sheet just never opens.

Now the outcome is always reported:
  * nothing readable  -> "Could not read that image - try another photo"
  * part of a batch    -> "3 of 5 added - the rest could not be read" (the good ones still import)
  * replace-photo fail -> "Could not read that photo" (the card keeps its old face)
`me()` is the toast the app already uses for its quota and share errors, so this is the same
affordance the rest of the app speaks with - no new UI.
"""
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
JS = HERE.parent / "app" / "index.js"
data = JS.read_text(encoding="utf-8")
CHECK = "--check" in sys.argv

YE_OLD = ("ye=async e=>{if(e.length){for(let t of e)if(t.type.startsWith(`image/`))"
          "try{oe.current.push(await Hd(t))}catch{}_e()}}")
YE_NEW = ("ye=async e=>{let imgs=(e||[]).filter(t=>t&&t.type&&t.type.startsWith(`image/`));"
          "if(!imgs.length)return;"
          "let ok=0;"
          "for(let t of imgs)try{oe.current.push(await Hd(t));ok+=1}catch{}"
          "if(ok&&ok<imgs.length)me(`${ok} of ${imgs.length} added - the rest could not be read`);"
          "else if(!ok)me(`Could not read that image - try another photo`);"
          "_e()}")
VE_OLD = ("ve=async(e,t)=>{try{let n=await Hd(t);p({src:n,aspect:am,onDone:t=>{"
          "se(e.id,e.side===`front`?{src:t}:{back:t}),p(null)}})}catch{}}")
VE_NEW = ("ve=async(e,t)=>{let n;try{n=await Hd(t)}catch{me(`Could not read that photo`);return}"
          "p({src:n,aspect:am,onDone:t=>{se(e.id,e.side===`front`?{src:t}:{back:t}),p(null)}})}")
EDITS = [("gallery import", YE_OLD, YE_NEW), ("replace photo", VE_OLD, VE_NEW)]


def main() -> int:
    global data
    if "Could not read that image" in data:
        print("patch28: already applied" + (" (check)" if CHECK else ""))
        return 0
    for label, old, _ in EDITS:
        if data.count(old) != 1:
            raise SystemExit(f"patch28{'' if not CHECK else ' --check'}: {label} anchor found {data.count(old)}x, need 1")
    if CHECK:
        print("patch28 --check: anchors ok (nothing written)")
        return 0
    for label, old, new in EDITS:
        if old == new:
            raise SystemExit(f"patch28: {label} edit is a no-op")
        data = data.replace(old, new, 1)
    JS.write_text(data, encoding="utf-8")
    print(f"patch28: applied - import failures now surface as a toast ({len(data)} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
