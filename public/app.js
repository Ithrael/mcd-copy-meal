import { encodeShare, decodeShare } from './share.js';

const staticDemo = document.documentElement.dataset.hosting === 'pages' ? await import('./pages-demo.js') : null;

const $ = selector => document.querySelector(selector);
const money = cents => (cents / 100).toFixed(2).replace(/\.00$/, '');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { mode:'demo', token:'', hasServerToken:false, store:null, catalog:null, recipes:[], mustHave:[], shared:null, shareEncoded:null, verification:null, editItems:[], busy:false };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
function error(message = '', budgetRelated = false) { $('#error-message').textContent = message; $('#error-message').hidden = !message; $('#error-message').dataset.budgetRelated=String(budgetRelated); }
function busy(active, message = '正在核验菜单与价格…') {
  state.busy = active;
  $('.results').setAttribute('aria-busy',String(active));
  for (const node of document.querySelectorAll('#recipe-form button, #recipe-form input, #recipe-form select, #store-button, #connection-button, #import-recipe, #try-verification, #reprice-shared, #edit-shared, .recipe-actions button')) node.disabled = active;
  $('#generate-button').textContent = active ? message : '帮我搭一份';
}
async function api(path, body) {
  if (staticDemo) return staticDemo.demoApi(path,body);
  const headers = {};
  if (state.mode === 'demo') headers['x-demo-mode'] = '1';
  else if (state.token) headers['x-mcd-token'] = state.token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || '读取失败，请稍后重试。'), {missing:data.missing || []});
  return data;
}
function renderControls() {
  const catalog = state.catalog;
  $('#mode-label').textContent = state.mode === 'demo' ? '演示模式' : '实时模式';
  $('#connection-button').textContent = staticDemo ? '使用真实核价' : state.mode === 'demo' ? '连接麦当劳' : '连接设置';
  $('#try-verification').hidden = state.mode !== 'demo';
  $('#selected-store').innerHTML = `<span class="store-symbol" aria-hidden="true">⌖</span><span><strong>${escape(state.store?.name || '先选一家门店')}</strong><small>${escape(state.store?.address || '搜索城市和门店')}</small></span><span aria-hidden="true">⌄</span>`;
  $('#source-note').textContent = staticDemo ? '演示菜单与示例金额，不是实时价格。使用真实核价请按说明运行本地版。' : state.mode === 'demo' ? '演示菜单与示例金额。连接麦当劳账户后，可读取当前门店菜单并核验价格。' : (catalog?.source || '选定门店后，读取当前在售菜单。');
  const foods = catalog?.products.flatMap(p=>[...(p.kind!=='bundle'?[p]:[]),...(p.rounds || []).flatMap(r=>r.choices)]) || [];
  const availableNames = new Set(foods.map(p=>p.name));
  const preferred = ['main','side'].flatMap(kind=>[...new Set(foods.filter(p=>p.kind===kind).map(p=>p.name))].slice(0,4));
  const names = [...new Set([...preferred,...state.mustHave])];
  $('#must-have').innerHTML = names.map(name => `<button class="choice-chip" type="button" data-name="${escape(name)}" aria-pressed="${state.mustHave.includes(name)}">${escape(name)}${catalog && !availableNames.has(name) ? '（当前未售）' : ''}</button>`).join('');
  $('#more-food').innerHTML = '<option value="">其他餐品…</option>'+[...availableNames].filter(name=>!names.includes(name)).map(name=>`<option value="${escape(name)}">${escape(name)}</option>`).join('');
  $('#more-food').hidden = !$('#more-food').options[1];
  renderShared();
}
function renderVerification(value = state.verification) {
  state.verification = value;
  const box = $('#verification-result'); box.hidden = !value || !state.shared;
  if (box.hidden) return;
  const labels = {pending:'这份点法还未核验',loading:'正在核验这份点法',missing:'缺少餐品，暂不能原样点',unavailable:'暂时无法核验'};
  let kind = value.kind, title = labels[kind], message = value.message || (staticDemo ? '先查看具体点法，选择演示门店体验核验。真实核价请运行本地版。' : '先查看具体点法，选好你的门店再核验。真实核价需连接你的麦当劳账户。');
  if (value.recipe) {
    const recipe = value.recipe, left = Math.round(Number($('#budget').value)*100) - recipe.total;
    kind = left < 0 ? 'over' : 'ok'; title = value.modified ? '修改后的点法已核价' : '原样点法已通过核价';
    if (left < 0) title = value.modified ? '修改后仍超出预算' : '原样可核价，但超出预算';
    message = `${recipe.store.name} · ${recipe.mode==='demo'?'示例金额':'本次核价'} ¥${money(recipe.total)}${left<0?`，超出预算 ¥${money(-left)}`:''}。${value.modified?'你已修改餐品或选件，结果对应修改后的点法。':'餐品、套餐选件和份数已按这家店重新匹配。'}`;
  }
  box.dataset.kind = kind;
  box.innerHTML = `<h3>${state.mode==='demo'?'演示结果 · ':''}${escape(title)}</h3><p>${escape(message)}</p>${value.missing?.length?`<p>未找到：${value.missing.map(escape).join('、')}</p>`:''}`;
}
function renderRecipes(recipes, info = {}) {
  state.recipes = recipes;
  $('#results-title').textContent = info.verifiedShared ? '这家店的核验结果' : info.shared ? '先看点法，再核验' : '可以这样点';
  $('#result-count').textContent = recipes.length ? `${recipes.length} 份搭配` : '';
  $('#results-subtitle').textContent = info.shared ? '保留朋友的餐品和具体选件，用自己的门店重新确认。' : state.mode === 'demo' ? '演示金额，体验预算、修改和分享流程。' : info.verifiedShared ? '价格按本次账户与门店核验，朋友的优惠不会直接沿用。' : '候选搭配已逐份核价，按当前可点结果展示。';
  if (!recipes.length) {
    let description = '试试换一个预算，或减少必点餐品。';
    if (info.lowestChecked != null) description = `当前核验过的搭配最低 ¥${money(info.lowestChecked)}。你可以调整预算或搭配条件。`;
    if (info.shared) description = '先选好自己的门店，再核验朋友这份搭配。';
    if (info.chooseStore) description = '搜索城市和地址，选择你准备取餐的门店。';
    if (info.storeUnavailable) description = '门店营业时段或服务状态可能影响菜单。请稍后再试，或换一家营业中的门店。';
    $('#recipe-results').innerHTML = `<div class="empty-state"><h3>${info.storeUnavailable?'暂时无法读取这家店':info.shared?'朋友的攻略，等你来抄':info.chooseStore?'先选一家店':'这个预算暂时没有合适搭配'}</h3><p>${escape(description)}</p>${info.lowestChecked ? `<button type="button" class="secondary-button" data-new-budget="${Math.ceil(info.lowestChecked/100)}">预算调到 ${Math.ceil(info.lowestChecked/100)} 元</button>` : info.storeUnavailable?'<button type="button" class="secondary-button" data-change-store>换一家门店</button>':''}</div>`;
    return;
  }
  const budget = Number($('#budget').value) * 100;
  $('#recipe-results').innerHTML = recipes.map((recipe, index) => {
    const left = budget >= 100 && budget <= 50000 ? Math.round(budget - recipe.total) : null;
    const meta = recipe.mode === 'demo' ? '示例金额 · 未实时核验' : `官方核价 · ${new Date(recipe.checkedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}`;
    return `<article class="recipe-card ${index===0?'recommended':''}">
      <div class="recipe-topline"><span class="recipe-label">${left!==null&&left<0?'这份搭配超出预算':index===0?'优先看看这份':index===1?'换个口味':'另一份搭配'}</span><span class="recipe-meta">${meta}</span></div>
      <div class="recipe-body"><div class="recipe-title"><h3>${escape(recipe.title)}</h3><span class="price"><small>¥</small>${money(recipe.total)}</span></div>
      <div class="food-lineup">${recipe.items.map(item=>`<div class="food-tile">${item.image?`<img src="${escape(item.image)}" alt="${escape(item.name)}" width="78" height="78">`:''}<div><strong>${escape(item.name)}</strong><small>× ${item.quantity}</small></div></div>`).join('')}</div>
      ${recipe.items.some(item=>item.selections)?`<div class="order-breakdown">${recipe.items.filter(item=>item.selections).map(item=>`<div><strong>${escape(item.name)}：每份选</strong><span>${item.selections.flatMap(group=>group.items.map(row=>`${escape(row.name)} × ${row.quantity}`)).join(' ＋ ')}</span></div>`).join('')}</div>`:''}
      <div class="recipe-explanation">${left===null?'':`<span class="${left>=0?'budget-left':'missing-items'}">${left>=0?`预算还剩 ¥${money(left)}`:`超出预算 ¥${money(-left)}`}</span>`}${recipe.offer?`<span>${recipe.mode==='demo'?'示例优惠':'本账户券方案'}：${escape(recipe.offer)}</span>`:''}${recipe.discount>0?`<span>本次优惠 ¥${money(recipe.discount)}</span>`:''}</div></div>
      <div class="recipe-actions"><button type="button" class="text-button" data-action="edit" data-index="${index}">改一下搭配</button><div><button class="secondary-button" type="button" data-action="image" data-index="${index}">保存攻略图</button><button class="secondary-button share-button" type="button" data-action="share" data-index="${index}">${info.verifiedShared?'分享我的核验结果':'请朋友核验这份点法'}</button></div></div>
    </article>`;
  }).join('');
}
function options() {
  return {store:state.store,budget:$('#budget').value,mustHave:state.mustHave,includeSide:$('#with-side').checked,includeDrink:$('#with-drink').checked};
}
async function generate() {
  if (state.busy) return;
  if (!state.store) { openStores(); return; }
  error(); renderVerification(null); busy(true);
  try {
    const result = await api('/api/generate',options());
    state.catalog = result.catalog; renderControls(); renderRecipes(result.recipes,result);
    if (result.failedCount) toast(`有 ${result.failedCount} 份候选未能核价，已展示其余核验成功的结果。`);
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
  } catch (failure) { error(failure.message); }
  finally { busy(false); }
}
async function loadCatalog(store, verifyShared = false) {
  state.store = store; state.catalog = null; error(); renderVerification(state.shared?{kind:'pending'}:null); renderRecipes([],{shared:Boolean(state.shared)}); busy(true,'正在读取门店菜单…'); renderControls();
  try {
    state.catalog = await api('/api/catalog',{store}); renderControls();
  } catch (failure) { state.catalog = null; state.recipes = []; renderControls(); renderRecipes([], {storeUnavailable:true}); renderVerification({kind:'unavailable',message:failure.message}); error(failure.message); }
  finally { busy(false); }
  if (state.catalog) {
    if (state.shared && verifyShared) await repriceShared();
    else if (state.shared) renderRecipes([],{shared:true});
    else await generate();
  }
}
function renderStores(stores) {
  $('#store-list').innerHTML = stores.length ? stores.map((store,index)=>`<button type="button" class="store-option" data-store-index="${index}" ${store.isOpen===false?'disabled':''}><strong>${escape(store.name)}</strong><small>${escape(store.address)}</small>${store.hours||store.isOpen!==undefined?`<small>${store.isOpen===false?'当前未营业':store.isOpen===true?'营业中':''}${store.hours?' · '+escape(store.hours):''}</small>`:''}</button>`).join('') : '<p class="dialog-note">没有找到可用门店，试试附近的地标或另一条地址。</p>';
  $('#store-list').onclick = event => {
    const button = event.target.closest('[data-store-index]');
    if (!button) return;
    $('#store-dialog').close(); loadCatalog(stores[Number(button.dataset.storeIndex)],true);
  };
}
async function searchStores() {
  const form = $('#store-search-form');
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true; $('#store-search-note').textContent = '正在找门店…';
  try {
    const result = await api(`/api/stores?city=${encodeURIComponent($('#search-city').value.trim())}&keyword=${encodeURIComponent($('#search-keyword').value.trim())}`);
    renderStores(result.stores);
    $('#store-search-note').textContent = result.mode === 'demo' ? '下面是两家虚拟演示门店。切换门店后，示例价格会变化。' : result.stores.length && result.stores.every(store=>store.isOpen===false)?'查到的门店暂未营业，试试附近其他地标。':'选择你准备到店取餐的门店。';
  } catch (failure) { $('#store-search-note').textContent = failure.message; renderStores([]); }
  finally { submit.disabled = false; }
}
function openStores() {
  if (state.busy) return;
  $('#search-keyword').required = state.mode === 'live';
  $('#store-dialog').showModal();
  if (state.mode === 'demo') searchStores();
  else { $('#store-search-note').textContent = '输入城市和附近地标，查询可用门店。'; $('#store-list').innerHTML = ''; $('#search-city').focus(); }
}
function readShared(force = false) {
  const encoded = new URLSearchParams(location.hash.slice(1)).get('recipe');
  if (!force && encoded === state.shareEncoded) return false;
  state.shareEncoded = encoded;
  if (!encoded) { state.shared = null; document.title='麦麦抄作业 · 朋友这份点法，我这里能用吗？'; renderShared(); renderVerification(null); return true; }
  try {
    state.shared = decodeShare(encoded); $('#budget').value = state.shared.budget/100;
    document.title = `${state.shared.title} · 麦麦抄作业`;
    renderShared(); renderVerification({kind:'pending'});
  } catch (failure) { error(failure.message); state.shared = null; renderShared(); renderVerification(null); }
  return true;
}
function renderShared() {
    document.body.classList.toggle('verifying-recipe',Boolean(state.shared));
    $('#create-own-recipe').hidden = !state.shared;
    $('#shared-banner').hidden = !state.shared;
    if (!state.shared) return;
    $('#shared-banner').hidden = false;
    $('#shared-banner').innerHTML = `<div><strong>朋友的点法：${escape(state.shared.title)}</strong><p>${state.shared.items.map(i=>`${escape(i.name)} × ${i.quantity}${i.selections?`<br>每份选：${i.selections.flatMap(group=>group.items.map(row=>`${escape(row.name)} × ${row.quantity}`)).join(' ＋ ')}`:''}`).join('<br>')}<br>数量和套餐选件保留，门店价格和账户优惠重新核验。</p></div><div><button id="reprice-shared" class="primary-button" type="button" ${state.busy?'disabled':''}>${state.mode==='demo'?'按演示门店核验':'核验这家店能否照着点'}</button><button id="edit-shared" class="text-button" type="button" ${state.busy?'disabled':''}>手动替换餐品</button></div>`;
    $('#reprice-shared').onclick = repriceShared;
    $('#edit-shared').onclick = () => { if(!state.busy) openEdit(state.shared.items); };
}
async function repriceShared() {
  if (state.busy) return;
  if (!state.store) { openStores(); return; }
  error(); renderRecipes([],{shared:true}); renderVerification({kind:'loading',message:'正在检查这家店的餐品、套餐选件和本次金额…'}); busy(true,'正在核验朋友这份搭配…');
  try {
    const result = await api('/api/reprice',{store:state.store,budget:$('#budget').value,items:state.shared.items});
    state.catalog = result.catalog; renderControls(); renderRecipes([result.recipe],{verifiedShared:true}); renderVerification({kind:'checked',recipe:result.recipe});
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
    if (result.overBudget) error(`换到这家店后，金额超出预算 ¥${money(result.recipe.total-result.budget)}。可以修改搭配或调整预算。`,true);
    else toast('已按你选的门店重新计价。');
  } catch (failure) { renderVerification({kind:failure.missing?.length?'missing':'unavailable',message:failure.message,missing:failure.missing}); }
  finally { busy(false); }
}
function openEdit(items) {
  if (!state.catalog) { toast('请先选好门店并读取菜单。'); return; }
  state.editItems = items.map(i=>({name:i.name,quantity:i.quantity,...(i.selections?{selections:structuredClone(i.selections)}:{})}));
  $('#edit-error').hidden = true;
  $('#edit-items').innerHTML = state.editItems.map((item,index)=>{
    const product = state.catalog.products.find(p=>p.name===item.name);
    const pool = product ? state.catalog.products.filter(p=>p.kind===product.kind) : state.catalog.products;
    return `<div class="edit-block"><div class="edit-item"><label>餐品 ${index+1}<select data-edit-name="${index}" required>${!product?`<option value="" selected disabled>${escape(item.name)}（当前未售）</option>`:''}${pool.map(p=>`<option value="${escape(p.name)}" ${p.name===item.name?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label><label>份数<input type="number" min="1" max="8" step="1" value="${item.quantity}" data-edit-quantity="${index}" required></label></div><div class="edit-groups" data-edit-groups="${index}"></div></div>`;
  }).join('');
  state.editItems.forEach((_,index)=>renderEditGroups(index));
  $('#edit-dialog').showModal();
}
function renderEditGroups(index) {
  const item = state.editItems[index];
  const product = state.catalog.products.find(p=>p.name===$(`[data-edit-name="${index}"]`).value);
  $(`[data-edit-groups="${index}"]`).innerHTML = (product?.rounds || []).map((round,roundIndex)=>{
    const old = item.selections?.[roundIndex];
    const chosen = old?.name===round.name ? old.items.flatMap(row=>Array(row.quantity).fill(row.name)) : item.selections?[]:round.choices.flatMap(choice=>Array(choice.defaultQuantity || 0).fill(choice.name));
    return `<fieldset><legend>${escape(round.name)} · 每份选 ${round.min===round.max?round.min:`${round.min}～${round.max}`} 项</legend>${Array.from({length:round.max},(_,slot)=>{
      const current = chosen[slot] || '';
      const missing = current && !round.choices.some(choice=>choice.name===current);
      return `<label><span class="sr-only">${escape(round.name)}第 ${slot+1} 项</span><select data-edit-parent="${index}" data-edit-round="${roundIndex}" ${slot<round.min?'required':''}><option value="" ${!current?'selected':''}>${slot<round.min?'请选择餐品':'不加这一项'}</option>${missing?`<option value="" selected disabled>${escape(current)}（当前未售）</option>`:''}${round.choices.map(choice=>`<option value="${escape(choice.name)}" ${choice.name===current?'selected':''}>${escape(choice.name)}${choice.extraCents?`（${choice.extraCents>0?'+':'−'}¥${money(Math.abs(choice.extraCents))} 菜单加价）`:''}</option>`).join('')}</select></label>`;
    }).join('')}</fieldset>`;
  }).join('');
}
$('#edit-items').onchange=event=>{
  const select=event.target.closest('[data-edit-name]');
  if(!select)return;
  const index=Number(select.dataset.editName);state.editItems[index]={name:select.value,quantity:state.editItems[index].quantity};renderEditGroups(index);
};
async function submitEdit() {
  const items = state.editItems.map((item,index)=>{
    const name=$(`[data-edit-name="${index}"]`).value;
    const product=state.catalog.products.find(p=>p.name===name);
    const selections=(product?.rounds || []).map((round,roundIndex)=>{
      const quantities=new Map();
      for(const select of document.querySelectorAll(`[data-edit-parent="${index}"][data-edit-round="${roundIndex}"]`))if(select.value)quantities.set(select.value,(quantities.get(select.value)||0)+1);
      return {name:round.name,items:[...quantities].map(([name,quantity])=>({name,quantity}))};
    });
    return {name,quantity:Number($(`[data-edit-quantity="${index}"]`).value),...(selections.length?{selections}:{})};
  });
  $('#edit-submit').disabled = true; $('#edit-error').hidden = true;
  renderRecipes([],{shared:Boolean(state.shared)}); renderVerification(state.shared?{kind:'loading',message:'正在核验修改后的点法…'}:null);
  try {
    const result = await api('/api/reprice',{store:state.store,budget:$('#budget').value,items});
    state.catalog = result.catalog; renderControls(); renderRecipes([result.recipe],{verifiedShared:Boolean(state.shared)}); renderVerification(state.shared?{kind:'checked',recipe:result.recipe,modified:true}:null);
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
    $('#edit-dialog').close(); error();
    if (result.overBudget) error(`修改后超出预算 ¥${money(result.recipe.total-result.budget)}，请再调整搭配或预算。`,true);
    else toast('搭配已修改，金额已重新计算。');
  } catch (failure) { $('#edit-error').textContent = failure.message; $('#edit-error').hidden = false; renderVerification({kind:failure.missing?.length?'missing':'unavailable',message:failure.message,missing:failure.missing}); }
  finally { $('#edit-submit').disabled = false; }
}
function shareURL(recipe) {
  const encoded = encodeShare({v:2,title:recipe.title,budget:Math.round(Number($('#budget').value)*100),items:recipe.items});
  const link = new URL('./',location.href); link.hash = 'recipe=' + encoded; return link.href;
}
const localPreview = () => ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
const offerNote = recipe => recipe.mode==='demo' ? '示例优惠，仅供体验。' : '本账户可用券参与核价，朋友需确认自己也有适用券。';
async function share(recipe) {
  try {
    if (!$('#budget').reportValidity()) return;
    const url = shareURL(recipe);
    const text = [`这份点法，你那里能用吗？｜麦麦抄作业`,recipe.title,`${recipe.mode==='demo'?'示例金额':'本店核价'} ¥${money(recipe.total)} · ${recipe.store.name}`,`${recipe.mode==='demo'?'演示生成时间':'核验时间'}：${new Date(recipe.checkedAt).toLocaleString('zh-CN',{hour12:false})}`,...recipe.items.map(item=>`${item.name} × ${item.quantity}${item.selections?'\n每份选：'+item.selections.flatMap(group=>group.items.map(row=>`${row.name} × ${row.quantity}`)).join(' ＋ '):''}`),...(recipe.offer?[offerNote(recipe)]:[]),staticDemo?'打开链接，在演示门店体验换店流程。真实核价请运行本地版。':'打开链接，保留这份点法，按你自己的门店和账户重新核价。'].join('\n');
    if (navigator.share) await navigator.share({title:'麦麦抄作业',text,url});
    else if (navigator.clipboard) { await navigator.clipboard.writeText(`${text}\n${url}`); toast(localPreview()?'点法和本地链接已复制；部署网站后，朋友才能打开。':'点法和攻略链接已复制，发给朋友就能复用。'); }
    else { const area=document.createElement('textarea');area.value=`${text}\n${url}`;document.body.append(area);area.select();document.execCommand('copy');area.remove();toast('点法和攻略链接已复制。'); }
  } catch (failure) { if (failure.name !== 'AbortError') { error('分享失败，请重试；也可以先保存攻略图。'); } }
}
function loadImage(src) {
  if (src.startsWith('https://menu-img.mcd.cn/')) src = `/api/image?url=${encodeURIComponent(src)}`;
  return new Promise(resolve=>{const image=new Image();image.crossOrigin='anonymous';image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=src;});
}
function wrapText(ctx, text, width) {
  const lines=[];let current='';
  for(const char of text) { if(ctx.measureText(current+char).width>width && current){lines.push(current);current=char;}else current+=char; }
  if(current)lines.push(current);return lines;
}
async function saveImage(recipe, button) {
  if (!$('#budget').reportValidity()) return;
  button.disabled=true;button.textContent='正在生成';
  try {
    const font='"PingFang SC", "Microsoft YaHei", sans-serif';
    const canvas=document.createElement('canvas');canvas.width=1080;const ctx=canvas.getContext('2d');ctx.font=`24px ${font}`;
    const selectionLines=recipe.items.map(item=>item.selections?wrapText(ctx,'每份选：'+item.selections.flatMap(group=>group.items.map(row=>`${row.name} × ${row.quantity}`)).join(' ＋ '),600):[]);
    const rowHeights=selectionLines.map(lines=>Math.max(170,lines.length?160+lines.length*32:170));
    const note=[staticDemo?'演示餐品与金额，不是实时价格。扫码进入在线演示，真实核价请运行本地版。':localPreview()?'当前二维码指向本机预览，朋友访问前需部署网站。':'餐品、优惠和金额以所选门店当前核验结果为准。',...(recipe.offer?[offerNote(recipe)]:[])].join(' ');
    ctx.font=`22px ${font}`;const noteLines=wrapText(ctx,note,590);
    const originTop=Math.max(260,170+noteLines.length*34+25);
    const width=1080,height=490+rowHeights.reduce((a,b)=>a+b,0)+Math.max(430,originTop+100);canvas.height=height;
    ctx.fillStyle='#f6f7f8';ctx.fillRect(0,0,width,height);ctx.fillStyle='#ffffff';ctx.fillRect(55,45,970,height-90);
    ctx.fillStyle='#d9252a';ctx.fillRect(55,45,970,15);ctx.font=`bold 38px ${font}`;ctx.fillText('麦麦抄作业 · 你那里能用吗？',100,125);
    ctx.fillStyle='#29241e';ctx.font=`bold 52px ${font}`;ctx.fillText(recipe.title,100,215);
    ctx.fillStyle='#d9252a';ctx.font='bold 94px Arial';ctx.fillText(`¥${money(recipe.total)}`,100,335);
    ctx.fillStyle='#716d67';ctx.font=`27px ${font}`;ctx.fillText(recipe.mode==='demo'?'示例金额 · 非实时价格':'麦当劳官方实时核价',100,390);
    const storeLines=wrapText(ctx,recipe.store.name,860);storeLines.slice(0,2).forEach((line,index)=>ctx.fillText(line,100,440+index*35));
    const [images,qr]=await Promise.all([Promise.all(recipe.items.map(item=>item.image?loadImage(item.image):null)),staticDemo?staticDemo.qrDataUrl(shareURL(recipe)).then(loadImage):loadImage(`/api/qr?url=${encodeURIComponent(shareURL(recipe))}`)]);
    if(!qr)throw new Error('二维码生成失败。');
    recipe.items.forEach((item,index)=>{
      const top=490+rowHeights.slice(0,index).reduce((a,b)=>a+b,0);ctx.strokeStyle='#e5e7eb';ctx.beginPath();ctx.moveTo(100,top);ctx.lineTo(980,top);ctx.stroke();
      if(images[index])ctx.drawImage(images[index],100,top+15,130,130);
      ctx.fillStyle='#29241e';ctx.font=`bold 31px ${font}`;wrapText(ctx,item.name,570).slice(0,2).forEach((line,i)=>ctx.fillText(line,255,top+65+i*38));
      ctx.fillStyle='#716d67';ctx.font=`28px ${font}`;ctx.fillText(`× ${item.quantity}`,875,top+76);
      if(item.selections){ctx.font=`24px ${font}`;selectionLines[index].forEach((line,i)=>ctx.fillText(line,255,top+130+i*32));}
    });
    const bottom=490+rowHeights.reduce((a,b)=>a+b,0);ctx.fillStyle='#ffc72c';ctx.fillRect(100,bottom+5,880,64);ctx.fillStyle='#29241e';ctx.font=`bold 28px ${font}`;ctx.fillText(staticDemo?'扫码体验：换一家演示门店看看结果。':localPreview()?'本地预览 · 部署网站后即可扫码核验':'扫码核验：这份点法，在你这家店能用吗？',128,bottom+47);
    ctx.drawImage(qr,750,bottom+85,230,230);
    ctx.fillStyle='#716d67';ctx.font=`22px ${font}`;ctx.fillText(`${recipe.mode==='demo'?'演示生成时间':'核验时间'}：${new Date(recipe.checkedAt).toLocaleString('zh-CN',{hour12:false})}`,100,bottom+125);
    noteLines.forEach((line,index)=>ctx.fillText(line,100,bottom+170+index*34));
    ctx.font=`20px ${font}`;wrapText(ctx,new URL('./',location.href).href,590).slice(0,2).forEach((line,index)=>ctx.fillText(line,100,bottom+originTop+index*28));
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图片生成失败。')),'image/png'));
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`麦麦抄作业-${recipe.title}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast(localPreview()?'攻略图已保存，二维码目前指向本地预览。':'带二维码的攻略图已保存，朋友扫码就能复用。');
  } catch { error('攻略图生成失败，请重试或分享攻略链接。'); }
  finally {button.disabled=false;button.textContent='保存攻略图';}
}

$('#recipe-form').onsubmit=event=>{event.preventDefault();generate();};
function toggleMustHave(name){if(state.busy)return;if(state.mustHave.includes(name))state.mustHave=state.mustHave.filter(n=>n!==name);else if(state.mustHave.length<5)state.mustHave.push(name);else{toast('最多选择 5 种必点餐品。');return;}renderControls();}
$('#must-have').onclick=event=>{const button=event.target.closest('[data-name]');if(button)toggleMustHave(button.dataset.name);};
$('#more-food').onchange=event=>{if(event.target.value)toggleMustHave(event.target.value);};
$('.budget-presets').onclick=event=>{const button=event.target.closest('[data-budget]');if(!button)return;$('#budget').value=button.dataset.budget;budgetChanged();};
function updatePreset(){document.querySelectorAll('[data-budget]').forEach(b=>b.classList.toggle('active',Number(b.dataset.budget)===Number($('#budget').value)));}
function budgetChanged(){updatePreset();if(state.recipes.length)renderRecipes(state.recipes,{verifiedShared:Boolean(state.verification?.recipe)});renderVerification();if($('#error-message').dataset.budgetRelated==='true')error();}
$('#budget').oninput=budgetChanged;
$('#store-button').onclick=openStores;$('#selected-store').onclick=openStores;
$('#store-search-form').onsubmit=event=>{event.preventDefault();searchStores();};
$('.recipe-results').onclick=event=>{
  if(event.target.closest('[data-change-store]')){openStores();return;}
  const budgetButton=event.target.closest('[data-new-budget]');if(budgetButton){$('#budget').value=budgetButton.dataset.newBudget;updatePreset();generate();return;}
  const button=event.target.closest('[data-action]');if(!button||state.busy)return;const recipe=state.recipes[Number(button.dataset.index)];
  if(button.dataset.action==='edit')openEdit(recipe.items);if(button.dataset.action==='share')share(recipe);if(button.dataset.action==='image')saveImage(recipe,button);
};
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#edit-form').onsubmit=event=>{event.preventDefault();submitEdit();};
$('#connection-button').onclick=()=>{$('#connection-dialog').showModal();if(!staticDemo)$('#token').focus();};
$('#connection-form').onsubmit=async event=>{
  if(staticDemo){event.preventDefault();return;}
  event.preventDefault();const token=$('#token').value.trim();if(!token&&!state.hasServerToken){toast('请填写 Token，或选择演示模式。');return;}
  state.token=token;state.mode='live';state.store=null;state.catalog=null;state.mustHave=[];$('#token').value='';$('#connection-dialog').close();renderControls();renderRecipes([],{chooseStore:true});renderVerification(state.shared?{kind:'pending'}:null);error();openStores();
};
$('#demo-button').onclick=async()=>{state.mode='demo';state.token='';$('#token').value='';state.mustHave=[];$('#connection-dialog').close();const data=await api('/api/stores');await loadCatalog(data.stores[0]);};
$('#import-recipe').onclick=()=>{$('#import-error').hidden=true;$('#recipe-link').value='';$('#import-dialog').showModal();$('#recipe-link').focus();};
$('#create-own-recipe').onclick=()=>{if(state.busy)return;history.replaceState(null,'',location.pathname+location.search);readShared();renderControls();error();generate();};
$('#import-form').onsubmit=event=>{
  event.preventDefault();
  try {
    const text=$('#recipe-link').value.trim(), link=text.match(/https?:\/\/\S+/g)?.find(value=>value.includes('#recipe='));
    if(!link)throw new Error('请粘贴麦麦抄作业的分享链接，链接中应包含 #recipe=。');
    const encoded=new URLSearchParams(new URL(link).hash.slice(1)).get('recipe');
    const shared=decodeShare(encoded);location.hash='recipe='+encodeShare(shared);readShared(true);updatePreset();renderRecipes([],{shared:true});error();$('#import-dialog').close();
  }catch(failure){$('#import-error').textContent=failure.message;$('#import-error').hidden=false;}
};
$('#try-verification').onclick=async()=>{
  if(state.busy||state.mode!=='demo')return;
  location.hash='recipe='+encodeShare({v:2,title:'麦香鸡套餐点法',budget:3000,items:[{name:'麦香鸡套餐',quantity:1,selections:[{name:'主食',items:[{name:'麦香鸡',quantity:1}]},{name:'小食',items:[{name:'薯条',quantity:1}]},{name:'饮料',items:[{name:'可乐',quantity:1}]}]}]});
  readShared(true);updatePreset();
  try{const data=await api('/api/stores');await loadCatalog(data.stores.at(-1),true);}catch(failure){error(failure.message);}
};
window.addEventListener('hashchange',()=>{if(readShared()){updatePreset();renderRecipes([],{shared:Boolean(state.shared)});}});
async function boot(){
  try {
    if(staticDemo){$('#hosting-note').hidden=false;$('#live-connection-fields').hidden=true;$('#token').disabled=true;$('#pages-connection-note').hidden=false;$('#connection-title').textContent='使用真实核价';$('#demo-button').textContent='继续体验演示';$('.results-footnote').textContent='当前网页只展示示例流程。真实门店、账户优惠和价格，请在本地版核验。';}
    const status=staticDemo?await staticDemo.demoApi('/api/status'):await fetch('/api/status').then(r=>r.json());state.hasServerToken=status.hasServerToken;state.mode=status.mode;readShared();updatePreset();renderControls();
    if(state.mode==='live'){renderRecipes([],{chooseStore:true});$('.results').setAttribute('aria-busy','false');openStores();}
    else{const data=await api('/api/stores');await loadCatalog(data.stores[0]);}
  }catch(failure){error(failure.message);$('.results').setAttribute('aria-busy','false');$('#recipe-results').innerHTML='<div class="empty-state"><h3>暂时无法读取菜单</h3><p>请检查服务是否启动，再刷新页面。</p></div>';}
}
boot();
