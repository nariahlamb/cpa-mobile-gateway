/* CPA 移动面板 · 纯前端逻辑，全部通过 Management API 操作 CPA 原生配置 */
'use strict';

const LS = { base:'cpa_base', key:'cpa_key', remember:'cpa_remember', rules:'cpa_rules' };
let API = { base:'', key:'' };
let SITES = [];          // openai-compatibility 数组
let curSiteIdx = -1;     // 模型页当前站点
let MODELS = [];         // 当前站点模型 [{name,alias,_up?,_speed?,_checked?}]
let RULES = [];          // 归类规则 [{name,pattern,alias,flags}]

/* ---------- 工具 ---------- */
function $(id){return document.getElementById(id)}
function toast(msg,ms=2000){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove('show'),ms)}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function setStatus(state,txt){const d=$('statusDot');d.className='dot'+(state?' on':state===false?' off':'');$('statusTxt').textContent=txt}

/* ---------- Management API ---------- */
async function mgmt(path, method='GET', body){
  if(!API.base) throw new Error('未配置网关地址');
  const url = API.base.replace(/\/+$/,'') + '/v0/management' + path;
  const opt = { method, headers:{ 'Authorization':'Bearer '+API.key } };
  if(body!==undefined){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body) }
  const r = await fetch(url, opt);
  const txt = await r.text();
  let data; try{ data = txt?JSON.parse(txt):null }catch(e){ data = txt }
  if(!r.ok) throw new Error((data&&data.error)?data.error:('HTTP '+r.status));
  return data;
}
// 通过网关 api-call 代理请求上游（用于拉模型 / 测速），带上该站点某个 key
async function upstream(site, method, subPath, keyOverride){
  const key = keyOverride || (site['api-key-entries']&&site['api-key-entries'][0]&&site['api-key-entries'][0]['api-key']) || '';
  const base = (site['base-url']||'').replace(/\/+$/,'');
  const body = {
    method, url: base + subPath,
    header: { 'Authorization':'Bearer '+key, 'Content-Type':'application/json' }
  };
  const res = await mgmt('/api-call','POST',body);
  let parsed=null; try{ parsed = res.body?JSON.parse(res.body):null }catch(e){}
  return { status:res.status_code, raw:res.body, json:parsed };
}

/* ---------- 连接 ---------- */
function loadSaved(){
  if(localStorage.getItem(LS.remember)==='1'){
    API.base = localStorage.getItem(LS.base)||''; API.key = localStorage.getItem(LS.key)||'';
    $('cfgBase').value=API.base; $('cfgKey').value=API.key; $('cfgRemember').checked=true;
  }else{
    API.base = location.origin; $('cfgBase').value=API.base;
  }
  try{ RULES = JSON.parse(localStorage.getItem(LS.rules)||'[]') }catch(e){ RULES=[] }
  if(!RULES.length) RULES = defaultRules();
}
async function connect(){
  API.base = $('cfgBase').value.trim() || location.origin;
  API.key  = $('cfgKey').value.trim();
  if($('cfgRemember').checked){
    localStorage.setItem(LS.remember,'1');
    localStorage.setItem(LS.base,API.base); localStorage.setItem(LS.key,API.key);
  }else{ localStorage.removeItem(LS.remember); localStorage.removeItem(LS.key) }
  $('connHint').textContent='连接中…';
  try{
    await loadSites();
    await loadGlobalSettings();
    setStatus(true,'已连接 · '+SITES.length+' 站点');
    $('connHint').textContent='连接成功，站点 '+SITES.length+' 个';
    toast('连接成功');
    nav('sites');
  }catch(e){
    setStatus(false,'连接失败');
    $('connHint').textContent='失败：'+e.message;
    toast('连接失败：'+e.message,3000);
  }
}

