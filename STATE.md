# AWS Weekend Challenge: Map it — current state

## Mandatory deliverables

| Deliverable from live rules | Status | Evidence or next action |
|---|---|---|
| Original application displaying real location/spatial data on a map | UNMET | Standby selected; reviewed MVP/UI specification ready, no application code before official opening. |
| AWS location or data service in application/pipeline | UNMET | Dedicated S3/CloudFront + AWS Location Routes architecture selected; not deployed. |
| Publicly reachable application running on AWS, or working map shown in demo | UNMET | Prefer anonymous HTTPS live app and video together. |
| Written project published on AWS Builder Center describing dataset, mapping method, AWS service and live URL | UNMET | Your project tab currently says `No project yet.` |
| Public demo video showing live map and exploration, under three minutes | UNMET | Public YouTube/Vimeo/Facebook Video/Youku URL required. |
| Only rights-cleared data; no personal/sensitive data | PARTIAL | Austin source/policy and annual queries verified; public sanitized import pipeline not built. |
| Optional public source repository with approved OSI licence | UNMET | Intended MIT repository after official build start. |
| Project submitted; qualification pass/fail requirements satisfied | UNMET | Final submission must be verified visibly; registration already exists. |

## Right now

Owner selected **Standby Operations Console**, authorized implementation per the reviewed [MVP specification](docs/STANDBY_MVP_SPEC.md), and explicitly approved **USD 25 total AWS budget** in the human message of 2026-10-29. Start on 2026-10-30 at/after 07:00 UTC / 09:00 Europe/Athens. First deliver application shell, then map with real sanitized Austin data, then road-time coverage evaluation. React/TypeScript/Tailwind/TanStack remain mandatory; FrontBox is read-only reference. No automatic continuation is scheduled, preserving the owner's earlier manual-resume preference. No application code, repository, cloud resource, paid route call or submission created yet.

## Prize aim and structure

Target exact organizer label: **"Hackathon Winners (5)"**, each **"$100 USD in AWS Promotional Credits"** and **"AWS Builder Backpack"**. All winner slots are identical; runner-up categories do not exist. Aim for one winner slot, not a non-existent special award. [PRIMARY 2026-10-29, Chrome Rules tab, `await mapTab.getAXState()`]

Four equally weighted criteria: Technical innovation and originality; Craft and execution; Usefulness and impact; Creativity and storytelling. Each is 25%. Gate 1 combines AI scoring and human review; highest 50 advance; AWS panel selects five using the same rubric. Leaving any criterion at zero caps the composite at 75%. The landing page shows 31 participants, which is registration count, not entry count. [PRIMARY 2026-10-29, `await mapTab.getAXState()` on About and Rules tabs]

## Verified facts

| Claim | Value | Exact observation/command | Date |
|---|---|---|---|
| Canonical organizer URL | https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/weekend-challenge-map-it | `await cua.getTab('275773236', {browser:'3'})` | 2026-10-29 |
| Official build/submission opening | 2026-10-30 00:00 PDT = 07:00 UTC = 09:00 Europe/Athens | `await mapTab.getAXState()` on Rules; `datetime.fromisoformat('2026-10-30T00:00:00').replace(tzinfo=ZoneInfo('America/Los_Angeles')).astimezone(ZoneInfo('Europe/Athens'))` | 2026-10-29 |
| Official deadline | 2026-11-02 13:00 PST = 21:00 UTC = 23:00 Europe/Athens | `await mapTab.getAXState()` on About and Rules; `datetime.fromisoformat('2026-11-02T13:00:00').replace(tzinfo=ZoneInfo('America/Los_Angeles')).astimezone(ZoneInfo('Europe/Athens'))` | 2026-10-29 |
| Judging period | 2026-11-02 through 2026-11-13 | `await mapTab.getAXState()` on Rules | 2026-10-29 |
| Rules updated | 2026-10-28 | `await mapTab.getAXState()` on Rules | 2026-10-29 |
| Project status | Registered owner session; no project, no team | `await mapTab.getAXState()` on Your project | 2026-10-29 |
| Organizer clarification | No discussion posts visible | `await mapTab.getAXState()` on Discussion | 2026-10-29 |
| Personal challenge AWS identity | profile `default`, account 308857099262, `tf-surface-studio` | `aws sts get-caller-identity --profile default --query Arn --output text` | 2026-10-29 |
| GitHub account | `upgradedev` active with repository/workflow scope | `gh auth status` | 2026-10-29 |
| Available disk | 355962880 bytes at initial observation; volatile | `Get-PSDrive -Name C \| Select-Object Free,Used` | 2026-10-29 |
| Project directory was new | `False` before creation | `Test-Path -LiteralPath repos/aws-map-it` | 2026-10-29 |
| Workspace root is not a Git checkout | git reports not a repository | `git status --short` | 2026-10-29 |
| Public video account capability | Existing YouTube Studio channel exposes upload dialog and file selection; no file uploaded, new terms accepted, or visibility publication tested | `await cua.createBrowserTab('3','https://studio.youtube.com/',{sessionName:'🎬 Map demo readiness'})`; `await videoGateTab.click(74)`; `await videoGateTab.getAXState()` | 2026-10-29 |

