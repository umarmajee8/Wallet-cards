"""Remove Auto-detect details from the minified CardWallet bundle."""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "app" / "index.js"
data = path.read_text(encoding="utf-8")

old_settings = (
    "(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase tracking-[0.12em] sub`,children:`Reading cards`}),"
    "(0,U.jsxs)(`div`,{className:`rounded-2xl px-4 py-4`,style:{background:`var(--raised)`,border:`1px solid var(--line)`},children:["
    "(0,U.jsxs)(`div`,{className:`flex items-start gap-3`,children:["
    "(0,U.jsxs)(`div`,{className:`min-w-0 flex-1`,children:["
    "(0,U.jsxs)(`div`,{className:`flex items-center gap-2`,children:["
    "(0,U.jsx)(`span`,{className:`text-[16px] font-semibold ink`,children:`Auto-detect details`}),"
    "(0,U.jsx)(`span`,{className:`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white`,style:{background:`#ff9500`},children:`Beta`})"
    "]}),"
    "(0,U.jsx)(`p`,{className:`mt-1 pr-2 text-[13px] leading-snug sub`,children:`Reads the card in the picture and fills the details in for you. Still a beta version — it misreads things, so check whatever it writes. Turn it off and the app never looks at your pictures.`})"
    "]}),"
    "(0,U.jsx)(Mp,{on:t.autoDetect,onChange:e=>n({autoDetect:e})})"
    "]}),"
    "(0,U.jsx)(`div`,{className:`mt-3 border-t hairline pt-3 text-[13px] font-medium sub`,children:t.autoDetect?(0,U.jsx)(`span`,{className:`text-[#0a84ff]`,children:`On · new pictures are read automatically`}):(0,U.jsx)(`span`,{children:`Off · details are only what you type in`})})"
    "]}),"
)

old_btn = (
    "a&&(0,U.jsxs)(`button`,{onClick:()=>!s&&i(e),disabled:s,className:`mb-3 flex w-full items-center justify-center gap-2 rounded-xl border hairline py-2.5 text-[14px] font-semibold ink active:opacity-70 disabled:sub`,children:["
    "(0,U.jsxs)(`svg`,{width:`16`,height:`16`,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:`1.9`,strokeLinecap:`round`,strokeLinejoin:`round`,children:["
    "(0,U.jsx)(`path`,{d:`M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3`}),"
    "(0,U.jsx)(`path`,{d:`M3 12h18`})]}),"
    "s?`Reading the card…`:`Fill in from picture`,"
    "(0,U.jsx)(`span`,{className:`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white`,style:{background:`#ff9500`},children:`Beta`})]}),"
)

replacements = [
    (old_settings, ""),
    (old_btn, ""),
    (
        "xe=(e,n)=>{j.autoDetect&&(ne(!0),jp(n).then(({fields:n,title:r})=>{!n.length&&!r||(t(t=>t.map(t=>{if(t.id!==e)return t;let i=new Set((t.fields??[]).map(e=>e.label.toLowerCase())),a=n.filter(e=>!i.has(e.label.toLowerCase())),o=/^(new card|)$/i.test(t.title.trim())&&r?r:t.title;return{...t,title:o,fields:[...t.fields??[],...a]}})),navigator.vibrate&&navigator.vibrate(6))}).catch(()=>{}).finally(()=>ne(!1)))}",
        "xe=(e,n)=>{}",
    ),
    ("j.autoDetect&&xe(n,e)", "0"),
    ("canScan:j.autoDetect,onScan:e=>xe(e.id,e.src),", "canScan:!1,"),
    ("e.autoDetect===!1&&ne(!1)", "0"),
    (
        "return n.theme!==`custom`&&(n.theme=id),n",
        "return n.theme!==`custom`&&(n.theme=id),n.autoDetect=!1,n",
    ),
]

for old, new in replacements:
    count = data.count(old)
    print(f"count {count} for snippet starting {old[:48]!r}")
    if count != 1:
        raise SystemExit(f"expected 1 match, got {count}")
    data = data.replace(old, new, 1)

path.write_text(data, encoding="utf-8")
print("autodetect removed")
