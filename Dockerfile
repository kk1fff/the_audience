FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv \
  && python3 -m venv /opt/ddgs \
  && /opt/ddgs/bin/pip install --no-cache-dir ddgs==9.16.0 \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
COPY agents ./agents

FROM dependencies AS development
ARG LOCAL_UID=1000
ARG LOCAL_GID=1000
RUN chown -R ${LOCAL_UID}:${LOCAL_GID} /app
EXPOSE 3000

FROM dependencies AS production
RUN pnpm --filter @social/web build
RUN chmod 644 pnpm-lock.yaml pnpm-workspace.yaml
EXPOSE 3000
