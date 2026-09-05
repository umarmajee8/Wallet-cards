// patch19 source: the new Settings sheet.
//
// This is the readable form of the minified function that patch19 splices into
// app/index.js. patch19 deletes these `//` lines and each line's leading indentation and
// joins the rest, so a line break may only sit after `,` `(` `[` `{` or an operator - never
// where a space would be needed (intra-line spaces survive, so string contents stay intact).
// Every node is built into its own variable and closed on the same line-group, so the
// nesting never spans a join. Aliases in scope at the splice point: U (jsx), x (React),
// X (motion), W (AnimatePresence), Ed (the memoised carousel = Td), __cwStack, Mp (switch).
function Np({open:e,settings:t,onChange:n,onCustomise:r,onClose:i,cards:cs}){
let a=(0,x.useRef)(0);
(0,x.useEffect)(()=>{e&&(a.current=Date.now())},[e]);
let [pk,sp]=(0,x.useState)(null),cu=t.custom||{},
// one pouch field, written the way the colour swatch always wrote one
pc=(k,v)=>n({custom:{...cu,[k]:v},theme:`slate`}),
num=(k,d)=>{let v=cu[k];return v==null?d:+v},
// compact controls: a labelled row, a chip picker, a slider with its own read-out
Row=(l,c)=>(0,U.jsxs)(`div`,{className:`cw-row`,children:[(0,U.jsx)(`span`,{className:`cw-lbl`,children:l}),c]}),
Chip=(o,v,f)=>(0,U.jsx)(`div`,{className:`cw-chips`,children:o.map(z=>(0,U.jsx)(`button`,{onClick:()=>{f(z.k);navigator.vibrate&&navigator.vibrate(6)},"data-on":v===z.k,className:`cw-chip`,children:z.label},z.label))}),
Seg=o=>(0,U.jsx)(`div`,{className:`mb-1 flex gap-2`,children:o.map(z=>(0,U.jsx)(`button`,{onClick:()=>{z.f();navigator.vibrate&&navigator.vibrate(6)},"data-on":z.v,className:`cw-chip`,children:z.label},z.label))}),
Rng=(l,k,mn,mx,st,fmt)=>Row(l,(0,U.jsxs)(`div`,{className:`flex min-w-0 flex-1 items-center gap-2`,children:[(0,U.jsx)(`input`,{"aria-label":l,type:`range`,min:mn,max:mx,step:st,value:num(k,(+mn+mx)/2),onChange:z=>pc(k,+z.target.value),className:`cw-range`}),(0,U.jsx)(`span`,{className:`cw-val`,children:fmt(num(k,(+mn+mx)/2))})]})),
dot=h=>(0,U.jsx)(`button`,{"aria-label":`Pouch colour ${h}`,className:`cw-dot`,style:{background:h},"data-on":(cu.color||t.slateColor||`#5c6574`)===h,onClick:()=>{n({theme:`slate`,slateColor:h,custom:{...cu,color:h}});navigator.vibrate&&navigator.vibrate(6)}},h),
H=t2=>(0,U.jsx)(`div`,{className:`pb-2 cw-h`,children:t2}),
S=t2=>(0,U.jsx)(`div`,{className:`cw-sub`,children:t2}),
// the live preview is the wallet's own component tree, fed with the settings being edited
pv=(()=>{let l=(cs||[]).slice(0,3);
if(pk)l=l.filter(z=>z.id===pk).concat(l.filter(z=>z.id!==pk)).slice(0,1);
if(!l.length)l=[{id:`__cwprev`,src:`data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`,title:``,subtitle:``,fields:[]}];
return l})(),
prev=(0,U.jsx)((t.view||`carousel`)===`stack`?__cwStack:Ed,{cards:pv,cover:t.cover!==!1,theme:t.theme,custom:t.custom,tint:t.slateColor,index:0,onIndexChange:()=>{},onOpen:()=>{},onLongPress:()=>{},ejectedId:null,hiddenId:null}),
// ---- Design: shape, colour, material, edge, radius, shadow, texture
pouchRows=(0,U.jsxs)(U.Fragment,{children:[(0,U.jsx)(`div`,{className:`cw-dots`,children:[`#f3efe6`,`#5c6574`,`#2b2d32`,`#8b93a0`,`#9a8f82`,`#2c3d56`,`#2d4a3e`,`#6b3038`,`#5a4a3a`,`#3d3454`,`#1c1e22`].map(dot)}),
Row(`Material`,Chip([{k:.55,label:`Matte`},{k:1,label:`Satin`},{k:1.6,label:`Gloss`}],num(`material`,1),k=>pc(`material`,k))),
Row(`Border`,Chip([{k:0,label:`None`},{k:.6,label:`Soft`},{k:1.5,label:`Firm`}],num(`border`,1),k=>pc(`border`,k))),
Rng(`Background`,`depth`,.55,1.4,.01,v=>`${Math.round(v*100)}%`),
Rng(`Radius`,`radius`,.4,1.9,.01,v=>`${Math.round(v*100)}%`),
Rng(`Shadow`,`shadow`,.2,1.9,.01,v=>`${Math.round(v*100)}%`),
Rng(`Grading`,`grade`,.4,1.6,.05,v=>`${Math.round(v*100)}%`),
Rng(`Grain`,`grain`,0,1,.05,v=>`${Math.round(v*100)}%`),
Row(`Stitching`,(0,U.jsx)(Mp,{on:!!cu.stitch,onChange:z=>pc(`stitch`,z)})),
Row(`Name`,(0,U.jsx)(`input`,{value:cu.name??`Wallet`,maxLength:22,onChange:z=>pc(`name`,z.target.value.slice(0,22)),className:`min-w-0 flex-1 cw-lbl outline-none`,style:{textAlign:`right`,border:`0`,background:`transparent`}}))]}),
design=(0,U.jsxs)(U.Fragment,{children:[S(`Design`),
Seg([{label:`Slate`,v:(cu.design||`slate`)===`slate`,f:()=>pc(`design`,`slate`)},{label:`Classic`,v:cu.design===`classic`,f:()=>pc(`design`,`classic`)}]),
t.cover===!1?null:pouchRows]}),
// ---- Layout: which wallet, cover, size, spacing, how the stack fans
layout=(0,U.jsxs)(`div`,{children:[S(`Layout`),
Seg([{label:`Carousel`,v:(t.view||`carousel`)===`carousel`,f:()=>n({view:`carousel`})},{label:`Stack`,v:t.view===`stack`,f:()=>n({view:`stack`})}]),
Row(`Wallet & cover`,(0,U.jsx)(Mp,{on:t.cover!==!1,onChange:z=>{n({cover:z});navigator.vibrate&&navigator.vibrate(6)}})),
Rng(`Size`,`size`,.82,1.06,.01,v=>`${Math.round(v*100)}%`),
Rng(`Spacing`,`gap`,0,44,1,v=>`${Math.round(v)}px`),
Row(`Stack`,Chip([{k:.5,label:`Flat`},{k:1,label:`Fan`},{k:1.5,label:`Deck`}],num(`stack`,1),k=>pc(`stack`,k)))]}),
// ---- Cards: which card the preview shows (a view filter, card data is never touched)
cardsRow=(0,U.jsxs)(`div`,{children:[S(`Cards`),(0,U.jsx)(`div`,{className:`cw-chips`,children:[{id:null,label:`All`},...(cs||[]).slice(0,4).map(z=>({id:z.id,label:(z.title||`Card`).slice(0,12)}))].map(z=>(0,U.jsx)(`button`,{onClick:()=>sp(z.id),"data-on":pk===z.id,className:`cw-chip`,children:z.label},z.id||`all`))})]}),
pouch=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Custom Pouch`),(0,U.jsx)(`div`,{className:`cw-preview`,children:(0,U.jsx)(`div`,{className:`cw-preview-in`,children:prev})}),design,layout,cardsRow]}),
appear=(0,U.jsxs)(`div`,{className:`cw-card`,children:[H(`Appearance`),
Seg([{label:`System`,v:t.appearance===`system`,f:()=>n({appearance:`system`})},{label:`Light`,v:t.appearance===`light`,f:()=>n({appearance:`light`})},{label:`Dark`,v:t.appearance===`dark`,f:()=>n({appearance:`dark`})}])]}),
body=(0,U.jsxs)(`div`,{children:[pouch,appear,(0,U.jsx)(`div`,{style:{height:4}})]}),
hdr=(0,U.jsxs)(`div`,{className:`flex items-center justify-between px-5 pb-1 pt-3`,children:[(0,U.jsx)(`span`,{className:`cw-title`,children:`Settings`}),(0,U.jsx)(`button`,{onClick:i,className:`solid-btn rounded-full px-4 py-1.5 text-[14px] font-semibold active:opacity-80`,children:`Done`}),]}),
scrl=(0,U.jsx)(`div`,{className:`overflow-y-auto px-5 pt-3`,style:{maxHeight:`calc(88vh - 70px)`},children:body}),
grab=(0,U.jsx)(`div`,{className:`pt-2.5`,children:(0,U.jsx)(`div`,{className:`mx-auto h-1 w-10 rounded-full chip-bg`})}),
panel=(0,U.jsxs)(X.div,{className:`no-select rounded-t-[26px] cw-glass-sheet`,initial:{y:`100%`},animate:{y:0},exit:{y:`100%`},transition:{type:`spring`,stiffness:340,damping:36},style:{paddingBottom:`calc(env(safe-area-inset-bottom) + 18px)`},onClick:e=>e.stopPropagation(),children:[grab,hdr,scrl]});
return(0,U.jsx)(W,{children:e&&(0,U.jsx)(X.div,{className:`fixed inset-0 z-[80] flex flex-col justify-end cw-scrim`,initial:{opacity:0},animate:{opacity:1},exit:{opacity:0},transition:{duration:.18},style:{zIndex:2000},onClick:()=>{Date.now()-a.current>350&&i()},children:panel})});
}