/* ---------- 站点 ---------- */
async function loadSites(){
  const d = await mgmt('/openai-compatibility');
  SITES = (d && d['openai-compatibility']) || [];
  renderSites(); renderMdlSiteSel();
}
function detectExit(site){
  // 依据 base-url 猜测出口类型标签（仅展示，实际能力以测速为准）
  const u=(site['base-url']||'').toLowerCase(); const t=[];
  t.push('chat');                              // openai-compatibility 一定走 chat/completions
  if(/anthropic|claude/.test(u)) t.push('anth');
  if(/openai|azure|responses/.test(u)) t.push('resp');
  return t;
}
function renderSites(){
  $('siteCount').textContent = SITES.length+' 个';
  const box=$('siteList');
  if(!SITES.length){ box.innerHTML='<div class="empty">暂无站点，点下方新增</div>'; return }
  box.innerHTML = SITES.map((s,i)=>{
    const keys=(s['api-key-entries']||[]).length;
    const mdls=(s.models||[]).length;
    const on=!s.disabled;
    const exits=detectExit(s).map(e=>`<span class="badge ${e}">${e==='chat'?'chat':e==='resp'?'responses':'anthropic'}</span>`).join('');
    return `<div class="item">
      <div class="hd"><b>${esc(s.name||'(未命名)')}</b>
        <span class="badge ${on?'on':'off'}">${on?'启用':'禁用'}</span></div>
      <div class="hd"><span class="u">${esc(s['base-url']||'')}</span></div>
      <div style="margin:6px 0">${exits}</div>
      <div class="meta"><span>🔑 ${keys} key</span><span>📦 ${mdls} 模型</span>${s.prefix?`<span>前缀 ${esc(s.prefix)}</span>`:''}</div>
      <div class="btn-grid" style="margin-top:10px">
        <button class="btn sec sm" onclick="openSiteSheet(${i})">编辑</button>
        <button class="btn sec sm" onclick="gotoModels(${i})">模型</button>
        <button class="btn ${on?'warn':'ok'} sm" onclick="toggleSite(${i})">${on?'禁用':'启用'}</button>
        <button class="btn err sm" onclick="delSite(${i})">删除</button>
      </div></div>`;
  }).join('');
}
async function toggleSite(i){
  try{ await mgmt('/openai-compatibility','PATCH',{index:i,value:{disabled:!SITES[i].disabled}});
    await loadSites(); toast(SITES[i]&&!SITES[i].disabled?'已启用':'已禁用'); }
  catch(e){ toast('失败：'+e.message,3000) }
}
async function delSite(i){
  if(!confirm('删除站点「'+(SITES[i].name||'')+'」？')) return;
  try{ await mgmt('/openai-compatibility?index='+i,'DELETE'); await loadSites(); toast('已删除'); }
  catch(e){ toast('失败：'+e.message,3000) }
}

/* 站点编辑弹层 */
function openSiteSheet(i){
  const s = i>=0 ? JSON.parse(JSON.stringify(SITES[i])) : {name:'',['base-url']:'',prefix:'',['api-key-entries']:[{['api-key']:''}],models:[],disabled:false};
  const keysHtml = (s['api-key-entries']||[]).map((k,ki)=>keyRow(k['api-key']||'',k.weight,ki)).join('');
  $('sheetBody').innerHTML = `
    <h3>${i>=0?'编辑站点':'新增站点'}</h3>
    <label class="fld"><span>名称</span><input type="text" id="s_name" value="${esc(s.name)}" placeholder="openrouter"></label>
    <label class="fld"><span>Base URL</span><input type="text" id="s_url" value="${esc(s['base-url'])}" placeholder="https://openrouter.ai/api/v1"></label>
    <label class="fld"><span>路由前缀 (可选)</span><input type="text" id="s_prefix" value="${esc(s.prefix||'')}" placeholder="留空则不加前缀"></label>
    <div class="fld"><span style="font-size:12px;color:var(--sub);display:block;margin-bottom:4px">API Keys（多个自动轮询，权重可选）</span>
      <div id="s_keys">${keysHtml}</div>
      <button class="btn sec sm" onclick="addKeyRow()">+ 添加 Key</button></div>
    <div class="hint">保存后到「模型」页拉取上游模型并归类。</div>
    <div class="btn-grid" style="margin-top:12px">
      <button class="btn full" onclick="saveSite(${i})">保存</button>
      <button class="btn sec full" onclick="closeSheet()">取消</button></div>`;
  showSheet();
}
function keyRow(val,weight,ki){
  return `<div class="kv" data-kr>
    <input type="text" value="${esc(val)}" placeholder="sk-..." data-k>
    <input type="number" class="w" value="${weight!=null?weight:''}" placeholder="权重" data-w>
    <button class="btn err sm" onclick="this.parentNode.remove()">×</button></div>`;
}
function addKeyRow(){ $('s_keys').insertAdjacentHTML('beforeend', keyRow('',null,0)) }
async function saveSite(i){
  const entries=[];
  document.querySelectorAll('#s_keys [data-kr]').forEach(r=>{
    const k=r.querySelector('[data-k]').value.trim(); const w=r.querySelector('[data-w]').value.trim();
    if(k){ const e={['api-key']:k}; if(w!=='') e.weight=parseInt(w,10); entries.push(e) }
  });
  const val = {
    name:$('s_name').value.trim(), ['base-url']:$('s_url').value.trim(),
    prefix:$('s_prefix').value.trim(), ['api-key-entries']:entries,
    models: i>=0?(SITES[i].models||[]):[], disabled: i>=0?SITES[i].disabled:false
  };
  if(!val.name||!val['base-url']){ toast('名称和 Base URL 必填'); return }
  try{
    if(i>=0) await mgmt('/openai-compatibility','PATCH',{index:i,value:val});
    else { const arr=SITES.concat([val]); await mgmt('/openai-compatibility','PUT',arr) }
    await loadSites(); closeSheet(); toast('已保存');
  }catch(e){ toast('保存失败：'+e.message,3000) }
}

