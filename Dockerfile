# syntax=docker/dockerfile:1
# api-grep as an HTTP server (`serve`, the default command) or as the CLI:
#   docker run --rm -p 8080:8080 -e API_GREP_TOKEN=<16+ characters> ghcr.io/okapi-hq/api-grep
#   docker run --rm -v "$PWD:/repo:ro" ghcr.io/okapi-hq/api-grep scan /repo --json
ARG NODE_IMAGE=node:24-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# The bundle and the tree-sitter grammars (copied from devDependencies into dist/grammars).
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY tsconfig.json tsup.config.ts ./
COPY src ./src
COPY schema ./schema
RUN pnpm build

# Runtime dependencies only.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

FROM ${NODE_IMAGE}
# The commit the image is built from: reports and --version read `<version>+<commit>`.
ARG API_GREP_COMMIT=""
ENV NODE_ENV=production \
    API_GREP_BUILD=${API_GREP_COMMIT} \
    API_GREP_HOST=:: \
    API_GREP_PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY schema ./schema
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.API_GREP_PORT + '/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["serve"]
