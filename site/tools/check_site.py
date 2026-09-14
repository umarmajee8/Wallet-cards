#!/usr/bin/env python3
"""Structural gate for the marketing site - run it after any edit: `python3 tools/check_site.py`.

It is deliberately boring and does not need a browser, because nothing in this repo can run one:

  * every page must parse with no unclosed or stray tags, and have exactly one <h1>;
  * every local href must resolve to a file that exists;
  * nothing may load a script, stylesheet or image from another host - that is the whole claim of the
    privacy page ("loads nothing from a third party"), so it is enforced, not promised;
  * the stylesheet may not hard-code a colour below the token blocks, and only the two surfaces that
    earn a blur may declare one.

Exit code 0 means all of that holds. tools/contrast.py covers colour legibility; this covers structure.
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
LOADS = re.compile(r'<script[^>]*\bsrc="([^"]+)"'
                   r'|<link[^>]*rel="stylesheet"[^>]*\bhref="([^"]+)"'
                   r'|<img[^>]*\bsrc="([^"]+)"')


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.err = []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.err.append(f"unclosed <{self.stack.pop()}>")
            self.stack.pop()
        else:
            self.err.append(f"stray </{tag}>")


def pages():
    return sorted(ROOT.glob("*.html"))


def main() -> int:
    fail = []
    for page in pages():
        txt = page.read_text()
        p = Parser()
        p.feed(txt)
        opened = [t for t in p.stack if t != "html"]
        urls = [u for u in (next(g for g in m if g) for m in LOADS.findall(txt))]
        offsite = [u for u in urls if u.startswith(("http://", "https://", "//"))]
        h1 = len(re.findall(r"<h1[\s>]", txt))
        broken = []
        for href in re.findall(r'href="\./([^"#?]+)', txt):
            target = (page.parent / href.split("#")[0]).resolve()
            if not target.exists():
                broken.append(href)
        ok = not (p.err or opened or offsite or broken) and h1 == 1
        print(f"  {'PASS' if ok else 'FAIL'}  {page.name:14} {len(txt):>6} B  "
              f"h1={h1} loads={len(urls)} (offsite={len(offsite)}) links-broken={broken or 0} "
              f"parse={'clean' if not (p.err or opened) else (p.err + opened)}")
        if not ok:
            fail.append(page.name)

    css = (ROOT / "assets" / "site.css").read_text()
    below = css[css.index("* { box-sizing"):]
    literals = re.findall(r"#[0-9a-fA-F]{3,8}\b|rgba?\(", below)
    blurring = [b.strip() for b in re.findall(r"([^\n{}]+)\{[^}]*backdrop-filter", css)]
    ok = not literals and len(blurring) <= 4
    print(f"  {'PASS' if ok else 'FAIL'}  site.css       {len(css):>6} B  "
          f"colour literals after the token blocks={len(literals)} blur rules={blurring}")
    if not ok:
        fail.append("site.css")

    js = (ROOT / "assets" / "site.js").read_text()
    net = re.findall(r"fetch\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket", js)
    print(f"  {'PASS' if not net else 'FAIL'}  site.js        {len(js):>6} B  network calls={net or 'none'}")
    if net:
        fail.append("site.js")

    total = sum(f.stat().st_size for f in ROOT.rglob("*") if f.is_file())
    print(f"  {'PASS' if total < 400_000 else 'FAIL'}  folder weight {total:,} B "
          f"({'< 400 KB budget' if total < 400_000 else 'over the 400 KB budget'})")
    if total >= 400_000:
        fail.append("weight")

    print("\n" + ("FAIL: " + ", ".join(fail) if fail else "all structural checks passed "
          f"(run tools/contrast.py too - that is the colour gate)"))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
