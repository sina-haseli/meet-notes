import type { MeetingType } from "../types";

const RULES = `You turn a transcript of a Google Meet work meeting (spoken Persian with English technical terms) into two documents. The notes feed AI coding agents later, so structure and accuracy matter more than prose.

## Rules
- notes in English; summary in Persian with English technical terms in Latin script unchanged
- English technical terms (service names, components, libraries, API names, code identifiers) stay in Latin script, verbatim. Never translate or transliterate them.
- use the services context only to correct service/repo/component names to their real names; never add tasks, owners, estimates or decisions not present in the transcript. If there is no services context, write \`?\` for unknown Service/Repo cells
- unknown values are \`?\`
- items attributed to uncertain speakers keep the \`(uncertain)\` marker
- every item cites a \`[MM:SS]\` timestamp

`;

const CONTRACT_HEAD = `## Output contract
Answer with exactly this layout and nothing before, between or after it (no code fences, no commentary):

<<<SUMMARY>>>
`;

const STANDARD = `${RULES}${CONTRACT_HEAD}(summary: a short Persian summary: purpose, key decisions, tasks with owners, open questions)
<<<NOTES>>>
(notes: English, with exactly the sections below, in this order)

## Notes sections (in this order)
1. \`# <title> — <type> — <date>\`
2. \`## Participants\`
3. \`## Features discussed\` (each with \`![](screens/<ms>.jpg)\` links for the relevant screenshots and \`[MM:SS]\` refs)
4. \`## Tasks\` (table: Task | Service/Repo | Owner | Story points | Source)
5. \`## Tech debt & technical problems\`
6. \`## Decisions\`
7. \`## Open questions\`
8. \`## Quotes\`

In \`## Tasks\`, Source is the \`[MM:SS]\` timestamp where the task was said. Write \`?\` for any unknown cell. If a section has nothing, write \`None discussed.\`

`;

const DAILY = `${RULES}${CONTRACT_HEAD}(summary: Persian. For each participant, three short bullet groups: دیروز (yesterday), امروز (today), موانع (blockers). Keep English terms in Latin script. Then a short list titled نیاز به پیگیری with the items that need follow-up.)
<<<NOTES>>>
(notes: English, with exactly the sections below, in this order)

## Notes sections (in this order)
1. \`# <title> — daily — <date>\`
2. \`## Participants\`
3. \`## Per person\` (one \`### <name>\` per participant, each with \`- Done:\`, \`- Doing:\` and \`- Blocked:\` items, every item with a \`[MM:SS]\` ref)
4. \`## Blockers\` (table: Blocker | Person | Owner to unblock | Source)
5. \`## Decisions\`
6. \`## Open questions\`

Do not use story points or estimates. Anything that was not said is omitted, never guessed. Write \`?\` for an unknown Owner to unblock. If a section has nothing, write \`None discussed.\`

`;

export const TEMPLATES: Record<MeetingType, string> = {
  grooming: `${STANDARD}## Meeting type: grooming
Emphasis: features and estimates. For every feature record its scope, acceptance criteria that were actually stated, and the story points that were agreed (\`?\` if none). Tasks must carry the agreed Story points.
`,
  planning: `${STANDARD}## Meeting type: planning
Emphasis: sprint scope, owners and capacity. Record what is in and out of the sprint, who owns each task, and any stated capacity or availability limits (\`?\` if not stated).
`,
  technical: `${STANDARD}## Meeting type: technical
Emphasis: problems, options and the chosen approach. For each technical problem list the options that were raised, the trade-offs stated, and the approach chosen (\`?\` if none was chosen). Put them under \`## Tech debt & technical problems\` and \`## Decisions\`.
`,
  daily: `${DAILY}## Meeting type: daily
Emphasis: what each person did, is doing and is blocked on. Capture only what each person actually said. Blockers carry the person who is blocked and, if one was named, who can unblock them.
`,
};
