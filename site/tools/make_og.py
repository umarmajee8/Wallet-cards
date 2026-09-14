#!/usr/bin/env python3
"""Write assets/og.png (1200x630) from the site's own colour tokens - no image library, no network.

The site has no build step, and Open Graph still wants a raster, so this draws the product's own motif (a
flat-colour card cover on two glass panes, and the lock with its four digit boxes) as flat pixels and writes
a PNG with zlib by hand. Colours are composited once, up front, because per-pixel alpha stacking leaves a
halo around every shape. Re-run it after changing a token; replace it with a designed export when one exists
and keep 1200x630.

    python3 tools/make_og.py
"""
import re
import struct
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
CSS = HERE.parent / "assets" / "site.css"
OUT = HERE.parent / "assets" / "og.png"
W, H = 1200, 630


def tokens():
    return {k: v.strip() for k, v in re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);",
                                                re.search(r":root\s*\{(.*?)\}", CSS.read_text(), re.S).group(1))}


def parse(val):
    m = re.match(r"^#([0-9a-fA-F]{6})$", val.strip())
    if m:
        h = m.group(1)
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
    m = re.match(r"^rgba?\(([^)]+)\)$", val.strip())
    p = [x.strip() for x in m.group(1).split(",")]
    rgb = tuple(int(x) for x in p[:3])
    return rgb + (int(round(float(p[3]) * 255)) if len(p) > 3 else 255,)


class Canvas:
    def __init__(self):
        self.px = bytearray(W * H * 4)

    def blend(self, x, y, col, cov):
        if not (0 <= x < W and 0 <= y < H) or cov <= 0:
            return
        i = (y * W + x) * 4
        a = col[3] / 255 * cov
        for c in range(3):
            self.px[i + c] = int(col[c] * a + self.px[i + c] * (1 - a) + 0.5)
        self.px[i + 3] = min(255, int(self.px[i + 3] + (255 - self.px[i + 3]) * a))

    def rect(self, x0, y0, x1, y1, col, r=0, alpha=1.0):
        """axis-aligned rect, optional corner radius; only the rim gets a coverage ramp"""
        for y in range(max(0, int(y0)), min(H, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(W, int(x1) + 1)):
                cov = 1.0
                if r:
                    near = (x < x0 + r or x > x1 - r) and (y < y0 + r or y > y1 - r)
                    if near:
                        cx = min(max(x, x0 + r), x1 - r)
                        cy = min(max(y, y0 + r), y1 - r)
                        d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
                        cov = max(0.0, min(1.0, r + 0.5 - d + ((x < x0 + r) - (x > x1 - r)) * 0))
                        if r <= 0:
                            cov = 1.0
                        else:
                            dx = max(x0 + r - x, 0, x - (x1 - r))
                            dy = max(y0 + r - y, 0, y - (y1 - r))
                            dd = (dx * dx + dy * dy) ** 0.5
                            cov = max(0.0, min(1.0, r + 0.5 - dd))
                self.blend(x, y, col, cov * alpha)

    def write(self, path):
        raw = b"".join(b"\x00" + bytes(self.px[y * W * 4:(y + 1) * W * 4]) for y in range(H))

        def chunk(tag, data):
            return (struct.pack(">I", len(data)) + tag + data
                    + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

        png = (b"\x89PNG\r\n\x1a\n"
               + chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(raw, 6))
               + chunk(b"IEND", b""))
        path.write_bytes(png)
        return len(png)


def main():
    tk = tokens()
    paper, bg_a, bg_b = parse(tk["--paper"]), parse(tk["--bg-a"]), parse(tk["--bg-b"])
    ink, muted, danger = parse(tk["--ink"]), parse(tk["--muted"]), parse(tk["--danger"])
    solid, on_solid = parse(tk["--solid"]), parse(tk["--on-solid"])

    def mix(base, over, a):
        return tuple(int(over[c] * a + base[c] * (1 - a) + 0.5) for c in range(3)) + (255,)

    c = Canvas()
    for y in range(H):                                   # the page wash, kept very quiet
        t = y / H
        c.rect(0, y, W, y, tuple(int(bg_b[i] * (1 - t) + paper[i] * t + 0.5) for i in range(3)) + (255,))
    pane = mix(mix(paper, bg_a, 0.35), paper, 0.5)
    rim = mix(paper, ink, 0.10)
    for dx, dy in ((34, -30), (17, -15)):                # two glass panes, fanned
        x0, y0 = 116 + dx, 180 + dy
        c.rect(x0, y0, x0 + 470, y0 + 330, pane, r=30)
        c.rect(x0, y0, x0 + 470, y0 + 1, rim)
        c.rect(x0, y0 + 329, x0 + 470, y0 + 330, rim)
    x0, y0, x1, y1 = 116, 150, 592, 486                  # the cover: flat colour, accent chip, field lines
    c.rect(x0, y0, x1, y1, solid, r=28)
    c.rect(x0 + 40, y0 + 44, x0 + 150, y0 + 66, mix(solid, danger, 0.92), r=12)
    for i, w in enumerate((300, 236, 268, 190)):
        c.rect(x0 + 40, y0 + 116 + i * 42, x0 + 40 + w, y0 + 128 + i * 42,
               mix(solid, on_solid, 0.82 - i * 0.12), r=6)
    c.rect(x0 + 40, y1 - 46, x0 + 132, y1 - 12, mix(solid, on_solid, 0.26), r=17)
    lx, ly = 800, 182                                    # the lock, then the four digit boxes under it
    c.rect(lx - 8, ly - 100, lx + 248, ly + 44, mix(paper, bg_a, 0.28), r=26)
    c.rect(lx + 46, ly - 74, lx + 194, ly - 52, ink, r=11)
    c.rect(lx + 46, ly - 74, lx + 68, ly + 4, ink, r=11)
    c.rect(lx + 172, ly - 74, lx + 194, ly + 4, ink, r=11)
    c.rect(lx + 78, ly - 52, lx + 162, ly - 24, mix(paper, bg_a, 0.28), r=8)
    bx0, by0 = lx + 8, ly - 22
    c.rect(bx0, by0, bx0 + 224, by0 + 168, ink, r=26)
    c.rect(bx0 + 104, by0 + 52, bx0 + 128, by0 + 96, mix(ink, on_solid, 0.9), r=10)
    c.rect(bx0 + 96, by0 + 84, bx0 + 136, by0 + 116, mix(ink, on_solid, 0.9), r=12)
    for n in range(4):
        dx = bx0 - 22 + n * 62
        c.rect(dx, by0 + 196, dx + 50, by0 + 250, mix(paper, ink, 0.07), r=14)
        c.rect(dx + 17, by0 + 214, dx + 33, by0 + 232, mix(paper, ink, 0.34), r=8)
    c.rect(0, H - 6, W, H, mix(paper, danger, 0.55))
    n = c.write(OUT)
    print("%s: %dx%d RGBA, %s bytes written (flat colour, so it compresses hard)"
          % (OUT.name, W, H, format(n, ",")))


if __name__ == "__main__":
    main()
