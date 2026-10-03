# Runtime image for a host that cannot build the project (small VPS, other architecture):
# the bundle in dist-npm/ is built beforehand by deploy.sh. Same runtime stage as the root Dockerfile.
FROM node:22-slim
# git is required: the vault is a git repository and every save is a commit. ssh lets it push to GitHub with a deploy key.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*'
ENV NODE_ENV=production
WORKDIR /app
COPY dist-npm/ ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force
RUN mkdir -p /vault /data && chown -R node:node /vault /data /app
USER node
ENV DFL_HOST=0.0.0.0 DFL_PORT=4000 DFL_DATA_DIR=/data DFL_EMBED=hash
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.DFL_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["node", "/app/bin.js"]
CMD ["serve", "/vault"]
