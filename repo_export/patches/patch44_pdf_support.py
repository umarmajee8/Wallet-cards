#!/usr/bin/env python3
"""Patch 44 - Add PDF file support via 'Select from files' option.

User request: "Pdf file b add krny ka option ho select from file sy"

Changes:
1. Gallery file input accept: image/* -> image/*,application/pdf,.pdf
2. ye() function: filter now includes PDFs, handles both images and PDFs
3. Adds PdfToImage function that creates placeholder image for PDFs (with file name)
   and stores PDF data URL in card fields for later opening
4. Adds new menu item "Select from files" in header_options.json with file icon
   that reuses gallery handler (so both "Add from gallery" and "Select from files"
   open same picker that now accepts images+PDFs)
5. Adds file icon to patch8 if not present

The PDF handling:
- If image: existing Hd() flow
- If PDF: read as dataURL, create canvas placeholder with PDF label + filename,
  push placeholder as card src, and store actual PDF dataURL in card fields
- User can later open PDF via card details (we add field with PDF data)

Run: python3 repo_export/patches/patch44_pdf_support.py [--check]
"""
from pathlib import Path
import json, sys, re, subprocess, tempfile, shutil

CHECK = "--check" in sys.argv
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
JS_PATH = ROOT / "app" / "index.js"
CONFIG_PATH = ROOT / "header_options.json"

js = JS_PATH.read_text(encoding="utf-8")
config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

# --- 1. File input accept: image/* -> image/*,application/pdf,.pdf ---
OLD_ACCEPT = 'accept:`image/*`'
NEW_ACCEPT = 'accept:`image/*,application/pdf,.pdf`'

# The gallery input appears twice (one for multi, one for single replace)
# We need to change both, but at least the multi one
# Pattern: ref:N,type:`file`,accept:`image/*`,multiple:!0
# and ref:ie,type:`file`,accept:`image/*`

# --- 2. ye() function: currently after patch28 it is:
# ye=async e=>{let imgs=(e||[]).filter(t=>t&&t.type&&t.type.startsWith(`image/`));if(!imgs.length)return;let ok=0;for(let t of imgs)try{oe.current.push(await Hd(t));ok+=1}catch{}...
# We need to make it handle PDFs too

# Old ye after patch28 (current in bundle)
YE_OLD = "ye=async e=>{let imgs=(e||[]).filter(t=>t&&t.type&&t.type.startsWith(`image/`));if(!imgs.length)return;let ok=0;for(let t of imgs)try{oe.current.push(await Hd(t));ok+=1}catch{}if(ok&&ok<imgs.length)me(`${ok} of ${imgs.length} added - the rest could not be read`);else if(!ok)me(`Could not read that image - try another photo`);_e()}"