/* ---------- 模型页 ---------- */
function renderMdlSiteSel(){
  const sel=$('mdlSiteSel');
  sel.innerHTML = SITES.length? SITES.map((s,i)=>`<option value="${i}">${esc(s.name||'站点'+i)}</option>`).join('')
    : '<option value="-1">无站点</option>';
  if(curSiteIdx>=0 && curSiteIdx<SITES.length) sel.value=String(curSiteIdx);
  else curSiteIdx = SITES.length?0:-1;
  onMdlSiteChange(true);
}
function gotoModels(i){ curSiteIdx=i; nav('models'); renderMdlSiteSel() }
function onMdlSiteChange(skipReload){
  curSiteIdx = parseInt($('mdlSiteSel').value,10);
  if(curSiteIdx<0||curSiteIdx>=SITES.length){ MODELS=[]; renderModels(); $('mdlSiteName').textContent='选择站点'; return }
  const s=SITES[curSiteIdx];
  $('mdlSiteName').textContent = s.name||'';
  MODELS = (s.models||[]).map(m=>({name:m.name,alias:m.alias||m.name,['display-name']:m['display-name'],_checked:false,_up:true}));
  renderModels();
  $('mdlHint').textContent = MODELS.length? ('已配置 '+MODELS.length+' 个模型') : '该站点暂无模型，点上方拉取';
}
function renderModels(){
  const box=$('mdlList');
  if(!MODELS.length){ box.innerHTML='<div class="empty">无模型</div>'; $('selAll').checked=false; return }
  box.innerHTML = MODELS.map((m,i)=>{
    let spd=''; if(m._speed!=null){ const c=m._speed<0?'r':m._speed<800?'g':m._speed<2500?'y':'r'; spd=`<span class="spd ${c}">${m._speed<0?'超时':m._speed+'ms'}</span>` }
    const aliasDiff = m.alias&&m.alias!==m.name;
    return `<div class="mdl">
      <input type="checkbox" ${m._checked?'checked':''} onchange="MODELS[${i}]._checked=this.checked;syncSelAll()">
      <div class="mn"><b>${esc(m.alias||m.name)}</b>${aliasDiff?`<small>← ${esc(m.name)}</small>`:''}${!m._up?'<small style="color:var(--warn)">自定义/未验证</small>':''}</div>
      ${spd}
      <button class="btn sec sm" onclick="editModel(${i})" style="min-width:auto;padding:6px 10px">✎</button>
    </div>`;
  }).join('');
  syncSelAll();
}
function toggleSelAll(){ const c=$('selAll').checked; MODELS.forEach(m=>m._checked=c); renderModels() }
function syncSelAll(){ const all=MODELS.length&&MODELS.every(m=>m._checked); $('selAll').checked=!!all }

async function fetchUpstreamModels(){
  if(curSiteIdx<0){ toast('先选站点'); return }
  const s=SITES[curSiteIdx];
  $('mdlHint').innerHTML='<span class="spin"></span> 拉取 /v1/models …';
  try{
    const r = await upstream(s,'GET','/models');
    if(r.status<200||r.status>=300){ $('mdlHint').textContent='上游返回 '+r.status; toast('拉取失败 '+r.status,3000); return }
    const list = (r.json&&(r.json.data||r.json.models||r.json))||[];
    const ids = list.map(x=> typeof x==='string'?x : (x.id||x.name||x.model)).filter(Boolean);
    if(!ids.length){ $('mdlHint').textContent='未解析到模型（响应：'+ (r.raw||'').slice(0,80) +'…）'; return }
    const exist=new Set(MODELS.map(m=>m.name));
    let added=0;
    ids.forEach(id=>{ if(!exist.has(id)){ MODELS.push({name:id,alias:id,_checked:true,_up:true}); added++ } });
    renderModels();
    $('mdlHint').textContent='拉到 '+ids.length+' 个，新增 '+added+' 个。可归类后点「应用」写回。';
    toast('拉取成功 '+ids.length+' 个');
  }catch(e){ $('mdlHint').textContent='失败：'+e.message; toast('失败：'+e.message,3000) }
}

