import type { DashboardData } from './dashboard.js'

// A single self-contained document: CSS in one <style>, JS in one <script>, and
// the report embedded in a <script type="application/json"> tag. Zero external
// requests — the client fetches only same-origin /api/* endpoints. The client JS
// deliberately avoids template literals so it can live inside this TS template
// without backtick/${} collisions.

const CSS = `
:root{
  color-scheme:light dark;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,monospace;
  --sans:-apple-system,"SF Pro Text",system-ui,Segoe UI,sans-serif;
  --bg:#fafafa;--surface:#ffffff;--text:#16161a;--muted:#71717a;
  --line:rgba(0,0,0,.08);--hover:rgba(0,0,0,.03);
  --accent:#b97e14;--err:#b4433a;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0e0e10;--surface:#17171a;--text:#ececef;--muted:#8e8e96;
  --line:rgba(255,255,255,.08);--hover:rgba(255,255,255,.03);
  --accent:#d9a03a;--err:#cf6d64;
}}
*{box-sizing:border-box;}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px 64px;}
section{margin-top:48px;}
a{color:inherit;text-decoration:none;}
.num,.tnum,td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;}

.topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;}
.wordmark{font-family:var(--mono);font-size:18px;font-weight:600;letter-spacing:-.5px;}
.sub{color:var(--muted);font-size:12px;margin-top:4px;font-family:var(--mono);}
.controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;}
.seg button{border:0;background:transparent;color:var(--muted);font:12px var(--mono);padding:6px 11px;cursor:pointer;}
.seg button.active{background:var(--accent);color:#fff;}
.btn{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:6px;padding:6px 12px;font:12px var(--sans);cursor:pointer;}
.btn:disabled{opacity:.6;cursor:default;}
.upd{color:var(--muted);font-size:11px;}

.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;}
.tile{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:16px;display:block;}
.tile .label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}
.tile .val{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:28px;margin-top:8px;line-height:1;}
.tile .meta2{font-size:12px;color:var(--muted);margin-top:6px;}
@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr);}}

.shead{font-size:13px;font-weight:600;letter-spacing:.02em;margin:0 0 4px;}
.sfind{color:var(--muted);font-size:12px;margin:0 0 16px;}

.toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;}
.filter{border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:6px;padding:7px 10px;font:13px var(--sans);width:240px;}
.tblwrap{overflow-x:auto;}
table{width:100%;border-collapse:collapse;}
th,td{text-align:left;padding:0 10px;height:40px;border-bottom:1px solid var(--line);white-space:nowrap;}
thead th{height:32px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;cursor:pointer;user-select:none;}
th.num,td.num{text-align:right;}
th .arr{font-size:9px;color:var(--accent);}
tbody tr.srow:hover{background:var(--hover);cursor:pointer;}
tr.dormant{opacity:.45;}
.chip{font-family:var(--mono);font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-left:6px;}
.spark svg{display:block;vertical-align:middle;}
.err{color:var(--err);}
.dot{color:var(--muted);opacity:.4;}
.unt{color:var(--muted);}
.trend.up{color:var(--accent);}
.trend.down,.trend.flat{color:var(--muted);}
.ts{color:var(--muted);font-size:12px;}

.detail td{padding:0;}
.dwrap{padding:16px 10px;background:var(--hover);animation:acc .16s ease-out;}
@keyframes acc{from{opacity:0;transform:translateY(-4px);}to{opacity:1;transform:none;}}
.dsec{margin-bottom:16px;}
.dsec:last-child{margin-bottom:0;}
.dsec h4{margin:0 0 6px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);}
.mini{width:100%;border-collapse:collapse;}
.mini th,.mini td{height:auto;padding:5px 8px;font-size:12px;}
.mini th{cursor:default;}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;}
.card{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:10px 12px;opacity:.45;}
.card .cn{font-size:13px;}
.card .cm{font-size:11px;color:var(--muted);margin-top:2px;font-family:var(--mono);}

.olist{display:flex;flex-direction:column;}
.orow{display:grid;grid-template-columns:170px 64px 1fr auto;gap:12px;align-items:baseline;padding:9px 0;border-bottom:1px solid var(--line);}
.oname{font-size:13px;}
.pill{font-family:var(--mono);font-size:11px;border:1px solid var(--line);border-radius:4px;padding:1px 6px;color:var(--muted);text-align:center;}
.pill.failed{color:var(--err);border-color:var(--err);}
.quote{color:var(--muted);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;}
.quote.exp{white-space:normal;}

footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;}
footer .v{font-family:var(--mono);}

@media(max-width:900px){.col-activity{display:none;}}
`

