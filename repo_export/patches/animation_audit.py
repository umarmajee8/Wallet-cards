#!/usr/bin/env python3
"""Static animation / rendering-cost audit of the Card Wallet web layer.

This CANNOT measure smoothness - frame timing only exists on a real device.
What it can do is flag the patterns that cause visible jank on Android
WebView, so the on-device pass knows exactly where to look.

Usage: python3 repo_export/patches/animation_audit.py
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "repo_export" / "app"
JS = (APP / "index.js").read_text(encoding="utf-8", errors="replace")
CSS = (APP / "index.css").read_text(encoding="utf-8", errors="replace")

# Properties the compositor can animate off the main thread.
COMPOSITED = {"x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "opacity"}
# Properties that force layout on every frame -> the classic source of jank.
LAYOUT_TRIGGERING = {"width", "height", "top", "left", "right", "bottom", "margin",
                     "marginTop", "marginLeft", "padding", "fontSize", "borderRadius"}

findings: list[tuple[str, str, str]] = []


def finding(level: str, title: str, detail: str) -> None:
    findings.append((level, title, detail))


# --- 1. which properties are actually animated -----------------------------
animated_props: set[str] = set()
for block in re.findall(r"(?:animate|initial|exit|whileTap|whileDrag):\{([^{}]{0,200})\}", JS):
    for key in re.findall(r"([A-Za-z]+)\s*:", block):
        animated_props.add(key)

layout_animated = sorted(animated_props & LAYOUT_TRIGGERING)
composited = sorted(animated_props & COMPOSITED)
if layout_animated:
    finding("WARN", "Layout-triggering properties are animated",
            f"{layout_animated} - these re-layout every frame on the main thread")
else:
    finding("PASS", "All motion uses compositor-friendly properties",
            f"animated: {composited}")

# --- 2. spring configuration sanity ----------------------------------------
springs = re.findall(r"stiffness:(\d+),damping:(\d+)", JS)
harsh = [(s, d) for s, d in springs if int(d) and int(s) / int(d) > 25]
finding(
    "PASS" if not harsh else "WARN",
    "Spring damping ratios are in a settled range",
    f"{len(springs)} springs, stiffness/damping worst case "
    f"{max((int(s) / int(d) for s, d in springs), default=0):.1f}"
    + (f", under-damped: {harsh}" if harsh else ""),
)

# --- 3. long animations ----------------------------------------------------
durations = [float(d) for d in re.findall(r"duration:([0-9.]+)[,}]", JS)]
ui_durations = [d for d in durations if d < 10]  # seconds (ignore ms timeouts)
slow = [d for d in ui_durations if d > 0.5]
finding(
    "PASS" if not slow else "INFO",
    "Transition durations stay snappy",
    f"{len(ui_durations)} timed transitions, max {max(ui_durations, default=0)}s"
    + (f", >0.5s: {slow}" if slow else ""),
)

# --- 4. expensive paint effects -------------------------------------------
backdrop = len(re.findall(r"backdrop-filter", CSS)) + len(re.findall(r"backdropFilter", JS))
blurs = len(re.findall(r"blur\(", CSS)) + len(re.findall(r"blur\(", JS))
finding(
    "INFO" if backdrop else "PASS",
    "Backdrop-filter / blur usage (GPU cost on mid-range Android)",
    f"backdrop-filter refs={backdrop}, blur() refs={blurs} - verify the frosted pouch "
    f"and sheet scrims on a real mid-range device",
)

shadows = len(re.findall(r"box-shadow", CSS)) + len(re.findall(r"boxShadow", JS))
animated_shadow = bool(re.search(r"(?:animate|whileTap):\{[^{}]*boxShadow", JS))
finding(
    "WARN" if animated_shadow else "PASS",
    "box-shadow is not animated per-frame",
    f"{shadows} shadow declarations, animated={animated_shadow}",
)

# --- 5. scroll behaviour ---------------------------------------------------
finding(
    "PASS" if "overscroll" in CSS or "overscrollBehavior" in JS else "INFO",
    "Overscroll behaviour is pinned (prevents WebView bounce/pull-refresh)",
    f"overscroll refs in css={len(re.findall('overscroll', CSS))}, js={len(re.findall('overscrollBehavior', JS))}",
)
finding(
    "PASS" if "touch-action" in CSS or "touchAction" in JS else "INFO",
    "touch-action declared for drag surfaces (avoids 300ms/scroll conflicts)",
    f"refs css={len(re.findall('touch-action', CSS))}, js={len(re.findall('touchAction', JS))}",
)

# --- 6. images / decode ----------------------------------------------------
finding(
    "PASS" if "decode()" in JS or ".decode(" in JS else "INFO",
    "Card images are pre-decoded before they animate",
    "img.decode() warm-up found" if ".decode(" in JS else "no explicit decode warm-up",
)
finding(
    "INFO", "Card photos are persisted as data URLs in localStorage",
    "large wallets => bigger JSON parse on cold start; measure cold start on device",
)

# --- 7. dead weight --------------------------------------------------------
ocr_refs = len(re.findall(r"tesseract|ocr/", JS))
finding(
    "INFO" if ocr_refs else "PASS",
    "OCR engine assets still shipped (auto-detect feature was removed)",
    f"{ocr_refs} refs left in the bundle; ~17 MB of tesseract wasm/traineddata is "
    "still inside the APK. Safe to drop only in a real source rebuild.",
)

width = max(len(t) for _, t, _ in findings) + 2
print()
for level, title, detail in findings:
    print(f"  {level:<5} {title:<{width}} {detail}")
warns = [t for lvl, t, _ in findings if lvl == "WARN"]
print(f"\n{len(findings)} checks, {len(warns)} warning(s)")
if warns:
    print("WARNINGS: " + ", ".join(warns))
print("NOTE: smoothness/jank itself can only be judged on a physical device.")
