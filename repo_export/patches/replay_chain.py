#!/usr/bin/env python3
"""Rebuild app/index.js from the pristine bundle by replaying the patch chain.

The bundle in this repo is *only ever* produced by the patch scripts, so the scripts must be
able to reproduce it exactly from the stock file - that is what proves the shipped bundle has
no hand edits and that the patches stay mutually consistent (idempotent, ordered, and honest
about which spans a later patch rewrites).

    python3 patches/replay_chain.py                 # verify the shipped bundle == the replay
    python3 patches/replay_chain.py --upto 19       # build through patch 19 only (scratch)
    python3 patches/replay_chain.py --upto 19 --swap # ...and put it in the tree (negative controls)
    python3 patches/replay_chain.py --restore         # put the saved bundle back

`--swap` writes the tree file but first copies the previous one to /tmp, and
`--restore` puts it back, so a control run cannot lose the real bundle. `--check-each` runs
every patch's own `--check` against the final file, which is how a missing DOWNSTREAM_KEEP
or SUPERSEDED marker shows up.

The stock bundle is read from --stock (default: the `index.stock.js` next to this script, or
/tmp/index.stock.js if that is where the pristine copy lives).
"""
from pathlib import Path
import argparse
import hashlib
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
APP = HERE.parent / "app"
ROOT = HERE.parents[1]   # the git checkout - the stock-bundle fallback reads the base blob from here
BACKUP = Path("/tmp/cardwallet-replay-backup.js")   # outside the tree, so a control run cannot commit it

ORDER = [7, 8, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]


def scripts(upto, work):
    """The copies inside the scratch tree - never the repo's own scripts, or the replay
    would read and patch the shipped bundle instead of the one being rebuilt."""
    out = []
    for n in ORDER:
        if n > upto:
            break
        hits = sorted((work / "patches").glob(f"patch{n}_*.py"))
        if len(hits) != 1:
            raise SystemExit(f"expected exactly one patch{n}_*.py, found {len(hits)}: {[h.name for h in hits]}")
        out.append(hits[0])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--upto", type=int, default=max(ORDER))
    ap.add_argument("--stock", default=None)
    ap.add_argument("--swap", action="store_true", help="write the replay into app/index.js (kept as .replay_backup.js)")
    ap.add_argument("--restore", action="store_true", help="put app/index.js back from .replay_backup.js")
    ap.add_argument("--check-each", action="store_true")
    ap.add_argument("--out", default=None, help="also copy the replayed bundle here")
    ap.add_argument("--verbose", action="store_true", help="print each patch's own output")
    a = ap.parse_args()

    if a.restore:
        if not BACKUP.exists():
            raise SystemExit(f"nothing to restore ({BACKUP} does not exist)")
        shutil.move(str(BACKUP), str(APP / "index.js"))
        back = (APP / "index.js").read_bytes()
        print(f"restored app/index.js from {BACKUP.name} - {len(back)} bytes, "
              f"md5 {hashlib.md5(back).hexdigest()[:12]}")
        return

    stock = None
    for cand in (a.stock, APP / "index.stock.js", "/tmp/index.stock.js"):
        if cand and Path(cand).exists():
            stock = Path(cand)
            break
    if not stock:
        # last resort: the bundle as it stood on the commit this session branched from - the seed
        # patch 7's anchors were written against, so /tmp copies surviving is not a requirement
        for ref in ("eb98ba0", "HEAD"):
            got = subprocess.run(["git", "-C", str(ROOT), "show", f"{ref}:repo_export/app/index.js"],
                                 capture_output=True, text=True)
            if got.returncode == 0 and got.stdout:
                tmp = Path("/tmp/index.stock.js")
                tmp.write_text(got.stdout, encoding="utf-8")
                stock = tmp
                print(f"(using the bundle from {ref}: {len(got.stdout)} chars)")
                break
    if not stock:
        raise SystemExit("no pristine bundle: pass --stock /path/to/index.stock.js")

    work = Path("/tmp/replay-chain")
    shutil.rmtree(work, ignore_errors=True)
    (work / "app").mkdir(parents=True)
    shutil.copytree(HERE, work / "patches")
    shutil.copy(HERE.parent / "header_options.json", work / "header_options.json")
    shutil.copy(APP / "index.css", work / "app" / "index.css")   # patch 15 edits it; idempotent
    (work / "app" / "index.js").write_bytes(stock.read_bytes())

    for script in scripts(a.upto, work):
        r = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, cwd=str(work))
        if r.returncode:
            print(f"{script.name} FAILED ({r.returncode})")
            print((r.stdout + r.stderr)[-1500:])
            raise SystemExit(1)
        print(f"ok  {script.name}" + (("\n      " + "\n      ".join((r.stdout or "").strip().splitlines())) if a.verbose and r.stdout.strip() else ""))

    got = (work / "app" / "index.js").read_bytes()
    if a.out:
        Path(a.out).write_bytes(got)
        print("wrote", a.out)
    if a.swap:
        cur = APP / "index.js"
        if not BACKUP.exists():
            shutil.copy(cur, BACKUP)
            note = f"backup: {BACKUP}"
        else:
            # the first swap of a session owns the backup, so a chain of control runs can all be
            # undone with one --restore; say so, because --restore then returns to *that* state
            note = ("keeping the backup already there" if BACKUP.read_bytes() == cur.read_bytes()
                    else f"keeping an OLDER backup ({BACKUP} was taken before an earlier swap)")
        before = len(cur.read_bytes())
        cur.write_bytes(got)
        # and prove it landed - a --swap that silently wrote nothing turns every negative control
        # into a run of the shipped bundle, which looks exactly like "the new tests pass without
        # the new patch" and is the worst possible thing for a control to say
        after = cur.read_bytes()
        if after != got:
            raise SystemExit(f"--swap did not take: {cur} holds {len(after)} bytes, wanted {len(got)}")
        print(f"swapped replayed bundle into the tree: {before} -> {len(after)} bytes ({note})")

    want = (APP / "index.js").read_bytes()
    same = got == want
    print(f"\nreplay through patch {a.upto}: {len(got)} bytes vs shipped {len(want)} -> "
          + ("IDENTICAL" if same else "DIFFERS"))
    if not same and not a.swap:
        for i in range(min(len(got), len(want))):
            if got[i] != want[i]:
                print(f"first difference at byte {i}:\n  replay: …{got[max(0, i-70):i+70]!r}\n  shipped: …{want[max(0, i-70):i+70]!r}")
                break
    if a.check_each:
        print()
        for script in scripts(a.upto, work):
            r = subprocess.run([sys.executable, str(script), "--check"], capture_output=True, text=True, cwd=str(work))
            tail = (r.stdout or r.stderr).strip().splitlines()
            print(f"{'ok  ' if r.returncode == 0 else 'FAIL'} {script.name:<38} {tail[-1] if tail else ''}")
        repo = (APP / "index.js").read_bytes()
        if (work / "app" / "index.js").read_bytes() != repo:
            print("\n(note: --check-each ran against the replayed file, not the shipped one)")
    raise SystemExit(0 if (same or a.swap) else 1)


main()
