# Operations and existing APIs

Run from the repository root. Python 3, Docker, and Docker Compose with raw env-file support are prerequisites. Use the helper at `.agents/skills/tune-social-agents/scripts/tune.py`; examples abbreviate it as `$TUNE`:

```sh
TUNE=.agents/skills/tune-social-agents/scripts/tune.py
python3 "$TUNE" build --tag audience:tuning
python3 "$TUNE" init --session .tuning/my-cast --image audience:tuning --env-file /private/path/llm.env --minutes 30 --rounds 3
```

Build only if no compatible image is available. Init resolves the image to its SHA ID and checks configuration version 1, creates an owned session, copies supported credentials into a mode-0600 private file, and materializes defaults into `candidate/`. Only init accepts a new session path; other commands require its marker. Never edit session.json or compose.json to evade limits. The fixed-image template is `docker-compose.tuning.yml`; the helper generates explicit session copies so shell/production environment values cannot change image, data, provider or deadlines.

The input env file contains plain, unquoted `KEY=value` lines. Supported keys: LLM_PROVIDER (`ollama` or `openai_compatible`), LLM_BASE_URL, LLM_MODEL, LLM_API_KEY, LLM_THINK, EXA_API_KEY. Use an OpenAI-compatible base ending in `/v1`; Ollama uses its server root. From a container, a host server is usually `http://host.docker.internal:11434`, not localhost. Do not publish the file or use secrets in URL query strings. Raw env loading preserves `$` and `#` characters in values.

Before first trial, edit `candidate/agents/<id>/profile.json` to establish the roster, and create each intended memory.md. Omitted bundled agents remain; set enabled:false to disable unwanted people. After baseline, only persona, seed memories, and shared behavior may change. Profile identities, roster, location, schedules and model configuration are locked for comparisons. A changed credential/model file requires a new session.

```sh
python3 "$TUNE" probe --session .tuning/my-cast
python3 "$TUNE" trial --session .tuning/my-cast --name baseline
python3 "$TUNE" post --session .tuning/my-cast --text '@aya_wanders I finally finished my first painting.'
python3 "$TUNE" observe --session .tuning/my-cast --post-id 1 --timeout 360
python3 "$TUNE" reply --session .tuning/my-cast --parent-id 1 --text 'What caught your eye?'
python3 "$TUNE" collect --session .tuning/my-cast
```

Probe makes one small real-model request and validates the decision schema. The session clock starts at probe (or first mock trial). A fresh trial stops the previous stack, saves available results, creates a new data directory from configuration only, and launches the same image. Baseline does not count toward the candidate limit; later automated trials do. Each trial records its effective configuration, prompt hash, image and public model settings. Candidate changes require a new trial, not a restart over contaminated memories. `reload` only restarts an unchanged trial; `start` resumes an unchanged trial within its deadline.

```sh
# After editing the candidate prompt/persona:
python3 "$TUNE" trial --session .tuning/my-cast --name candidate-1
# Separate interactive feedback, inside the same total time budget:
python3 "$TUNE" trial --session .tuning/my-cast --name human-check --manual
python3 "$TUNE" status --session .tuning/my-cast
python3 "$TUNE" stop --session .tuning/my-cast
```

Browser URL defaults to http://localhost:3002. For a remote host, forward the port. The web stays available when the deadline stops the worker. `stop` collects available results and removes only this session's containers, retaining its data and snapshots.

## API contract

- `GET /api/agents`: enabled agents and handles.
- `GET /api/posts`: recent feed; `GET /api/posts/<id>`: specific conversation.
- `POST /api/posts`: JSON `{"text":"..."}` or multipart `text`, up to four repeated `images`, and aligned optional `imageDescriptions`.
- `POST /api/comments`: JSON `{"parentId":123,"text":"..."}` or multipart with parentId. Replies target an agent-authored comment; use IDs from the conversation, not guesses.
- `GET /api/activity`: items and attempt histories, `nextCursor`, browse summaries. Continue with `?beforePostId=<nextCursor>` until null. Attempts expose actual system/user prompts, decision, background and memory changes.

Text is limited to 280 characters; JPEG/PNG/WebP images to 10 MB each. For image scenarios use the existing API, e.g. `curl -F 'text=What do you notice?' -F 'images=@/path/photo.png;type=image/png' http://localhost:3002/api/posts`. Do not shell-interpolate untrusted conversation text. Helpers use structured subprocess and JSON arguments.

`observe` tracks the specified post until no pending/running job remains and outcomes stay stable for ten seconds, or a timeout/deadline occurs. It is a bounded snapshot, not a promise of no future browsing. Collects follow Activity pagination and store data in the trial's results.json. Use post detail for old conversations beyond the feed window.

## Export

Write the session's report.md and obtain user acceptance. Ensure candidate matches the last tested trial, including the accepted seed memories.

```sh
python3 "$TUNE" export --session .tuning/my-cast --output ./tuning-output --accepted
cd tuning-output
docker compose -f compose.local.yaml up -d
```

The generated Compose file loads local_runtime.env itself using raw parsing; do not also pass it as a Compose interpolation --env-file. The output root must not exist. It contains `local_data/` (prompts and profiles/seeds only), mode-0600 local_runtime.env, compose.local.yaml, manifest.json, report.md and RUN.md. Export validates a disposable copy with the pinned production image and starts the web without a live worker/model call. The delivered folder remains free of database/uploads. Default final port is 3000; use export `--port` if already occupied. The generated Compose file has no tuning deadline, source mounts or build section. It uses a local image ID with pull_policy:never; use Docker save/load to move the same image to another machine, and adjust the private endpoint if needed.

Workflow tests may initialize with `--allow-mock` and `LLM_PROVIDER=mock`; exported manifests label these as workflow tests. Never describe their responses as real-model evidence.
