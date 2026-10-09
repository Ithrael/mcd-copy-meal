export function foodKind(name) {
  if (/汉堡|鸡腿堡|麦香鸡|麦香鱼|麦满分|松饼堡|营养卷|巨无霸|鸡排|笋卷/.test(name)) return 'main';
  if (/薯|麦乐鸡|鸡翅|玉米杯|派|鸡米花/.test(name)) return 'side';
  if (/可乐|雪碧|咖啡|冰咖|美式|奶铁|豆浆|牛奶|红茶|黑巧|饮|怡泉|橙橙|柠柠|果汁|苹果汁/.test(name)) return 'drink';
  return null;
}

export function defaultModification(detail) {
  const values = (detail.modification?.items || []).flatMap(item => {
    const selected = (item.values || []).filter(value => value.selectedQuantity > 0);
    if (selected.length < (item.minValues || 0)) throw new Error('餐品特制缺少官方默认选项。');
    return (item.values || []).filter(value=>value.selectedQuantity>0 || value.unselectedKey).map(value => {
      const key=value.selectedQuantity>0 ? value.selectedKey : value.unselectedKey;
      if (!value.code || key == null || !Number.isInteger(value.selectedQuantity) || value.selectedQuantity<0) throw new Error('餐品默认选项结构尚未适配。');
      return {code:String(value.code),key:String(key),quantity:value.selectedQuantity};
    });
  });
  return values.length ? {values} : undefined;
}

export function detailedProduct(product, detail, images = new Map()) {
  if (typeof detail.name !== 'string' || !detail.name) throw new Error('餐品详情缺少名称。');
  const rounds = (detail.rounds || []).map(round => {
    const min = round.minQuantity ?? round.quantity;
    const max = round.maxQuantity ?? round.quantity;
    if (round.id == null || !round.name || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < Math.max(1,min) || max > 4 || !Array.isArray(round.choices)) throw new Error('套餐选件结构暂不支持。');
    const choices = round.choices.filter(choice=>choice.available !== false && choice.soldOut !== true).map(choice => {
      if (!choice.code || !choice.name) throw new Error('套餐选件缺少餐品名称或编码。');
      const extra = String(choice.diffPrice ?? '+ ¥0').match(/^([+-])?\s*[¥￥]?\s*(\d+(?:\.\d+)?)$/);
      if (!extra) throw new Error('套餐选件加价尚未适配。');
      return {code:String(choice.code),name:choice.name,kind:foodKind(choice.name),image:images.get(String(choice.code)) || '',extraCents:Math.round(Number(extra[2])*100)*(extra[1]==='-'?-1:1),defaultQuantity:choice.quantity || (choice.isDefault===1?1:0),maxQuantity:choice.maxQuantity > 0 ? choice.maxQuantity : max,modification:defaultModification(choice)};
    });
    if (!choices.length && min > 0) throw new Error('套餐当前缺少可选餐品。');
    return {id:String(round.id),name:round.name,min,max,choices};
  });
  return {...product,name:detail.name,kind:rounds.length>1?'bundle':product.kind,rounds,modification:defaultModification(detail)};
}

export function selectProduct(product, requested, quantity = 1, useDefaults = false) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 8) throw new Error('餐品份数请设置在 1～8 之间。');
  if (!product.rounds?.length) {
    if (requested?.length) throw new Error('该单品没有套餐选件。');
    return {...product,quantity};
  }
  const groups = requested ?? (useDefaults ? product.rounds.map(round=>({name:round.name,items:round.choices.filter(choice=>choice.defaultQuantity>0).map(choice=>({name:choice.name,quantity:choice.defaultQuantity}))})) : null);
  if (!Array.isArray(groups) || groups.length !== product.rounds.length) throw new Error(`${product.name}需要完整套餐选件，请手动选择。`);
  const contents = [];
  let extraCents = 0;
  const selections = [];
  const roundList = product.rounds.map((round,index)=>{
    const group = groups[index];
    if (group?.name !== round.name || !Array.isArray(group.items) || group.items.length > 4) throw new Error(`${product.name}的“${round.name}”选件不完整，请手动选择。`);
    const names = new Set();
    let count = 0;
    const comboItemList = group.items.map(row=>{
      if (typeof row?.name !== 'string' || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 4 || names.has(row.name)) throw new Error('套餐选件名称或份数不正确。');
      names.add(row.name);
      const choice = round.choices.find(choice=>choice.name===row.name);
      if (!choice) { const error=new Error(`这家门店的${product.name}未提供：${row.name}。请换门店或手动修改选件。`);error.missing=[row.name];throw error; }
      if (row.quantity > choice.maxQuantity) throw new Error(`${row.name}超过套餐允许的份数。`);
      count += row.quantity; extraCents += choice.extraCents * row.quantity;
      contents.push({name:choice.name,kind:choice.kind,image:choice.image,quantity:row.quantity*quantity});
      return {code:choice.code,quantity:row.quantity,...(choice.modification?{modification:choice.modification}:{})};
    });
    if (count < round.min || count > round.max) throw new Error(`“${round.name}”需选择 ${round.min===round.max?round.min:`${round.min}～${round.max}`} 份餐品。`);
    selections.push({name:round.name,items:group.items.map(({name,quantity})=>({name,quantity}))});
    return {round:round.id,comboItemList};
  });
  return {...product,quantity,price:product.price+extraCents,contents,selections,roundList};
}

export function foodItems(items) {
  return items.flatMap(item=>item.contents || [{name:item.name,kind:item.kind,image:item.image,quantity:item.quantity}]);
}

export function fulfills(items, options) {
  const foods = foodItems(items);
  return options.mustHave.every(name=>items.some(item=>item.name===name)||foods.some(food=>food.name===name))
    && foods.some(food=>food.kind==='main')
    && (!options.includeSide || foods.some(food=>food.kind==='side'))
    && (!options.includeDrink || foods.some(food=>food.kind==='drink'));
}

export function bundleVariants(product, options) {
  if (!product.rounds?.length) return [];
  const variants = [];
  try { variants.push(selectProduct(product,undefined,1,true)); } catch {}
  // General multi-pick rounds can be edited; bounded recommendations expand single-pick rounds.
  if (product.rounds.some(round=>round.min!==1||round.max!==1)) return variants;
  let groups = [[]];
  for (const round of product.rounds) {
    const choices = [...round.choices].sort((a,b)=>Number(options.mustHave.includes(b.name))-Number(options.mustHave.includes(a.name)) || a.extraCents-b.extraCents || b.defaultQuantity-a.defaultQuantity);
    groups = groups.flatMap(group=>choices.map(choice=>[...group,{name:round.name,items:[{name:choice.name,quantity:1}]}])).slice(0,256);
  }
  variants.push(...groups.map(group=>selectProduct(product,group)));
  const unique = new Map(variants.map(variant=>[JSON.stringify(variant.selections),variant]));
  return [...unique.values()];
}
