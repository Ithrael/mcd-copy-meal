import { selectProduct, foodItems, fulfills, bundleVariants } from './meals.js';

export function toCents(value) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) throw new Error('请输入有效金额。');
  const amount = Number(value);
  if (amount < 0 || amount > 1000000) throw new Error('金额超出有效范围。');
  return Math.round(amount * 100);
}
export function validateOptions(input) {
  const budget = toCents(input.budget);
  if (budget < 100 || budget > 50000) throw new Error('预算请设置在 1～500 元之间。');
  if (!Array.isArray(input.mustHave) || input.mustHave.length > 5 || input.mustHave.some(n => typeof n !== 'string' || n.length > 80)) throw new Error('必点餐品格式不正确。');
  return { budget, mustHave: [...new Set(input.mustHave)], includeSide: input.includeSide !== false, includeDrink: input.includeDrink !== false };
}
export function resolveItems(products, requested) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 8) throw new Error('请选择 1～8 种餐品。');
  const missing = [];
  const quantities = new Map();
  const totals = new Map();
  for (const row of requested) {
    if (typeof row?.name !== 'string' || row.name.length > 80 || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 8) throw new Error('餐品名称或份数不正确。');
    const product = products.find(p => p.name === row.name);
    if (!product) { missing.push(row.name); continue; }
    const selected = selectProduct(product,row.selections,row.quantity);
    const key = product.code + ':' + JSON.stringify(selected.selections || []);
    const previous = quantities.get(key);
    quantities.set(key,{product,selections:selected.selections,quantity:(previous?.quantity || 0)+row.quantity});
    totals.set(product.code,(totals.get(product.code)||0)+row.quantity);
    if (totals.get(product.code) > 8) throw new Error('同一餐品最多选择 8 份。');
  }
  if (missing.length) {
    const error = new Error(`这家门店的当前菜单未找到：${missing.join('、')}。请换门店或手动替换。`);
    error.missing = missing; throw error;
  }
  return [...quantities.values()].map(({product,selections,quantity})=>selectProduct(product,selections,quantity));
}
export function candidates(products, options) {
  const names = new Set(products.flatMap(product=>[product.name,...(product.rounds || []).flatMap(round=>round.choices.map(choice=>choice.name))]));
  const missing = options.mustHave.filter(name=>!names.has(name));
  if (missing.length) throw new Error(`这家门店的当前菜单未找到：${missing.join('、')}。请换门店或手动替换。`);
  const singles = products.filter(product=>product.kind!=='bundle').flatMap(product=>{
    try { return product.rounds?.length ? bundleVariants(product,options) : [selectProduct(product,undefined,1,true)]; } catch { return []; }
  });
  const sets = fillRequirements([],singles,options);
  for (const product of products.filter(product=>product.kind==='bundle')) {
    const expanded = bundleVariants(product,options).flatMap(variant=>fillRequirements([variant],singles,options));
    sets.push(...expanded.sort((a,b)=>sum(a)-sum(b)).slice(0,128));
  }
  const unique = new Map();
  for (const set of sets) {
    if (!fulfills(set,options)) continue;
    const key = set.map(p => p.code+':'+JSON.stringify(p.selections||[])).sort().join('|');
    if (!unique.has(key)) unique.set(key,set);
  }
  return [...unique.values()].sort((a,b) => sum(a) - sum(b));
}
function fillRequirements(seed, singles, options) {
  const required = [...seed];
  for (const name of options.mustHave) {
    if (required.some(p=>p.name===name)||foodItems(required).some(p=>p.name===name)) continue;
    const single = singles.find(p=>p.name===name||foodItems([p]).some(food=>food.name===name));
    if (!single) return [];
    required.push(single);
  }
  const pools = ['main',...(options.includeSide?['side']:[]),...(options.includeDrink?['drink']:[])]
    .filter(kind=>!foodItems(required).some(p=>p.kind===kind)).map(kind=>singles.filter(p=>foodItems([p]).some(food=>food.kind===kind)));
  if (pools.some(pool=>!pool.length)) return [];
  let sets = [required];
  for (const pool of pools) sets = sets.flatMap(set=>pool.map(product=>[...set,product])).slice(0,400);
  return sets.filter(set=>set.length<=8);
}
function sum(items) { return items.reduce((total, p) => total + p.price * p.quantity, 0); }
export function checkedRecipe(catalog, items, price) {
  if (!Number.isSafeInteger(price.total) || price.total < 0) throw new Error('计价结果没有可验证的应付金额。');
  return {
    title: foodItems(items).find(i=>i.kind==='main')?.name ? `${foodItems(items).find(i=>i.kind==='main').name}搭配` : '我的点餐搭配',
    items: items.map(({code,name,kind,price,image,quantity,selections,contents}) => ({code,name,kind,price,image:contents?.find(food=>food.kind==='main'&&food.image)?.image || contents?.find(food=>food.image)?.image || image,quantity,...(selections?{selections,contents}: {})})),
    total: price.total, subtotal: price.subtotal ?? null, discount: price.discount ?? null,
    offer: price.offer || '', source: price.source, mode: catalog.mode, store: catalog.store,
    checkedAt: new Date().toISOString(),
  };
}
export async function generateRecipes(catalog, options, quote) {
  const sets = candidates(catalog.products, options);
  // This is a bounded shortlist, not a claim of exhaustive or global optimization.
  const limit = catalog.mode === 'demo' ? 30 : 9;
  const shortlist = [];
  const orders = new Set();
  for (const set of sets) {
    const key = set.map(p=>p.code).sort().join('|');
    if (!orders.has(key)) { orders.add(key); shortlist.push(set); }
    if (shortlist.length===Math.min(6,limit)) break;
  }
  for (const set of sets) { if (shortlist.length===limit) break; if (!shortlist.includes(set)) shortlist.push(set); }
  const verified = [];
  let failed = 0;
  let firstError;
  for (const items of shortlist) {
    try { verified.push(checkedRecipe(catalog, items, await quote(items))); }
    catch (error) { failed++; firstError ||= error; }
  }
  if (shortlist.length && !verified.length) throw firstError;
  verified.sort((a,b) => a.total - b.total);
  const withinBudget = verified.filter(r => r.total <= options.budget);
  const recipes = [];
  // Prefer different main dishes when available, while retaining the actual cheapest.
  const mains = new Set();
  for (const recipe of withinBudget) {
    const main = foodItems(recipe.items).find(i=>i.kind==='main')?.name;
    if (!mains.has(main)) { recipes.push(recipe); mains.add(main); }
    if (recipes.length === 3) break;
  }
  for (const recipe of withinBudget) {
    if (recipes.length === 3) break;
    if (!recipes.includes(recipe)) recipes.push(recipe);
  }
  return { recipes, lowestChecked: verified[0]?.total ?? null, checkedCount: verified.length, failedCount: failed };
}