const JS = `
(function(){
  var S={data:null,days:30,sortCol:'invocations',sortDir:-1,filter:'',showAll:false,open:null,details:{}};

  var COLS=[
    {k:'name',label:'Skill',num:false,cls:'',val:function(s){return s.name.toLowerCase();}},
    {k:'activity',label:'Activity',num:false,cls:'col-activity',val:function(s){return s.invocations;}},
    {k:'invocations',label:'Invokes',num:true,cls:'',val:function(s){return s.invocations;}},
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
    var area='<polygon points="0,'+H+' '+line+' '+W+','+H+'" fill="var(--accent)" fill-opacity="0.06"/>';
    var poly='<polyline points="'+line+'" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';
    return '<svg viewBox="0 0 '+W+' '+H+'" width="'+W+'" height="'+H+'" preserveAspectRatio="none">'+area+poly+'</svg>';
  }

  function renderAll(){renderTopbar();renderStats();renderFiring();renderDead();renderWarnings();renderOutcomes();renderFooter();}

  function renderTopbar(){
    var m=S.data.meta;
    var seg=[7,30,90].map(function(d){return '<button data-days="'+d+'" class="'+(S.days===d?'active':'')+'">'+d+'d</button>';}).join('');
    el('topbar').innerHTML=
      '<div><div class="wordmark">skillstats</div><div class="sub">'+esc(m.host)+' \\u00B7 '+esc(m.dbPath)+'</div></div>'+
      '<div class="controls"><div class="seg" id="seg">'+seg+'</div>'+
      '<button class="btn" id="refresh">Refresh</button><span class="upd" id="upd"></span></div>';
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
    el('stats').innerHTML=
      tile('Activations',fmt(inv),'<span class="trend '+tr.cls+'">'+tr.txt+'</span> vs prior '+S.days+'d')+
      tile('Active / total skills',active+' / '+sk.length,(sk.length-active)+' idle this window')+
      tileLink('#dead','Dormant',fmt(dormant),'did nothing in window')+
      tile('Untrusted-grade share',share,unt+' of '+grades+' grades');
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
      '<td>'+esc(s.name)+harnessChips(s.harnesses)+'</td>'+
      '<td class="col-activity spark">'+sparkSVG(s.dailyCounts)+'</td>'+
      '<td class="num">'+fmt(s.invocations)+'</td>'+
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

  function renderFooter(){el('footer').innerHTML='<span>100% local \\u2014 nothing leaves this machine</span><span class="v">skillstats v'+esc(S.data.meta.version)+'</span>';}

  function setSort(k){if(S.sortCol===k)S.sortDir*=-1;else{S.sortCol=k;S.sortDir=(k==='name'?1:-1);}renderFiring();}
  function setDays(d){if(S.days===d)return;S.days=d;S.details={};S.open=null;fetchReport();}
  function fetchReport(){fetch('/api/report?days='+S.days).then(function(r){return r.json();}).then(function(data){S.data=data;renderAll();});}
  function doRefresh(){
    var b=el('refresh');if(b){b.disabled=true;b.textContent='Refreshing\\u2026';}
    fetch('/api/refresh?days='+S.days,{method:'POST'}).then(function(r){return r.json();}).then(function(data){S.data=data;S.details={};renderAll();}).catch(function(){renderAll();});
  }

  document.addEventListener('click',function(e){
    var t=e.target;
    var th=t.closest('th[data-col]');if(th){setSort(th.getAttribute('data-col'));return;}
    var sb=t.closest('button[data-days]');if(sb){setDays(+sb.getAttribute('data-days'));return;}
    if(t.closest('#refresh')){doRefresh();return;}
    if(t.closest('#showall')){S.showAll=true;renderRows();return;}
    var q=t.closest('.quote');if(q){q.classList.toggle('exp');return;}
    var row=t.closest('tr.srow');if(row){toggleOpen(row.getAttribute('data-skill'));return;}
  });
  document.addEventListener('input',function(e){if(e.target.id==='filter'){S.filter=e.target.value;S.showAll=false;renderRows();}});
  document.addEventListener('keydown',function(e){if(e.key==='/'&&document.activeElement.id!=='filter'){var f=el('filter');if(f){e.preventDefault();f.focus();}}});

  function boot(){
    S.data=JSON.parse(el('bootstrap').textContent);
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
    '<title>skillstats</title>\n' +
    '<style>' +
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