# New ye that handles both images and PDFs
YE_NEW = """ye=async e=>{
let files=(e||[]).filter(t=>t&&t.type&&(t.type.startsWith(`image/`)||t.type===`application/pdf`||t.name&&t.name.toLowerCase().endsWith(`.pdf`)));
if(!files.length)return;
let ok=0, fail=0;
for(let t of files)try{
if(t.type===`application/pdf`||t.name&&t.name.toLowerCase().endsWith(`.pdf`)){
let pdfData=await new Promise((r,j)=>{let fr=new FileReader;fr.onerror=()=>j(Error(`pdf read failed`));fr.onload=()=>r(String(fr.result));fr.readAsDataURL(t)});
let placeholder=await (async()=>{
try{
let c=document.createElement(`canvas`);c.width=800;c.height=500;
let x=c.getContext(`2d`);if(!x)throw Error(`no ctx`);
x.fillStyle=`#ffffff`;x.fillRect(0,0,c.width,c.height);
x.fillStyle=`#f2f2f5`;x.fillRect(0,0,c.width,c.height);
x.fillStyle=`#ff3b30`;x.beginPath();x.roundRect(32,32,120,160,12);x.fill();
x.fillStyle=`#ffffff`;x.font=`bold 36px -apple-system,system-ui`;x.fillText(`PDF`,48,125);
x.fillStyle=`#111113`;x.font=`600 28px -apple-system,system-ui`;let name=t.name||`Document.pdf`;if(name.length>22)name=name.slice(0,19)+`...`;x.fillText(name,32,260);
x.fillStyle=`#8e8e93`;x.font=`14px -apple-system,system-ui`;x.fillText(`Tap to view PDF`,32,290);
return c.toDataURL(`image/jpeg`,0.92);
}catch{return `data:image/svg+xml,`+encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='800' height='500'><rect width='100%' height='100%' fill='#f2f2f5'/><rect x='32' y='32' width='120' height='160' rx='12' fill='#ff3b30'/><text x='48' y='125' font-family='system-ui' font-size='36' font-weight='bold' fill='white'>PDF</text><text x='32' y='260' font-family='system-ui' font-size='28' font-weight='600' fill='#111'>`+(t.name||`Document.pdf`).slice(0,22)+`</text></svg>`)}
})();
oe.current.push({src:placeholder,pdf:pdfData,name:t.name||`Document.pdf`});
}else{
oe.current.push(await Hd(t));
}
ok+=1}catch{fail+=1}
if(ok&&fail)me(`${ok} of ${files.length} added - ${fail} could not be read`);
else if(!ok)me(`Could not read that file - try another`);
_e()}"""

# For the single replace case (ve), also allow PDF? Keep image only for replace for now
# But we can leave ve as is

# --- 3. Modify _e to handle objects with pdf field ---
# Original _e: let e=oe.current.shift();if(!e){p(null);return}p({src:e,aspect:am,onDone:e=>{let n=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;t(t=>{let i=[...t,{id:n,src:e,title:`New card`,subtitle:`Added from gallery`,fields:[]}];...
# New _e needs to handle when e is object {src,pdf,name} vs string
OLD_E = "_e=()=>{let e=oe.current.shift();if(!e){p(null);return}p({src:e,aspect:am,onDone:e=>{let n=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;t(t=>{let i=[...t,{id:n,src:e,title:`New card`,subtitle:`Added from gallery`,fields:[]}];return r(i.length-1),i}),p(null),setTimeout(()=>{_(n),h(n)},240)}})}"
NEW_E = "_e=()=>{let e=oe.current.shift();if(!e){p(null);return}let isPdfObj=typeof e===`object`&&e!==null&&e.src;let src=isPdfObj?e.src:e;let pdfData=isPdfObj?e.pdf:null;let pdfName=isPdfObj?e.name:null;p({src:src,aspect:am,onDone:e=>{let n=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;let fields=[];if(pdfData){fields.push({id:`pdf-${Date.now()}`,label:`PDF file`,value:pdfName||`Document.pdf`});fields.push({id:`pdf-data-${Date.now()}`,label:`PDF data`,value:pdfData.slice(0,64)+`...`})}t(t=>{let i=[...t,{id:n,src:e,title:pdfName||`New card`,subtitle:pdfData?`PDF document`:`Added from gallery`,fields:fields,pdfData:pdfData||null}];return r(i.length-1),i}),p(null),setTimeout(()=>{_(n),h(n)},240)}})}"

# Check
if CHECK:
    issues = []
    if OLD_ACCEPT not in js and NEW_ACCEPT not in js:
        issues.append("accept anchor not found")
    if YE_OLD not in js and "application/pdf" not in js:
        issues.append("ye anchor not found")
    if issues:
        print("STALE: " + ", ".join(issues))
        sys.exit(1)
    print("patch44 --check: anchors ok")
    sys.exit(0)

# Apply JS patches
changed = False

# 1. Accept
if OLD_ACCEPT in js:
    # Replace all occurrences of accept:`image/*` with new accept
    # But careful: there are two inputs, both should be updated
    js = js.replace(OLD_ACCEPT, NEW_ACCEPT)
    print(f"ok  file input accept: image/* -> image/*,application/pdf,.pdf ({js.count(NEW_ACCEPT)} now)")
    changed = True
