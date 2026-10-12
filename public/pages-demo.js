import { demoCatalog, demoQuote, demoStores } from '../lib/demo.js';
import { validateOptions, generateRecipes, resolveItems, checkedRecipe, toCents } from '../lib/recipes.js';
import QRCode from 'qrcode/lib/browser.js';

// GitHub Pages uses the same demo rules as Node, entirely in the browser.
export async function demoApi(path, input) {
  const route = path.split('?')[0];
  if (route === '/api/status') return {mode:'demo',hasServerToken:false};
  if (route === '/api/stores') return {mode:'demo',stores:demoStores};
  const catalog = demoCatalog(input?.store?.code);
  const quote = items => demoQuote(catalog,items);
  if (route === '/api/catalog') return catalog;
  if (route === '/api/generate') return {...await generateRecipes(catalog,validateOptions(input),quote),catalog,warnings:[]};
  if (route === '/api/reprice') {
    const budget = toCents(input.budget);
    if (budget < 100 || budget > 50000) throw new Error('预算请设置在 1～500 元之间。');
    const items = resolveItems(catalog.products,input.items);
    const recipe = checkedRecipe(catalog,items,quote(items));
    return {recipe,catalog,overBudget:recipe.total>budget,budget,warnings:[]};
  }
  throw new Error('在线演示不提供此功能，请使用本地真实核价版。');
}

export function qrDataUrl(link) {
  return QRCode.toDataURL(link,{width:280,margin:4,errorCorrectionLevel:'M'});
}