async function speedTestSelected(){
  if(curSiteIdx<0) return;
  const s=SITES[curSiteIdx];
  const sel = MODELS.filter(m=>m._checked);
  const targets = sel.length?sel:MODELS;
  if(!targets.length){ toast('无可测模型'); return }
  $('mdlHint').innerHTML='<span class="spin"></span> 测速中（串行，自用低并发）…';
  const base=(s['base-url']||'').replace(/\/+$/,'');
  const key=(s['api-key-entries']||[])[0]&&(s['api-key-entries'][0]['api-key'])||'';
  for(const m of targets){
    const t0=performance.now();
    try{
      const body={ method:'POST', url:base+'/chat/completions',
        header:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},
        data: JSON.stringify({model:m.name,max_tokens:1,messages:[{role:'user',content:'hi'}]}) };
      const res = await mgmt('/api-call','POST',body);
      const dt=Math.round(performance.now()-t0);
      m._speed = (res.status_code>=200&&res.status_code<300)? dt : (res.status_code>=400&&res.status_code<500? dt : -1);
      // 4xx（如额度/参数）仍算连通，5xx/超时算失败
      if(res.status_code>=500) m._speed=-1;
    }catch(e){ m._speed=-1 }
    renderModels();
  }
  $('mdlHint').textContent='测速完成';
  toast('测速完成');
}

function classifyAndApply(){
  if(curSiteIdx<0) return;
  if(!RULES.length){ toast('先到「归类」页配置规则'); return }
  let changed=0;
  MODELS.forEach(m=>{ const a=classifyOne(m.name); if(a && a!==m.alias){ m.alias=a; changed++ } });
  renderModels();
  toast('归类完成，改动 '+changed+' 个，点确认写回');
  applyModelsToSite();
}
async function applyModelsToSite(){
  const s=SITES[curSiteIdx];
  const models = MODELS.map(m=>{ const o={name:m.name,alias:m.alias||m.name}; if(m['display-name'])o['display-name']=m['display-name']; return o });
  try{
    await mgmt('/openai-compatibility','PATCH',{index:curSiteIdx,value:{models}});
    SITES[curSiteIdx].models=models;
    $('mdlHint').textContent='已写回 '+models.length+' 个模型到 CPA 配置';
    toast('已保存到网关');
  }catch(e){ toast('写回失败：'+e.message,3000) }
}
async function deleteSelected(){
  const keep = MODELS.filter(m=>!m._checked);
  const del = MODELS.length-keep.length;
  if(!del){ toast('未选中'); return }
  if(!confirm('删除选中的 '+del+' 个模型？')) return;
  MODELS=keep; renderModels();
  await applyModelsToSite();
}
function editModel(i){
  const m=MODELS[i];
  $('sheetBody').innerHTML=`<h3>编辑模型</h3>
    <label class="fld"><span>上游模型名 (name)</span><input type="text" id="m_name" value="${esc(m.name)}"></label>
    <label class="fld"><span>对外别名 (alias)</span><input type="text" id="m_alias" value="${esc(m.alias||'')}" placeholder="/models 中显示的名字"></label>
    <label class="fld"><span>显示名 (可选)</span><input type="text" id="m_disp" value="${esc(m['display-name']||'')}"></label>
    <div class="btn-grid"><button class="btn full" onclick="saveModel(${i})">保存</button>
      <button class="btn sec full" onclick="closeSheet()">取消</button></div>`;
  showSheet();
}
function saveModel(i){
  MODELS[i].name=$('m_name').value.trim();
  MODELS[i].alias=$('m_alias').value.trim()||MODELS[i].name;
  const d=$('m_disp').value.trim(); if(d)MODELS[i]['display-name']=d; else delete MODELS[i]['display-name'];
  closeSheet(); renderModels(); applyModelsToSite();
}
function openCustomModelSheet(){
  $('sheetBody').innerHTML=`<h3>添加自定义模型</h3>
    <label class="fld"><span>上游模型名 (name)</span><input type="text" id="c_name" placeholder="gpt-4o-mini"></label>
    <label class="fld"><span>对外别名 (alias)</span><input type="text" id="c_alias" placeholder="留空同 name"></label>
    <div class="btn-grid"><button class="btn full" onclick="addCustomModel()">添加</button>
      <button class="btn sec full" onclick="closeSheet()">取消</button></div>`;
  showSheet();
}
function addCustomModel(){
  const n=$('c_name').value.trim(); if(!n){toast('模型名必填');return}
  const a=$('c_alias').value.trim()||n;
  MODELS.push({name:n,alias:a,_checked:false,_up:false});
  closeSheet(); renderModels(); applyModelsToSite();
}

