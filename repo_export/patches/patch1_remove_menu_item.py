path = "/home/claude/work/decoded/assets/public/assets/index-DfWhHAzK.js"
data = open(path, encoding="utf-8").read()

old = ",{label:`Make your own pouch`,onClick:f(a),icon:(0,U.jsx)(`path`,{d:`M4 8.5 12 5l8 3.5v7L12 19l-8-3.5v-7Zm0 0 8 3.5 8-3.5M12 12v7`,stroke:`currentColor`,strokeWidth:`1.6`,strokeLinejoin:`round`})}"

print("count:", data.count(old))
if data.count(old) == 1:
    data = data.replace(old, "")
    open(path, "w", encoding="utf-8").write(data)
    print("patched")
