# 雅趣麻将 · Render / Fly / 任意容器平台通用镜像
FROM node:20-alpine

WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 再复制源码与静态资源
COPY . .

ENV PORT=8000
EXPOSE 8000

CMD ["npm", "start"]
