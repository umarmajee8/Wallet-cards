// patch25 source: the Settings sheet after round 13 - patch 24's sheet with the preview repaired.
//
// Round 13 exists because the stack preview was still an empty box on a real phone (the user's
// screenshot): the component sized its *cards* from the `fit` box, but its own stage carried only
// `flex:1` - which means nothing outside a flex column - so the stage was 0px tall and its
// `overflow:hidden` clipped the whole stack away. patch 25 hands the stage the box's width and
// height, and only when a `fit` box is given, so the wallet path stays byte-identical.
// The stand-in cards also get a properly encoded data URL: their fill colour carried a raw `#`,
// which ends a URL, so that artwork could never load.
//
// Readable form of the function patch25 splices into app/index.js. patch25 deletes these `//`
// lines and each line's leading indentation and joins the rest, so a line break may only sit
// after `,` `(` `[` `{` or an operator (intra-line spaces survive). One node per variable, so no
// nesting spans a join. Aliases in scope at the splice point: U (jsx), x (React), X (motion),
// W (AnimatePresence), Ed (the memoised carousel = Td), __cwStack, Mp (the switch), __cwMrg
// (patch 23's per-view overlay, so the preview is fed exactly what the wallet is fed).
function Np({open:e,settings:t,onChange:n,onCustomise:r,onClose:i,cards:cs}){
let ts=(0,x.useRef)(0),ms=(0,x.useRef)(null),tgt=(0,x.useRef)({}),rmp=(0,x.useRef)({}),loop=(0,x.useRef)(0),fr=(0,x.useRef)(0),drg=(0,x.useRef)(null),[drag,setDrag]=(0,x.useState)(null);
// rAF is not assumed: on any engine without it the same 16ms coalescing falls back to a timer, and
// the glide below simply commits per frame instead of per event.
function rf(f){return typeof window>`u`||!window.requestAnimationFrame?setTimeout(f,16):window.requestAnimationFrame(f)}
function cf(id){return typeof window>`u`||!window.cancelAnimationFrame?clearTimeout(id):window.cancelAnimationFrame(id)}
// "stack.rot" / "carousel.peek" are per-view; a bare "radius" is shared pouch design.
function isP(p){let s=p.split(`.`);return s.length>1&&(s[0]===`stack`||s[0]===`carousel`)}
function sub(c,p){if(!isP(p))return c[p];let s=p.split(`.`);return (c[s[0]]||{})[s[1]]}
function warp(c,p,v){let o={...c};if(isP(p)){let s=p.split(`.`);o[s[0]]={...(o[s[0]]||{}),[s[1]]:v}}else o[p]=v;return o}
(0,x.useEffect)(()=>{e&&(ts.current=Date.now(),ms.current=null,tgt.current={},rmp.current={})},[e]);
(0,x.useEffect)(()=>()=>{loop.current&&cf(loop.current);fr.current&&cf(fr.current)},[]);
let cu=t.custom||{},isStack=(t.view||`carousel`)===`stack`,NS=isStack?`stack`:`carousel`,
RAMP=[`stack.overlap`,`stack.vOff`,`stack.size`,`stack.rot`,`stack.visible`,`stack.spacing`,`carousel.gap`,`carousel.size`,`carousel.side`,`carousel.peek`,`carousel.pos`],
// A drag is a two-tier write with a third tier on top: local state holds the value this sheet is
// showing (React otherwise restores a controlled input to the last committed value mid-drag, and
// that flicker is what read as "not smooth"), the geometry fields are *ramped* - each frame covers
// 42% of the remaining distance so the wallet and the preview glide to the finger instead of
// stepping - and every other field commits once per frame. `ms.current` mirrors the whole settings
// object, so the two writers and the ramp can never disagree about what the sheet has already said.
now=o=>{ms.current=o;n(o)},
pc=(p,v)=>{drg.current=p;setDrag({p,v});if(RAMP.includes(p)){tgt.current[p]=v;loop.current||tick();return}soon({custom:warp(cu,p,v)})},
tick=()=>{loop.current=rf(()=>{loop.current=0;let live=0,c0=(ms.current||t).custom||cu,o={...c0};
for(let p in tgt.current){let to=tgt.current[p],from=rmp.current[p];from==null&&(from=+(sub(c0,p)??to));let d=to-from;
if(Math.abs(d)>2e-4){from+=d*.42;if(Math.abs(to-from)<Math.max(8e-4,Math.abs(d)*.05))from=to;else live=1}else from=to;
rmp.current[p]=from;o=warp(o,p,Math.round(from*1e4)/1e4);
if(from===to){delete tgt.current[p];delete rmp.current[p];if(drg.current===p){setDrag(null);drg.current=null}}}
now({...ms.current||t,custom:o});if(live)tick()})},
soon=o=>{ms.current={...ms.current||t,...o};if(fr.current)return;fr.current=rf(()=>{fr.current=0;n({custom:ms.current.custom,theme:`slate`});if(!Object.keys(tgt.current).length)setDrag(null)})},
set=o=>{now({...ms.current||t,...o,custom:{...(ms.current||t).custom,...(o.custom||{})}})},
num=p=>{if(drag&&drag.p===p)return +drag.v;let v=sub((ms.current||t).custom||cu,p);return v==null?null:+v},
Row=(l,c)=>(0,U.jsxs)(`div`,{className:`cw-row`,children:[(0,U.jsx)(`span`,{className:`cw-lbl`,children:l}),c]}),
Seg=o=>(0,U.jsx)(`div`,{className:`mb-1 flex gap-2`,children:o.map(z=>(0,U.jsx)(`button`,{onClick:()=>{z.f();navigator.vibrate&&navigator.vibrate(6)},"data-on":z.v,className:`cw-chip`,children:z.label},z.label))}),
Rng=(l,p,mn,mx,st,fmt,d)=>{let raw=num(p),v=raw==null?d:raw,pr=Math.round((v-mn)/(mx-mn)*100);
return(0,U.jsxs)(`div`,{className:`cw-row`,children:[(0,U.jsx)(`span`,{className:`cw-lbl`,children:l}),(0,U.jsxs)(`div`,{className:`flex min-w-0 flex-1 items-center gap-2`,children:[(0,U.jsx)(`input`,{"aria-label":l,type:`range`,min:mn,max:mx,step:st,value:v,style:{"--p":`${pr}%`},onChange:z=>pc(p,+z.target.value),className:`cw-range`}),(0,U.jsx)(`span`,{className:`cw-val`,children:fmt(v)})]})]})},
dot=h=>(0,U.jsx)(`button`,{"aria-label":`Pouch colour ${h}`,className:`cw-dot`,style:{background:h},"data-on":(cu.color||t.slateColor||`#5c6574`)===h,onClick:()=>{set({theme:`slate`,slateColor:h,custom:{...cu,color:h}});navigator.vibrate&&navigator.vibrate(6)}},h),
H=t2=>(0,U.jsx)(`div`,{className:`pb-2 cw-h`,children:t2}),
S=t2=>t2?(0,U.jsx)(`div`,{className:`cw-sub`,children:t2}):null,
// The preview is the wallet's own tree fed the wallet's own merged settings, and it never runs dry:
// the wallet's real cards first, then stand-ins built by the same card components with the same
// per-card pouch colour, so three cards are on stage in the carousel and five in the stack.
pv=(()=>{let want=isStack?6:3,l=(cs||[]).filter(z=>z&&z.src).slice(0,want),pal=[`rgb(44,61,86)`,`rgb(90,58,44)`,`rgb(31,68,54)`,`rgb(75,59,107)`,`rgb(107,31,42)`];
for(let i=l.length;i<want;i++){let cl=pal[i%pal.length];l.push({id:`__cwph${i}`,title:``,subtitle:``,fields:[],color:cl,
src:`data:image/svg+xml;charset=utf-8,`+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="760" height="494"><rect width="760" height="494" rx="88" fill="'+cl+'"/></svg>')})}
return l})(),
prev=(0,U.jsx)(isStack?__cwStack:Ed,{cards:pv,cover:t.cover!==!1,theme:t.theme,custom:__cwMrg(t.custom,NS),tint:t.slateColor,index:0,onIndexChange:()=>{},onOpen:()=>{},onLongPress:()=>{},ejectedId:null,hiddenId:null,fit:isStack?{w:388,h:302}:void 0}),
prevBox=(0,U.jsx)(`div`,{className:`cw-preview`,children:(0,U.jsx)(`div`,{className:`cw-preview-in`,style:isStack?{width:388,height:302,transform:`translateX(-50%) scale(.56)`}:void 0,children:prev})}),
// ---- Design: colour, edge, radius, shadow, texture - every one of them a slider
pouchRows=(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(`div`,{className:`cw-dots`,children:[`#f3efe6`,`#5c6574`,`#2b2d32`,`#8b93a0`,`#9a8f82`,`#2c3d56`,`#2d4a3e`,`#6b3038`,`#5a4a3a`,`#3d3454`,`#1c1e22`].map(dot)}),
Rng(`Background`,`depth`,.55,1.4,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Radius`,`radius`,.4,1.9,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Shadow`,`shadow`,0,1.9,.01,v=>v<.02?`None`:`${Math.round(v*100)}%`,1),
Rng(`Sheen`,`material`,.4,1.8,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Edge`,`border`,0,1.8,.01,v=>v<.02?`None`:`${Math.round(v*100)}%`,1),
Rng(`Grading`,`grade`,.4,1.6,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Grain`,`grain`,0,1,.01,v=>`${Math.round(v*100)}%`,0),
Row(`Stitching`,(0,U.jsx)(Mp,{on:!!cu.stitch,onChange:z=>pc(`stitch`,z)})),
Row(`Name`,(0,U.jsx)(`input`,{value:cu.name??`Wallet`,maxLength:22,onChange:z=>pc(`name`,z.target.value.slice(0,22)),className:`min-w-0 flex-1 cw-lbl outline-none`,style:{textAlign:`right`,border:`0`,background:`transparent`}}))]}),
design=(0,U.jsxs)(U.Fragment,{children:[S(`Design`),
Seg([{label:`Slate`,v:(cu.design||`slate`)===`slate`,f:()=>pc(`design`,`slate`)},{label:`Classic`,v:cu.design===`classic`,f:()=>pc(`design`,`classic`)}]),
t.cover===!1?null:pouchRows]}),
// ---- Layout: one view at a time, and each view owns its numbers outright
layout=(0,U.jsxs)(`div`,{children:[S(`Layout`),
Seg([{label:`Carousel`,v:!isStack,f:()=>set({view:`carousel`})},{label:`Stack`,v:isStack,f:()=>set({view:`stack`})}]),
S(isStack?`Stack - these never reach the carousel`:`Carousel - these never reach the stack`),
Row(`Wallet & cover`,(0,U.jsx)(Mp,{on:t.cover!==!1,onChange:z=>{set({cover:z});navigator.vibrate&&navigator.vibrate(6)}})),
isStack?(0,U.jsxs)(U.Fragment,{children:[
Rng(`Card overlap`,`stack.overlap`,0,1.1,.01,v=>`${Math.round(v*100)}%`,.7),
Rng(`Vertical offset`,`stack.vOff`,0,26,.5,v=>v<.5?`None`:`${Math.round(v)}px`,0),
Rng(`Scale`,`stack.size`,.8,1.14,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Rotation`,`stack.rot`,0,1.6,.01,v=>v<.02?`Flat`:Math.round(v*40)+`°`,1),
Rng(`Visible cards`,`stack.visible`,3,8,1,v=>`${Math.round(v)}`,3),
Rng(`Spacing`,`stack.spacing`,0,44,.5,v=>v<.5?`None`:`${Math.round(v)}px`,0)]}):(0,U.jsxs)(U.Fragment,{children:[
Rng(`Card spacing`,`carousel.gap`,0,44,.5,v=>v<.5?`Tight`:`${Math.round(v)}px`,20),
Rng(`Scale`,`carousel.size`,.8,1.14,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Side cards`,`carousel.side`,.15,1,.01,v=>v<.2?`Hidden`:`${Math.round(v*100)}%`,1),
Rng(`Peek amount`,`carousel.peek`,.7,1.5,.01,v=>`${Math.round(v*100)}%`,1),
Rng(`Position`,`carousel.pos`,-.22,.22,.005,v=>Math.abs(v)<.01?`Centre`:(v<0?`Left `:`Right `)+Math.round(Math.abs(v)*227)+`px`,0)]})]}),
pouch=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Custom Pouch`),prevBox,design,layout]}),
appear=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Appearance`),
Seg([{label:`System`,v:t.appearance===`system`,f:()=>set({appearance:`system`})},{label:`Light`,v:t.appearance===`light`,f:()=>set({appearance:`light`})},{label:`Dark`,v:t.appearance===`dark`,f:()=>set({appearance:`dark`})}])]}),
body=(0,U.jsxs)(`div`,{children:[pouch,appear,(0,U.jsx)(`div`,{style:{height:4}})]}),
hdr=(0,U.jsxs)(`div`,{className:`flex items-center justify-between px-5 pb-1 pt-3`,children:[(0,U.jsx)(`span`,{className:`cw-title`,children:`Settings`}),(0,U.jsx)(`button`,{onClick:i,className:`solid-btn rounded-full px-3.5 py-1 text-[13.5px] font-semibold active:opacity-80`,children:`Done`}),]}),
scrl=(0,U.jsx)(`div`,{className:`overflow-y-auto px-5 pt-3`,style:{maxHeight:`calc(88vh - 70px)`},children:body}),
grab=(0,U.jsx)(`div`,{className:`pt-2.5`,children:(0,U.jsx)(`div`,{className:`mx-auto h-1 w-10 rounded-full chip-bg`})}),
panel=(0,U.jsxs)(X.div,{className:`no-select rounded-t-[26px] cw-glass-sheet`,initial:{y:`100%`},animate:{y:0},exit:{y:`100%`},transition:{type:`spring`,stiffness:340,damping:36},style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 18px)`},onClick:e=>e.stopPropagation(),children:[grab,hdr,scrl]});
return(0,U.jsx)(W,{children:e&&(0,U.jsx)(X.div,{className:`fixed inset-0 z-[80] flex flex-col justify-end cw-scrim`,initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:.18},style:{zIndex:2000},onClick:()=>{Date.now()-ts.current>350&&i()},children:panel})});
}
