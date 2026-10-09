import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteArguments, liveQuote } from '../lib/mcd.js';

// Field projection of the official tools/list contract, read on 2026-10-10.
// Price responses below are synthetic test values, not live coupon prices.
const schema={properties:{storeCode:{type:'string'},orderType:{type:'integer'},beType:{type:'integer'},items:{type:'array',items:{properties:{productCode:{type:'string'},quantity:{type:'integer'},couponId:{type:'string'},couponCode:{type:'string'},modification:{type:'object'},roundList:{type:'array'}}}}}};
const coupon={couponId:'test-voucher',couponCode:'test-code',title:'测试券',products:[{productCode:'1450',productName:'麦香鸡'}]};
const chicken={code:'1450',name:'麦香鸡',quantity:3,price:1700};
const cola={code:'3050',name:'可乐中杯',quantity:1,price:1000};

test('官方商品级用券仅匹配一个单位，保持总份数、其他餐品和套餐选件',()=>{
  const items=[{...chicken,roundList:[{round:'test-round',comboItemList:[{code:'child',quantity:1}]}]},cola];
  const before=structuredClone(items);
  const args=quoteArguments(schema,'test-store',items,coupon);
  assert.equal(args.items.reduce((sum,item)=>sum+(item.productCode==='1450'?item.quantity:0),0),3);
  assert.equal(args.items.filter(item=>item.couponId).length,1);
  assert.deepEqual(args.items[0],{productCode:'1450',quantity:1,couponId:'test-voucher',couponCode:'test-code',roundList:items[0].roundList});
  assert.deepEqual(args.items[1],{productCode:'1450',quantity:2,roundList:items[0].roundList});
  assert.deepEqual(args.items[2],{productCode:'3050',quantity:1});
  assert.deepEqual(items,before);
});

test('券适用编码不匹配时不能靠同名套用，也不能把单品券套在套餐内部',()=>{
  assert.throws(()=>quoteArguments(schema,'store',[chicken],{...coupon,products:[{productCode:'different',productName:'麦香鸡'}]}),/未明确匹配/);
  assert.throws(()=>quoteArguments(schema,'store',[{code:'combo',name:'麦香鸡套餐',quantity:1,contents:[chicken]}],coupon),/未明确匹配/);
  assert.throws(()=>quoteArguments(schema,'store',[chicken],{...coupon,products:[]}),/未明确匹配/);
  assert.throws(()=>quoteArguments(schema,'store',[chicken],{...coupon,products:{productCode:'1450'}}),/未明确匹配/);
  assert.equal(quoteArguments(schema,'store',[chicken],{...coupon,products:[{productName:'麦香鸡'}]}).items[0].couponId,'test-voucher');
});

test('商品级券只选官方核价更低的方案，失败券保留基线，券列表同次查询复用',async()=>{
  let couponReads=0;const calls=[];
  const mcd={definitions:new Map([['calculate-price',schema]]),call:async(name,args)=>{
    if(name==='query-store-coupons'){couponReads++;return [{...coupon,couponId:'bad'}, {...coupon,couponId:'valid'}, {...coupon,couponId:'untried'}];}
    const id=args.items.find(item=>item.couponId)?.couponId;calls.push(id || 'base');
    if(id==='bad')throw new Error('测试失效券');
    return {totalFen:id==='valid'?1500:1700};
  }};
  const quote=liveQuote(mcd,{store:{code:'test-store'}});
  const first=await quote([{...chicken,quantity:1}]);
  assert.equal(first.total,1500);assert.equal(first.offer,'测试券');
  await quote([{...chicken,quantity:1}]);
  assert.equal(couponReads,1);assert.ok(!calls.includes('untried'));assert.equal(quote.warnings.size,1);
});

test('未降价的券不显示用券收益；没有适用商品的券不随意加到第一件餐品',async()=>{
  const ids=[];
  const mcd={definitions:new Map([['calculate-price',schema]]),call:async(name,args)=>{
    if(name==='query-store-coupons')return [{...coupon,couponId:'neutral'}, {...coupon,couponId:'unknown',products:[]}];
    ids.push(args.items.find(item=>item.couponId)?.couponId);return {totalFen:1700};
  }};
  const quote=liveQuote(mcd,{store:{code:'test-store'}});
  const price=await quote([{...chicken,quantity:1}]);
  assert.equal(price.total,1700);assert.equal(price.offer,undefined);
  assert.deepEqual(ids,[undefined,'neutral']);assert.equal(quote.warnings.size,1);
});
