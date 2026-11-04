# Local development

## Docker working-tree iteration

Use this stack while an agent edits and tests the project, including code that has not been committed:

```sh
mkdir -p data/dev
docker compose -f docker-compose.dev.yml up -d --build
```

Open http://localhost:3001. This is a standalone Compose file, not an override to combine with `docker-compose.yml`. Its project name is `audience-dev`, its port binds to localhost, and its data lives under `data/dev/`. The production stack and its data remain separate. Set `DEV_PORT` to choose another port. If your host UID/GID are not 1000, set `LOCAL_UID` and `LOCAL_GID` to your numeric IDs before building and starting.

The running containers read the current working tree through read-only source mounts. The coding agent edits the host files; Next.js reloads web changes and `tsx watch` restarts the worker when worker or shared-package TypeScript changes. New source files inside the mounted directories are included automatically. No commit, merge, or rebuild is needed for that edit/test loop.

Mounted paths are `apps/web/app`, `apps/web/components`, `apps/web/lib`, `apps/web/next.config.mjs`, `apps/worker/src`, each existing `packages/*/src`, and `agents`. Dependencies and generated Next.js files stay inside the container, so host `node_modules` and `.next` do not interfere. Rebuild after changing dependencies, manifests, TypeScript configuration, or the Dockerfile. Add mounts explicitly if creating a new package or a new source root outside these paths.

```sh
# Observe the current uncommitted code running
docker compose -f docker-compose.dev.yml logs -f --tail=100 web worker

# Run the regression suite against mounted source
docker compose -f docker-compose.dev.yml exec -w /app web corepack pnpm test

# Apply agent configuration edits (overlays live in data/dev/agents)
docker compose -f docker-compose.dev.yml restart worker

# Rebuild after dependencies or build configuration change
docker compose -f docker-compose.dev.yml up -d --build

# Stop development without deleting its data
docker compose -f docker-compose.dev.yml down
```

Development uses mock responses by default, even if production `.env` selects a real model. To opt in, set `DEV_LLM_PROVIDER`, `DEV_LLM_BASE_URL`, `DEV_LLM_MODEL`, and optionally `DEV_LLM_API_KEY`, `DEV_LLM_THINK`, or `DEV_EXA_API_KEY` in `.env`, then recreate with `docker compose -f docker-compose.dev.yml up -d --force-recreate worker`. Do not use `localhost` to reach a model server on the host from a container; use `host.docker.internal` or its reachable address.

Before submitting a PR, run the regression suite and production build. Review and merge remain delivery gates, not prerequisites for trying edits. Recreating containers picks up the current working tree but retains `data/dev/`; deleting development data is a separate, explicit action.

## Native development

Run `corepack pnpm install`, then start `corepack pnpm dev:web` and `corepack pnpm dev:worker` in separate terminals. Copy `.env.example` to `.env` and export its variables when using a real LLM. This folder is for local scripts and notes; machine-specific files should stay untracked.

For local DDGS background search, create a Python virtual environment and install the pinned adapter:

```sh
python3 -m venv .venv-ddgs
.venv-ddgs/bin/pip install ddgs==9.16.0
export BACKGROUND_PYTHON="$PWD/.venv-ddgs/bin/python"
```

With `EXA_API_KEY` set, the worker uses Exa instead and does not call DDGS. Weather and BBC news use short HTTP timeouts. Any unavailable source is recorded in Activity while the agent decision continues. Docker installs DDGS and sets `BACKGROUND_PYTHON` automatically; rebuild the worker image after changing this feature.
