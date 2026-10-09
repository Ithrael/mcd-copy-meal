import { encodeShare, decodeShare } from './share.js';

const $ = selector => document.querySelector(selector);
const money = cents => (cents / 100).toFixed(2).replace(/\.00$/, '');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { mode:'demo', token:'', hasServerToken:false, store:null, catalog:null, recipes:[], mustHave:[], shared:null, editItems:[], busy:false };
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
function error(message = '') { $('#error-message').textContent = message; $('#error-message').hidden = !message; }
function busy(active, message = '正在核验菜单与价格…') {
  state.busy = active;
  $('.results').setAttribute('aria-busy',String(active));
  for (const node of document.querySelectorAll('#recipe-form button, #recipe-form input, #store-button, #connection-button, .recipe-actions button')) node.disabled = active;
  $('#generate-button').textContent = active ? message : '帮我搭一份';
}
async function api(path, body) {
  const headers = {};
  if (state.mode === 'demo') headers['x-demo-mode'] = '1';
  else if (state.token) headers['x-mcd-token'] = state.token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '读取失败，请稍后重试。');
  return data;
}
function renderControls() {
  const catalog = state.catalog;
  $('#mode-label').textContent = state.mode === 'demo' ? '演示模式' : '实时模式';
  $('#connection-button').textContent = state.mode === 'demo' ? '连接麦当劳' : '连接设置';
  $('#selected-store').innerHTML = `<span class="store-symbol" aria-hidden="true">⌖</span><span><strong>${escape(state.store?.name || '先选一家门店')}</strong><small>${escape(state.store?.address || '搜索城市和门店')}</small></span><span aria-hidden="true">⌄</span>`;
  $('#source-note').textContent = state.mode === 'demo' ? '演示菜单与示例金额。连接麦当劳账户后，可读取当前门店菜单并核验价格。' : (catalog?.source || '选定门店后，读取当前在售菜单。');
  const names = [...new Set([...(catalog?.products.filter(p=>p.kind !== 'drink').slice(0,8).map(p=>p.name) || []),...state.mustHave])];
  $('#must-have').innerHTML = names.map(name => `<button class="choice-chip" type="button" data-name="${escape(name)}" aria-pressed="${state.mustHave.includes(name)}">${escape(name)}${catalog && !catalog.products.some(p=>p.name===name) ? '（当前未售）' : ''}</button>`).join('');
}
function renderRecipes(recipes, info = {}) {
  state.recipes = recipes;
  $('#result-count').textContent = recipes.length ? `${recipes.length} 份搭配` : '';
  $('#results-subtitle').textContent = state.mode === 'demo' ? '演示金额，体验预算、修改和分享流程。' : '候选搭配已逐份核价，按当前可点结果展示。';
  if (!recipes.length) {
    let description = '试试换一个预算，或减少必点餐品。';
    if (info.lowestChecked != null) description = `当前核验过的搭配最低 ¥${money(info.lowestChecked)}。你可以调整预算或搭配条件。`;
    if (info.shared) description = '先选好自己的门店，再核验朋友这份搭配。';
    if (info.chooseStore) description = '搜索城市和地址，选择你准备取餐的门店。';
    $('#recipe-results').innerHTML = `<div class="empty-state"><h3>${info.shared?'朋友的攻略，等你来抄':info.chooseStore?'先选一家店':'这个预算暂时没有合适搭配'}</h3><p>${escape(description)}</p>${info.lowestChecked ? `<button type="button" class="secondary-button" data-new-budget="${Math.ceil(info.lowestChecked/100)}">预算调到 ${Math.ceil(info.lowestChecked/100)} 元</button>` : ''}</div>`;
    return;
  }
  const budget = Number($('#budget').value) * 100;
  $('#recipe-results').innerHTML = recipes.map((recipe, index) => {
    const left = Math.round(budget - recipe.total);
    const meta = recipe.mode === 'demo' ? '示例金额 · 未实时核验' : '官方实时核价';
    return `<article class="recipe-card ${index===0?'recommended':''}">
      <div class="recipe-topline"><span class="recipe-label">${left<0?'这份搭配超出预算':index===0?'优先看看这份':index===1?'换个口味':'另一份搭配'}</span><span class="recipe-meta">${meta}</span></div>
      <div class="recipe-body"><div class="recipe-title"><h3>${escape(recipe.title)}</h3><span class="price"><small>¥</small>${money(recipe.total)}</span></div>
      <div class="food-lineup">${recipe.items.map(item=>`<div class="food-tile">${item.image?`<img src="${escape(item.image)}" alt="${escape(item.name)}" width="78" height="78">`:''}<div><strong>${escape(item.name)}</strong><small>× ${item.quantity}</small></div></div>`).join('')}</div>
      <div class="recipe-explanation"><span class="${left>=0?'budget-left':'missing-items'}">${left>=0?`预算还剩 ¥${money(left)}`:`超出预算 ¥${money(-left)}`}</span>${recipe.offer?`<span>${escape(recipe.offer)}</span>`:''}${recipe.discount>0?`<span>本次优惠 ¥${money(recipe.discount)}</span>`:''}</div></div>
      <div class="recipe-actions"><button type="button" class="text-button" data-action="edit" data-index="${index}">改一下搭配</button><div><button class="secondary-button" type="button" data-action="image" data-index="${index}">保存攻略图</button><button class="secondary-button share-button" type="button" data-action="share" data-index="${index}">分享这份作业</button></div></div>
    </article>`;
  }).join('');
}
function options() {
  return {store:state.store,budget:$('#budget').value,mustHave:state.mustHave,includeSide:$('#with-side').checked,includeDrink:$('#with-drink').checked};
}
async function generate() {
  if (state.busy) return;
  if (!state.store) { openStores(); return; }
  error(); busy(true);
  try {
    const result = await api('/api/generate',options());
    state.catalog = result.catalog; renderControls(); renderRecipes(result.recipes,result);
    if (result.failedCount) toast(`有 ${result.failedCount} 份候选未能核价，已展示其余核验成功的结果。`);
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
  } catch (failure) { error(failure.message); }
  finally { busy(false); }
}
async function loadCatalog(store) {
  state.store = store; error(); busy(true,'正在读取门店菜单…'); renderControls();
  try {
    state.catalog = await api('/api/catalog',{store}); renderControls();
  } catch (failure) { state.catalog = null; state.recipes = []; renderRecipes([], {chooseStore:true}); error(failure.message); }
  finally { busy(false); }
  if (state.catalog) {
    if (state.shared) renderRecipes([],{shared:true});
    else await generate();
  }
}
function renderStores(stores) {
  $('#store-list').innerHTML = stores.length ? stores.map((store,index)=>`<button type="button" class="store-option" data-store-index="${index}"><strong>${escape(store.name)}</strong><small>${escape(store.address)}</small></button>`).join('') : '<p class="dialog-note">没有找到可用门店，试试附近的地标或另一条地址。</p>';
  $('#store-list').onclick = event => {
    const button = event.target.closest('[data-store-index]');
    if (!button) return;
    $('#store-dialog').close(); loadCatalog(stores[Number(button.dataset.storeIndex)]);
  };
}
async function searchStores() {
  const form = $('#store-search-form');
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true; $('#store-search-note').textContent = '正在找门店…';
  try {
    const result = await api(`/api/stores?city=${encodeURIComponent($('#search-city').value.trim())}&keyword=${encodeURIComponent($('#search-keyword').value.trim())}`);
    renderStores(result.stores);
    $('#store-search-note').textContent = result.mode === 'demo' ? '下面是两家虚拟演示门店。切换门店后，示例价格会变化。' : '选择你准备到店取餐的门店。';
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
function readShared() {
  const encoded = new URLSearchParams(location.hash.slice(1)).get('recipe');
  if (!encoded) { state.shared = null; $('#shared-banner').hidden = true; return; }
  try {
    state.shared = decodeShare(encoded); $('#budget').value = state.shared.budget/100;
    document.title = `${state.shared.title} · 麦麦抄作业`;
    $('#shared-banner').hidden = false;
    $('#shared-banner').innerHTML = `<div><strong>朋友分享的作业：${escape(state.shared.title)}</strong><p>${state.shared.items.map(i=>`${escape(i.name)} × ${i.quantity}`).join(' ＋ ')}<br>按你自己的门店重新计价，再决定怎么点。</p></div><div><button id="reprice-shared" class="primary-button" type="button">按我的门店重算</button><button id="edit-shared" class="text-button" type="button">手动替换餐品</button></div>`;
    $('#reprice-shared').onclick = repriceShared;
    $('#edit-shared').onclick = () => { if(!state.busy) openEdit(state.shared.items); };
  } catch (failure) { error(failure.message); $('#shared-banner').hidden = true; state.shared = null; }
}
async function repriceShared() {
  if (state.busy) return;
  if (!state.store) { openStores(); return; }
  error(); busy(true,'正在核验朋友这份搭配…');
  try {
    const result = await api('/api/reprice',{store:state.store,budget:$('#budget').value,items:state.shared.items});
    state.catalog = result.catalog; renderControls(); renderRecipes([result.recipe]);
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
    if (result.overBudget) error(`换到这家店后，金额超出预算 ¥${money(result.recipe.total-result.budget)}。可以修改搭配或调整预算。`);
    else toast('已按你选的门店重新计价。');
  } catch (failure) { error(failure.message); }
  finally { busy(false); }
}
function openEdit(items) {
  if (!state.catalog) { toast('请先选好门店并读取菜单。'); return; }
  state.editItems = items.map(i=>({name:i.name,quantity:i.quantity}));
  $('#edit-error').hidden = true;
  $('#edit-items').innerHTML = state.editItems.map((item,index)=>{
    const product = state.catalog.products.find(p=>p.name===item.name);
    const pool = product ? state.catalog.products.filter(p=>p.kind===product.kind) : state.catalog.products;
    return `<div class="edit-item"><label>餐品 ${index+1}<select data-edit-name="${index}" required>${!product?`<option value="" selected disabled>${escape(item.name)}（当前未售）</option>`:''}${pool.map(p=>`<option value="${escape(p.name)}" ${p.name===item.name?'selected':''}>${escape(p.name)}</option>`).join('')}</select></label><label>份数<input type="number" min="1" max="8" step="1" value="${item.quantity}" data-edit-quantity="${index}" required></label></div>`;
  }).join('');
  $('#edit-dialog').showModal();
}
async function submitEdit() {
  const items = state.editItems.map((item,index)=>({name:$(`[data-edit-name="${index}"]`).value,quantity:Number($(`[data-edit-quantity="${index}"]`).value)}));
  $('#edit-submit').disabled = true; $('#edit-error').hidden = true;
  try {
    const result = await api('/api/reprice',{store:state.store,budget:$('#budget').value,items});
    state.catalog = result.catalog; renderControls(); renderRecipes([result.recipe]);
    if (result.warnings?.length) $('#source-note').textContent += ' ' + result.warnings.join(' ');
    $('#edit-dialog').close(); error();
    if (result.overBudget) error(`修改后超出预算 ¥${money(result.recipe.total-result.budget)}，请再调整搭配或预算。`);
    else toast('搭配已修改，金额已重新计算。');
  } catch (failure) { $('#edit-error').textContent = failure.message; $('#edit-error').hidden = false; }
  finally { $('#edit-submit').disabled = false; }
}
function shareURL(recipe) {
  const encoded = encodeShare({v:1,title:recipe.title,budget:Math.round(Number($('#budget').value)*100),items:recipe.items});
  return `${location.origin}/#recipe=${encoded}`;
}
const localPreview = () => ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
async function share(recipe) {
  const url = shareURL(recipe);
  const text = `${recipe.title}，按自己的门店重算后就能照着点。`;
  try {
    if (navigator.share) await navigator.share({title:'麦麦抄作业',text,url});
    else if (navigator.clipboard) { await navigator.clipboard.writeText(url); toast(localPreview()?'本地预览链接已复制；部署网站后，朋友才能打开。':'攻略链接已复制，发给朋友就能复用。'); }
    else { const area=document.createElement('textarea');area.value=url;document.body.append(area);area.select();document.execCommand('copy');area.remove();toast('攻略链接已复制。'); }
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
  button.disabled=true;button.textContent='正在生成';
  try {
    const width=1080,height=920+recipe.items.length*170;
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');
    const font='"PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillStyle='#f6f7f8';ctx.fillRect(0,0,width,height);ctx.fillStyle='#ffffff';ctx.fillRect(55,45,970,height-90);
    ctx.fillStyle='#d9252a';ctx.fillRect(55,45,970,15);ctx.font=`bold 38px ${font}`;ctx.fillText('麦麦抄作业',100,125);
    ctx.fillStyle='#29241e';ctx.font=`bold 52px ${font}`;ctx.fillText(recipe.title,100,215);
    ctx.fillStyle='#d9252a';ctx.font='bold 94px Arial';ctx.fillText(`¥${money(recipe.total)}`,100,335);
    ctx.fillStyle='#716d67';ctx.font=`27px ${font}`;ctx.fillText(recipe.mode==='demo'?'示例金额 · 非实时价格':'麦当劳官方实时核价',100,390);
    const storeLines=wrapText(ctx,recipe.store.name,860);storeLines.slice(0,2).forEach((line,index)=>ctx.fillText(line,100,440+index*35));
    const [images,qr]=await Promise.all([Promise.all(recipe.items.map(item=>item.image?loadImage(item.image):null)),loadImage(`/api/qr?url=${encodeURIComponent(shareURL(recipe))}`)]);
    if(!qr)throw new Error('二维码生成失败。');
    recipe.items.forEach((item,index)=>{
      const top=490+index*170;ctx.strokeStyle='#e5e7eb';ctx.beginPath();ctx.moveTo(100,top);ctx.lineTo(980,top);ctx.stroke();
      if(images[index])ctx.drawImage(images[index],100,top+15,130,130);
      ctx.fillStyle='#29241e';ctx.font=`bold 31px ${font}`;wrapText(ctx,item.name,570).slice(0,2).forEach((line,i)=>ctx.fillText(line,255,top+65+i*38));
      ctx.fillStyle='#716d67';ctx.font=`28px ${font}`;ctx.fillText(`× ${item.quantity}`,875,top+76);
    });
    const bottom=490+recipe.items.length*170;ctx.fillStyle='#ffc72c';ctx.fillRect(100,bottom+5,880,64);ctx.fillStyle='#29241e';ctx.font=`bold 28px ${font}`;ctx.fillText(localPreview()?'本地预览 · 部署网站后即可扫码复用':'扫码抄作业，按你自己的门店重新计价。',128,bottom+47);
    ctx.drawImage(qr,750,bottom+85,230,230);
    ctx.fillStyle='#716d67';ctx.font=`22px ${font}`;ctx.fillText(`核验时间：${new Date(recipe.checkedAt).toLocaleString('zh-CN',{hour12:false})}`,100,bottom+125);
    const note=localPreview()?'当前二维码指向本机预览，朋友访问前需部署网站。':'餐品、优惠和金额以所选门店当前核验结果为准。';
    wrapText(ctx,note,590).forEach((line,index)=>ctx.fillText(line,100,bottom+170+index*34));
    ctx.font=`20px ${font}`;wrapText(ctx,location.origin,590).slice(0,2).forEach((line,index)=>ctx.fillText(line,100,bottom+260+index*28));
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('图片生成失败。')),'image/png'));
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`麦麦抄作业-${recipe.title}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast(localPreview()?'攻略图已保存，二维码目前指向本地预览。':'带二维码的攻略图已保存，朋友扫码就能复用。');
  } catch { error('攻略图生成失败，请重试或分享攻略链接。'); }
  finally {button.disabled=false;button.textContent='保存攻略图';}
}

$('#recipe-form').onsubmit=event=>{event.preventDefault();generate();};
$('#must-have').onclick=event=>{const button=event.target.closest('[data-name]');if(!button||state.busy)return;const name=button.dataset.name;if(state.mustHave.includes(name))state.mustHave=state.mustHave.filter(n=>n!==name);else if(state.mustHave.length<5)state.mustHave.push(name);else{toast('最多选择 5 种必点餐品。');return;}renderControls();};
$('.budget-presets').onclick=event=>{const button=event.target.closest('[data-budget]');if(!button)return;$('#budget').value=button.dataset.budget;updatePreset();};
function updatePreset(){document.querySelectorAll('[data-budget]').forEach(b=>b.classList.toggle('active',Number(b.dataset.budget)===Number($('#budget').value)));}
$('#budget').oninput=updatePreset;
$('#store-button').onclick=openStores;$('#selected-store').onclick=openStores;
$('#store-search-form').onsubmit=event=>{event.preventDefault();searchStores();};
$('.recipe-results').onclick=event=>{
  const budgetButton=event.target.closest('[data-new-budget]');if(budgetButton){$('#budget').value=budgetButton.dataset.newBudget;updatePreset();generate();return;}
  const button=event.target.closest('[data-action]');if(!button||state.busy)return;const recipe=state.recipes[Number(button.dataset.index)];
  if(button.dataset.action==='edit')openEdit(recipe.items);if(button.dataset.action==='share')share(recipe);if(button.dataset.action==='image')saveImage(recipe,button);
};
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
$('#edit-form').onsubmit=event=>{event.preventDefault();submitEdit();};
$('#connection-button').onclick=()=>{$('#connection-dialog').showModal();$('#token').focus();};
$('#connection-form').onsubmit=async event=>{
  event.preventDefault();const token=$('#token').value.trim();if(!token&&!state.hasServerToken){toast('请填写 Token，或选择演示模式。');return;}
  state.token=token;state.mode='live';state.store=null;state.catalog=null;state.mustHave=[];$('#token').value='';$('#connection-dialog').close();renderControls();renderRecipes([],{chooseStore:true});error();openStores();
};
$('#demo-button').onclick=async()=>{state.mode='demo';state.token='';$('#token').value='';state.mustHave=[];$('#connection-dialog').close();const data=await api('/api/stores');await loadCatalog(data.stores[0]);};
window.addEventListener('hashchange',()=>{readShared();updatePreset();if(state.shared)renderRecipes([],{shared:true});});
async function boot(){
  try {
    const status=await fetch('/api/status').then(r=>r.json());state.hasServerToken=status.hasServerToken;state.mode=status.mode;readShared();updatePreset();renderControls();
    if(state.mode==='live'){renderRecipes([],{chooseStore:true});$('.results').setAttribute('aria-busy','false');openStores();}
    else{const data=await api('/api/stores');await loadCatalog(data.stores[0]);}
  }catch(failure){error(failure.message);$('.results').setAttribute('aria-busy','false');$('#recipe-results').innerHTML='<div class="empty-state"><h3>暂时无法读取菜单</h3><p>请检查服务是否启动，再刷新页面。</p></div>';}
}
boot();
