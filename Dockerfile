FROM node:22-bookworm-slim
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
RUN pnpm --filter @social/web build
COPY agents ./agents
RUN chmod 644 pnpm-lock.yaml pnpm-workspace.yaml
EXPOSE 3000
