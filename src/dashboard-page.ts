import type { DashboardData } from './dashboard.js'

// A single self-contained document: CSS in one <style>, JS in one <script>, and
// the report embedded in a <script type="application/json"> tag. Zero external
// requests — the client fetches only same-origin /api/* endpoints. The client JS
// deliberately avoids template literals so it can live inside this TS template
// without backtick/${} collisions.
//
// Styling is the KINETIC design system. The block below is the verbatim token
// layer inlined from design/kinetic.css (single self-contained page — zero
// external requests); every component rule consumes ONLY --k-* custom
// properties. If a value isn't a token, it doesn't ship — the sole raw colors
// live inside this inlined :root block.

const TOKENS = `
:root{
  color-scheme:light dark;

  --k-bg:light-dark(#f4f3f0,#02040a);
  --k-rail:light-dark(rgba(10,10,10,.025),rgba(223,223,223,.03));
  --k-inset:light-dark(rgba(10,10,10,.045),rgba(223,223,223,.05));
  --k-inset-hi:light-dark(rgba(10,10,10,.075),rgba(223,223,223,.08));
  --k-surface:light-dark(#faf9f6,rgba(223,223,223,.04));
  --k-surface-hi:light-dark(#ffffff,rgba(223,223,223,.07));
  --k-solid:light-dark(#edece8,#0a0e16);

  --k-border:light-dark(rgba(10,10,10,.14),rgba(223,223,223,.14));
  --k-border-hi:light-dark(rgba(10,10,10,.32),rgba(223,223,223,.34));

  --k-ink:light-dark(#0a0a0a,#dfdfdf);
  --k-ink-hi:light-dark(#000000,#ffffff);
  --k-ink-soft:light-dark(rgba(10,10,10,.78),rgba(223,223,223,.82));
  --k-muted:light-dark(rgba(10,10,10,.55),rgba(223,223,223,.55));
  --k-dim:light-dark(rgba(10,10,10,.42),rgba(223,223,223,.42));
  --k-faint:light-dark(rgba(10,10,10,.28),rgba(223,223,223,.28));
  --k-on-accent:light-dark(#f4f3f0,#02040a);
  --k-scrim:light-dark(rgba(10,10,10,.32),rgba(2,4,10,.6));

  --k-accent:light-dark(#0a0a0a,#dfdfdf);
  --k-accent-soft:light-dark(rgba(10,10,10,.06),rgba(223,223,223,.07));
  --k-accent-soft-hi:light-dark(rgba(10,10,10,.09),rgba(223,223,223,.1));
  --k-accent-line:light-dark(rgba(10,10,10,.32),rgba(223,223,223,.34));
  --k-accent-fill:light-dark(#0a0a0a,#dfdfdf);
  --k-accent-fill-hover:light-dark(#000000,#ffffff);

  --k-good-text:light-dark(rgba(10,10,10,.85),rgba(223,223,223,.9));
  --k-warn-text:light-dark(rgba(10,10,10,.7),rgba(223,223,223,.75));

  --k-bad-text:light-dark(oklch(50% .19 29),oklch(72% .16 25));
  --k-bad-soft:light-dark(oklch(58% .19 29 / .1),oklch(70% .16 25 / .13));
  --k-bad-line:light-dark(oklch(58% .19 29 / .3),oklch(70% .16 25 / .4));

  --k-space-xs:4px;--k-space-sm:6px;--k-space-s:8px;--k-space-m:12px;
  --k-space-l:16px;--k-space-xl:20px;--k-space-xxl:24px;--k-space-xxxl:32px;
  --k-space-huge:48px;--k-space-giant:64px;

  --k-radius:2px;--k-radius-pill:999px;

  --k-font-sans:"Polysans","Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --k-font-mono:ui-monospace,"SF Mono",Menlo,Monaco,Consolas,monospace;

  --k-size-xs:11px;--k-size-sm:12px;--k-size-base:12.5px;--k-size-md:13.5px;
  --k-size-lg:15px;--k-size-xl:16px;--k-size-xxl:18px;--k-size-xxxl:22px;
  --k-size-display:26px;--k-size-display-lg:32px;--k-size-display-xl:42px;

  --k-leading-none:1;--k-leading-tight:1.15;--k-leading-snug:1.3;
  --k-leading-body:1.55;--k-leading-relaxed:1.75;

  --k-tracking-tight:-0.015em;--k-tracking-snug:-0.008em;
  --k-tracking-wide:0.04em;--k-tracking-wider:0.1em;

  --k-weight-regular:400;--k-weight-medium:500;

  --k-dur-fast:120ms;--k-dur-base:200ms;--k-dur-slow:300ms;--k-dur-slower:400ms;
  --k-ease-standard:cubic-bezier(.32,.72,0,1);
  --k-ease-out:cubic-bezier(.16,1,.3,1);
}
:root[data-theme="light"]{color-scheme:light;}
:root[data-theme="dark"]{color-scheme:dark;}
`

