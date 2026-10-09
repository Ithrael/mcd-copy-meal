// These amounts and offers are fixtures, not current McDonald's prices.
const photos = {
  chicken: 'https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_1450_320.png',
  spicy: 'https://menu-img.mcd.cn/pcm/prod/menu/20260325/product/MS_1440_320.png',
  grilled: 'https://menu-img.mcd.cn/pcm/prod/menu/20241008/product/MS_1406_320.png',
  cheese: 'https://menu-img.mcd.cn/pcm/prod/menu/20260309/product/MS_1120_320.png',
  fish: 'https://menu-img.mcd.cn/pcm/prod/menu/20260101/product/MS_1600_320.png',
  fries: 'https://menu-img.mcd.cn/pcm/prod/menu/20250523/product/MS_G4810_320_1747877491921.png',
  nuggets: 'https://menu-img.mcd.cn/pcm/prod/menu/20260529/product/MS_G1401_320.png',
  corn: 'https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_G4437_320.png',
  cola: 'https://menu-img.mcd.cn/pcm/prod/menu/ProductPool/product/MS_9900008751_320.gif',
  coffee: 'https://menu-img.mcd.cn/pcm/prod/menu/20260422/product/MS_G507374_320.gif',
};
export const demoStores = [
  { code: 'demo-shanghai', name: '上海 · 演示门店', address: '虚拟门店，用于体验生成和分享流程', city: '上海' },
  { code: 'demo-hangzhou', name: '杭州 · 演示门店', address: '虚拟门店，切换后会重新计算示例金额', city: '杭州' },
];
const rows = [
  ['1450', '麦香鸡', 'main', 1900, 'chicken'],
  ['1440', '麦辣鸡腿汉堡', 'main', 2550, 'spicy'],
  ['1406', '板烧鸡腿堡', 'main', 2600, 'grilled'],
  ['1120', '双层吉士汉堡', 'main', 2550, 'cheese'],
  ['1600', '麦香鱼', 'main', 2450, 'fish'],
  ['4810', '薯条', 'side', 1450, 'fries'],
  ['1401', '麦乐鸡', 'side', 1550, 'nuggets'],
  ['4437', '玉米杯', 'side', 1450, 'corn'],
  ['9900008751', '可乐', 'drink', 1000, 'cola'],
  ['507411', '麦咖啡™美式', 'drink', 2300, 'coffee'],
];
export function demoCatalog(storeCode = demoStores[0].code) {
  const store = demoStores.find(s => s.code === storeCode);
  if (!store) throw new Error('请选择列表中的演示门店。');
  return {
    mode: 'demo', store, checkedAt: new Date().toISOString(),
    source: '演示菜单与示例金额，未进行实时核验',
    products: rows.filter(r => !(storeCode === 'demo-hangzhou' && r[0] === '1600')).map(([code, name, kind, cents, photo]) => ({
      code, name, kind, price: cents + (storeCode === 'demo-hangzhou' ? 100 : 0),
      image: `/assets/${photo}.${photo === 'cola' || photo === 'coffee' ? 'gif' : 'png'}`,
    })),
  };
}
export function demoQuote(catalog, items) {
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const threePiece = items.length === 3 && items.every(i => i.quantity === 1) && new Set(items.map(i => i.kind)).size === 3;
  const discount = threePiece ? 1600 : 0;
  return { total: subtotal - discount, subtotal, discount, source: '演示核价', offer: discount ? '示例三件搭配优惠' : '示例单点金额' };
}
export { photos };
