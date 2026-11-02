# AWS Weekend Challenge: Map it — current state

Updated 2026-11-02 20:54 UTC. The application remains frozen; this closure changes documentation and video tooling only.

## Mandatory deliverables

| Deliverable | Observed status |
|---|---|
| Public source | MET: [MIT source](https://github.com/upgradedev/standby) |
| Working AWS map and real spatial dataset | MET: [anonymous Capacity lab](https://d34x1513u5u1qs.cloudfront.net/capacity); latest delivery-session GET returned HTTP 200 |
| Written Builder project | SAVED DRAFT — owner must set public video URL and Publish |
| Public video under three minutes | https://youtu.be/5zMug36G_ko |
| Final challenge publication/submission | PENDING OWNER ACTION; saved draft is not submission |

The official deadline is 2026-11-02 21:00 UTC / 23:00 Europe/Athens. Target: “$100 in AWS credits + AWS Builder Backpack”, one of five equal winner slots. There are no separate runner-up categories. The official About page was re-read during final delivery: four equally weighted criteria (technical innovation, craft, usefulness, storytelling), fifty entries advance to five winners. Registered participants are not submitted-entry counts. [Official requirements](https://builder.aws.com/build/hackathons/e7a301ea-4d84-3b9e-95be-7340a70f7781/weekend-challenge-map-it).

## Verified artifacts and reproduction

| Evidence | Observation and command |
|---|---|
| Application frontend | `db67b6d0a2455549736be0d6574c184309fe0277`; deployed artifact, distinct from later source/tooling commits. Prior served-byte evidence is linked in [the brief](docs/CONSOLE_BRIEF.md#step6-owner-handover---approved-preview-deployed-2026-10-31). |
| API/config | `3802d94e5ae5a66b6b7fb8fc67030393d0a276ea`; separate deployed artifact. |
| Source and tooling | Qualified source `21f09d94bb02b47c8e09c6342816170848d08b10`, merged as `ac214372daf0e609084394ab8e1c2299890e62c6`; `gh pr view 11 --repo upgradedev/standby --json state,mergeCommit`. |
| Full source CI | [Successful run41517562574](https://github.com/upgradedev/standby/actions/runs/41517562574); `gh run view 41517562574 --repo upgradedev/standby --json status,conclusion,jobs`. Optional authenticated-role job is a separate gate. |
| V4 strict render | [Successful run41518347902](https://github.com/upgradedev/standby/actions/runs/41518347902); `gh run view 41518347902 --repo upgradedev/standby --json status,conclusion,headSha`. |
| Final V4 MP4 | SHA256 `d15d02a10ab66c08c1df8de93654c1c9625e6d78439117e1b33f72538c63d9c5`, 16788301 bytes; `Get-FileHash -Algorithm SHA256 Standby-V4.mp4`. |
| Media measurements | 165 seconds / 4125 frames / 1920×1080 / 25fps / AAC48kHz stereo; `ffprobe -v error -show_streams -show_format -of json Standby-V4.mp4`. Hosted `ffmpeg -af ebur128=peak=true` measured -16.0 LUFS / -1.9 dBTP. |
| Live readiness | `Invoke-WebRequest https://d34x1513u5u1qs.cloudfront.net/capacity -UseBasicParsing` returned 200 during delivery. |

V3 was technically qualified but creatively rejected by the owner. V4 adds progressive illustrations synchronized to the same approved narration: overlapping jobs, capability compatibility, payload and busy-cycle constraints, matched-job what-if and AWS data flow. Audio, captions and native product clips retain their sealed provenance. Final master technical qualification does not attest to a human whole-video listen on speakers and headphones.

## Operational limits and residual checks

The current six-page console includes real historical Austin context and prepared Amazon Location Car approach times, mixed fleets, simultaneous modeled incidents, per-type service durations, shifts, queues and paired seeded what-if. Three units are an editable example, not measured sufficient staffing. Home markers are assumed sites, not GPS. Workshop destinations/queues, routed towing legs, insured records, operational weather/holiday forecasts, anomaly detection and AI copilot are not connected. Transport, drop-off and recovery remain visible editable assumptions.

No new routes, capture sessions, voice calls or application deployment were performed for V4. The nine approved Polly calls were consumed once; do not synthesize again under that authorization. The approved total AWS budget is USD25; actual invoice spend is unmeasured. Human keyboard/native-popup and incomplete-axe judgments remain open; no whole-app accessibility certification is claimed.

## Next action and ownership

The owner explicitly undertook final MP4 upload after both supported UI runtimes failed before connection. Prepare/review files are outside product history in the owner's upload package. YouTube must be Public; the Builder demo field must contain that video URL, and the owner must Publish and verify the challenge entry. Do not infer publication from saved draft content. No browser recovery, new take, paid narration, routing or feature work is pending.

Codex root owns only the isolated documentation delivery branch until handoff. Artifact reviewers have separate output folders and no application write scope. Preserve canonical dirty checkouts and retained failed evidence. After final delivery, freeze this entry for judging; leave the live AWS surface running throughout the judging window.
