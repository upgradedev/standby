# AWS Weekend Challenge: Map it â€” current state

## Mandatory deliverables

| Deliverable from live rules | Status | Evidence or next action |
|---|---|---|
| Original application displaying real location/spatial data on a map | IMPLEMENTED | Shell, five routes and real-data AWS map are live; full acceptance in progress. |
| AWS location or data service in application/pipeline | IMPLEMENTED | Dedicated AWS serverless stack and real Location matrix deployed. |
| Publicly reachable application running on AWS, or working map shown in demo | IMPLEMENTED | Anonymous HTTPS app returns HTTP 200; video still outstanding. |
| Written project published on AWS Builder Center describing dataset, mapping method, AWS service and live URL | DRAFT | Project 3LPVbxnjerX5pvDmH8FsdDG8uuA created; title, description, body, source and app link autosaved. Video and final publication remain. |
| Public demo video showing live map and exploration, under three minutes | UNMET | Public YouTube/Vimeo/Facebook Video/Youku URL required. |
| Only rights-cleared data; no personal/sensitive data | IMPLEMENTED | Licensed Austin input is validated and sanitized; private raw records/matrix do not pass CloudFront; public views aggregate zones. |
| Optional public source repository with approved OSI licence | IMPLEMENTED | Public MIT repository created; hosted CI passes. |
| Project submitted; qualification pass/fail requirements satisfied | UNMET | Final submission must be verified visibly; registration already exists. |

## Right now

Implementation started after the owner resumed on 2026-10-30. Public AWS application: https://d34x1513u5u1qs.cloudfront.net . Original source: https://github.com/upgradedev/standby . Hosted typecheck, tests and production build pass. Full live acceptance now passes at desktop/tablet/mobile and through real Cognito Analyst/Planner/Admin flows. Read-concurrency and modal focus defects found by earlier runs were fixed; test readiness/locator mistakes were corrected without relaxing assertions. A real sanitized Austin snapshot and private HERE Car matrix exist. No paid routing is available to the public evaluator. USD 25 total remains the approved budget. Next: finish live acceptance, freeze, produce public video, publish Builder project and submit.

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
| Public video account capability | Existing YouTube Studio channel exposes upload dialog and file selection; no file uploaded, new terms accepted, or visibility publication tested | `await cua.createBrowserTab('3','https://studio.youtube.com/',{sessionName:'ðŸŽ¬ Map demo readiness'})`; `await videoGateTab.click(74)`; `await videoGateTab.getAXState()` | 2026-10-29 |

## Estimates and interpretations

| Item | Value | Owner |
|---|---|---|
| Build before official opening | INTERPRETATION: defer product code to avoid eligibility risk; not an explicit separate prior-code ban | Codex, independent reviewer concurs |
| Hosting cost | ESTIMATE within the approved USD 25 total budget; actual spend remains unmeasured because no resources have been allocated | Codex |
| Winning likelihood | UNKNOWN; no self-awarded judge score | Codex |

## Claimed work

| Agent | Files or area | Started UTC | Expected done |
|---|---|---|---|
| Codex coordinator | Release freeze, demo production, AWS retention/budget checks, Builder preparation | 2026-10-30 09:44 UTC | Concrete reviewable submission |
| — | Console, data/domain and writer lanes delivered; no active child edits | — | — |

## Blocked on

- Public app and source exist. Public video, written Builder project and Submitted state remain outstanding.
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

Produce and verify the public demo against frozen application commit `49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a`; finish Builder and video publication and visibly verify Submitted. Public draft URL: https://builder.aws.com/project/3LPVbxnjerX5pvDmH8FsdDG8uuA/standby-plan-roadside-standby-with-real-road-times . No automatic continuation is scheduled. USD 25 total approval persists; never re-request unchanged budget permission. New binding terms, final eligibility attestations and owner password entry remain owner action-time steps. Owner account enrollment helper is `python tools/create-operator.py --username <owner-choice>` and reads the new password interactively; never collect it in chat.

## Frozen application release and live acceptance

**Product freeze: `49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a`, declared before recording on 2026-10-30.** Unfreeze only for a false judge-facing claim, broken mandatory deliverable or rule violation, recording reason and affected video beats here first. Runtime source is unchanged by later acceptance/narration tooling (`git diff 49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a -- apps/console packages services` returns empty).

[PRIMARY] https://github.com/upgradedev/standby/actions/runs/41041997256 completed success. `gh run view 41041997256 --log` shows full anonymous journey PASS at desktop/tablet/mobile and real Cognito authorization PASS for Analyst, Planner and Admin, including idempotency, trusted evaluation, review denial, settings version conflict and stale-review invalidation. Initial source release build: https://github.com/upgradedev/standby/actions/runs/41040847530 . Exact test-run source is `cd34d6a4f87024c5f6d5a2627266fc54e55708d7`; application source matches frozen release per the runtime diff above.

[PRIMARY] Actual frozen dataset SHA256 `447804ec7823abef15241c0ff080af9892ad71456bde6227e2185d784b2ec31f`. `python tools/data/validate.py ../../worktrees/standby-data/.runtime/dataset.json` reports 120 zones, 12 sites, accepted training 3072 / heldout 1467. Source cohorts: training 3456 / heldout 1662; exclusions are retained in the private import manifest and shown publicly as counts. Do not confuse publication time with breakdown occurrence.

[PRIMARY] `python tools/build-matrix.py --input ../../worktrees/standby-data/.runtime/routing-input.json --attempt 1` reserved 1440 pairs, returned Core tier and zero NoRoute cells. Matrix hash `ca19df599b142229f099eb91073ddda5899aa676da1e86c5edf7b0dcacadadb0`; generated 2026-10-30T10:00:15Z and expires 2026-11-27T10:00:15Z. Routing ESTIMATE USD 0.72 from verified USD 0.0005/pair, before taxes/free allowances, not measured billing. No provider matrix exported into source/CI. Public map key expires after the published judging period; do not tear down live surfaces based on stale notes.

Synthetic role users share a dedicated acceptance workspace, with suppressed invitations and credentials encrypted only in the dedicated repository secret. Remove those test memberships/users/secret after final authorization verification. No actual owner password was set or collected. Public anonymous evaluation remains available independently of account enrollment.

Original narration was generated after product freeze with `python tools/demo/voice.py --release 49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a`: all six beat files passed their measured duration budgets. Receipt reserved 1971 characters. ESTIMATE neural speech USD 0.031536 at verified USD 0.000016/character, before tax/free allowances; actual invoiced spend remains unmeasured. No new route matrix call was needed. Recording and final media verification remain pending.

Demo production instrument defect: first six captures completed but final rendering correctly failed because the unavailable-unit clip had an inferred Node-clock in-point and insufficient usable media. Product freeze remains unchanged; tools-only repair is required for the broken mandatory video deliverable. Recorder now uses the documented explicit Playwright screencast API after readiness, browser presentation timestamps and actual ffprobe duration; baseline visibly restores the shared threshold before the proposal beat. The workflow preserves short-lived captured beats for independent repair/re-render. No application source changed.
