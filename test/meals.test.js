import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCatalog, demoQuote } from '../lib/demo.js';
import { detailedProduct, selectProduct, foodItems } from '../lib/meals.js';
import { candidates, generateRecipes, resolveItems, validateOptions } from '../lib/recipes.js';
import { quoteArguments } from '../lib/mcd.js';
import { encodeShare, decodeShare } from '../public/share.js';
import { readFile } from 'node:fs/promises';

test('单轮饮料规格的必点杯型进入候选，低预算不降级为默认杯型',async()=>{
  const drink=detailedProduct({code:'cola-group',name:'可乐',kind:'drink',price:1000},{name:'可乐',rounds:[{id:1,name:'杯型',minQuantity:1,maxQuantity:1,choices:[{code:'medium',name:'可乐中杯',quantity:1},{code:'large',name:'可乐大杯',quantity:0,diffPrice:'+ ¥2'}]}]});
  const catalog={mode:'demo',store:{code:'test'},products:[{code:'chicken',name:'麦香鸡',kind:'main',price:1700},drink]};
  const options=validateOptions({budget:30,mustHave:['麦香鸡','可乐大杯'],includeSide:false,includeDrink:true});
  const quote=items=>demoQuote(catalog,items);
  const result=await generateRecipes(catalog,options,quote);
  assert.equal(result.recipes[0].total,2900);
  assert.ok(foodItems(result.recipes[0].items).some(item=>item.name==='可乐大杯'));
  assert.ok(!foodItems(result.recipes[0].items).some(item=>item.name==='可乐中杯'));
  const low=await generateRecipes(catalog,{...options,budget:2800},quote);
  assert.equal(low.recipes.length,0);
  assert.equal(low.lowestChecked,2900);
});

test('低预算搜索涵盖随心配；套餐内部满足必点和饮料条件，不重复添加主食',async()=>{
  const catalog=demoCatalog();
  const options=validateOptions({budget:20,mustHave:['麦香鸡'],includeSide:false,includeDrink:true});
  const result=await generateRecipes(catalog,options,items=>demoQuote(catalog,items));
  assert.ok(result.recipes.length);
  assert.equal(result.recipes[0].total,1390);
  assert.equal(result.recipes[0].items.length,1);
  const foods=foodItems(result.recipes[0].items);
  assert.ok(foods.some(i=>i.name==='麦香鸡'));
  assert.ok(foods.some(i=>i.kind==='drink'));
  assert.equal(foods.filter(i=>i.kind==='main').length,1);
});

test('套餐不能凭名称满足约束：要吃薯条就保留实际薯条选件',()=>{
  const products=demoCatalog().products;
  const options=validateOptions({budget:30,mustHave:['麦香鸡','薯条'],includeSide:true,includeDrink:true});
  for(const set of candidates(products,options)) {
    const foods=foodItems(set);
    assert.ok(foods.some(i=>i.name==='麦香鸡'));
    assert.ok(foods.some(i=>i.name==='薯条'));
    assert.ok(foods.some(i=>i.kind==='drink'));
  }
});

test('好友的套餐选件重新匹配目标门店的编码；缺少杯型不替换成默认项',()=>{
  const original=demoCatalog().products.find(p=>p.code==='demo-chicken-set');
  const selected=selectProduct(original,undefined,2,true);
  const target={...original,code:'target-set',rounds:original.rounds.map(r=>({...r,id:'target-'+r.id,choices:r.choices.map(c=>({...c,code:'target-'+c.code}))}))};
  const rechecked=resolveItems([target],[{name:selected.name,quantity:2,selections:selected.selections}])[0];
  assert.equal(rechecked.code,'target-set');
  assert.equal(rechecked.roundList[0].round,'target-1');
  assert.equal(rechecked.roundList[0].comboItemList[0].code,'target-1450');
  assert.equal(rechecked.contents[0].quantity,2);
  target.rounds[2].choices=target.rounds[2].choices.filter(c=>c.name!=='可乐');
  assert.throws(()=>resolveItems([target],[{name:selected.name,quantity:1,selections:selected.selections}]),/未提供：可乐/);
  assert.throws(()=>resolveItems([original],[{name:original.name,quantity:1}]),/完整套餐选件/);
});