const CSS = `
*{box-sizing:border-box;}
body{
  margin:0;background:var(--k-bg);color:var(--k-ink);
  font-family:var(--k-font-sans);font-size:var(--k-size-md);
  line-height:var(--k-leading-body);font-weight:var(--k-weight-regular);
  -webkit-font-smoothing:antialiased;
}
::selection{background:var(--k-accent-soft-hi);}
:focus-visible{outline:1px solid var(--k-accent-line);outline-offset:2px;}
.wrap{max-width:1100px;margin:0 auto;padding:var(--k-space-xxxl) var(--k-space-xxl) var(--k-space-giant);}
section{margin-top:var(--k-space-huge);}
a{color:inherit;text-decoration:none;}
.num,.tnum,td.num{font-family:var(--k-font-mono);font-variant-numeric:tabular-nums;color:var(--k-ink);}

/* ── Topbar ─────────────────────────────────────────────────────── */
.topbar{display:flex;flex-direction:column;gap:var(--k-space-m);}
.tbrow{display:flex;justify-content:space-between;align-items:flex-start;gap:var(--k-space-l);flex-wrap:wrap;}
.wordmark{font-family:var(--k-font-mono);font-size:var(--k-size-xxl);font-weight:var(--k-weight-medium);letter-spacing:var(--k-tracking-tight);color:var(--k-ink);}
.sub{color:var(--k-muted);font-size:var(--k-size-sm);margin-top:var(--k-space-xs);font-family:var(--k-font-mono);}
.controls{display:flex;align-items:center;gap:var(--k-space-m);flex-wrap:wrap;}
.seg{display:inline-flex;border:1px solid var(--k-border);border-radius:var(--k-radius);overflow:hidden;}
.seg button{border:0;background:transparent;color:var(--k-muted);font:var(--k-size-sm)/1 var(--k-font-mono);padding:var(--k-space-sm) var(--k-space-m);cursor:pointer;transition:background var(--k-dur-base) var(--k-ease-out),color var(--k-dur-base) var(--k-ease-out);}
.seg button:hover{color:var(--k-ink);}
.seg button.active{background:var(--k-accent-fill);color:var(--k-on-accent);}
.btn{border:1px solid var(--k-border);background:var(--k-surface);color:var(--k-ink);border-radius:var(--k-radius);padding:var(--k-space-sm) var(--k-space-m);font:var(--k-size-sm) var(--k-font-sans);cursor:pointer;transition:background var(--k-dur-base) var(--k-ease-out),border-color var(--k-dur-base) var(--k-ease-out);}
.btn:hover{background:var(--k-surface-hi);border-color:var(--k-border-hi);}
.btn:disabled{color:var(--k-faint);cursor:default;}
.upd{color:var(--k-muted);font-size:var(--k-size-xs);font-family:var(--k-font-mono);}
.mfilter{display:flex;flex-wrap:wrap;gap:var(--k-space-s);}
.mfilter button{font-family:var(--k-font-mono);font-size:var(--k-size-xs);color:var(--k-muted);background:var(--k-inset);border:1px solid var(--k-border);border-radius:var(--k-radius-pill);padding:var(--k-space-xs) var(--k-space-m);cursor:pointer;transition:background var(--k-dur-base) var(--k-ease-out),color var(--k-dur-base) var(--k-ease-out),border-color var(--k-dur-base) var(--k-ease-out);}
.mfilter button:hover{color:var(--k-ink);border-color:var(--k-border-hi);}
.mfilter button.active{background:var(--k-accent-fill);color:var(--k-on-accent);border-color:var(--k-accent-fill);}

/* ── KPI strip ──────────────────────────────────────────────────── */
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:var(--k-space-l);}
.tile{border:1px solid var(--k-border);border-radius:var(--k-radius);background:var(--k-surface);padding:var(--k-space-l);display:block;}
.tile .label{font-size:var(--k-size-xs);text-transform:uppercase;letter-spacing:var(--k-tracking-wide);color:var(--k-muted);}
.tile .val{font-family:var(--k-font-mono);font-variant-numeric:tabular-nums;font-size:var(--k-size-display-lg);font-weight:var(--k-weight-regular);margin-top:var(--k-space-s);line-height:var(--k-leading-none);color:var(--k-ink);}
.tile .meta2{font-size:var(--k-size-sm);color:var(--k-muted);margin-top:var(--k-space-sm);overflow:hidden;text-overflow:ellipsis;}
@media(max-width:900px){.stats{grid-template-columns:repeat(3,1fr);}}
@media(max-width:600px){.stats{grid-template-columns:repeat(2,1fr);}}

/* ── Section headers ────────────────────────────────────────────── */
.shead{font-size:var(--k-size-lg);font-weight:var(--k-weight-medium);text-transform:uppercase;letter-spacing:var(--k-tracking-wide);color:var(--k-muted);margin:0 0 var(--k-space-xs);}
.sfind{color:var(--k-dim);font-size:var(--k-size-sm);margin:0 0 var(--k-space-l);}

/* ── Hero table ─────────────────────────────────────────────────── */
.toolbar{display:flex;justify-content:space-between;gap:var(--k-space-m);align-items:center;margin-bottom:var(--k-space-m);}
.filter{border:1px solid var(--k-border);background:var(--k-inset);color:var(--k-ink);border-radius:var(--k-radius);padding:var(--k-space-sm) var(--k-space-m);font:var(--k-size-md) var(--k-font-sans);width:240px;transition:border-color var(--k-dur-base) var(--k-ease-out);}
.filter::placeholder{color:var(--k-faint);}
.filter:focus{border-color:var(--k-border-hi);outline:none;}
.tblwrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:0 var(--k-space-m);height:40px;border-bottom:1px solid var(--k-border);white-space:nowrap;}
thead th{height:32px;font-size:var(--k-size-xs);text-transform:uppercase;letter-spacing:var(--k-tracking-wide);color:var(--k-muted);font-weight:var(--k-weight-medium);cursor:pointer;user-select:none;}
th.num,td.num{text-align:right;}
th .arr{font-size:9px;color:var(--k-muted);}
tbody tr.srow{transition:background var(--k-dur-fast) var(--k-ease-out);}
tbody tr.srow:hover{background:var(--k-inset);cursor:pointer;}
tr.dormant td{color:var(--k-faint);}
.chip,.mchip{font-family:var(--k-font-mono);font-size:var(--k-size-xs);color:var(--k-muted);border:1px solid var(--k-border);border-radius:var(--k-radius-pill);padding:0 var(--k-space-sm);margin-left:var(--k-space-sm);}
.spark svg{display:block;vertical-align:middle;}
.err{color:var(--k-bad-text);}
.dot{color:var(--k-faint);}
.unt{color:var(--k-dim);}
.trend.up{color:var(--k-ink-soft);}
.trend.down,.trend.flat{color:var(--k-muted);}
.ts{color:var(--k-muted);font-size:var(--k-size-sm);}
.whowrap{display:inline-flex;align-items:center;gap:var(--k-space-s);}
.whobar{display:inline-flex;width:44px;height:6px;border-radius:var(--k-radius);overflow:hidden;background:var(--k-inset);}
.whobar .wa{background:var(--k-ink-soft);}
.whobar .wh{background:var(--k-faint);}
.wpct{font-family:var(--k-font-mono);font-size:var(--k-size-xs);color:var(--k-muted);font-variant-numeric:tabular-nums;}

/* ── Accordion drill-down ───────────────────────────────────────── */
.detail td{padding:0;}
.dwrap{padding:var(--k-space-l) var(--k-space-m);background:var(--k-inset);animation:acc var(--k-dur-base) var(--k-ease-out);}
@keyframes acc{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}
.dsec{margin-bottom:var(--k-space-l);}
.dsec:last-child{margin-bottom:0;}
.dsec h4{margin:0 0 var(--k-space-sm);font-size:var(--k-size-xs);text-transform:uppercase;letter-spacing:var(--k-tracking-wide);color:var(--k-muted);font-weight:var(--k-weight-medium);}
.mini{width:100%;border-collapse:collapse;}
.mini th,.mini td{height:auto;padding:var(--k-space-sm) var(--k-space-s);font-size:var(--k-size-sm);}
.mini th{cursor:default;}

/* ── Dead weight ────────────────────────────────────────────────── */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:var(--k-space-s);}
.card{border:1px solid var(--k-border);border-radius:var(--k-radius);background:var(--k-surface);padding:var(--k-space-s) var(--k-space-m);}
.card .cn{font-size:var(--k-size-md);color:var(--k-dim);}
.card .cm{font-size:var(--k-size-xs);color:var(--k-faint);margin-top:var(--k-space-xs);font-family:var(--k-font-mono);}

/* ── Outcomes ───────────────────────────────────────────────────── */
.olist{display:flex;flex-direction:column;}
.orow{display:grid;grid-template-columns:170px 64px 1fr auto;gap:var(--k-space-m);align-items:baseline;padding:var(--k-space-s) 0;border-bottom:1px solid var(--k-border);}
.oname{font-size:var(--k-size-md);}
.pill{font-family:var(--k-font-mono);font-size:var(--k-size-xs);border:1px solid var(--k-border);border-radius:var(--k-radius);padding:1px var(--k-space-sm);color:var(--k-muted);text-align:center;}
.pill.failed{color:var(--k-bad-text);border-color:var(--k-bad-line);}
.quote{color:var(--k-muted);font-size:var(--k-size-md);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
.quote.exp{white-space:normal;}

footer{margin-top:var(--k-space-huge);padding-top:var(--k-space-l);border-top:1px solid var(--k-border);color:var(--k-muted);font-size:var(--k-size-sm);display:flex;justify-content:space-between;gap:var(--k-space-m);flex-wrap:wrap;}
footer .v{font-family:var(--k-font-mono);}

@media(max-width:900px){.col-activity,.col-who{display:none;}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;}}
`

