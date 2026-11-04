---
name: tune-social-agents
description: Tune The Audience social agents into distinct personalities using fixed-image Docker trials and prompt overlays, then export clean local_data and a launch command. Use for behavior tuning, not application code changes or model-weight training.
---

# Tune social agents

Deliver a tested cast of distinct people, a clean `local_data/` export, and an exact launch command. Keep application code, fixed instructions, model settings, and schedules unchanged during experiments. This skill is repository-local; resolve scripts relative to this file.

## Intake and setup

Gather the desired cast and individual differences, shared expectations, examples of good/bad exchanges, intentional seed memories, and observable success criteria. If unspecified, propose a varied cast and confirm it. Write a short personality brief for each person: voice, interests, temperament, initiative, disagreement style, emotional expression, memory priorities, and out-of-character examples. Use tendencies, not mandatory catchphrases, demographic stereotypes, or caricatures.

Ask only for missing LLM provider, endpoint, model, credential-file path, and experiment budget. Recommend three candidate trials within 30 minutes. Accept a private raw `KEY=value` environment file; never ask the user to paste secrets into public reports. Existing Ollama and OpenAI-compatible endpoints are supported. Do not silently reuse production credentials or use a paid endpoint without the user's authorization. Mock runs establish tooling correctness only.

Read [operations](references/operations.md) for commands and API details. Select a compatible local production image or build it once before tuning; the helper pins its ID. Initialize a new session, define the roster and locations/schedules during setup, edit its candidate profiles and seed memories, and verify the real provider from inside the container. Do not rebuild or mount source during experiments. Write the briefs, goals, and scenarios in the session directory, not in runtime overlays.

## Experiment loop

Read [evaluation](references/evaluation.md) when designing scenarios and comparing candidates.

1. Record the baseline for every enabled agent and representative group interactions. Reserve some scenarios for final regression checks.
2. Distinguish delivery/infrastructure failures from personality issues using Activity. A missed notification is not silence chosen by the model. Receiving a mention does not require responding.
3. State a focused hypothesis. If only one person needs adjustment, edit that person's `persona` or intentional seed memory rather than shared guidance. Shared guidance lives in `candidate/prompts/behavior.md`.
4. Create a fresh named trial from the candidate. Never compare against a database already shaped by a previous candidate. Keep shared scenarios and initial memories equivalent; only the intended experimental variable changes.
5. Evaluate transcripts against the briefs and goal. Keep or revert the candidate. Repeat promising comparisons within the remaining trial/time budget; record nondeterminism and changing external background as limitations.
6. Test the final cast on reserved scenarios. Offer a separate `--manual` trial for the user's browser conversations; the user may accept the evidence without taking that optional trial. Do not mix these messages into controlled comparisons.

Different people behaving differently is preferable. Preserve within-person consistency and between-person differentiation; do not optimize everyone into one friendly, inquisitive, verbose, agreeable voice. Different names and stock phrases are not sufficient evidence. Legitimate silence, agreement, humor, restraint, and disagreement can all fit an individual. Do not manufacture conflict merely to increase diversity.

The worker enforces the session deadline and stops after three consecutive processing failures. Observe only the scenario's jobs with a timeout; periodic browsing means global silence is not a reliable completion signal. When limits expire, preserve evidence and report where things stand. Ask before extending work through a new session. No success claims when evidence is missing or only mocked.

## Acceptance and delivery

Write `report.md` in the session: personality briefs; hypotheses and before/after evidence; individual/group/regression results; failed delivery versus model decisions; image/model identity; limits; user feedback; and whether the user accepted the candidate. Exclude credentials and unrelated personal information.

Export only after acceptance, using `--accepted`. The helper refuses an existing destination, checks that the candidate matches the last tested trial, materializes full profiles and initial memories, and smoke-tests a temporary copy. The export contains `local_data/`, separate private runtime environment, Compose file, manifest, report, and launch instructions. No experimental database, uploads, learned memories, or logs belong in `local_data/`. Tell the user the exact directory, command, URL, fixed image requirement, and remaining limitations. Do not publish or commit personal tuning artifacts.

If application changes are needed, report them separately. Do not enter the repository's issue-monitoring loop or create external issues as a side effect of a private tuning session. Software changes to this skill/runtime follow AGENT.md's engineering gates.
