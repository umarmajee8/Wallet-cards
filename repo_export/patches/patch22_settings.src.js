// patch22 source: the Settings sheet after round 11 - fewer buttons, Layout split by view,
// sliders that move smoothly.
//
// Readable form of the function patch22 splices into app/index.js. patch22 deletes these `//`
// lines and each line's leading indentation and joins the rest, so a line break may only sit
// after `,` `(` `[` `{` or an operator (intra-line spaces survive). One node per variable, so no
// nesting spans a join. Aliases in scope at the splice point: U (jsx), x (React), X (motion),
// W (AnimatePresence), Ed (the memoised carousel = Td), __cwStack, Mp (the switch).
function Np({open:e,settings:t,onChange:n,onCustomise:r,onClose:i,cards:cs}){
let ts=(0,x.useRef)(0),pend=(0,x.useRef)(null),fr=(0,x.useRef)(0),[drag,setDrag]=(0,x.useState)(null);
// rAF is not assumed: on any engine without it the same 16ms coalescing falls back to a timer.
function rf(f){return typeof window>`u`||!window.requestAnimationFrame?setTimeout(f,16):window.requestAnimationFrame(f)}
function cf(id){return typeof window>`u`||!window.cancelAnimationFrame?clearTimeout(id):window.cancelAnimationFrame(id)}
(0,x.useEffect)(()=>{e&&(ts.current=Date.now(),pend.current=null)},[e]);
(0,x.useEffect)(()=>()=>{fr.current&&cf(fr.current)},[]);
let cu=t.custom||{},isStack=(t.view||`carousel`)===`stack`,
// One pouch field, written the way the colour swatch always wrote one. A drag is a two-tier
// write: local state (setDrag) holds the value this sheet is showing, because React otherwise
// restores a controlled input to the last committed value on every event - that flicker is what
// read as "not smooth" - while the wallet is written once per frame through the rAF queue.
// `pend.current` mirrors everything this sheet has written, so the two tiers cannot disagree.
pc=(k,v)=>{let nx={...(pend.current||cu),[k]:v};pend.current=nx;setDrag({k,v});if(fr.current)return;
fr.current=rf(()=>{fr.current=0;setDrag(null);n({custom:pend.current,theme:`slate`})})},
set=o=>{let c={...(pend.current||{}),...(o.custom||{})};pend.current=Object.keys(c).length?c:null;
fr.current&&(cf(fr.current),fr.current=0);n(o)},
num=(k,d)=>{let v=drag&&drag.k===k?drag.v:pend.current&&pend.current[k]!=null?pend.current[k]:cu[k];return v==null?d:+v},
Row=(l,c)=>(0,U.jsxs)(`div`,{className:`cw-row`,children:[(0,U.jsx)(`span`,{className:`cw-lbl`,children:l}),c]}),
Chip=(o,v,f)=>(0,U.jsx)(`div`,{className:`cw-chips`,children:o.map(z=>(0,U.jsx)(`button`,{onClick:()=>{f(z.k);navigator.vibrate&&navigator.vibrate(6)},"data-on":v===z.k,className:`cw-chip`,children:z.label},z.label))}),
Seg=o=>(0,U.jsx)(`div`,{className:`mb-1 flex gap-2`,children:o.map(z=>(0,U.jsx)(`button`,{onClick:()=>{z.f();navigator.vibrate&&navigator.vibrate(6)},"data-on":z.v,className:`cw-chip`,children:z.label},z.label))}),
Rng=(l,k,mn,mx,st,fmt)=>{let v=num(k,(+mn+mx)/2),p=Math.round((v-mn)/(mx-mn)*100);return Row(l,(0,U.jsxs)(`div`,{className:`flex min-w-0 flex-1 items-center gap-2`,children:[(0,U.jsx)(`input`,{"aria-label":l,type:`range`,min:mn,max:mx,step:st,value:v,style:{"--p":`${p}%`},onChange:z=>pc(k,+z.target.value),className:`cw-range`}),(0,U.jsx)(`span`,{className:`cw-val`,children:fmt(v)})]}))},
dot=h=>(0,U.jsx)(`button`,{"aria-label":`Pouch colour ${h}`,className:`cw-dot`,style:{background:h},"data-on":(cu.color||t.slateColor||`#5c6574`)===h,onClick:()=>{set({theme:`slate`,slateColor:h,custom:{...cu,color:h}});navigator.vibrate&&navigator.vibrate(6)}},h),
H=t2=>(0,U.jsx)(`div`,{className:`pb-2 cw-h`,children:t2}),
S=t2=>t2?(0,U.jsx)(`div`,{className:`cw-sub`,children:t2}):null,
// the live preview is the wallet's own component tree, fed with the settings being edited.
// The stack sizes its cards from the viewport, so in here it gets the stage box instead (patch 21).
pv=(()=>{let l=(cs||[]).slice(0,3);
if(!l.length)l=[{id:`__cwprev`,src:`data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`,title:``,subtitle:``,fields:[]}];
return l})(),
prev=(0,U.jsx)(isStack?__cwStack:Ed,{cards:pv,cover:t.cover!==!1,theme:t.theme,custom:t.custom,tint:t.slateColor,index:0,onIndexChange:()=>{},onOpen:()=>{},onLongPress:()=>{},ejectedId:null,hiddenId:null,fit:isStack?{w:388,h:302}:void 0}),
prevBox=(0,U.jsx)(`div`,{className:`cw-preview`,children:(0,U.jsx)(`div`,{className:`cw-preview-in`,style:isStack?{width:388,height:302,transform:`translateX(-50%) scale(.56)`}:void 0,children:prev})}),
// ---- Design: colour, edge, radius, shadow, texture - every one of them a slider now
pouchRows=(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(`div`,{className:`cw-dots`,children:[`#f3efe6`,`#5c6574`,`#2b2d32`,`#8b93a0`,`#9a8f82`,`#2c3d56`,`#2d4a3e`,`#6b3038`,`#5a4a3a`,`#3d3454`,`#1c1e22`].map(dot)}),
Rng(`Background`,`depth`,.55,1.4,.01,v=>`${Math.round(v*100)}%`),
Rng(`Radius`,`radius`,.4,1.9,.01,v=>`${Math.round(v*100)}%`),
Rng(`Shadow`,`shadow`,0,1.9,.01,v=>v<.02?`None`:`${Math.round(v*100)}%`),
Rng(`Sheen`,`material`,.4,1.8,.01,v=>`${Math.round(v*100)}%`),
Rng(`Edge`,`border`,0,1.8,.01,v=>v<.02?`None`:`${Math.round(v*100)}%`),
Rng(`Grading`,`grade`,.4,1.6,.01,v=>`${Math.round(v*100)}%`),
Rng(`Grain`,`grain`,0,1,.01,v=>`${Math.round(v*100)}%`),
Row(`Stitching`,(0,U.jsx)(Mp,{on:!!cu.stitch,onChange:z=>pc(`stitch`,z)})),
Row(`Name`,(0,U.jsx)(`input`,{value:cu.name??`Wallet`,maxLength:22,onChange:z=>pc(`name`,z.target.value.slice(0,22)),className:`min-w-0 flex-1 cw-lbl outline-none`,style:{textAlign:`right`,border:`0`,background:`transparent`}}))]}),
design=(0,U.jsxs)(U.Fragment,{children:[S(`Design`),
Seg([{label:`Slate`,v:(cu.design||`slate`)===`slate`,f:()=>pc(`design`,`slate`)},{label:`Classic`,v:cu.design===`classic`,f:()=>pc(`design`,`classic`)}]),
t.cover===!1?null:pouchRows]}),
// ---- Layout: the wallet, and then that view's own settings
layout=(0,U.jsxs)(`div`,{children:[S(`Layout`),
Seg([{label:`Carousel`,v:!isStack,f:()=>set({view:`carousel`})},{label:`Stack`,v:isStack,f:()=>set({view:`stack`})}]),
S(isStack?`Stack`:`Carousel`),
Row(`Wallet & cover`,(0,U.jsx)(Mp,{on:t.cover!==!1,onChange:z=>{set({cover:z});navigator.vibrate&&navigator.vibrate(6)}})),
Rng(`Size`,`size`,.82,1.06,.01,v=>`${Math.round(v*100)}%`),
isStack?Rng(`Spread`,`gap`,0,44,.5,v=>`${Math.round(v)}px`):Rng(`Spacing`,`gap`,0,44,.5,v=>`${Math.round(v)}px`),
isStack?Row(`Fan`,Chip([{k:.5,label:`Flat`},{k:1,label:`Fan`},{k:1.5,label:`Deck`}],num(`stack`,1),k=>pc(`stack`,k))):null]}),
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
