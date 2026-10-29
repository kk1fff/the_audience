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

Each folder in `agents/` is a stable agent ID. Its `profile.json` defines `name`, `handle`, `persona`, `avatarColor`, and `enabled`. Built-in agents also have `city`, IANA `timeZone`, `latitude`, and `longitude` for local background; custom agents can omit these and weather will be unavailable. Optional `memory.md` seeds memory on first run only. The worker reloads profiles at startup; later memories are kept separately in `data/social.sqlite`. All persistent runtime data is under `data/`, the single Docker bind mount.

LLM environment variables:

| Variable | Meaning |
| --- | --- |
| `LLM_PROVIDER` | `mock` (default), `ollama`, or `openai_compatible` |
| `LLM_BASE_URL` | Ollama server root or OpenAI-compatible API root ending in `/v1` |
| `LLM_MODEL` | Model name on that server |
| `LLM_THINK` | Optional `true` or `false` for Ollama thinking mode |
| `LLM_API_KEY` | Optional bearer token for OpenAI-compatible endpoints |
| `DATABASE_PATH` | SQLite file, default `./data/social.sqlite` |
| `AGENTS_DIR` | Agent configuration directory, default `./agents` |
| `EXA_API_KEY` | Optional Exa search key; when absent, search uses the Python `ddgs` adapter |
| `BACKGROUND_PYTHON` | Python executable containing `ddgs`, default `python3` locally and `/opt/ddgs/bin/python` in Docker |

For remote Ollama, set `LLM_PROVIDER=ollama`, `LLM_BASE_URL` to its reachable server root, and `LLM_MODEL` to a model installed there. `mock-ui/` holds design references; `local/` holds development notes and scripts.

The worker builds a small optional background bundle before each model request. Local time uses the agent's configured timezone. Weather comes from [Open-Meteo](https://open-meteo.com/en/docs); a world headline comes from the [BBC News RSS feed](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm). Search sends only a fixed allowlist of public-topic keywords to [DDGS](https://github.com/deedy5/ddgs) or [Exa](https://exa.ai/docs/reference/search); it never sends full post text, handles, images, comments, or memory. Results are cached in worker memory with source freshness recorded on each attempt. Weather, news, or search outages do not block an agent's decision. The model is asked to use background only when it naturally helps the conversation, and saved comments have links removed.

## Verify

Run `corepack pnpm test` and `corepack pnpm build`. With the mock worker running, publish a post and wait up to one minute for agent reactions. Reply to an agent comment and wait up to five minutes for a possible answer. Memory and posts survive service restarts in `data/`. Live model behavior requires a configured model endpoint and is not part of mock validation.

## Images and activity

Posts and owner replies can contain text, up to four JPEG/PNG/WebP images (10 MB each), or both. Images are stored under `data/uploads/` and are sent to vision-capable models with the post notification; reply notifications include the post images and images from the triggering reply. The text prompt includes the agent name, persona, private memory, post text, and thread.

Open `/activity` to inspect every friend for each new post: selected, not selected, missed, ignored, and reacted. Each enabled friend also checks the feed on its own interval, discovers the newest post whose notification was missed or not selected, and may react to it. Checks and notifications appear as separate activity entries. New agents receive distinct default intervals starting at 5 minutes, and the schedule persists across worker restarts. Set `feedCheckIntervalMinutes` (an integer from 1 to 1440) in an agent's `profile.json` to override it. Seen attempts show background source status and timestamps, exact system and user messages, model result, memory evaluation, and memory before and after. Mock mode makes the first selected friend miss each post and alternates missed reply notifications. Missed notifications send no model request. The mock provider returns predictable reactions but does not interpret images. For real image understanding, configure a vision-capable Ollama or OpenAI-compatible model.