## Estimates and interpretations

| Item | Value | Owner |
|---|---|---|
| Build before official opening | INTERPRETATION: defer product code to avoid eligibility risk; not an explicit separate prior-code ban | Codex, independent reviewer concurs |
| Hosting cost | ESTIMATE within the approved USD 25 total budget; actual spend remains unmeasured because no resources have been allocated | Codex |
| Winning likelihood | UNKNOWN; no self-awarded judge score | Codex |

## Claimed work

| Agent | Files or area | Started UTC | Expected done |
|---|---|---|---|
| Codex coordinator | Repository bootstrap, CI, AWS/API, deployment and integration in repos/aws-map-it | 2026-10-30 09:44 UTC | First public working release |
| Codex console lane | apps/console only, isolated worktrees/standby-console checkout | 2026-10-30 09:44 UTC | Shell, five pages, real-data map |
| Codex data/domain lane | packages and tools/data, isolated worktrees/standby-data checkout | 2026-10-30 09:44 UTC | Frozen curated data and tested coverage solver |

## Blocked on

- Official build window has not opened; use preparation time for design and source verification.
- Product, live AWS URL, video, written Builder project and submission do not exist yet.
- Owner-only attestations: adult age, eligible actual residence, and Amazon employment/household exclusion are not inferred from language or timezone.
- YouTube Studio upload dialog is reachable; actual file upload/publication, CAPTCHA and any action-time terms remain untested. Existing Builder session and registration are verified.

## Do NOT do

- Do not reuse or mutate frozen challenge repositories, origins or stacks. Root `CLAUDE.md` freeze remains binding.
- Do not use profile `upgradedev`: it belongs to the commercial FrontBox account, according to a child read-only STS check [STATE-FILE until coordinator rechecks]. Use explicit `--profile default` and verify identity before any mutation.
- Do not install dependencies or leave `node_modules`; disk has very little free space. Owner selected React/TypeScript/Tailwind/TanStack; dependency install/build/browser checks run in hosted CI.
- Rules: "Limit one entry per person or team." Maximum team size is five. No duplicate project submission.
- Rules: "Create an original application that has not been previously published."
- Rules: "Use only data that the participant has the right to use, and exclude any personal or sensitive data from the Submission".
- A public source repository, if supplied, must carry an approved OSI licence.
- Public video must remain below three minutes; avoid unlicensed music/material and third-party trademarks without permission.
- No acceptance of new legal terms or final legally binding submission through UI without the required action-time owner confirmation.
- Do not call registration count entry count, forecast a winning score, or describe an undeployed feature as shipped.

## Open questions

- Is pre-window product implementation explicitly allowed? Rules do not separately answer this; no organizer clarification exists in Discussion.
- Standby and USD 25 total AWS budget are approved. Recheck price tier, remaining budget and enforceable per-job quota before first paid allocation; approval does not authorize exceeding USD 25 or an unlimited recurring commitment.
- Exact Builder publication/submission form fields are not yet visible; Your project currently has no project and the window is closed.
- Public YouTube upload readiness, CAPTCHA and any new agreement requirements.
- Names/roles visible on About: Ram Nethi; Manideep Reddy Gillela (Delivery Consultant - Cloud Infra Architect); Yue Ning; Hari; Restelli, Matteo. All carry AWS Employee badge. No need to infer preferences from names.

## Rules evidence

Live Rules text: "From October 30, 2026, at 12:00 a.m. PT to November 2, 2026, at 1:00 p.m. PT (\u201cSubmission Period\u201d), build an application that places location or spatial data on a map using an AWS location or data service".

