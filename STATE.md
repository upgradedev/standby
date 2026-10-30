# AWS Weekend Challenge: Map it — current state

## Current outcome

Standby is implemented and live at https://d34x1513u5u1qs.cloudfront.net/ . Public MIT source: https://github.com/upgradedev/standby . The final visible-map demo is recorded, downloaded and verified. Public video hosting, final Builder publication and visible submission remain owner-gated; **do not claim Submitted**. Implementation and USD 25 total budget are already approved. No automatic Codex continuation is scheduled.

## Mandatory deliverables

| Deliverable | Status | Evidence or next action |
|---|---|---|
| Original application displaying real spatial data | IMPLEMENTED | Actual HERE roads, real aggregate demand polygons/points and assumed standby sites are visibly rendered. |
| AWS location/data service | IMPLEMENTED | Amazon Location road matrix and compatible basemap; dedicated AWS serverless stack. |
| Anonymous working AWS application | IMPLEMENTED | HTTPS URL above; final desktop/tablet/mobile acceptance and required rendered-map pixel proof passed. |
| Public source with OSI licence | IMPLEMENTED | Original MIT code; third-party route data excluded from the source licence. |
| Written Builder project | DRAFT | https://builder.aws.com/project/3LPVbxnjerX5pvDmH8FsdDG8uuA/standby-plan-roadside-standby-with-real-road-times — saved body, app/repo and tags; final video link and Publish remain. |
| Public demo below three minutes | MP4 READY; PUBLIC HOSTING PENDING | Final 145-second video validated and visually inspected; must publish publicly on an allowed video service. |
| Final submission | PENDING OWNER ACTION-TIME CONFIRMATION | YouTube explicitly treats upload as agreement to terms; AWS eligibility facts are not inferred. |

## Frozen release and exact evidence

**Final application freeze: `5ad96cc4c6e50503556bb706f1698477764d2dd2`, declared before the final capture.** No runtime source changed afterward (`git diff 5ad96cc4c6e50503556bb706f1698477764d2dd2 -- apps/console packages services` is empty). Both live config and API health serve this release.

| Evidence | Exact result and reproduction |
|---|---|
| Application source build | https://github.com/upgradedev/standby/actions/runs/41057136525 passed. |
| Final source and visual regression checks | https://github.com/upgradedev/standby/actions/runs/41058056422 passed; source `40864f15e8b70a0f4b0dfecf9b5c4518b10ff10f` includes unchanged runtime plus gates. |
| Final anonymous browser journey | https://github.com/upgradedev/standby/actions/runs/41058050365 passed desktop/tablet/mobile, including mandatory positive geometry and actual screenshot-pixel checks. |
| Real Cognito roles | https://github.com/upgradedev/standby/actions/runs/41041997256 passed Analyst/Planner/Admin, exact review, idempotency, settings conflicts and stale-review invalidation. Source `cd34d6a4f87024c5f6d5a2627266fc54e55708d7`; service/domain implementation remains unchanged since that run. |
| Actual final media | https://github.com/upgradedev/standby/actions/runs/41058054655 passed all six captures and final encoded media checks. `verification.json`: video145s, audio145s,30fps,23 caption cues in bounds. |
| Encoded MP4 SHA256 | `ef6f57794642870f40f90cd1bb1fc318ae2424a21f3e2f4fbdddcac9e7d2cb6d`; independently recomputed from the downloaded file with Python hashlib. |
| Final video download | https://github.com/upgradedev/standby/actions/runs/41058054655/artifacts/12978028227 — retained until 2026-11-20; local `.runtime/demo-visible/standby-demo.mp4`. This CI artifact is not the required qualifying public video host. |
| Native visual proof | `.runtime/standby-map-live.jpg`: real basemap, polygons, representatives and sites. Decoded final-video map, resilience and provenance frames in `.runtime/demo-visible/` were visually inspected. |
| Live retention drill | `.runtime/retention-live-receipt.json`: expired synthetic object deleted; unexpired probe preserved; active matrix ETag unchanged. |
| Synthetic auth cleanup | `.runtime/auth-cleanup-receipt.json`: only isolated test users/memberships/results and their secret removed after PASS. No owner credentials created. |

