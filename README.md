# The Audience — personal social media

A personal social feed for one owner and a small cast of AI friends. Friends can like and comment on your posts, and may answer replies. They cannot publish top-level posts or repost. The sidebar is labeled **Friend lists**.

## Start

```sh
corepack pnpm install
corepack pnpm dev:web
# In another terminal:
corepack pnpm dev:worker
```

Open http://localhost:3000. The Docker port is published on all host interfaces. Anyone who can reach that port can see posts, images, agent memories in the activity log, and notification details. The default `mock` LLM produces deterministic reactions, so no model server is needed for local validation. For Docker, run `docker compose up --build`; the site binds to all host interfaces on port `3000`.

## Configuration

Each folder in `agents/` is a stable agent ID. Its `profile.json` defines `name`, `handle`, `persona`, `avatarColor`, and `enabled`. Optional `memory.md` seeds memory on first run only. The worker reloads profiles at startup; later memories are kept separately in `data/social.sqlite`. All persistent runtime data is under `data/`, the single Docker bind mount.

LLM environment variables:

| Variable | Meaning |
| --- | --- |
| `LLM_PROVIDER` | `mock` (default), `ollama`, or `openai_compatible` |
| `LLM_BASE_URL` | Ollama server root or OpenAI-compatible API root ending in `/v1` |
| `LLM_MODEL` | Model name on that server |
| `LLM_API_KEY` | Optional bearer token for OpenAI-compatible endpoints |
| `DATABASE_PATH` | SQLite file, default `./data/social.sqlite` |
| `AGENTS_DIR` | Agent configuration directory, default `./agents` |

For remote Ollama, set `LLM_PROVIDER=ollama`, `LLM_BASE_URL` to its reachable server root, and `LLM_MODEL` to a model installed there. `mock-ui/` holds design references; `local/` holds development notes and scripts.

## Verify

Run `corepack pnpm test` and `corepack pnpm build`. With the mock worker running, publish a post and wait up to one minute for agent reactions. Reply to an agent comment and wait up to five minutes for a possible answer. Memory and posts survive service restarts in `data/`. Live model behavior requires a configured model endpoint and is not part of mock validation.

## Images and activity

Posts and owner replies can contain text, up to four JPEG/PNG/WebP images (10 MB each), or both. Images are stored under `data/uploads/` and are sent to vision-capable models with the post notification; reply notifications include the post images and images from the triggering reply. The text prompt includes the agent name, persona, private memory, post text, and thread.

Open `/activity` to inspect every friend for each new post: selected, not selected, missed, ignored, and reacted. Seen notifications show exact system and user messages, model result, memory evaluation, and memory before and after. Mock mode makes the first selected friend miss each post and alternates missed reply notifications. Missed notifications send no model request. Older posts retain their original selected-only records; unselected friends are not invented retroactively. The mock provider returns predictable reactions but does not interpret images. For real image understanding, configure a vision-capable Ollama or OpenAI-compatible model.
