import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog, demoQuote } from '../lib/demo.js';
import { validateOptions, generateRecipes, resolveItems, toCents } from '../lib/recipes.js';
import { encodeShare, decodeShare } from '../public/share.js';
import { normalizePrice, normalizeMenu, quoteArguments, toolData, liveQuote, singleItemDetail } from '../lib/mcd.js';

test('推荐保留必点餐品，且核价后不超过预算；无解时返回已核验的最低金额',async()=>{
  const catalog=demoCatalog();
  const options=validateOptions({budget:'40',mustHave:['麦辣鸡腿汉堡','薯条'],includeDrink:true,includeSide:true});
  const result=await generateRecipes(catalog,options,items=>demoQuote(catalog,items));
  assert.ok(result.recipes.length>0);
  for(const recipe of result.recipes){
    assert.ok(recipe.total<=4000);
    assert.ok(recipe.items.some(i=>i.name==='麦辣鸡腿汉堡'));
    assert.ok(recipe.items.some(i=>i.name==='薯条'));
  }
  const impossible=await generateRecipes(catalog,{...options,budget:2000},items=>demoQuote(catalog,items));
  assert.equal(impossible.recipes.length,0);
  assert.equal(impossible.lowestChecked,3400);
});
test('按核价金额筛选：菜单估价超预算的组合也能因已核实优惠入选',async()=>{
  const catalog=demoCatalog();
  const options=validateOptions({budget:30,mustHave:['麦香鸡','薯条'],includeDrink:true,includeSide:true});
  const result=await generateRecipes(catalog,options,items=>demoQuote(catalog,items));
  assert.equal(result.recipes[0].total,2750);
  assert.equal(result.recipes[0].subtotal,4350);
});
test('跨门店按名称重新匹配，不沿用原店商品编码；缺货不静默替换',()=>{
  const newProducts=demoCatalog('demo-hangzhou').products.map(p=>({...p,code:'new-'+p.code}));
  const items=resolveItems(newProducts,[{name:'麦香鸡',quantity:2}]);
  assert.equal(items[0].code,'new-1450');
  assert.equal(items[0].quantity,2);
  assert.throws(()=>resolveItems(newProducts,[{name:'麦香鱼',quantity:1}]),/未找到.*麦香鱼/);
  assert.throws(()=>resolveItems(newProducts,[{name:'麦香鸡',quantity:9}]),/份数/);
});
test('分享支持中文，且只包含允许的字段；损坏或超长链接被拒绝',()=>{
  const input={v:1,title:'汉堡＋薯条',budget:3000,items:[{name:'麦香鸡',quantity:1,couponId:'private'}],token:'secret',address:'private'};
  const decoded=decodeShare(encodeShare(input));
  assert.deepEqual(decoded,{v:1,title:'汉堡＋薯条',budget:3000,items:[{name:'麦香鸡',quantity:1}]});
  assert.throws(()=>decodeShare('!bad!'),/链接/);
  assert.throws(()=>decodeShare('a'.repeat(6001)),/链接/);
  assert.throws(()=>encodeShare({...input,items:[{name:'薯条',quantity:0}]}),/餐品/);
});
test('金额按整数分计算；无法核实金额单位时失败，不制造实时价格',()=>{
  assert.equal(toCents('0.29'),29);
  assert.throws(()=>toCents(''),/有效金额/);
  assert.throws(()=>validateOptions({budget:0,mustHave:[]}),/预算/);
  assert.equal(normalizePrice({totalPrice:1900},1900).total,1900);
  assert.equal(normalizePrice({totalPrice:'19.00'},1900).total,1900);
  assert.equal(normalizePrice({totalFen:1700},1900).total,1700);
  assert.deepEqual(normalizePrice({price:1700,originalPrice:1700,discount:0},1700),{total:1700,subtotal:1700,discount:0,source:'麦当劳官方实时核价',unit:'fen'});
  // Live menu prices may differ from checkout; do not reject or replace the actual quote.
  assert.equal(normalizePrice({price:5300,originalPrice:5300,productOriginalPrice:5300,productList:[]},3990).total,5300);
  assert.throws(()=>normalizePrice({totalPrice:12.34},1900),/单位尚未核实/);
  assert.throws(()=>normalizePrice({totalPrice:-1},1900,'fen'),/应付金额/);
});
test('真实商品详情保留规格名称和默认特制；需要套餐选件的商品不冒充可直接点单的单品',()=>{
  const product={code:'510479',name:'燕麦奶铁',price:990};
  const detailed=singleItemDetail(product,{name:'冰燕麦奶铁中杯',rounds:[],modification:{items:[{minValues:1,values:[{code:'200002',selectedKey:'0-1',selectedQuantity:1},{code:'200002',selectedKey:'0-0',selectedQuantity:0}]}]}});
  assert.equal(detailed.name,'冰燕麦奶铁中杯');
  assert.deepEqual(detailed.modification,{values:[{code:'200002',key:'0-1',quantity:1}]});
  assert.equal(singleItemDetail(product,{name:'可乐',rounds:[{id:1}]}),null);
  assert.throws(()=>singleItemDetail(product,{name:'饮料',modification:{items:[{minValues:1,values:[]}]}}),/默认选项/);
});
test('菜单排除售罄和需要选件的套餐；官方业务错误被保留',()=>{
  const products=normalizeMenu({meals:{a:{name:'麦香鸡',currentPrice:'19'},b:{name:'麦香鱼',currentPrice:24,soldOut:true},c:{name:'麦香鸡套餐',currentPrice:30}}});
  assert.equal(products.length,1);
  assert.equal(products[0].price,1900);
  assert.throws(()=>toolData({structuredContent:{code:400,message:'门店已关闭'}}),/门店已关闭/);
});
test('计价参数按真实 schema 构造；未知必填字段不凭空补齐',()=>{
  const schema={type:'object',properties:{storeCode:{type:'string'},beType:{type:'integer'},products:{type:'array',items:{type:'object',properties:{mealCode:{type:'string'},quantity:{type:'integer'}},required:['mealCode','quantity']}}},required:['storeCode','products']};
  assert.deepEqual(quoteArguments(schema,'333',[{code:'1450',name:'麦香鸡',quantity:2}]),{storeCode:'333',beType:1,products:[{mealCode:'1450',quantity:2}]});
  assert.throws(()=>quoteArguments({...schema,required:['unsupported']},'333',[]),/尚未覆盖/);
});
test('优惠券效果以官方核价为准：失败券被忽略，未降价的券不宣称省钱',async()=>{
  const schema={properties:{storeCode:{type:'string'},products:{type:'array'},couponId:{type:'string'}}};
  const mcd={definitions:new Map([['calculate-price',schema]]),call:async(name,args)=>{
    if(name==='query-store-coupons')return [{couponId:'bad',title:'失效券'},{couponId:'valid',title:'可用券'}];
    if(args.couponId==='bad')throw new Error('失效');
    return {totalFen:args.couponId==='valid'?1700:1900};
  }};
  const catalog=demoCatalog();const quote=liveQuote(mcd,catalog);
  const price=await quote([{code:'1450',name:'麦香鸡',price:1900,quantity:1}]);
  assert.equal(price.total,1700);assert.equal(price.offer,'可用券');assert.equal(quote.warnings.size,1);
});
