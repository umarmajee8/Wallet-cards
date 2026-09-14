#!/usr/bin/env python3
"""Measure the site's text contrast the way a reviewer should: through the glass, over the worst pixel the
page background can produce, in both themes.

Every text surface here is --card or --glass painted over a body background that is a two-stop radial
gradient, so the ratio depends on which part of the gradient sits behind the text. Optimistic checkers sample
the middle. This one composites the surface over *each* background stop (paper, --bg-a, --bg-b) and reports
the worst ratio, which is the only number worth printing in a README. Exits non-zero when something a reader
needs falls under WCAG 2.2 AA (4.5:1 for body text), so it doubles as a gate:

    python3 tools/contrast.py

No dependencies, no network. Re-run it after touching any colour token in assets/site.css.
"""
import re
import sys
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "assets" / "site.css"

PAIRS = [
    ("body text on a card", "--ink", "--card"),
    ("secondary text on a card", "--muted", "--card"),
    ("card heading on a card", "--ink", "--card"),
    ("nav link on the blurred bar", "--muted", "--glass"),
    ("wordmark on the blurred bar", "--ink", "--glass"),
    ("theme switch label on glass", "--ink", "--glass"),
    ("primary button label", "--on-solid", "--solid"),
    ("secondary button label", "--ink", "--card"),
    ("caption under a screenshot", "--muted", None),
    ("note paragraph (bordered, on page)", "--muted", None),
    ("download panel body text", "--muted", "--glass"),
    ("download panel heading", "--ink", "--glass"),
    ("sha256 code chip", "--muted", "--tint"),
    ("footer line", "--muted", None),
]


def tokens(block):
    return {k: v.strip() for k, v in re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", block)}


def parse(val):
    m = re.match(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", val.strip())
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)
    m = re.match(r"^rgba?\(([^)]+)\)$", val.strip())
    if m:
        p = [x.strip() for x in m.group(1).split(",")]
        rgb = (int(x) / 255 for x in p[:3])
        return tuple(rgb) + (float(p[3]) if len(p) > 3 else 1.0,)
    raise ValueError("not a colour I can read: " + repr(val))


def over(fg, bg):
    a = fg[3]
    return tuple(a * fg[i] + (1 - a) * bg[i] for i in range(3)) + (1.0,)


def lin(c):
    return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4


def lum(rgb):
    r, g, b = rgb[:3]
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def main():
    css = CSS.read_text()
    light = re.search(r":root\s*\{(.*?)\}", css, re.S)
    dark = re.search(r"html\.dark\s*\{(.*?)\}", css, re.S)
    if not light or not dark:
        print("cannot find the :root or html.dark token blocks in site.css")
        return 2
    rows, worst = [], 99.0
    for theme, tk in (("light", tokens(light.group(1))), ("dark", tokens(dark.group(1)))):
        bgs = [parse(tk[k]) for k in ("--paper", "--bg-a", "--bg-b") if k in tk]
        for label, fg_tok, surf_tok in PAIRS:
            fg = parse(tk[fg_tok])
            best = 99.0
            for bg in bgs:
                base = over(parse(tk[surf_tok]), bg) if surf_tok else bg
                best = min(best, ratio(over(fg, base), base))
            rows.append((theme, label, best))
            worst = min(worst, best)
    for theme in ("light", "dark"):
        print("\n" + theme)
        for t, label, val in rows:
            if t == theme:
                print("  %s  %5.2f:1   %s" % ("PASS" if val >= 4.5 else "FAIL", val, label))
    print("\nworst ratio in the table: %.2f:1 (WCAG 2.2 AA wants 4.5:1 for body text, 3:1 for large text)" % worst)
    return 0 if worst >= 4.5 else 1


if __name__ == "__main__":
    sys.exit(main())
