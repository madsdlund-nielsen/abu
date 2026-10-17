# syntax=docker/dockerfile:1

# ---- deps ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# Kun låste versioner (package-lock.json); scripts køres (postinstall = prisma generate)
RUN npm ci --no-audit --no-fund

# ---- build (bruges også til migrationer/seed via docker-compose-servicen "migrate") ----
FROM node:22-bookworm-slim AS build
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runner
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/data/uploads
RUN useradd --system --uid 1001 abu && mkdir -p /data/uploads && chown -R abu /data
COPY --from=build --chown=abu /app/.next/standalone ./
COPY --from=build --chown=abu /app/.next/static ./.next/static
COPY --from=build --chown=abu /app/public ./public
USER abu
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
