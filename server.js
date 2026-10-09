import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoCatalog, demoQuote, demoStores } from './lib/demo.js';
import { validateOptions, resolveItems, generateRecipes, checkedRecipe, toCents } from './lib/recipes.js';
import { withMcd, liveStores, liveCatalog, liveQuote } from './lib/mcd.js';
import QRCode from 'qrcode';
import { decodeShare, encodeShare } from './public/share.js';

const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif'};
function json(response, status, data) {
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(data));
}
async function body(request) {
  const chunks = []; let bytes = 0;
  for await (const chunk of request) { bytes += chunk.length; if (bytes > 20000) throw new Error('请求内容过长。'); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('请求内容不是有效 JSON。'); }
}
function selectedStore(value) {
  if (typeof value?.code !== 'string' || !/^[\w-]{1,50}$/.test(value.code)) throw new Error('请先选择门店。');
  return {code:value.code,name:String(value.name || '所选麦当劳门店').slice(0,120),address:String(value.address || '').slice(0,180),city:String(value.city || '').slice(0,30)};
}
export const server = http.createServer(async (request,response) => {
  response.setHeader('X-Content-Type-Options','nosniff');
  response.setHeader('Referrer-Policy','no-referrer');
  response.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: https://*.mcd.cn; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    const url = new URL(request.url,'http://localhost');
    const token = request.headers['x-demo-mode'] === '1' ? '' : String(request.headers['x-mcd-token'] || process.env.MCD_MCP_TOKEN || '').trim();
    if (token.length > 8192) throw new Error('Token 格式不正确。');
    if (url.pathname === '/api/image' && request.method === 'GET') {
      const imageUrl = new URL(url.searchParams.get('url') || '');
      if (imageUrl.protocol !== 'https:' || imageUrl.hostname !== 'menu-img.mcd.cn' || imageUrl.username || imageUrl.password || (imageUrl.port && imageUrl.port !== '443')) throw new Error('仅支持麦当劳官方菜单图片。');
      const upstream = await fetch(imageUrl,{redirect:'error',signal:AbortSignal.timeout(10000)});
      const type = upstream.headers.get('content-type')?.split(';')[0];
      if (!upstream.ok || !['image/png','image/jpeg','image/gif','image/webp'].includes(type)) throw new Error('餐品图片暂时无法读取。');
      const chunks = []; let size = 0;
      for await (const chunk of upstream.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('餐品图片过大。');
        chunks.push(chunk);
      }
      response.writeHead(200,{'Content-Type':type,'Cache-Control':'public, max-age=86400'});
      response.end(Buffer.concat(chunks)); return;
    }
    if (url.pathname === '/api/qr' && request.method === 'GET') {
      const value = url.searchParams.get('url') || '';
      if (value.length > 7000) throw new Error('分享链接过长。');
      const link = new URL(value);
      if (!['http:','https:'].includes(link.protocol) || link.host !== request.headers.host) throw new Error('二维码仅支持当前网站的攻略链接。');
      const shared = decodeShare(new URLSearchParams(link.hash.slice(1)).get('recipe'));
      const clean = new URL('/',link.origin); clean.hash = 'recipe=' + encodeShare(shared);
      const png = await QRCode.toBuffer(clean.href,{type:'png',width:280,margin:4,errorCorrectionLevel:'M'});
      response.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});response.end(png);return;
    }
    if (url.pathname === '/api/status' && request.method === 'GET') return json(response,200,{mode:token?'live':'demo',hasServerToken:Boolean(process.env.MCD_MCP_TOKEN),priceUnit:process.env.MCD_PRICE_UNIT || 'auto'});
    if (url.pathname === '/api/stores' && request.method === 'GET') {
      const city = (url.searchParams.get('city') || '').slice(0,30);
      const keyword = (url.searchParams.get('keyword') || '').slice(0,80);
      if (token && (!city.trim() || !keyword.trim())) throw new Error('请填写城市和地址或门店关键词。');
      const stores = token ? await withMcd(token,m => liveStores(m,city,keyword)) : demoStores;
      return json(response,200,{mode:token?'live':'demo',stores});
    }
    if (['/api/catalog','/api/generate','/api/reprice'].includes(url.pathname) && request.method === 'POST') {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) return json(response,403,{error:'请求来源不匹配，请在当前页面重试。'});
      const input = await body(request);
      const store = selectedStore(input.store);
      const run = async mcd => {
        const catalog = mcd ? await liveCatalog(mcd,store) : demoCatalog(store.code);
        if (url.pathname === '/api/catalog') return catalog;
        const quote = mcd ? liveQuote(mcd,catalog) : items => demoQuote(catalog,items);
        if (url.pathname === '/api/generate') return {...await generateRecipes(catalog,validateOptions(input),quote),catalog,warnings:[...(quote.warnings || [])]};
        const items = resolveItems(catalog.products,input.items);
        const recipe = checkedRecipe(catalog,items,await quote(items));
        const budget = toCents(input.budget);
        if (budget < 100 || budget > 50000) throw new Error('预算请设置在 1～500 元之间。');
        return {recipe,catalog,overBudget:recipe.total > budget,budget,warnings:[...(quote.warnings || [])]};
      };
      return json(response,200,token ? await withMcd(token,run) : await run(null));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response,405,{error:'请求方式不支持。'});
    const pathname = decodeURIComponent(url.pathname);
    const file = resolve(publicRoot,pathname === '/' ? 'index.html' : '.' + pathname);
    if (!file.startsWith(publicRoot + sep) || !MIME[extname(file)]) return json(response,404,{error:'页面不存在。'});
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return json(response,404,{error:'页面不存在。'});
    response.writeHead(200,{'Content-Type':MIME[extname(file)],'Cache-Control':'no-cache'});
    response.end(request.method === 'HEAD' ? '' : await readFile(file));
  } catch (error) { json(response,400,{error:error.message || '处理失败，请重试。',missing:error.missing || []}); }
});
if (process.env.NODE_ENV !== 'test') server.listen(Number(process.env.PORT || 3107),process.env.HOST || '127.0.0.1',() => console.log(`麦麦抄作业：http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 3107}`));
