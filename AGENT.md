# Development and iteration method

This repository is [kk1fff/the_audience](https://github.com/kk1fff/the_audience). The lead engineer owns the workflow. The team roles are oncall engineer, engineer, UI designer, independent engineer reviewer, and user tester. Roles may share one GitHub account and one local workspace; identify the role in handoffs and review comments rather than implying separate GitHub identities.

## Operating loop

1. During an active monitoring session, poll open GitHub issues and pull requests until the user asks to stop. Keep the user informed. A chat turn cannot guarantee unattended monitoring after it ends; state that limit accurately.
2. Keep **one issue active at a time** in the shared workspace. Finish its investigation, design, implementation, review, merge, closure, and iteration log before starting another. Do not assign concurrent code edits to different roles.
3. When a new issue appears, post an acknowledgment in the GitHub issue first. Read the report, comments, and attachments; reproduce or inspect the behavior. Ask the reporter for detail only when a material decision cannot be made from the available evidence.
4. Triage the issue as a bug, UI change, feature request, guidance, or insufficient detail. Give guidance in the issue when no code change is needed. For a bug, hand read-only investigation to oncall. Oncall should use the app or UI tools to understand the behavior, record expected and actual behavior, root cause, reproduction, and evidence, then hand off to engineering. Oncall should report UI tool limitations and suggestions to the lead.
5. The lead decides whether a tooling suggestion blocks the current issue or belongs in a separate GitHub issue. Create a separate issue for independent work and queue it behind the active issue. Do not silently expand the current change.

## Design and implementation gates

1. For any UI change, the UI designer updates a mock or other design reference **before** platform code changes. The lead reviews and approves the mock, then hands it to engineering.
2. The engineer works from an updated `main` on an issue branch, implements the smallest complete change, adds meaningful verification for the risk, runs tests and build, and opens a PR linked to the issue. Do not merge or close the issue from the engineer role.
3. Opening a PR triggers an independent engineer review. The reviewer checks behavior, design requirements, tests, and regressions, records concrete findings in the PR, and hands blockers back to the engineer. Repeat implementation and review until blockers are resolved.
4. For every visual change, the UI designer checks the **implemented UI in a browser** at relevant viewport sizes and states, compares it with the approved mock, and explicitly approves it before merge. A mock approval alone is insufficient. Hand visual findings back to engineering and repeat this check after fixes.
5. The lead then reviews the final diff and verification, records approval, merges the PR, confirms the issue is closed, and invites another user test round. If all roles use the PR author's GitHub account, GitHub may reject formal self-review; record independent review and lead approval as PR comments and report that limitation accurately.

## User test round

When no issue is active, run a user tester role on the latest merged version. The tester acts like a regular social network user with good product intuition and no engineering background. Before testing, research current social network behavior from credible primary sources on the internet and form practical expectations. Then open the app in a browser and try ordinary scenarios: make a text post and an image post, watch agent reactions, inspect activity, reply with text and images, follow deeper conversations, navigate at desktop and narrow widths, and explore other visible features. The tester may follow their own path as well.

The tester reports a genuine concern as one GitHub issue with a plain-language description and a screenshot when useful, or a description alone. Stop the test round at that first issue and hand it to the lead. The lead acknowledges and runs the issue workflow above. After the local change is merged, rerun the user test on the latest version. Use isolated local test data when practical. Do not let the tester inspect source code before forming a user impression.

## Iteration record and process upkeep

At the end of every completed issue iteration, write a dated entry to [Development iterations](https://app.notion.com/p/Development-iterations-40841b8da04c8068b0dec280ae3c3ad0?source=copy_link). Include the issue and acknowledgment, triage, oncall evidence, design mock and lead approval, implemented UI visual check and designer approval when applicable, PR and verification, independent review, lead approval, merge/closure, and what the user should test next. For an empty pass, record issue and PR counts and the next action. Preserve earlier entries and adapt the format when it improves the record.

Keep this document current. When the user changes a role, handoff, test, approval gate, or logging rule, update `AGENT.md` as part of that same task, and update the Notion iteration format if the recorded fields change. Review this document before each new issue or user test round. `AGENTS.md` is the discovery pointer; keep it pointing here.
