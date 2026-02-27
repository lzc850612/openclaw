/**
 * Returns a self-contained HTML string for the A2A monitor dashboard.
 * No external dependencies, no build step — plain HTML + inline CSS + vanilla JS.
 */
export function buildMonitorHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OpenClaw A2A Monitor</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e2e8f0;height:100vh;display:flex;flex-direction:column;font-size:14px}
    header{padding:10px 18px;background:#161922;border-bottom:1px solid #2d3748;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    header h1{font-size:.95rem;font-weight:600;color:#a78bfa;letter-spacing:.01em}
    .hdr-right{display:flex;align-items:center;gap:10px;font-size:.72rem;color:#718096}
    .dot{width:7px;height:7px;border-radius:50%;background:#48bb78;display:inline-block;margin-right:5px;transition:background .3s}
    .dot.off{background:#4a5568}
    .layout{display:flex;flex:1;overflow:hidden}
    /* ── Task list ── */
    .sidebar{width:270px;border-right:1px solid #1e2535;overflow-y:auto;flex-shrink:0;display:flex;flex-direction:column}
    .sidebar-hdr{padding:10px 14px 6px;font-size:.65rem;text-transform:uppercase;letter-spacing:.1em;color:#4a5568;border-bottom:1px solid #1e2535;flex-shrink:0}
    .task-item{padding:10px 14px;border-bottom:1px solid #161922;cursor:pointer;transition:background .1s}
    .task-item:hover{background:#161922}
    .task-item.sel{background:#1a1e30;border-left:3px solid #a78bfa;padding-left:11px}
    .t-id{font-size:.62rem;font-family:monospace;color:#4a5568;margin-bottom:2px}
    .t-goal{font-size:.8rem;color:#cbd5e0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:5px}
    .t-meta{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
    .b{font-size:.6rem;padding:1px 6px;border-radius:999px;font-weight:700;text-transform:uppercase;white-space:nowrap}
    .b-active{background:#1c4532;color:#68d391}
    .b-completing{background:#744210;color:#f6ad55}
    .b-closed{background:#1a202c;color:#718096}
    .b-failed{background:#742a2a;color:#fc8181}
    .b-waiting-human{background:#322659;color:#b794f4}
    .b-initiator{background:#1a365d;color:#63b3ed}
    .b-responder{background:#1d4044;color:#4fd1c5}
    .t-peer{font-size:.62rem;color:#4a5568}
    .no-tasks{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#4a5568;gap:6px}
    .no-tasks .ico{font-size:1.8rem}
    /* ── Thread panel ── */
    .thread{flex:1;display:flex;flex-direction:column;overflow:hidden}
    .th-hdr{padding:12px 18px;border-bottom:1px solid #1e2535;background:#161922;flex-shrink:0}
    .th-title{font-size:.9rem;font-weight:600;color:#e2e8f0;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .th-meta{display:flex;flex-wrap:wrap;gap:5px;align-items:center;font-size:.7rem;color:#718096}
    .th-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#4a5568;font-size:.85rem}
    .msgs{flex:1;overflow-y:auto;padding:14px 18px;display:flex;flex-direction:column;gap:10px}
    /* ── Messages ── */
    .msg{padding:9px 13px;border-radius:8px;max-width:82%}
    .msg.out{background:#162040;border:1px solid #2c4a7a;align-self:flex-end}
    .msg.in{background:#162416;border:1px solid #2a5228;align-self:flex-start}
    .msg-hdr{display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:.65rem}
    .dir{font-size:.75rem}
    .msg.out .dir{color:#63b3ed}
    .msg.in .dir{color:#68d391}
    .mt{font-size:.6rem;padding:1px 5px;border-radius:3px;font-weight:700;text-transform:uppercase}
    .mt-message{background:#2d3748;color:#a0aec0}
    .mt-task-request{background:#1a365d;color:#63b3ed}
    .mt-completing{background:#744210;color:#f6ad55}
    .mt-completed{background:#1c4532;color:#68d391}
    .mt-error{background:#742a2a;color:#fc8181}
    .mt-default{background:#2d3748;color:#a0aec0}
    .msg-time{color:#4a5568;margin-left:auto}
    .msg-body{font-size:.8rem;color:#e2e8f0;white-space:pre-wrap;word-break:break-word;line-height:1.5}
    .msg-from{font-size:.62rem;color:#4a5568;margin-top:4px}
    .no-msgs{color:#4a5568;font-size:.78rem;text-align:center;padding:32px 0}
    /* ── HumanGate banners ── */
    .gate-pending{width:100%;padding:9px 14px;border-radius:6px;background:#3d3000;border:1px solid #7c5e00;color:#fbd38d;font-size:.8rem;display:flex;align-items:flex-start;gap:8px;box-sizing:border-box}
    .gate-pending .gate-icon{font-size:1rem;flex-shrink:0;margin-top:1px}
    .gate-pending .gate-text{flex:1;line-height:1.5}
    .gate-pending .gate-since{font-size:.65rem;color:#b7791f;margin-top:3px}
    .gate-answered{width:100%;padding:7px 14px;border-radius:6px;background:#1a2020;border:1px solid #2d4040;color:#718096;font-size:.78rem;display:flex;align-items:flex-start;gap:8px;box-sizing:border-box}
    .gate-answered .gate-icon{flex-shrink:0}
    .gate-answered .gate-text{flex:1;line-height:1.5}
  </style>
</head>
<body>
<header>
  <h1>OpenClaw A2A Monitor</h1>
  <div class="hdr-right">
    <span><span class="dot" id="dot"></span><span id="lbl">connecting…</span></span>
    <span id="taskCount"></span>
  </div>
</header>
<div class="layout">
  <div class="sidebar">
    <div class="sidebar-hdr">Tasks</div>
    <div id="taskList" style="flex:1"></div>
  </div>
  <div class="thread" id="thread">
    <div class="th-empty">← select a task to view its message thread</div>
  </div>
</div>
<script>
(function(){
  var tasks=[], selId=null, selTask=null;

  function esc(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function host(url){
    try{ return new URL(url).host; }catch(e){ return String(url||''); }
  }

  function ts(ms){
    if(!ms) return '';
    var d=new Date(ms);
    return d.getHours().toString().padStart(2,'0')+':'+
           d.getMinutes().toString().padStart(2,'0')+':'+
           d.getSeconds().toString().padStart(2,'0');
  }

  function badge(cls,txt){
    return '<span class="b '+cls+'">'+esc(txt)+'</span>';
  }

  function statusBadge(s){
    var map={active:'b-active',completing:'b-completing',closed:'b-closed',failed:'b-failed','waiting-human':'b-waiting-human'};
    return badge(map[s]||'b-closed', s);
  }

  function typeCls(t){
    var s=String(t||'message').replace(/[^a-z0-9]/g,'-');
    return 'mt-'+s;
  }

  function renderList(){
    var el=document.getElementById('taskList');
    if(!tasks.length){
      el.innerHTML='<div class="no-tasks"><div class="ico">⬡</div><div>No A2A tasks yet</div></div>';
      return;
    }
    el.innerHTML=tasks.map(function(t){
      return '<div class="task-item'+(t.taskId===selId?' sel':'')+'" onclick="window._sel('+esc(JSON.stringify(t.taskId))+')">'+
        '<div class="t-id">'+esc(t.taskId.slice(0,8))+'…</div>'+
        '<div class="t-goal" title="'+esc(t.goal)+'">'+esc(t.goal)+'</div>'+
        '<div class="t-meta">'+
          statusBadge(t.status)+
          badge(t.role==='initiator'?'b-initiator':'b-responder', t.role)+
          '<span class="t-peer">'+esc(t.remoteAgentId)+'@'+esc(host(t.remoteInstanceUrl))+'</span>'+
          '<span class="t-peer">'+t.messageCount+' msg'+(t.messageCount===1?'':'s')+'</span>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  function renderGate(g){
    if(g.status==='pending'){
      return '<div class="gate-pending">'+
        '<span class="gate-icon">&#9646;</span>'+
        '<div class="gate-text">'+
          '<strong>waiting for human:</strong> &ldquo;'+esc(g.question)+'&rdquo;'+
          '<div class="gate-since">pending since '+ts(g.createdAt)+'</div>'+
        '</div>'+
      '</div>';
    }
    return '<div class="gate-answered">'+
      '<span class="gate-icon">&#10003;</span>'+
      '<div class="gate-text">'+
        'gate answered: &ldquo;'+esc(g.answer||'')+'&rdquo;'+
      '</div>'+
    '</div>';
  }

  function renderThread(){
    var panel=document.getElementById('thread');
    if(!selTask){
      panel.innerHTML='<div class="th-empty">← select a task to view its message thread</div>';
      return;
    }
    var t=selTask;
    var msgs=(t.messages||[]).map(function(m){
      var dir=m.direction||'in';
      var icon=dir==='out'?'▶':'◀';
      var tc=typeCls(m.type);
      return '<div class="msg '+dir+'">'+
        '<div class="msg-hdr">'+
          '<span class="dir">'+icon+'</span>'+
          '<span class="mt '+tc+'">'+esc(m.type||'message')+'</span>'+
          '<span class="msg-time">'+ts(m.receivedAtMs)+'</span>'+
        '</div>'+
        '<div class="msg-body">'+esc(m.content)+'</div>'+
        '<div class="msg-from">'+esc(m.fromAgentId)+'@'+esc(host(m.fromInstanceUrl))+'</div>'+
      '</div>';
    }).join('');
    // Render gate banners after messages.
    var gateHtml=(t.gates||[]).map(renderGate).join('');
    var threadContent=msgs+(gateHtml?gateHtml:'');
    panel.innerHTML=
      '<div class="th-hdr">'+
        '<div class="th-title" title="'+esc(t.goal)+'">'+esc(t.goal)+'</div>'+
        '<div class="th-meta">'+
          statusBadge(t.status)+
          badge(t.role==='initiator'?'b-initiator':'b-responder',t.role)+
          '<span>peer: '+esc(t.remoteAgentId)+'@'+esc(host(t.remoteInstanceUrl))+'</span>'+
          '<span>created '+ts(t.createdAtMs)+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="msgs">'+(threadContent||'<div class="no-msgs">No messages recorded yet</div>')+'</div>';
    // scroll to bottom
    var msgs_el=panel.querySelector('.msgs');
    if(msgs_el) msgs_el.scrollTop=msgs_el.scrollHeight;
  }

  window._sel=function(id){
    selId=id;
    selTask=null;
    renderList();
    renderThread();
    fetch('/a2a/tasks/'+encodeURIComponent(id))
      .then(function(r){ return r.ok?r.json():null; })
      .then(function(d){ if(d){ selTask=d; renderThread(); } })
      .catch(function(){});
  };

  function refresh(){
    fetch('/a2a/tasks')
      .then(function(r){ return r.ok?r.json():Promise.reject(r.status); })
      .then(function(data){
        tasks=data;
        document.getElementById('dot').classList.remove('off');
        document.getElementById('lbl').textContent='live';
        document.getElementById('taskCount').textContent=data.length+' task'+(data.length===1?'':'s');
        renderList();
        if(selId){
          return fetch('/a2a/tasks/'+encodeURIComponent(selId))
            .then(function(r){ return r.ok?r.json():null; });
        }
      })
      .then(function(d){ if(d){ selTask=d; renderThread(); } })
      .catch(function(){
        document.getElementById('dot').classList.add('off');
        document.getElementById('lbl').textContent='error';
      });
  }

  refresh();
  setInterval(refresh, 2000);
})();
</script>
</body>
</html>`;
}
