path = "/home/claude/work/decoded/assets/public/assets/index-DfWhHAzK.js"
data = open(path, encoding="utf-8").read()

# 1) Insert two new theme definitions right after the Frost (Yu) theme object.
anchor = "rivets:!0,castShadow:`rgba(0,0,0,0.55)`}},Xu={color:`#243044`"
assert data.count(anchor) == 1, data.count(anchor)

new_themes = (
    "rivets:!0,castShadow:`rgba(0,0,0,0.55)`}},"
    "__cwSteelTheme={id:`steel`,name:`Steel`,"
    "tray:`linear-gradient(180deg, #5b5d6c 0%, #454758 45%, #34364a 100%)`,"
    "trayBorder:`1px solid rgba(255,255,255,0.10)`,"
    "traySheen:`linear-gradient(118deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.0) 26%, rgba(255,255,255,0.06) 42%, rgba(255,255,255,0) 60%)`,"
    "trayShadow:`0 18px 38px -18px rgba(0,0,0,0.55)`,"
    "sleeve:{base:`#4c4e5d`,deep:`#2c2e3d`,grain:.32,grainScale:.42,sheen:`rgba(255,255,255,0.16)`,"
    "shade:`rgba(0,0,0,0.35)`,vignette:.3,rim:`rgba(255,255,255,0.22)`,stitch:null,"
    "stitchShadow:`rgba(0,0,0,0.5)`,rivets:!1,castShadow:`rgba(0,0,0,0.5)`}},"
    "__cwEmeraldTheme={id:`emerald`,name:`Emerald`,"
    "tray:`linear-gradient(180deg, #163b2c 0%, #0d2a1f 48%, #071a13 100%)`,"
    "trayBorder:`1px solid rgba(255,255,255,0.07)`,"
    "traySheen:`linear-gradient(118deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.0) 26%, rgba(255,255,255,0.05) 42%, rgba(255,255,255,0) 60%)`,"
    "trayShadow:`0 18px 38px -18px rgba(0,0,0,0.6)`,"
    "sleeve:{base:`#123527`,deep:`#051209`,grain:.45,grainScale:.42,sheen:`rgba(255,255,255,0.10)`,"
    "shade:`rgba(0,0,0,0.42)`,vignette:.38,rim:`rgba(255,255,255,0.14)`,stitch:`rgba(180,210,195,0.35)`,"
    "stitchShadow:`rgba(0,0,0,0.55)`,rivets:!1,castShadow:`rgba(0,0,0,0.55)`}},"
    "Xu={color:`#243044`"
)

data = data.replace(anchor, new_themes, 1)

# 2) Make the theme-resolver aware of the two new ids.
old_resolver = "id=`frost`,ad=(e,t)=>e===`custom`&&t?rd(t):Yu,od=new Map"
new_resolver = "id=`frost`,ad=(e,t)=>e===`custom`&&t?rd(t):e===`steel`?__cwSteelTheme:e===`emerald`?__cwEmeraldTheme:Yu,od=new Map"
assert data.count(old_resolver) == 1, data.count(old_resolver)
data = data.replace(old_resolver, new_resolver, 1)

open(path, "w", encoding="utf-8").write(data)
print("themes patched")