## Freeze history and important failure

- Original `49b8a940f83dcdf72fa5ee72aca7ba55553dcc7a` passed original source/journey checks. Those checks did not prove visible map pixels.
- `48caf91933de5f24553c3ae9d0772c12186f3ded` corrected cohort labels and overbroad private-results wording. Its video run41055059142 passed timing but **failed later visual review**: the map was blank. Keep that artifact as failure evidence; never publish it.
- Native DOM inspection identified the cause: lazy-loaded MapLibre CSS overrode `.map-canvas`, giving the clipped map container height0 despite initialized SDK, AX markers and correct metrics. Final freeze5ad uses the higher-specificity `.map-canvas.maplibregl-map` selector. Actual native geometry became600x931px with absolute positioning. New gates reject zero area, clipping, offscreen controls and blank/neutral-only map pixels; the known bad image fails and the fixed image passes the same criteria.
- Only a false judge-facing statement, broken mandatory deliverable or disqualification risk justifies further unfreeze. Record reason, affected surfaces and whether video needs replacing before editing.

## Product and data contract

Read `docs/STANDBY_MVP_SPEC.md` for the selected MVP, console IA, API/domain contracts, AWS architecture and acceptance details. Five routes implement Overview, Incident history, Planning queues, Coverage map and Settings. The original React/TypeScript/Tailwind/TanStack console has a collapsible rail, badges, workspace/search/user bar, charts, filtered/sorted/paged master-detail table, tabbed drawer, toasts/API banner, page states, keyboard containment and responsive navigation. Protected workspaces enforce real server permissions.

The public model compares depot, geographic spread and train-selected placements, then recomputes with an unavailable unit. This is historical coverage with assumed sites/fleet and modeled Car road approach. It is **not** real dispatch, customer waiting time, an achieved SLA, future demand, simultaneous-job simulation or a validated mixed motorcycle/tow-truck operation.

[PRIMARY] City of Austin source: https://data.austintexas.gov/resource/dx9v-zd7x.json ; reuse terms: https://datahub.austintexas.gov/stories/s/ranj-cccq . The importer pages to completion and sanitizes public output. Publication timestamp is not breakdown occurrence. Train2023–2024 selects the model; holdout2025 only evaluates it. `python tools/data/validate.py ../../worktrees/standby-data/.runtime/dataset.json` validates120 train-derived Voronoi zones,12 assumed sites,3072 accepted training reports and1467 accepted held-out reports. Raw input counts3456/1662 are separate denominators. Fixed partitions cover bbox[-97.88,30.18,-97.62,30.46]; no in-region held-out demand is dropped to improve coverage.

Dataset SHA256 `447804ec7823abef15241c0ff080af9892ad71456bde6227e2185d784b2ec31f`. Private matrix SHA256 `ca19df599b142229f099eb91073ddda5899aa676da1e86c5edf7b0dcacadadb0`; generated2026-10-30T10:00:15Z, expires2026-11-27T10:00:15Z. `python tools/build-matrix.py --input ../../worktrees/standby-data/.runtime/routing-input.json --attempt 1` reserved1440 Core pairs and returned zero NoRoute cells. No further paid routing call was needed for testing or video. Default three-unit/10-minute held-out result: depot929/1467, spread1172/1467, proposal1415/1467; these are modeled historical results under the stated assumptions.

## AWS, cost and safeguards

Dedicated stack `standby-mvp`, region eu-west-1, personal account308857099262, explicit profile`default` and IAM identity`tf-surface-studio`. Never use profile`upgradedev`, which belongs to the commercial FrontBox account. Root verifies identity before cloud mutation. Never mutate frozen or unrelated workspace projects.

Private S3 web origin with CloudFront OAC; separate private source and expiring provider cache buckets; HTTP API; separate read/evaluate, writer and retention Lambdas; DynamoDB; Cognito authorization code with PKCE and workspace memberships; CloudWatch and scheduled retention. Raw matrices remain private; public modeled comparisons intentionally expose derived coverage and road times. No raw/matrix bucket is a CloudFront origin. Paid route building is owner-only with an atomic finite pair quota; the public evaluator cannot trigger it. Read concurrency8 with API rate3/s and burst10 was verified after fixing actual throttles. Do not weaken auth, role checks, exact-result review, conditional versions or expiry.

