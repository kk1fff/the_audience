# Behavior evaluation

Write scenarios and criteria before baseline. Include: a daily update, celebration, difficult day, factual question, disagreement, optional image post (only with a vision-capable endpoint), and a longer conversation. Adapt to the user's goal; this is not a mandatory fixed script.

| Change/stage | Coverage |
| --- | --- |
| Baseline | Every enabled person, shared situations, representative groups |
| Individual persona | Their relevant scenarios plus groups involving them |
| Shared behavior | Every enabled person plus groups |
| Seed memory | That person's recall and unrelated subjects |
| Final candidate | Whole cast, reserved scenarios, then separate human trial |

Assess relevance, naturalness, repeated phrasing/questions, appropriate participation, and memory accuracy. Record brief evidence and regressions rather than an unsupported aggregate score. Distinguish:

- **Within-person consistency:** recognizable voice and tendencies across different situations, with situational flexibility.
- **Between-person differentiation:** understandable differences in perspective and response to comparable situations.
- **Group dynamics:** complementary contributions, no echo chorus or manufactured argument, room for the owner to respond.

Example distinct briefs: an observant traveler who expresses curiosity through details, a concise practical friend who offers advice only when useful, and a reflective friend who can acknowledge feelings without asking a question. These are illustrative, not defaults imposed on every user.

For targeted coverage, mention the intended agent using the handle returned by `/api/agents`. Ordinary unmentioned posts test the product's natural selection/delivery behavior. Inspect Activity before labeling absence a behavior failure. Do not accelerate schedules, edit SQLite jobs, force responses, or bypass the normal APIs to improve a score.

Fresh trials begin with the same intentional seed memories; changing the seed is itself a declared variable. Model outputs, notifications, and external background remain variable. Repeat promising comparisons when budget permits; do not claim exact reproducibility. If a trial times out with jobs pending, preserve that result as incomplete. Repeats consume candidate-trial budget; agree on a larger budget up front when needed.

Only user-accepted candidates are exported as final. At a budget stop, deliver evidence and a recommendation without implying acceptance. A human trial may continue only within the agreed deadline; a new session requires explicit user direction.
