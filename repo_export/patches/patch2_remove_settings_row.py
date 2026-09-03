path = "/home/claude/work/decoded/assets/public/assets/index-DfWhHAzK.js"
data = open(path, encoding="utf-8").read()

old = "(0,U.jsxs)(`button`,{onClick:r,className:`flex w-full items-center justify-between rounded-2xl px-4 py-3 active:opacity-70`,style:{background:`var(--raised)`,border:`1px solid var(--line)`},children:[(0,U.jsxs)(`span`,{className:`text-left`,children:[(0,U.jsx)(`span`,{className:`block text-[15px] font-semibold ink`,children:`Make your own pouch`}),(0,U.jsx)(`span`,{className:`block text-[12.5px] sub`,children:o?`On \u00b7 tap to change it`:`Your leather, your colour, your name`})]}),(0,U.jsx)(`span`,{className:`text-[18px] sub`,children:`\u203a`})]}),o?(0,U.jsx)(`button`,{onClick:()=>{n({theme:`frost`}),navigator.vibrate&&navigator.vibrate(6)},className:`mb-5 mt-2 w-full px-1 text-left text-[13px] font-medium text-[#0a84ff] active:opacity-70`,children:`Back to the standard pouch`}):(0,U.jsx)(`div`,{className:`mb-5`}),"

print("count:", data.count(old))
if data.count(old) == 1:
    data = data.replace(old, "")
    open(path, "w", encoding="utf-8").write(data)
    print("patched")