/* ---------- 归类规则引擎 ---------- */
// 兼容 axonhub/Go 风格的内联标志：把 pattern 前缀 (?i)/(?is)/(?im) 剥离并并入 flags。
// JS RegExp 不支持整体内联标志前缀，也不支持 x(verbose)/U(ungreedy)，这里做规整。
function compileRegex(pattern, flags){
  let p = String(pattern||''); let f = String(flags||'');
  const m = p.match(/^\(\?([a-zA-Z]+)\)/);   // 仅识别最前面的 (?flags)
  if(m){
    p = p.slice(m[0].length);
    for(const ch of m[1].toLowerCase()){ if('gimsuy'.indexOf(ch)>=0 && f.indexOf(ch)<0) f+=ch; }
  }
  f = f.split('').filter((c,i,a)=>'gimsuy'.indexOf(c)>=0 && a.indexOf(c)===i).join('');
  return new RegExp(p, f);   // p 里若仍含 (?i:...) 修饰组，交给 JS 引擎按其支持度处理
}
function defaultRules(){
  // 规整型规则在前（真正改名），命中即用其别名重写；顺序即优先级
  return [
    {name:'去前缀 openai/ 等', pattern:'^[a-z0-9_.-]+/(.+)$', alias:'$1', flags:'i'},
    {name:'GPT 去日期', pattern:'^(gpt-[0-9a-z.]+(?:-[a-z]+)?)-(?:\\d{4}-\\d{2}-\\d{2}|\\d{6,8}|latest|preview)$', alias:'$1', flags:'i'},
    {name:'Claude 去日期', pattern:'^(claude-[0-9a-z.]+-[a-z]+)-\\d{6,8}$', alias:'$1', flags:'i'},
    {name:'Gemini 去 latest', pattern:'^(gemini-[0-9a-z.]+(?:-[a-z]+)*)-(?:latest|preview|exp[0-9-]*)$', alias:'$1', flags:'i'},
    {name:'通用去日期尾巴', pattern:'^(.*?)-(?:\\d{4}-\\d{2}-\\d{2}|\\d{8})$', alias:'$1', flags:'i'}
  ];
}
function classifyOne(name){
  // 链式归类：按顺序依次应用所有命中的改写规则（axonhub 式多级归并）
  let out = name;
  for(const r of RULES){
    if(!r.pattern) continue;
    let re; try{ re=compileRegex(r.pattern, r.flags) }catch(e){ continue }
    if(!re.test(out)) continue;
    if(!r.alias) continue;                       // 无别名的规则仅作匹配，不改写
    const next = out.replace(re, r.alias);
    if(next && next!==out) out = next;           // 应用改写后继续下一条
  }
  return out;
}
function renderRules(){
  const box=$('ruleList');
  if(!RULES.length){ box.innerHTML='<div class="empty">无规则</div>'; return }
  box.innerHTML=RULES.map((r,i)=>`<div class="item">
    <div class="hd"><b>${esc(r.name||'规则'+i)}</b>
      <button class="btn sec sm" onclick="moveRule(${i},-1)" style="min-width:auto;padding:4px 9px">↑</button>
      <button class="btn sec sm" onclick="moveRule(${i},1)" style="min-width:auto;padding:4px 9px">↓</button></div>
    <div class="meta"><span>正则 <code>${esc(r.pattern)}</code>${r.flags?' /'+esc(r.flags):''}</span></div>
    <div class="meta"><span>别名 ${r.alias?`<code>${esc(r.alias)}</code>`:'<i>保持原名</i>'}</span></div>
    <div class="btn-grid" style="margin-top:8px">
      <button class="btn sec sm" onclick="openRuleSheet(${i})">编辑</button>
      <button class="btn err sm" onclick="delRule(${i})">删除</button></div></div>`).join('');
}
function saveRules(){ localStorage.setItem(LS.rules, JSON.stringify(RULES)) }
function openRuleSheet(i){
  const r = i>=0?RULES[i]:{name:'',pattern:'',alias:'',flags:'i'};
  $('sheetBody').innerHTML=`<h3>${i>=0?'编辑规则':'新增规则'}</h3>
    <label class="fld"><span>规则名</span><input type="text" id="r_name" value="${esc(r.name)}" placeholder="Claude"></label>
    <label class="fld"><span>匹配正则</span><input type="text" id="r_pat" value="${esc(r.pattern)}" placeholder="claude"></label>
    <label class="fld"><span>正则 flags</span><input type="text" id="r_flags" value="${esc(r.flags||'i')}" placeholder="i"></label>
    <label class="fld"><span>目标别名（留空=保持原名，支持 $1）</span><input type="text" id="r_alias" value="${esc(r.alias||'')}" placeholder="$1"></label>
    <div class="btn-grid"><button class="btn full" onclick="saveRule(${i})">保存</button>
      <button class="btn sec full" onclick="closeSheet()">取消</button></div>`;
  showSheet();
}
function saveRule(i){
  const r={name:$('r_name').value.trim(),pattern:$('r_pat').value.trim(),flags:$('r_flags').value.trim(),alias:$('r_alias').value.trim()};
  if(!r.pattern){toast('正则必填');return}
  try{ compileRegex(r.pattern,r.flags) }catch(e){ toast('正则非法：'+e.message,3000); return }
  if(i>=0)RULES[i]=r; else RULES.push(r);
  saveRules(); closeSheet(); renderRules(); toast('已保存')
}
function delRule(i){ RULES.splice(i,1); saveRules(); renderRules() }
function moveRule(i,d){ const j=i+d; if(j<0||j>=RULES.length)return; const t=RULES[i];RULES[i]=RULES[j];RULES[j]=t; saveRules(); renderRules() }
function loadPresetRules(){ if(confirm('用预设规则覆盖当前规则？')){ RULES=defaultRules(); saveRules(); renderRules(); toast('已载入预设') } }
function exportRules(){ const s=JSON.stringify(RULES,null,2); navigator.clipboard&&navigator.clipboard.writeText(s); prompt('规则 JSON（已复制）：',s) }
function importRules(){ const s=prompt('粘贴规则 JSON：'); if(!s)return; try{ const a=JSON.parse(s); if(Array.isArray(a)){RULES=a;saveRules();renderRules();toast('已导入')} }catch(e){ toast('JSON 非法') } }
function previewRules(){
  const lines=($('ruleTest').value||'').split('\n').map(x=>x.trim()).filter(Boolean);
  if(!lines.length){ $('rulePreview').innerHTML='<div class="hint">输入模型名后预览</div>'; return }
  $('rulePreview').innerHTML=lines.map(n=>{const a=classifyOne(n);const diff=a!==n;
    return `<div class="mdl"><div class="mn"><b>${esc(a)}</b>${diff?`<small>← ${esc(n)}</small>`:'<small style="color:var(--mut)">未改</small>'}</div></div>`}).join('');
}