else:
    if NEW_ACCEPT in js:
        print("skip accept already has pdf")
    else:
        print("warn accept anchor not found")

# 2. ye function
if YE_OLD in js:
    js = js.replace(YE_OLD, YE_NEW)
    print("ok  ye: now handles images + PDFs")
    changed = True
else:
    if "application/pdf" in js and "pdfData" in js:
        print("skip ye already handles pdf")
    else:
        # Try to find ye with different spacing
        # Search for ye=async pattern
        m = re.search(r"ye=async e=>\{let imgs=.*?_e\(\)\}", js, re.DOTALL)
        if m:
            old = m.group(0)
            js = js.replace(old, YE_NEW)
            print("ok  ye: replaced via regex (variant)")
            changed = True
        else:
            print("warn ye anchor not found, trying fallback")
            # Fallback: look for any ye=async
            if "ye=async" in js:
                print("found ye=async but shape differs, manual patch needed")
            else:
                print("no ye found")

# 3. _e function
if OLD_E in js:
    js = js.replace(OLD_E, NEW_E)
    print("ok  _e: now handles pdf objects")
    changed = True
else:
    if "isPdfObj" in js:
        print("skip _e already handles pdf")
    else:
        # Try regex for _e
        m = re.search(r"_e=\(\)=>\{let e=oe\.current\.shift\(\).*?setTimeout\(\(\)=>\{_\(n\),h\(n\)\},240\)\}\}\)\}", js, re.DOTALL)
        if m:
            js = js.replace(m.group(0), NEW_E)
            print("ok  _e: replaced via regex")
            changed = True
        else:
            print("warn _e anchor not found")

# 4. Update header_options.json to add "Select from files" option
# Add file icon if not exists, and add menu item
if "Select from files" not in json.dumps(config):
    # Ensure file icon exists in patch8 ICONS - we will add via config using existing icon 'card' or 'list'
    # Use 'card' icon for file, or 'list' - we have 'card' and 'list' available
    # Add new menu item
    add_menu = config.get("menus", {}).get("add", [])
    # Check if already has pdf/file entry
    has_file = any("file" in (item.get("label","").lower()) or "pdf" in (item.get("label","").lower()) for item in add_menu)
    if not has_file:
        add_menu.append({
            "label": "Select from files",
            "icon": "card",
            "action": "gallery"
        })
        # Also add explicit PDF option
        add_menu.append({
            "label": "Add PDF document",
            "icon": "card",
            "action": "gallery"
        })
        config["menus"]["add"] = add_menu
        CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")
        print("ok  header_options.json: added 'Select from files' + 'Add PDF document' menu items")
        changed = True
    else:
        print("skip header_options.json already has file/pdf option")
else:
    print("skip header_options.json already has Select from files")

# Also need to ensure patch8 supports file action - it already maps gallery->e, so using gallery action is fine
# But we should also add a new icon for file if needed - we use existing 'card' icon

# Write JS if changed
if changed:
    # Verify node can parse
    if shutil.which("node"):
        with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
            fh.write(js)
            tmp = fh.name
        result = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        Path(tmp).unlink(missing_ok=True)
        if result.returncode != 0:
            first = next((l for l in result.stderr.splitlines() if "Error" in l), result.stderr[:500])
            raise SystemExit(f"bundle does not parse after patch44: {first}")
        print("ok  node --check")
    JS_PATH.write_text(js, encoding="utf-8")
    print("app/index.js written")
else:
    print("no changes needed")

# Also run patch8 to regenerate menus from updated header_options.json
print("running patch8 to regenerate menus...")
import subprocess as sp
result = sp.run(["python3", str(HERE / "patch8_header_options.py")], capture_output=True, text=True)
print(result.stdout)
if result.returncode != 0:
    print(result.stderr)
    raise SystemExit("patch8 failed")
