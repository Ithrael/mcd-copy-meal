import test from 'node:test';
import assert from 'node:assert/strict';
process.env.NODE_ENV='test';
const {server}=await import('../server.js');
const {encodeShare}=await import('../public/share.js');
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
test.after(()=>new Promise(resolve=>server.close(resolve)));
const post=async(path,body)=>{
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-demo-mode':'1'},body:JSON.stringify(body)});
  return {status:response.status,...await response.json()};
};
test('HTTP 完整流程：生成攻略，跨门店重新计价，并明确返回超预算状态',async()=>{
  const generated=await post('/api/generate',{store:{code:'demo-shanghai'},budget:30,mustHave:['麦香鸡','薯条'],includeDrink:true,includeSide:true});
  assert.equal(generated.status,200);assert.equal(generated.recipes[0].total,2750);
  const rechecked=await post('/api/reprice',{store:{code:'demo-hangzhou'},budget:30,items:generated.recipes[0].items.map(({name,quantity})=>({name,quantity}))});
  assert.equal(rechecked.status,200);assert.equal(rechecked.recipe.total,3050);assert.equal(rechecked.overBudget,true);
});
test('HTTP 缺货、恶意份数和跨站请求不会获得成功结果；配置文件不可读取',async()=>{
  const missing=await post('/api/reprice',{store:{code:'demo-hangzhou'},budget:40,items:[{name:'麦香鱼',quantity:1}]});
  assert.equal(missing.status,400);assert.deepEqual(missing.missing,['麦香鱼']);
  const invalid=await post('/api/reprice',{store:{code:'demo-shanghai'},budget:40,items:[{name:'麦香鸡',quantity:-1}]});
  assert.equal(invalid.status,400);
  const crossSite=await fetch(base+'/api/generate',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});
  assert.equal(crossSite.status,403);
  assert.equal((await fetch(base+'/.env.local')).status,404);
  assert.equal((await fetch(base+'/lib/mcd.js')).status,404);
});
test('攻略二维码生成可读取的 PNG，且拒绝非本站链接',async()=>{
  const share=encodeShare({v:1,title:'一份搭配',budget:3000,items:[{name:'麦香鸡',quantity:1}]});
  const response=await fetch(base+'/api/qr?url='+encodeURIComponent(base+'/#recipe='+share));
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  const data=Buffer.from(await response.arrayBuffer());assert.equal(data.subarray(1,4).toString(),'PNG');
  const foreign=await fetch(base+'/api/qr?url='+encodeURIComponent('https://example.com/#recipe='+share));
  assert.equal(foreign.status,400);
});
test('图片转发拒绝外部主机、伪造子域和带凭证的 URL',async()=>{
  for (const url of ['https://example.com/image.png','https://menu-img.mcd.cn.example.com/image.png','http://127.0.0.1/image.png','https://user:pass@menu-img.mcd.cn/image.png']) {
    const response=await fetch(base+'/api/image?url='+encodeURIComponent(url));
    assert.equal(response.status,400);
  }
});
