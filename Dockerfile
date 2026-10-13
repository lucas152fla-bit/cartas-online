# Cartas Online — imagem de produção
# Requer Node 24+ (usa node:sqlite sem flag)
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependências (usa o package-lock para build reproduzível)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Código da aplicação
COPY . .

ENV PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# O banco SQLite e o segredo de sessão vivem em /app/data.
# Monte um volume persistente aqui para não perder contas/carteira.
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
