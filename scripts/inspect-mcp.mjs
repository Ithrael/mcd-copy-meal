import { withMcd } from '../lib/mcd.js';
const token = process.env.MCD_MCP_TOKEN?.trim();
if (!token) { console.error('请在 .env.local 中配置 MCD_MCP_TOKEN。'); process.exit(1); }
try {
  await withMcd(token, async ({definitions}) => {
    for (const name of ['query-nearby-stores','query-meals','query-store-coupons','calculate-price']) console.log(JSON.stringify({name,inputSchema:definitions.get(name)},null,2));
  });
} catch (error) { console.error(error.message); process.exitCode=1; }