const JS = `
(function(){
  var S={data:null,days:30,machine:'',machines:[],sortCol:'invocations',sortDir:-1,filter:'',showAll:false,open:null,details:{}};

  var COLS=[
    {k:'name',label:'Skill',num:false,cls:'',val:function(s){return s.name.toLowerCase();}},
    {k:'activity',label:'Activity',num:false,cls:'col-activity',val:function(s){return s.invocations;}},
    {k:'invocations',label:'Invokes',num:true,cls:'',val:function(s){return s.invocations;}},
    {k:'who',label:'Who',num:false,cls:'col-who',val:function(s){var bt=s.byTrigger||{};var a=(bt.model||0)+(bt.hook||0);var h=bt['user-slash']||0;var t=a+h;return t>0?h/t:-1;}},
    {k:'trend',label:'Trend',num:true,cls:'',val:function(s){return s.prevInvocations>0?(s.invocations-s.prevInvocations)/s.prevInvocations:(s.invocations>0?1e9:-1);}},
    {k:'tokensAfter',label:'Tokens after',num:true,cls:'',val:function(s){return s.tokensAfter;}},
    {k:'errorsAfter',label:'Errors',num:true,cls:'',val:function(s){return s.errorsAfter;}},
    {k:'outcomes',label:'Outcomes',num:true,cls:'',val:function(s){var o=s.outcomes;return o.worked+o.partial+o.failed;}},
    {k:'lastUsed',label:'Last used',num:true,cls:'',val:function(s){return s.lastUsed?Date.parse(s.lastUsed):0;}}
  ];
  function colByKey(k){for(var i=0;i<COLS.length;i++){if(COLS[i].k===k)return COLS[i];}return COLS[2];}

  function el(id){return document.getElementById(id);}
  function esc(s){s=String(s==null?'':s);return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
  function fmt(n){return (n==null?0:n).toLocaleString();}
  function shortMachine(m){return String(m==null?'':m).replace(/\\.local$/,'').split('.')[0];}
  function relTime(iso){
    if(!iso)return 'never';
    var t=Date.parse(iso);if(isNaN(t))return 'never';
    var s=Math.max(0,(Date.now()-t)/1000);
    if(s<60)return Math.floor(s)+'s ago';
    var m=s/60;if(m<60)return Math.floor(m)+'m ago';
    var h=m/60;if(h<24)return Math.floor(h)+'h ago';
    var d=h/24;if(d<30)return Math.floor(d)+'d ago';
    var mo=d/30;if(mo<12)return Math.floor(mo)+'mo ago';
    return Math.floor(d/365)+'y ago';
  }
  function harnessChips(h){h=h||{};var o='';if((h['claude-code']||0)>0)o+='<span class="chip">CC</span>';if((h['codex']||0)>0)o+='<span class="chip">CX</span>';return o;}
  function machineChips(m){
    if(S.machines.length<2)return '';
    m=m||{};var keys=Object.keys(m).filter(function(k){return m[k]>0;});if(!keys.length)return '';
    return keys.map(function(k){return '<span class="mchip">'+esc(shortMachine(k))+'</span>';}).join('');
  }
  function whoBar(bt){
    bt=bt||{};
    var agent=(bt.model||0)+(bt.hook||0),human=(bt['user-slash']||0),tot=agent+human;
    if(tot===0)return '';
    var ap=Math.round(agent/tot*100),hp=100-ap;
    var bar='<span class="whobar" title="'+agent+' agent \\u00B7 '+human+' human"><span class="wa" style="width:'+ap+'%"></span><span class="wh" style="width:'+hp+'%"></span></span>';
    var lab=human>0?'<span class="wpct">'+hp+'% you</span>':'';
    return '<span class="whowrap">'+bar+lab+'</span>';
  }
  function trend(cur,prev){
    if(prev===0)return cur>0?{cls:'up',txt:'\\u25B2 new'}:{cls:'flat',txt:'\\u2014'};
    var d=(cur-prev)/prev*100;
    if(Math.abs(d)<0.5)return {cls:'flat',txt:'0%'};
    var up=d>0;
    return {cls:up?'up':'down',txt:(up?'\\u25B2':'\\u25BC')+' '+Math.abs(Math.round(d))+'%'};
  }
  function sparkSVG(counts){
    counts=counts||[];var n=counts.length;if(n===0)return '';
    var W=120,H=28,P=3,max=1,i;
    for(i=0;i<n;i++){if(counts[i]>max)max=counts[i];}
    var step=n>1?W/(n-1):0,pts=[];
    for(i=0;i<n;i++){var x=n>1?i*step:W/2;var y=H-P-(counts[i]/max)*(H-2*P);pts.push(x.toFixed(1)+','+y.toFixed(1));}
    var line=pts.join(' ');
    var area='<polygon points="0,'+H+' '+line+' '+W+','+H+'" fill="var(--k-ink)" fill-opacity="0.05"/>';
    var poly='<polyline points="'+line+'" fill="none" stroke="var(--k-dim)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    return '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" preserveAspectRatio="none">'+area+poly+'</svg>';
  }

  function renderAll(){renderTopbar();renderStats();renderFiring();renderDead();renderWarnings();renderOutcomes();renderFooter();}

  function renderTopbar(){
    var m=S.data.meta;
    var seg=[7,30,90].map(function(d){return '<button data-days="'+d+'" class="'+(S.days===d?'active':'')+'">'+d+'d</button>';}).join('');
    var mf='';
    if(S.machines.length>1){
      var chips='<button class="'+(S.machine===''?'active':'')+'" data-machine="">all systems</button>';
      chips+=S.machines.map(function(mm){return '<button class="'+(S.machine===mm?'active':'')+'" data-machine="'+esc(mm)+'">'+esc(shortMachine(mm))+'</button>';}).join('');
      mf='<div class="mfilter" id="mfilter">'+chips+'</div>';
    }
    el('topbar').innerHTML=
      '<div class="tbrow">'+
      '<div><div class="wordmark">skill-stats</div><div class="sub">'+esc(m.host)+' \\u00B7 '+esc(m.dbPath)+'</div></div>'+
      '<div class="controls"><div class="seg" id="seg">'+seg+'</div>'+
      '<button class="btn" id="refresh">Refresh</button><span class="upd" id="upd"></span></div>'+
      '</div>'+mf;
    updAgo();
  }
  function updAgo(){var u=el('upd');if(u&&S.data)u.textContent='updated '+relTime(S.data.meta.refreshedAt);}

  function tile(label,val,meta){return '<div class="tile"><div class="label">'+esc(label)+'</div><div class="val">'+val+'</div><div class="meta2">'+meta+'</div></div>';}
  function tileLink(href,label,val,meta){return '<a class="tile" href="'+href+'"><div class="label">'+esc(label)+'</div><div class="val">'+val+'</div><div class="meta2">'+meta+'</div></a>';}
  function renderStats(){
    var sk=S.data.report.skills,inv=0,prev=0,active=0,dormant=0,unt=0,grades=0;
    sk.forEach(function(s){inv+=s.invocations;prev+=s.prevInvocations;if(s.invocations>0)active++;if(s.dormant)dormant++;var o=s.outcomes;grades+=o.worked+o.partial+o.failed;unt+=o.untrusted;});
    var tr=trend(inv,prev);
    var share=grades>0?Math.round(unt/grades*100)+'%':'\\u2014';
    var sysNames=S.machines.length?esc(S.machines.map(shortMachine).join(' \\u00B7 ')):'this machine only';
    el('stats').innerHTML=
      tile('Activations',fmt(inv),'<span class="trend '+tr.cls+'">'+tr.txt+'</span> vs prior '+S.days+'d')+
      tile('Active / total skills',active+' / '+sk.length,(sk.length-active)+' idle this window')+
      tileLink('#dead','Dormant',fmt(dormant),'did nothing in window')+
      tile('Untrusted-grade share',share,unt+' of '+grades+' grades')+
      tile('Systems',fmt(S.machines.length||1),sysNames);
  }

  function renderFiring(){
    var thead=COLS.map(function(c){
      var arr=S.sortCol===c.k?'<span class="arr">'+(S.sortDir<0?'\\u25BC':'\\u25B2')+'</span>':'';
      return '<th class="'+(c.num?'num ':'')+c.cls+'" data-col="'+c.k+'">'+esc(c.label)+' '+arr+'</th>';
    }).join('');
    el('firing').innerHTML=
      '<div class="shead">What\\u2019s firing</div>'+
      '<div class="toolbar"><input class="filter" id="filter" placeholder="Filter skills   /" value="'+esc(S.filter)+'"/><span class="upd" id="rowcount"></span></div>'+
      '<div class="tblwrap"><table><thead><tr>'+thead+'</tr></thead><tbody id="frows"></tbody></table></div>';
    renderRows();
  }
  function filteredSorted(){
    var f=S.filter.trim().toLowerCase();
    var rows=S.data.report.skills.filter(function(s){return !f||s.name.toLowerCase().indexOf(f)>=0;});
    var col=colByKey(S.sortCol);
    rows.sort(function(a,b){
      var va=col.val(a),vb=col.val(b),cmp=va<vb?-1:va>vb?1:0;
      if(cmp!==0)return cmp*S.sortDir;
      return a.name<b.name?-1:a.name>b.name?1:0;
    });
    return rows;
  }
  function rowHTML(s){
    var tr=trend(s.invocations,s.prevInvocations),o=s.outcomes;
    var errCell=s.errorsAfter>0?'<span class="err">'+fmt(s.errorsAfter)+'</span>':'<span class="dot">\\u00B7</span>';
    var outc='<span>'+(o.worked||0)+'\\u2713</span>'+
      (o.failed>0?' <span class="err">'+o.failed+'\\u2717</span>':'')+
      (o.partial>0?' <span class="unt">'+o.partial+'~</span>':'')+
      (o.untrusted>0?' <span class="unt">('+o.untrusted+'u)</span>':'');
    return '<tr class="srow'+(s.dormant?' dormant':'')+'" data-skill="'+esc(s.name)+'">'+
      '<td>'+esc(s.name)+harnessChips(s.harnesses)+machineChips(s.machines)+'</td>'+
      '<td class="col-activity spark">'+sparkSVG(s.dailyCounts)+'</td>'+
      '<td class="num">'+fmt(s.invocations)+'</td>'+
      '<td class="col-who">'+whoBar(s.byTrigger)+'</td>'+
      '<td class="num"><span class="trend '+tr.cls+'">'+tr.txt+'</span></td>'+
      '<td class="num">'+fmt(s.tokensAfter)+'</td>'+
      '<td class="num">'+errCell+'</td>'+
      '<td>'+outc+'</td>'+
      '<td class="num ts">'+esc(relTime(s.lastUsed))+'</td>'+
      '</tr>'+(S.open===s.name?detailRow(s.name):'');
  }
  function renderRows(){
    var rows=filteredSorted(),total=rows.length;
    var shown=S.showAll?rows:rows.slice(0,50);
    var html=shown.map(rowHTML).join('');
    if(total===0)html='<tr><td colspan="'+COLS.length+'" class="ts">No skills match the filter.</td></tr>';
    else if(!S.showAll&&total>50)html+='<tr class="showrow"><td colspan="'+COLS.length+'"><button class="btn" id="showall">Show all '+total+'</button></td></tr>';
    el('frows').innerHTML=html;
    var rc=el('rowcount');if(rc)rc.textContent=total+' skill'+(total===1?'':'s');
  }
  function detailRow(name){
    var d=S.details[name];
    var body=d?detailHTML(d):'<div class="ts">Loading\\u2026</div>';
    return '<tr class="detail"><td colspan="'+COLS.length+'"><div class="dwrap">'+body+'</div></td></tr>';
  }
  function detailHTML(d){
    if(d.error)return '<div class="ts">Failed to load drill-down.</div>';
    var dt=d.detail;
    var recent=(dt.recent||[]).map(function(a){
      return '<tr><td class="ts">'+esc(relTime(a.ts))+'</td><td>'+esc(a.harness||'?')+'</td><td>'+esc(a.project||'\\u2014')+'</td><td class="num">'+fmt(a.tokensAfter)+'</td><td class="num">'+(a.errorsAfter>0?'<span class="err">'+fmt(a.errorsAfter)+'</span>':'0')+'</td></tr>';
    }).join('')||'<tr><td class="ts" colspan="5">No recent activations.</td></tr>';
    var vers=(dt.versions||[]).map(function(v){
      return '<tr><td class="tnum">'+esc(v.skillHash?v.skillHash.slice(0,10):'(unknown)')+'</td><td class="num">'+fmt(v.invocations)+'</td><td class="num">'+fmt(v.tokensAfter)+'</td><td class="num">'+fmt(v.errorsAfter)+'</td></tr>';
    }).join('')||'<tr><td class="ts" colspan="4">No version history.</td></tr>';
    var outs=(d.outcomes||[]).map(function(o){
      return '<div class="orow"><span class="tnum">'+esc(relTime(o.ts))+'</span><span class="pill '+esc(o.grade||'')+'">'+esc(o.grade||'?')+'</span><span class="quote">'+esc(o.evidence||'(no evidence)')+'</span><span class="unt">'+(o.trusted?'trusted':'untrusted')+'</span></div>';
    }).join('')||'<div class="ts">No outcomes recorded.</div>';
    return '<div class="dsec"><h4>Recent activations</h4><table class="mini"><thead><tr><th>When</th><th>Harness</th><th>Project</th><th class="num">Tokens</th><th class="num">Errors</th></tr></thead><tbody>'+recent+'</tbody></table></div>'+
      '<div class="dsec"><h4>Version timeline</h4><table class="mini"><thead><tr><th>Hash</th><th class="num">Invokes</th><th class="num">Tokens</th><th class="num">Errors</th></tr></thead><tbody>'+vers+'</tbody></table></div>'+
      '<div class="dsec"><h4>Outcomes</h4>'+outs+'</div>';
  }
  function toggleOpen(name){
    if(S.open===name){S.open=null;renderRows();return;}
    S.open=name;renderRows();
    if(!S.details[name]){
      fetch('/api/skill/'+encodeURIComponent(name)+'?days='+S.days).then(function(r){return r.json();}).then(function(d){S.details[name]=d;if(S.open===name)renderRows();}).catch(function(){S.details[name]={error:true};if(S.open===name)renderRows();});
    }
  }

  function renderDead(){
    var dorm=S.data.report.skills.filter(function(s){return s.dormant;});
    var head='<div class="shead">Dead weight</div><div class="sfind">'+(dorm.length?dorm.length+' skills on disk did nothing in this window.':'Nothing dormant \\u2014 every skill on disk fired in this window.')+'</div>';
    var body=dorm.length?'<div class="grid">'+dorm.map(function(s){
      var when=s.lastUsed?'last used '+relTime(s.lastUsed):'never used';
      return '<div class="card"><div class="cn">'+esc(s.name)+'</div><div class="cm">'+esc(when)+'</div></div>';
    }).join('')+'</div>':'';
    el('dead').innerHTML=head+body;
  }

  function renderWarnings(){
    var warn=S.data.report.skills.filter(function(s){return s.invocations>0&&(s.errorsAfter/s.invocations)>0.5;})
      .sort(function(a,b){return (b.errorsAfter/b.invocations)-(a.errorsAfter/a.invocations);});
    var head='<div class="shead">Warning signals</div>';
    if(!warn.length){el('warnings').innerHTML=head+'<div class="sfind">No warning signals in this window.</div>';return;}
    var rows=warn.map(function(s){
      var ratio=(s.errorsAfter/s.invocations).toFixed(2);
      return '<tr><td>'+esc(s.name)+'</td><td class="num">'+fmt(s.invocations)+'</td><td class="num err">'+fmt(s.errorsAfter)+'</td><td class="num err">'+ratio+'</td></tr>';
    }).join('');
    el('warnings').innerHTML=head+'<div class="sfind">Skills erroring after activation more than half the time.</div>'+
      '<div class="tblwrap"><table><thead><tr><th>Skill</th><th class="num">Invokes</th><th class="num">Errors</th><th class="num">Err / invoke</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }

  function renderOutcomes(){
    var os=S.data.recentOutcomes||[];
    var head='<div class="shead">Recent outcomes</div>';
    if(!os.length){el('outcomes').innerHTML=head+'<div class="sfind">No outcomes recorded yet \\u2014 agents grade skills via record_skill_outcome.</div>';return;}
    var rows=os.map(function(o){
      return '<div class="orow"><span class="oname">'+esc(o.skill)+'</span><span class="pill '+esc(o.grade||'')+'">'+esc(o.grade||'?')+'</span><span class="quote">'+esc(o.evidence||'(no evidence)')+'</span><span class="ts">'+(o.trusted?'trusted':'untrusted')+' \\u00B7 '+esc(relTime(o.ts))+'</span></div>';
    }).join('');
    el('outcomes').innerHTML=head+'<div class="olist">'+rows+'</div>';
  }

  function renderFooter(){el('footer').innerHTML='<span>100% local \\u2014 nothing leaves this machine</span><span class="v">skill-stats v'+esc(S.data.meta.version)+'</span>';}

  function setSort(k){if(S.sortCol===k)S.sortDir*=-1;else{S.sortCol=k;S.sortDir=(k==='name'?1:-1);}renderFiring();}
  function setDays(d){if(S.days===d)return;S.days=d;S.details={};S.open=null;fetchReport();}
  function setMachine(m){if(S.machine===m)return;S.machine=m;S.details={};S.open=null;fetchReport();}
  function computeMachines(data){
    var set={};data.report.skills.forEach(function(s){var m=s.machines||{};for(var k in m){if(m[k]>0)set[k]=true;}});
    return Object.keys(set).sort();
  }
  // Only an unfiltered response is trusted for the machine universe — a filtered
  // report's rows only carry the one machine we asked for.
  function ingest(data){S.data=data;if(!S.machine)S.machines=computeMachines(data);}
  function fetchReport(){
    var q='/api/report?days='+S.days+(S.machine?'&machine='+encodeURIComponent(S.machine):'');
    fetch(q).then(function(r){return r.json();}).then(function(data){ingest(data);renderAll();});
  }
  function doRefresh(){
    var b=el('refresh');if(b){b.disabled=true;b.textContent='Refreshing\\u2026';}
    fetch('/api/refresh?days='+S.days,{method:'POST'}).then(function(r){return r.json();}).then(function(data){
      ingest(data);S.details={};
      if(S.machine)fetchReport();else renderAll();
    }).catch(function(){renderAll();});
  }

  document.addEventListener('click',function(e){
    var t=e.target;
    var th=t.closest('th[data-col]');if(th){setSort(th.getAttribute('data-col'));return;}
    var sb=t.closest('button[data-days]');if(sb){setDays(+sb.getAttribute('data-days'));return;}
    var mb=t.closest('button[data-machine]');if(mb){setMachine(mb.getAttribute('data-machine'));return;}
    if(t.closest('#refresh')){doRefresh();return;}
    if(t.closest('#showall')){S.showAll=true;renderRows();return;}
    var q=t.closest('.quote');if(q){q.classList.toggle('exp');return;}
    var row=t.closest('tr.srow');if(row){toggleOpen(row.getAttribute('data-skill'));return;}
  });
  document.addEventListener('input',function(e){if(e.target.id==='filter'){S.filter=e.target.value;S.showAll=false;renderRows();}});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement.id!=='filter'){var f=el('filter');if(f){e.preventDefault();f.focus();}}});

  function boot(){
    S.data=JSON.parse(el('bootstrap').textContent);
    S.machines=computeMachines(S.data);
    renderAll();
    doRefresh();
    setInterval(updAgo,15000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
`

export function renderPage(data: DashboardData): string {
  const bootstrap = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\//g, '\\/')
  return (
    '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
    '<title>skill-stats</title>\n' +
    '<style>' +
    TOKENS +
    CSS +
    '</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="wrap">\n' +
    '  <header class="topbar" id="topbar"></header>\n' +
    '  <section class="stats" id="stats"></section>\n' +
    '  <section id="firing"></section>\n' +
    '  <section id="dead"></section>\n' +
    '  <section id="warnings"></section>\n' +
    '  <section id="outcomes"></section>\n' +
    '  <footer id="footer"></footer>\n' +
    '</div>\n' +
    '<script type="application/json" id="bootstrap">' +
    bootstrap +
    '</script>\n' +
    '<script>' +
    JS +
    '</script>\n' +
    '</body>\n' +
    '</html>\n'
  )
}
