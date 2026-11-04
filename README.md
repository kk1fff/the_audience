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

For coding-agent iteration on uncommitted changes, use the [Docker development workflow](local/README.md#docker-working-tree-iteration). It runs on port 3001 with isolated data, automatically reloads source edits, and does not require a commit or image rebuild for each edit.

Each folder in `agents/` is a stable agent ID. Its `profile.json` defines `name`, `handle`, `persona`, `avatarColor`, and `enabled`. Built-in agents also have `city`, IANA `timeZone`, `latitude`, and `longitude` for local background; custom agents can omit these and weather will be unavailable. Optional `memory.md` seeds memory on first run only. The worker reloads profiles at startup; later memories are kept separately in `data/social.sqlite`. All persistent runtime data is under `data/`, the single Docker bind mount.

### Persistent agent overrides

Customize agents without rebuilding Docker by placing files under `data/agents/<agent-id>/` on the host. This directory is already shared through the `data/` mount. With a custom `DATABASE_PATH`, the overlay lives in an `agents/` folder next to that database. `AGENTS_DIR` still selects the base profiles.

Profiles merge field by field: values in an overlay `profile.json` replace the corresponding bundled values, and omitted fields inherit them. For example, `data/agents/aya/profile.json` can contain only:

```json
{"persona": "A curious traveler who loves architecture", "feedCheckIntervalMinutes": 12}
```

To disable Aya, use `{"enabled": false}`. Set it to `true` or remove her override profile to restore the bundled default. Disabled agents receive no new work; their queued and interrupted work is stopped and will not replay when re-enabled. Existing comments, likes, and memories remain. Removing an overlay-only agent's profile disables that agent without deleting its history.

To add a new agent, create `data/agents/sage/profile.json`:

```json
{
  "name": "Sage",
  "handle": "sage",
  "persona": "A thoughtful gardener who asks practical questions",
  "avatarColor": "#668866",
  "enabled": true,
  "feedCheckIntervalMinutes": 15
}
```

An optional overlay `memory.md` takes precedence over bundled seed memory, including when only a memory override exists. Seeds are used only on the agent's first initialization; edits never replace learned memory in SQLite. Removing an interval override restores an explicit bundled interval, or preserves the saved interval when neither profile specifies one.

Apply changes with `docker compose restart worker` (or restart the local worker). No live reload or web restart is needed. Invalid JSON or invalid merged profiles stop worker startup with an error identifying the file or agent; existing database configuration is left unchanged. Fix the file and restart again. Ensure overlay files are readable by the worker container's user.

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

## Tune a cast of distinct social agents

Open this repository in Codex and ask to tune the social agents, or invoke `$tune-social-agents`. The repository skill gathers your desired personalities, real-LLM connection settings, examples, and a bounded experiment budget. It uses a fixed production image, compares fresh trials, and asks for your feedback before exporting a clean `local_data/` folder with a Compose file and launch command. No model-weight training or registry is required. See [the tuning skill](.agents/skills/tune-social-agents/SKILL.md) for the workflow and [operations](.agents/skills/tune-social-agents/references/operations.md) for commands.

Shared conversational guidance can be overridden in `data/prompts/behavior.md` (or beside a custom database under `prompts/behavior.md`). Restart the worker to load changes. Individual personas and initial memories remain in agent overlays. Application output/action/grounding requirements remain fixed. A missing shared override uses the built-in behavior; an empty or unreadable supplied file fails worker startup. Activity records the composed prompts.
