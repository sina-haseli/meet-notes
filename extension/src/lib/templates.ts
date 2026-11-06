import type { MeetingType } from "../types";

/** Email-summary section title for the code suggestions (exact copy). */
const SUGGEST_TITLE = "سرویس‌های احتمالی برای تغییر (پیشنهاد AI)";
const WHERE_TO_LOOK = "## Where to look in the code (AI suggestion)";

const SERVICES_RULE = `use the services context only to correct service/repo/component names to their real names; never add tasks, owners, estimates or decisions not present in the transcript. If there is no services context, write \`?\` for unknown Service/Repo cells`;

// Standard meetings may suggest where code lives, but only from `## Code evidence`.
const SERVICES_RULE_CODE = `use the services context only to correct service/repo/component names to their real names; suggestions about where code lives come only from \`## Code evidence\`, only in the sections described below (the summary section \`${SUGGEST_TITLE}\`, the notes section \`${WHERE_TO_LOOK}\` and \`(suggested)\` Service/Repo cells), labelled as AI suggestions, never presented as said or decided; never add tasks, owners, estimates or decisions not present in the transcript. If there is no services context, write \`?\` for unknown Service/Repo cells`;

const rules = (servicesRule: string) => `You turn a transcript of a Google Meet work meeting (spoken Persian with English technical terms) into two documents. The notes feed AI coding agents later, so structure and accuracy matter more than prose.

## Rules
- notes in English; summary in Persian with English technical terms in Latin script unchanged
- English technical terms (service names, components, libraries, API names, code identifiers) stay in Latin script, verbatim. Never translate or transliterate them.
- ${servicesRule}
- unknown values are \`?\`
- items attributed to uncertain speakers keep the \`(uncertain)\` marker
- Never replace a \`Speaker N\` label with a participant name, even if the participants list suggests who it might be. A person section or item for an uncertain speaker uses the \`Speaker N\` label and is marked (uncertain).
- every item cites a \`[MM:SS]\` timestamp

`;

const CONTRACT_HEAD = `## Output contract
Answer with exactly this layout and nothing before, between or after it (no code fences, no commentary):

<<<SUMMARY>>>
`;

const STANDARD = `${rules(SERVICES_RULE_CODE)}${CONTRACT_HEAD}(summary: a short Persian summary: purpose, key decisions, tasks with owners, open questions. If \`## Code evidence\` lists services, end the summary with a section titled \`${SUGGEST_TITLE}\`: one line per service — the service name and a short Persian reason based on the evidence. Service names only; never file paths. Make clear these are AI suggestions from the code, not something said in the meeting. If the code evidence is empty, skipped or not run, omit this section entirely.)
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
9. \`${WHERE_TO_LOOK}\` (per suggested service: the service, the file paths from the evidence, and why they match — which keywords, what the snippet shows. If \`## Code evidence\` lists no services write \`No matching code found.\`; if the code search was skipped or not run write \`Code search skipped (<reason>).\`; if the search stopped at a limit, say the results may be partial.)

In \`## Tasks\`, Source is the \`[MM:SS]\` timestamp where the task was said. Service/Repo may be \`<service> (suggested)\` only when the code evidence clearly ties that task to that service; otherwise \`?\` (or the name actually said). Write \`?\` for any unknown cell. If a section has nothing, write \`None discussed.\`

`;

const DAILY = `${rules(SERVICES_RULE)}${CONTRACT_HEAD}(summary: Persian. For each participant, three short bullet groups: دیروز (yesterday), امروز (today), موانع (blockers). Keep English terms in Latin script. Then a short list titled نیاز به پیگیری with the items that need follow-up.)
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
