# syntax=docker/dockerfile:1
# Defluance: one image, web UI + REST API + MCP endpoint in a single Node process.

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
# Stages dist-npm/: the bundled server, the exported web UI and the runtime package.json.
RUN node scripts/pack-cli.mjs --no-pack

FROM node:22-slim
# git is required: the vault is a git repository and every save is a commit.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*'
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /src/dist-npm/ ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force
# /vault is the folder of Markdown notes (mount your own), /data holds the index and sessions.
RUN mkdir -p /vault /data && chown -R node:node /vault /data /app
USER node
ENV DFL_HOST=0.0.0.0 DFL_PORT=4000 DFL_DATA_DIR=/data
EXPOSE 4000
VOLUME ["/vault", "/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DFL_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "/app/bin.js"]
CMD ["serve", "/vault"]
