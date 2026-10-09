import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHash } from 'node:crypto';
import { toCents } from './recipes.js';

const ALLOWED = new Set(['query-nearby-stores', 'query-meals', 'query-meal-detail', 'query-store-coupons', 'calculate-price']);
const detailsCache = new Map();
export function toolData(result) {
  if (result.isError) throw new Error('麦当劳工具调用失败，请稍后重试。');
  let payload = result.structuredContent;
  if (!payload) {
    const text = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { payload = JSON.parse(text); } catch { throw new Error('麦当劳返回的数据格式暂不支持，请检查接入文档。'); }
  }
  if (payload.success === false || (payload.code != null && ![0, 200, '0', '200', 'SUCCESS'].includes(payload.code))) throw new Error(String(payload.message || payload.msg || '麦当劳返回业务错误。').slice(0,200));
  return payload.data ?? payload;
}

function scalar(value, schema) {
  if (schema?.type === 'string' && typeof value !== 'string') return Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (schema?.type === 'number' || schema?.type === 'integer') return Number(value);
  return value;
}
// Shape known values against the server's actual schema, rather than inventing required fields.
export function shapeArguments(schema = {}, known, label = '工具') {
  const props = schema.properties || {};
  const args = {};
  for (const [key, field] of Object.entries(props)) {
    if (known[key] !== undefined) args[key] = scalar(known[key], field);
    else if (field.default !== undefined) args[key] = field.default;
  }
  for (const key of schema.required || []) {
    if (args[key] === undefined) throw new Error(`${label}需要参数 ${key}，当前接口适配尚未覆盖。请按 MCP_INTEGRATION.md 完成联调。`);
  }
  return Object.keys(props).length ? args : known;
}
function itemArguments(itemSchema, item) {
  const known = { code: item.code, mealCode: item.code, productCode: item.code, quantity: item.quantity, count: item.quantity, qty: item.quantity, name: item.name, productName: item.name, modification: item.modification };
  return itemSchema?.properties ? shapeArguments(itemSchema, known, '餐品计价') : { code: item.code, quantity: item.quantity };
}
export function quoteArguments(schema, storeCode, items, coupon) {
  const known = { storeCode, beType: 1, orderType: 1 };
  const props = schema?.properties || {};
  for (const key of ['products', 'meals', 'items', 'mealList', 'productList']) {
    if (props[key]) known[key] = items.map(item => itemArguments(props[key].items, item));
  }
  if (!Object.keys(props).length) known.products = items.map(i => ({ code: i.code, quantity: i.quantity }));
  if (coupon) {
    const id = coupon.couponId ?? coupon.id;
    if (id == null) throw new Error('优惠券缺少可用于计价的标识。');
    if (props.couponId) known.couponId = id;
    if (props.couponIds) known.couponIds = [id];
    if (props.coupons) known.coupons = [props.coupons.items?.properties ? shapeArguments(props.coupons.items, { couponId: id, id, quantity: 1 }, '优惠券') : id];
    if (!['couponId','couponIds','coupons'].some(k => props[k])) throw new Error('当前计价工具未提供支持的优惠券参数。');
  }
  return shapeArguments(schema, known, '官方计价');
}
const first = (object, keys) => keys.map(k => object?.[k]).find(v => v != null);
export function normalizePrice(data, expectedSubtotal, configuredUnit = 'auto') {
  const p = data.priceInfo ?? data;
  const explicitCents = first(p, ['totalCents','payableCents','totalFen','payAmountFen']);
  const totalRaw = explicitCents ?? first(p, ['payAmount','payableAmount','actualPayAmount','totalPayPrice','totalAmount','totalPrice','payPrice','total','price']);
  if (totalRaw === undefined || !Number.isFinite(Number(totalRaw)) || Number(totalRaw) < 0) throw new Error('官方计价没有返回可识别的应付金额，需完成返回字段适配。');
  const subtotalRaw = first(p, ['subtotal','originalAmount','originalTotalPrice','goodsTotalPrice','mealAmount','goodsAmount','originalPrice']);
  const unit = String(p.priceUnit ?? p.currencyUnit ?? p.unit ?? configuredUnit).toLowerCase();
  let factor;
  // Live-verified calculate-price format: price/originalPrice and productList are in fen.
  const officialFen = unit === 'auto' && p.price != null && p.productOriginalPrice != null && Array.isArray(p.productList);
  if (explicitCents !== undefined || officialFen || ['fen','cents','cent','分'].includes(unit)) factor = 1;
  else if (['yuan','元','rmb_yuan'].includes(unit)) factor = 100;
  else {
    const reference = subtotalRaw ?? totalRaw;
    const asFen = Math.round(Number(reference));
    const asYuan = toCents(reference);
    const fenMatches = asFen === expectedSubtotal;
    const yuanMatches = asYuan === expectedSubtotal;
    if (fenMatches === yuanMatches) throw new Error('官方响应的金额单位尚未核实。请核对一份单品的计价返回，并设置 MCD_PRICE_UNIT=fen 或 yuan。');
    factor = fenMatches ? 1 : 100;
  }
  const cents = raw => factor === 100 ? toCents(raw) : Math.round(Number(raw));
  return {
    total: cents(totalRaw), subtotal: subtotalRaw == null ? null : cents(subtotalRaw),
    discount: first(p,['discountAmount','discountPrice','discount']) == null ? null : cents(first(p,['discountAmount','discountPrice','discount'])),
    source: '麦当劳官方实时核价', unit: factor === 1 ? 'fen' : 'yuan',
  };
}
export function normalizeMenu(data) {
  const raw = data.meals;
  if (!raw || typeof raw !== 'object') throw new Error('当前菜单返回结构需要适配，尚未读取到餐品列表。');
  const products = [];
  for (const [key, meal] of Object.entries(raw)) {
    const name = meal.name ?? meal.productName;
    const amount = meal.currentPrice;
    if (!name || amount == null || meal.soldOut === true || meal.available === false) continue;
    // Configurable bundles require explicit selections; first version uses single items.
    if (/套餐|件套|随心配|随心选|组合|开心乐园餐/.test(name)) continue;
    const kind = /汉堡|鸡腿堡|麦香鸡|麦香鱼|麦满分|松饼堡|营养卷/.test(name) ? 'main' : /薯条|麦乐鸡|鸡翅|玉米杯|薯饼/.test(name) ? 'side' : /可乐|咖啡|美式|奶铁|豆浆|牛奶|橙橙|红茶|饮/.test(name) ? 'drink' : null;
    if (!kind) continue;
    let image = '';
    try { const url = new URL(meal.image); if (url.protocol === 'https:' && url.hostname.endsWith('.mcd.cn')) image = url.href; } catch {}
    products.push({ code: String(meal.code ?? key), name, kind, price: toCents(amount), image });
  }
  if (!products.length) throw new Error('这家门店当前没有可用于首版搭配的单品，请换门店或时段。');
  return products;
}

