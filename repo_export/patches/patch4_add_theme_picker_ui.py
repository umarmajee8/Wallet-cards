path = "/home/claude/work/decoded/assets/public/assets/index-DfWhHAzK.js"
data = open(path, encoding="utf-8").read()

anchor = "children:[(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase tracking-[0.12em] sub`,children:`Reading cards`})"
assert data.count(anchor) == 1, data.count(anchor)

picker = (
    "children:["
    "(0,U.jsxs)(`div`,{className:`mb-5`,children:["
    "(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase tracking-[0.12em] sub`,children:`Pouch style`}),"
    "(0,U.jsx)(`div`,{className:`flex gap-3`,children:["
    "{id:`frost`,name:`Frosted`,c1:`#2b2b2f`,c2:`#0d0d0f`},"
    "{id:`steel`,name:`Steel`,c1:`#5b5d6c`,c2:`#2c2e3d`},"
    "{id:`emerald`,name:`Emerald`,c1:`#163b2c`,c2:`#071a13`}"
    "].map(e=>(0,U.jsxs)(`button`,{key:e.id,onClick:()=>{n({theme:e.id}),navigator.vibrate&&navigator.vibrate(6)},"
    "className:`flex flex-1 flex-col items-center gap-1.5 rounded-2xl px-2 py-3 active:opacity-70`,"
    "style:{background:`var(--raised)`,border:t.theme===e.id?`2px solid #0a84ff`:`1px solid var(--line)`},"
    "children:["
    "(0,U.jsx)(`div`,{className:`h-9 w-14 rounded-lg`,style:{background:`linear-gradient(180deg, ${e.c1} 0%, ${e.c2} 100%)`}}),"
    "(0,U.jsx)(`span`,{className:`text-[12px] font-medium ink`,children:e.name})"
    "]}))})"
    "]}),"
    "(0,U.jsx)(`div`,{className:`pb-2 text-[13px] font-medium uppercase tracking-[0.12em] sub`,children:`Reading cards`})"
)

data = data.replace(anchor, picker, 1)
open(path, "w", encoding="utf-8").write(data)
print("ui patched")
