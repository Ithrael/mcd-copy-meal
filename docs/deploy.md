# 部署到公网

本项目需要 Node 服务，不能只把 `public/` 上传到静态托管。当前没有已发布的公网地址。

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
