# 公网部署指南（方案二：Render 免费档，推荐）

项目已内置 `render.yaml` 蓝图：把代码推上 GitHub 后，Render 会自动识别并部署，
**不需要写任何服务器命令**。部署完成后得到一个固定网址，发给朋友即可联机。

## 第 1 步：推到 GitHub

```bash
cd mahjong
git init
git add .
git commit -m "雅趣麻将：全平台联机版"
git branch -M main
git remote add origin https://github.com/你的用户名/jingzhi-mahjong.git
git push -u origin main
```

> 请先在 GitHub 网页上新建一个空仓库（不要勾选 README），再把上面命令里的仓库地址换成你自己的。

## 第 2 步：在 Render 创建服务

1. 打开 [render.com](https://render.com)，用 GitHub 账号注册/登录（免费）。
2. 点右上角 **New +** → 选 **Blueprint**。
3. 连接你的 GitHub 账号，选择刚推送的 `jingzhi-mahjong` 仓库。
4. Render 会读取仓库根目录的 `render.yaml`，自动填好：
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Health Check：`/`
   - Node 版本：20
5. 点 **Apply / Deploy**，等待 2~5 分钟，状态变为 **Live**。

## 第 3 步：把网址发给朋友

部署完成后，Render 会给你一个地址，形如：

```
https://jingzhi-mahjong.onrender.com
```

- 电脑朋友：浏览器直接打开；
- 手机朋友：同一网址，建议横屏；iPhone「添加到主屏幕」/ Android「安装应用」即可当 App 用；
- 玩法：一方点「联机对战 → 创建房间」，把 6 位房间码发给其他人 → 加入 → 房主开始。

## 其他部署方式

### Fly.io（同样有免费额度，启动更快）

```bash
fly launch   # 会自动识别 Dockerfile
fly deploy
```

### 自己的云服务器（VPS）

```bash
# Ubuntu 示例
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /opt/mahjong && npm install
sudo npm i -g pm2
pm2 start server/server.js --name mahjong
pm2 save && pm2 startup
```

需要 HTTPS 时用 Nginx 反代（配置见下方）。

## 常见问题

| 问题 | 说明 |
| --- | --- |
| 端口怎么填 | Render/Fly 会自动注入 `PORT`，服务器代码已自动读取，不需要手动设置 |
| WebSocket 支持吗 | 支持。网页、联机共用同一端口，Render 原生放行 WebSocket 升级 |
| 免费版慢/休眠 | Render 免费服务闲置会休眠，第一次打开约等 30~60 秒唤醒；客户端会自动重连 |
| 手机能玩吗 | 能，同一网址即可；建议横屏 |
| 更新代码 | 直接 `git push`，Render 会自动重新部署（Blueprint 默认 autoDeploy） |
| 房间安全 | 房间码 6 位 + 服务器权威校验；想要更多控制可后续加房间密码/账号 |

## 附：Nginx + HTTPS 反向代理（自建 VPS 用）

```nginx
server {
  listen 443 ssl;
  server_name mahjong.example.com;
  ssl_certificate     /etc/letsencrypt/live/example/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```
