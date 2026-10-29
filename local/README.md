# Local development

Run `corepack pnpm install`, then start `corepack pnpm dev:web` and `corepack pnpm dev:worker` in separate terminals. Copy `.env.example` to `.env` and export its variables when using a real LLM. This folder is for local scripts and notes; machine-specific files should stay untracked.

For local DDGS background search, create a Python virtual environment and install the pinned adapter:

```sh
python3 -m venv .venv-ddgs
.venv-ddgs/bin/pip install ddgs==9.16.0
export BACKGROUND_PYTHON="$PWD/.venv-ddgs/bin/python"
```

With `EXA_API_KEY` set, the worker uses Exa instead and does not call DDGS. Weather and BBC news use short HTTP timeouts. Any unavailable source is recorded in Activity while the agent decision continues. Docker installs DDGS and sets `BACKGROUND_PYTHON` automatically; rebuild the worker image after changing this feature.
