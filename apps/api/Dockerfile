# Imagem da API PR7 para o servidor (contexto de build = raiz do projeto):
#   docker build -f apps/api/Dockerfile -t pr7-api .
# Serve também o painel em /painel. Aplica as migrações do banco ao subir.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN npm ci --workspace=apps/api --include-workspace-root --no-audit --no-fund
COPY apps/api ./apps/api
RUN cd apps/api && npx prisma generate && npx nest build

FROM node:22-alpine
# openssl: Prisma · postgresql16-client: pg_dump do backup automático
RUN apk add --no-cache openssl postgresql16-client tzdata
ENV TZ=America/Sao_Paulo NODE_ENV=production BACKUP_DIRETO=true
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/assets ./apps/api/assets
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY apps/admin ./apps/admin
WORKDIR /app/apps/api
# Fotos/comprovantes e backups ficam em volumes (não se perdem ao atualizar a imagem)
VOLUME ["/app/storage", "/app/backups"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/webhooks/whatsapp || exit 1
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
