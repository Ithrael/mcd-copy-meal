import test from 'node:test';
import assert from 'node:assert/strict';
import { demoApi } from '../public/pages-demo.js';
import { encodeShare, decodeShare } from '../public/share.js';

test('Pages 演示能生成套餐、分享完整选件并换店重算超预算',async()=>{
  assert.deepEqual(await demoApi('/api/status'),{mode:'demo',hasServerToken:false});
  const {stores} = await demoApi('/api/stores?city=上海');
  const generated = await demoApi('/api/generate',{store:stores[0],budget:40,mustHave:['麦香鸡','薯条'],includeDrink:true,includeSide:true});
  const original = generated.recipes.find(r=>r.items.length===1&&r.items[0].name==='麦香鸡套餐');
  assert.ok(original);
  assert.equal(original.total,2750);
  assert.equal(original.mode,'demo');
  const shared = decodeShare(encodeShare({v:2,title:original.title,budget:2800,items:original.items}));
  const received = await demoApi('/api/reprice',{store:stores[1],budget:28,items:shared.items});
  assert.equal(received.recipe.total,2850);
  assert.equal(received.overBudget,true);
  assert.equal(received.recipe.mode,'demo');
  assert.deepEqual(received.recipe.items[0].selections,shared.items[0].selections);
  assert.ok(received.recipe.items[0].image.startsWith('./assets/'));
});

test('Pages 缺项保留具体名单，非法预算和未知功能不会得到成功结果',async()=>{
  const store={code:'demo-hangzhou'};
  await assert.rejects(demoApi('/api/reprice',{store,budget:50,items:[{name:'麦香鱼',quantity:1}]}),error=>{
    assert.deepEqual(error.missing,['麦香鱼']);return true;
  });
  await assert.rejects(demoApi('/api/reprice',{store,budget:0,items:[{name:'麦香鸡',quantity:1}]}),/预算/);
  await assert.rejects(demoApi('/api/create-order',{store}),/不提供此功能/);
});
