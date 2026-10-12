import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const source = new URL('../public/',import.meta.url);
const output = new URL('../dist/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for (const name of ['style.css','favicon.svg','share.js','assets']) {
  await cp(new URL(name,source),new URL(name,output),{recursive:true});
}
const html = (await readFile(new URL('index.html',source),'utf8')).replace('<html lang="zh-CN">','<html lang="zh-CN" data-hosting="pages">');
await writeFile(new URL('index.html',output),html);
await writeFile(new URL('.nojekyll',output),'');
const licenses = await Promise.all(['../LICENSE','../node_modules/qrcode/license','../node_modules/dijkstrajs/LICENSE.md'].map(path=>readFile(new URL(path,import.meta.url),'utf8')));
await writeFile(new URL('LICENSE.txt',output),licenses.join('\n\n---\n\n'));
await build({entryPoints:[fileURLToPath(new URL('app.js',source))],outfile:fileURLToPath(new URL('app.js',output)),bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,legalComments:'eof'});
console.log('GitHub Pages 演示已构建到 dist/，不包含服务端或环境文件。');