/* ---------- 全局设置 ---------- */
async function loadGlobalSettings(){
  try{ const st=await mgmt('/routing/strategy'); if(st&&st.strategy)$('cfgStrategy').value=st.strategy }catch(e){}
  try{ const rt=await mgmt('/request-retry'); if(rt&&rt['request-retry']!=null)$('cfgRetry').value=rt['request-retry'] }catch(e){}
}
async function saveStrategy(){ try{ await mgmt('/routing/strategy','PUT',{value:$('cfgStrategy').value}); toast('策略已保存') }catch(e){ toast('失败：'+e.message,3000) } }
async function saveRetry(){ try{ await mgmt('/request-retry','PUT',{value:parseInt($('cfgRetry').value||'0',10)}); toast('重试已保存') }catch(e){ toast('失败：'+e.message,3000) } }

/* ---------- 导航 / 弹层 ---------- */
function nav(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  $('page-'+page).classList.add('active');
  document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  if(page==='rules') renderRules();
  if(page==='models') renderMdlSiteSel();
}
function showSheet(){ $('sheet').classList.add('show') }
function closeSheet(){ $('sheet').classList.remove('show') }
$('sheet').addEventListener('click',e=>{ if(e.target.id==='sheet') closeSheet() });

/* ---------- 启动 ---------- */
loadSaved();
renderRules();
if(API.base){ connect() }
