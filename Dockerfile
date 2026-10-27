# Headless Aiden Teams worker for Linux servers, such as a Fly.io machine.
# It runs Aiden's worker with no desktop app and picks up team work on the member's own
# subscription. See docs/linux-fly.md.
#
#   docker build -t aiden-teams-worker .
#   docker run --init -v aiden-data:/data aiden-teams-worker
#
# Set WITH_BROWSER=false to leave out Chromium; the machine then reports that it cannot run
# browser checks, and the team gives that work to other machines.

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm exec tsc -p tsconfig.json

FROM node:${NODE_VERSION}-bookworm-slim
ARG WITH_BROWSER=true
# The aiden wrapper also selects file credentials, since a server has no OS keychain.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 CI=true LANG=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod 0644 /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --uid 1001 --home-dir /data/home --no-create-home --shell /bin/bash aiden \
 && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/cli/package.json apps/cli/
COPY apps/desktop/package.json apps/desktop/
COPY packages ./packages
RUN pnpm install --prod --frozen-lockfile \
 && arch=$(dpkg --print-architecture | sed 's/amd64/x64/') \
 && ln -s "/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-$arch/claude" /usr/local/bin/claude \
 && claude --version \
 && if [ "$WITH_BROWSER" = true ]; then \
      node node_modules/playwright/cli.js install --with-deps chromium \
      && rm -rf /var/lib/apt/lists/*; \
    fi
COPY --from=build /app/dist ./dist
COPY workflows ./workflows
COPY LICENSE NOTICE THIRD_PARTY_NOTICES.md ./
COPY deploy/linux/aiden deploy/linux/entrypoint.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/aiden /usr/local/bin/entrypoint.sh
VOLUME /data
ENTRYPOINT ["entrypoint.sh"]
CMD ["serve"]
