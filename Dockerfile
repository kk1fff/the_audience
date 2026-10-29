FROM node:22-bookworm-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @social/web build
COPY agents ./agents
RUN chmod 644 pnpm-lock.yaml pnpm-workspace.yaml
EXPOSE 3000
