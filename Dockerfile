# Imagem de produção do Gestão de Melhorias (usada pelo Fly.io; funciona em qualquer serviço com Docker).

# 1) Build: instala tudo e compila frontend e backend
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# 2) Execução: só o necessário para rodar
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
