# 发布在线演示与真实核价服务

## GitHub Pages 演示版

用户已选择此方案。在线演示复用原有界面和配餐规则，提供预算配餐、套餐修改、分享、换演示门店及 PNG 导出。所有价格为示例，不连接账户；真实 MCP 核价由本地 Node 版提供。

仓库包含 `.github/workflows/pages.yml`。在仓库 Pages 设置中选择 GitHub Actions 后，推送到 `main` 会执行检查、测试、静态打包及 Pages 发布。公开地址在部署与浏览器核验成功后补充。

本地构建：

```sh
npm ci
npm run build:pages
```

仅发布 `dist/`，支持项目子路径。输出包含页面、打包 JS、CSS、演示图片、二维码依赖许可和 `.nojekyll`；不包含环境文件、Node 服务或真实响应。演示请求在浏览器完成，不需要 `/api/*` 后端。

依据：[GitHub Pages 静态托管](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[官方 Actions 发布流程](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

## 完整实时核价服务（可选）

此模式需要运行现有 Node 服务，GitHub Pages 不能承载它。下面两种后端方案尚未部署。

## Render

仓库提供 `render.yaml`，使用一台 Web Service，不增加数据库。

1. 当前代码已公开于 [Ithrael/mcd-copy-meal](https://github.com/Ithrael/mcd-copy-meal)。
2. 登录 Render 后打开[此版本的部署入口](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2FIthrael%2Fmcd-copy-meal)，检查 `render.yaml` 中的一台免费 Web Service；也可在 [Render Dashboard](https://dashboard.render.com/) 新建 Blueprint，连接该仓库。
3. 检查环境变量：`HOST=0.0.0.0`，`NODE_ENV=production`，`NODE_VERSION=22`；**`MCD_MCP_TOKEN` 必须留空**。个人 `.env.local` 不上传。
4. 部署完成后打开实际 HTTPS 地址，验证 `/api/status` 返回 `mode: demo`、`hasServerToken: false`。
5. 在两个浏览器会话内完成：演示生成 → 编辑 → 分享 → 换门店重算 → PNG 扫码。再用个人 Token 在营业中的真实门店核价；确认刷新后 Token 不保留。
6. 把核验通过的真实地址补进 README 和传播材料。尚未部署成功时，不写虚构体验链接。

| 设置 | 值 |
| --- | --- |
| Runtime | Node |
| Build command | `npm ci --omit=dev` |
| Start command | `npm start` |
| Health check | `/api/status` |

Render 的免费服务可能休眠，首次访问需要等待唤醒；面向比赛集中演示前先确认加载速度和账号当时的免费额度。方案不自动购买付费资源。

依据：[官方 Node 部署步骤](https://render.com/docs/deploy-node-express-app)、[部署入口说明](https://render.com/docs/deploy-to-render)、[Blueprint 配置](https://render.com/docs/blueprint-spec)、[Node 版本设置](https://render.com/docs/node-version)、[免费服务说明](https://render.com/docs/free)。

## 自己的服务器

在 Node 22 或 24 环境运行以下命令，由现有反向代理提供 HTTPS；转发时保留原始 Host，以便分享二维码和同源校验使用正确域名。

```sh
npm ci --omit=dev
HOST=0.0.0.0 NODE_ENV=production MCD_MCP_TOKEN= PORT=3107 npm start
```

服务器不需要本机 `.env.local`、`.git/`、测试产物或用户数据；不记录携带 Token 的请求头。
