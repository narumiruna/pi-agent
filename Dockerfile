FROM node:24-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY biome.json tsconfig.json tsconfig.server.json tsconfig.web.json vite.config.ts vitest.config.ts ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git openssh-client ripgrep \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    PI_CODING_AGENT_DIR=/app/.pi/agent \
    DATA_DIR=/app/data \
    WORKSPACE=/workspace \
    HOME=/app/home \
    NPM_CONFIG_CACHE=/app/.npm \
    GIT_TERMINAL_PROMPT=0 \
    GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=10"

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/.pi/agent /app/data /app/home /app/.npm /workspace \
  && chown -R 10001:10001 /app/.pi /app/data /app/home /app/.npm /workspace

USER 10001:10001
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/index.js"]