USD25 **total** remains approved; do not re-request unchanged budget. ESTIMATE initial routingUSD0.72 =1440 x verifiedUSD0.0005/Core pair. Original Polly narration1971 characters: ESTIMATE USD0.031536 at USD0.000016/character. Six original voice files were reused, with no additional synthesis. Actual invoiced spend remains unmeasured; these are not an invoice or a guaranteed account-wide financial cap. Internal Location allocation targetUSD10 and finite initial quota8640 pairs remain safeguards. Provider-derived stored copies expire28 days; lifecycle29 days plus verified deletion worker. Map-only origin-restricted viewer key expires after the published judging window. Do not tear down any live judge surface from stale notes; recheck the organizer's actual judging end first.

## Official challenge and prize aim

Organizer: https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/weekend-challenge-map-it . Target exact label **"Hackathon Winners (5)"**; each receives **"$100 USD in AWS Promotional Credits"** and **"AWS Builder Backpack"**. All slots are identical; there are no runner-up categories. Four criteria each25%: technical innovation/originality, craft/execution, usefulness/impact, creativity/storytelling. AI plus human scoring advances the highest50; AWS panel selects five. Observed registrations were31 onOctober29 and81 onOctober30; these are not submitted-entry counts and are not a winning-probability estimate.

Live rules were read in the owner's Chrome session, updated2026-10-28. Build/submission window2026-10-30 07:00UTC/09:00Athens through2026-11-02 21:00UTC/23:00Athens. Published judgingNovember2–13, subject to organizer extension. Rules require original mapped spatial data, AWS location/data service, a publicly reviewable working app or working map demo, a published Builder project and an allowed public video below three minutes. Allowed video hosts: YouTube, Vimeo, Facebook Video or Youku. Public source is optional but must use an OSI-approved licence. One entry/person or team, maximum five members. Do not fabricate winning scores, label registrations as entries or reuse unlicensed data.

Eligibility requires age18+ and eligible actual residence, with Amazon employment/affiliation, immediate-family and household exclusions. Excluded residences recorded from the official rules: Argentina, Australia, Brazil, Hong Kong, Indonesia, Italy, Malaysia, Thailand, Philippines, Vietnam, Singapore, Russia, Cuba, Iran, North Korea, Belarus, Crimea, DNR, LNR and UAE. Greece is not listed; actual owner residence is still unconfirmed. Ask for the facts; never infer them from language/timezone.

## Remaining owner-gated actions

1. Review `.runtime/demo-visible/standby-demo.mp4` and the existing Builder draft.
2. Obtain one explicit action-time confirmation for public upload to the signed-in YouTube channel Efthimios and final AWS Builder publication/submission, including the terms acceptance. Upload dialog explicitly says submitting videos agrees to YouTube terms/community guidelines; no file has been selected or uploaded.
3. Obtain owner attestation of age18+, actual country of residence and absence of the Amazon employment/family/household exclusion before final submission.
4. Upload the final MP4 publicly, add captions if supported, update Builder body and Demo field with the real public video URL, Publish, then visibly verify qualification/Submitted and public links. Never claim submission from a draft.

The owner freed local disk space after an async request; latest observed free space1727320064 bytes. Prior automatic review rejected generated-copy cleanup as blocked by policy without a more specific reason; no alternate destructive cleanup was attempted. This storage blocker is resolved. Local Git state was reconciled safely with the upstream final-documentation commit after preserving `.runtime/pre-final-status.patch`.

Owner enrollment helper: `python tools/create-operator.py --username <owner-choice>` prompts for the owner's new password interactively. Never collect or invent an owner password in chat. Public simulation works independently. No Codex automation is scheduled.

## Writer claims

No active child writer claims. Coordinator is finishing the publication handoff; final UI writes remain gated by the owner's action-time confirmation. Isolated implementation checkouts are standby-console, standby-data and standby-writer; never work inside another agent's checkout. Local source checks may use dependency-free Node/Python only. Heavy dependencies/build/browser work stay in hosted CI; never install npm/pip/Playwright packages here.
