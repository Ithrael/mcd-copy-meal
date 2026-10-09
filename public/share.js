const MAX_LENGTH = 6000;
export function validateShare(input) {
  if (![1,2].includes(input?.v) || typeof input.title !== 'string' || input.title.length > 80 || !Number.isSafeInteger(input.budget) || input.budget < 100 || input.budget > 50000 || !Array.isArray(input.items) || input.items.length < 1 || input.items.length > 8) throw new Error('这份分享攻略格式不正确，请让朋友重新生成链接。');
  const items = input.items.map(item => {
    if (typeof item?.name !== 'string' || !item.name.trim() || item.name.length > 80 || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 8) throw new Error('分享攻略中的餐品格式不正确。');
    let selections;
    if (item.selections !== undefined) {
      if (input.v!==2 || !Array.isArray(item.selections) || item.selections.length<1 || item.selections.length>6) throw new Error('套餐分享选件不完整。');
      selections=item.selections.map(group=>{
        if (typeof group?.name!=='string' || !group.name.trim() || group.name.length>80 || !Array.isArray(group.items) || group.items.length>4) throw new Error('套餐分享选件格式不正确。');
        return {name:group.name,items:group.items.map(row=>{
          if (typeof row?.name!=='string' || !row.name.trim() || row.name.length>80 || !Number.isInteger(row.quantity) || row.quantity<1 || row.quantity>4) throw new Error('套餐分享选件格式不正确。');
          return {name:row.name,quantity:row.quantity};
        })};
      });
    }
    return { name: item.name, quantity: item.quantity,...(selections?{selections}:{}) };
  });
  // Allowlist deliberately strips all other fields, including tokens and coupon IDs.
  return { v: input.v, title: input.title, budget: input.budget, items };
}
export function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateShare(payload)));
  const encoded=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  if(encoded.length>MAX_LENGTH)throw new Error('搭配信息过长，请减少餐品后分享。');
  return encoded;
}
export function decodeShare(encoded) {
  if (!encoded || encoded.length > MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('分享链接不完整，请重新复制。');
  try {
    const text = atob(encoded.replace(/-/g,'+').replace(/_/g,'/'));
    return validateShare(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(text, c => c.charCodeAt(0)))));
  } catch { throw new Error('分享攻略无法读取，请让朋友重新生成链接。'); }
}