export function singleItemDetail(product, detail) {
  // First version only offers single products, with the provider's default modifications.
  if (!detail.name || (detail.rounds?.length || 0) > 0) return null;
  const values = (detail.modification?.items || []).flatMap(item => {
    const selected = (item.values || []).filter(value => value.selectedQuantity > 0);
    if (selected.length < (item.minValues || 0)) throw new Error('餐品特制缺少官方默认选项。');
    return selected.map(value => {
      if (!value.code || value.selectedKey == null || !Number.isInteger(value.selectedQuantity)) throw new Error('餐品默认选项结构尚未适配。');
      return {code:String(value.code),key:String(value.selectedKey),quantity:value.selectedQuantity};
    });
  });
  return {...product,name:detail.name,...(values.length ? {modification:{values}} : {})};
}

export async function withMcd(token, action) {
  const client = new Client({name:'mcd-copy-meal',version:'0.1.0'},{capabilities:{}});
  const transport = new StreamableHTTPClientTransport(new URL('https://mcp.mcd.cn'), {requestInit:{headers:{Authorization:`Bearer ${token}`}}});
  try {
    await client.connect(transport, {timeout: 25000});
    const listed = await client.listTools({}, {timeout: 25000});
    const definitions = new Map(listed.tools.map(t => [t.name, t.inputSchema]));
    const accountScope = createHash('sha256').update(token).digest('hex');
    const call = async (name, args) => {
      if (!ALLOWED.has(name) || !definitions.has(name)) throw new Error(`当前连接未提供所需只读工具：${name}`);
      const shaped = shapeArguments(definitions.get(name),args,name);
      const key = name === 'query-meal-detail' ? `${accountScope}:${JSON.stringify(shaped)}` : null;
      const cached = key && detailsCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.data;
      const result = await client.callTool({name,arguments:shaped}, undefined, {timeout:25000});
      const data = toolData(result);
      if (key) {
        if (detailsCache.size >= 300) detailsCache.delete(detailsCache.keys().next().value);
        detailsCache.set(key,{data,expires:Date.now()+300000});
      }
      return data;
    };
    return await action({call,definitions});
  } catch (error) {
    const text = String(error.message || error).replaceAll(token, '[已隐藏]').slice(0,350);
    if (/401|unauthori|invalid.*token/i.test(text)) throw new Error('麦当劳连接未授权，请检查 Token 是否有效。');
    if (/429/.test(text)) throw new Error('麦当劳请求较频繁，请稍后再试。');
    throw new Error(text);
  } finally { await client.close().catch(() => {}); }
}
export async function liveStores(mcd, city, keyword) {
  const data = await mcd.call('query-nearby-stores', {beType:1,searchType:2,city,keyword,address:keyword});
  const stores = Array.isArray(data) ? data : data.stores;
  if (!Array.isArray(stores)) throw new Error('门店返回结构需要适配，尚未读取到门店列表。');
  return stores.slice(0,15).map(s => ({code:String(s.storeCode),name:s.storeName ?? s.name,address:s.address || '',city}));
}
export async function liveCatalog(mcd, store) {
  const args = {storeCode:store.code,beType:1,orderType:1};
  const menu = await mcd.call('query-meals', args);
  const listed = normalizeMenu(menu);
  const products = [];
  for (let index = 0; index < listed.length; index += 2) {
    const detailed = await Promise.all(listed.slice(index,index+2).map(async product => {
      const detail = await mcd.call('query-meal-detail',{...args,code:product.code});
      return singleItemDetail(product,detail);
    }));
    products.push(...detailed.filter(Boolean));
  }
  if (!products.length) throw new Error('这家门店暂时没有首版支持的单品，请换门店或时段。');
  return {mode:'live',store,products,checkedAt:new Date().toISOString(),source:'麦当劳当前门店单品菜单，使用官方默认特制，搭配金额以官方计价为准'};
}
export function liveQuote(mcd, catalog) {
  const schema = mcd.definitions.get('calculate-price');
  const warnings = new Set();
  let couponsPromise;
  const supportsCoupons = ['couponId','couponIds','coupons'].some(key => schema?.properties?.[key]);
  const quote = async items => {
    const args = quoteArguments(schema,catalog.store.code,items);
    const data = await mcd.call('calculate-price',args);
    const subtotal = items.reduce((n,p)=>n+p.price*p.quantity,0);
    let best = normalizePrice(data,subtotal,process.env.MCD_PRICE_UNIT || 'auto');
    couponsPromise ||= mcd.call('query-store-coupons',{storeCode:catalog.store.code,beType:1,orderType:1}).catch(() => {
        warnings.add('当前门店优惠券未读取成功，本次只展示已完成核价的点法。'); return [];
      });
    const coupons = await couponsPromise;
    const list = (Array.isArray(coupons) ? coupons : coupons?.coupons || []).filter(c => c.couponId != null || c.id != null);
    if (supportsCoupons) {
      const eligible = list.filter(c => !c.products?.length || c.products.some(p => items.some(i => p.productName === i.name || String(p.productCode) === i.code))).slice(0,2);
      for (const coupon of eligible) {
        try {
          const candidate = await mcd.call('calculate-price',quoteArguments(schema,catalog.store.code,items,coupon));
          const price = normalizePrice(candidate,subtotal,best.unit);
          if (price.total < best.total) best = {...price,offer:String(coupon.title || '当前门店可用优惠').slice(0,80)};
        } catch { warnings.add('部分优惠券未通过计价，已保留核验成功的金额。'); }
      }
    } else if (list.length) warnings.add('账户有门店优惠券，商品级用券适配尚未完成，本次按单点组合核价。');
    return best;
  };
  quote.warnings = warnings;
  return quote;
}