test('同一套餐的不同选件不被合并；相同选件可合并，并检查总份数',()=>{
  const product=demoCatalog().products.find(p=>p.code==='demo-chicken-set');
  const first=selectProduct(product,undefined,1,true);
  const second=structuredClone(first.selections);second[1].items=[{name:'玉米杯',quantity:1}];
  const rows=[{name:product.name,quantity:1,selections:first.selections},{name:product.name,quantity:1,selections:second}];
  assert.equal(resolveItems([product],rows).length,2);
  assert.equal(resolveItems([product],[rows[0],rows[0]])[0].quantity,2);
  assert.throws(()=>resolveItems([product],rows.map(row=>({...row,quantity:5}))),/最多选择 8 份/);
});

test('商品详情的 round 约束、子项和默认特制按实际计价结构发送',()=>{
  const product=detailedProduct({code:'set',name:'套餐',kind:'bundle',price:2800},{name:'中套餐',rounds:[{id:7,name:'饮料',minQuantity:1,maxQuantity:1,choices:[{code:'3050',name:'可乐中杯',quantity:1,isDefault:1,diffPrice:'+ ¥0',maxQuantity:-1,modification:{items:[{minValues:1,values:[{code:'200002',selectedKey:'0-1',selectedQuantity:1}]}]}}]}]});
  const selected=selectProduct(product,undefined,1,true);
  const schema={properties:{storeCode:{type:'string'},orderType:{type:'integer'},beType:{type:'integer'},items:{type:'array',items:{properties:{productCode:{type:'string'},quantity:{type:'integer'},roundList:{type:'array'}}}}}};
  const args=quoteArguments(schema,'store',[selected]);
  assert.deepEqual(args.items,[{productCode:'set',quantity:1,roundList:[{round:'7',comboItemList:[{code:'3050',quantity:1,modification:{values:[{code:'200002',key:'0-1',quantity:1}]}}]}]}]);
  assert.throws(()=>selectProduct(product,[{name:'饮料',items:[]}]),/需选择 1 份/);
  assert.throws(()=>selectProduct(product,[{name:'饮料',items:[{name:'可乐中杯',quantity:2}]}]),/超过套餐/);
});

test('新版分享保留具体选件，逐层剔除凭证和券标识；旧版链接仍能读取',()=>{
  const product=selectProduct(demoCatalog().products.find(p=>p.code==='demo-chicken-set'),undefined,1,true);
  product.token='private';product.selections[0].couponId='private';product.selections[0].items[0].code='private';
  const encoded=encodeShare({v:2,title:'这份作业',budget:3000,items:[product],token:'private'});
  const shared=decodeShare(encoded);
  assert.equal(shared.items[0].selections[2].items[0].name,'可乐');
  assert.equal(JSON.stringify(shared).includes('private'),false);
  assert.equal(JSON.stringify(shared).includes('roundList'),false);
  assert.equal(decodeShare(encodeShare({v:1,title:'旧版',budget:2000,items:[{name:'麦香鸡',quantity:1}]})).v,1);
  assert.throws(()=>encodeShare({...shared,items:[{...shared.items[0],selections:[{name:'饮料',items:[{name:'可乐',quantity:0}]}]}]}),/选件/);
});

test('真实 MCP 字段节选可构造已核价的麦香鸡随心配和中套餐',async()=>{
  const {samples}=JSON.parse(await readFile(new URL('./fixtures/mcp-meals.json',import.meta.url),'utf8'));
  for(const {menu,detail} of samples){
    const product=detailedProduct({...menu,kind:'bundle',price:Number(menu.currentPrice)*100},detail);
    const selections=product.rounds.map(round=>({name:round.name,items:[{name:(round.choices.find(choice=>choice.name==='麦香鸡')||round.choices.find(choice=>choice.name==='可乐中杯')||round.choices.find(choice=>choice.defaultQuantity>0)).name,quantity:1}]}));
    const selected=selectProduct(product,selections);
    assert.equal(selected.roundList.length,detail.rounds.length);
    assert.ok(foodItems([selected]).some(food=>food.name==='麦香鸡'));
    assert.ok(foodItems([selected]).some(food=>food.name==='可乐中杯'));
  }
});