Eligibility: age at least eighteen and Builder profile; excluded residences include Argentina, Australia, Brazil, Hong Kong, Indonesia, Italy, Malaysia, Thailand, Philippines, Vietnam, Singapore, Russia, Cuba, Iran, North Korea, Belarus, Crimea, DNR, LNR and UAE. Amazon employees/affiliates, immediate families and households excluded. Greece is not listed, but actual residence remains owner-attested.

Qualification is pass/fail: working mapped spatial data on a public AWS app or clearly shown in a working demo, written project published on Builder Center, and reviewability by AI and human judges. An idea/article alone cannot qualify.

## Current implementation contract and fresh evidence

Read `docs/STANDBY_MVP_SPEC.md` before implementation. User-mandated console includes full collapsed rail/badges, workspace/search/user bar, Overview, Incident history, Planning queues, Coverage map and Settings; TanStack master-detail table/drawer; page states, toasts/API banner, real role checks, mobile navigation and semantic dark tokens. FrontBox source was inspected without mutation. No FrontBox code, customer data, tenant IDs, credentials or commercial account resources travel to this build.

Coordinator independently reproduced the proposed UTC reporting cohorts using `urllib.request.urlopen(base + '?' + urllib.parse.urlencode(q))` with the exact query in the specification, deterministic `published_date,traffic_report_id` ordering, limit 10000 and year boundaries. Row/unique counts: 2023 = 1863; 2024 = 1593; 2025 = 1662. In-memory response SHA256s respectively `bc4103f97bc71e0c378e72efe1680f31c1649941fb98b9552b310920e24ae1a0`, `a090c5a004fea99a5c761d868711850b313e57a79c13aec98348e5c8b1fb5e8e`, `faa698341953d689e10ee7bba914efff5f03f22b8d55168cc2b4d84e06aec6d7`. These are research receipts, not yet saved/published dataset artifacts. Actual import must page to completion, validate and hash its own bytes.

Pricing [PRIMARY 2026-10-29]: `aws pricing get-products --profile default --region us-east-1 --service-code AmazonLocationService --filters Type=TERM_MATCH,Field=regionCode,Value=eu-west-1` produced Core matrix USD 0.0005/pair (SKU DB2SJYP4W6C6FA5A), Advanced USD 0.0015/pair (UPPAVEFY5K72BAYN), default map tiles USD 0.00004/tile (UZQ6TJ4A8HKY8BRG). Proposed finite initial route quota is 8640 pairs, with 2880 maximum per initial snapshot (design limits). Core matrix spend estimate USD 4.32 at the full quota; 100000 tiles estimate USD 4.00. All spend figures are ESTIMATES from these parameters, before tax/free allowances. Owner approved USD 25 total through the specified judging-period scope in the human message of 2026-10-29; USD 10 Location remains an internal allocation target within that total. Monitoring/quota must preserve the authorized total; AWS alerts/throttles are not themselves guaranteed financial caps.

Fresh disk observation: `Get-PSDrive -Name C | Select-Object Free` gave 531779584 bytes at session start, volatile. No dependencies installed. Source work/build/test will use hosted CI; local checks remain dependency-free.

Architecture review corrections integrated: CloudFront can never reach raw/matrix buckets; protected result writer recomputes trusted metrics; builder-only atomic pair budget includes retries; provider-derived copies expire in a dedicated unversioned cache; fixed train-derived Voronoi zones keep heldout demand in scope; workspace Settings/search/queue state contracts and browser acceptance are explicit. Plan is not a claim that these controls have been deployed or tested.

## Next action

At the next active session on/after 2026-10-30 07:00 UTC, begin the already-authorized implementation in isolated checkouts: application shell first, map with real sanitized data next, then coverage evaluation. No automatic wakeup is configured. Freeze source/split/region before optimizer, bootstrap hosted CI, ship anonymous core before extra features, then complete the selected console/auth workflow and record the frozen live release. Recheck AWS `default` identity, current pricing, remaining approved USD 25 budget and finite quotas before paid allocation; no renewed approval is needed for unchanged work within that authorization. Target Submitted by 2026-11-01 18:00 Athens, backstop 23:00; official deadline 2026-11-02 23:00 Athens. New legal terms/CAPTCHA remain action-time owner steps.
