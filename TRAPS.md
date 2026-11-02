# Traps

## 2026-10-30 — Verified Builder upload and preview path

Successful path after exclusive Chrome control: fresh wide editor, direct Insert image button, one Insert image dialog, waitForEvent(filechooser) before Space on the dialog's input[type=file], then chooser.setFiles with the absolute JPG path. Fill title/alt/caption and Insert. All three remaining native uploads completed and survived reload. Earlier narrow More options menus exposed a different nested Image dialog; do not treat those flows as interchangeable.

End inside a wrapped heading can stop at a visual-line boundary. Return may split the heading around an inserted image. Inspect rendered heading text after insertion and correct with native block-type controls. Locator.fill on inherited contenteditable headings can turn them into paragraphs; explicitly select Heading 2 again when needed.

Full-page screenshots can show blank offscreen images despite loaded image metadata and can place sticky headers across content. Scroll each section into the viewport, inspect actual pixels and retain normal viewport proofs. Do not use the full-page capture as the final visual evidence.

## 2026-10-30 — Builder images and misleading chooser timeouts

Plain HTML paste retained prose/table but discarded images. Conventional Markdown image imports produced empty decorators and a failed-draft-save message. Native upload and Insert produced a banner that survived reload. Its UI export uses an Image component with url, title, alt and caption. Reconstructing image blocks through Markdown also failed to save; the backend reason remains unknown. Preserve working native RTE blocks and use the normal uploader.

A chooser timeout does not prove no Windows picker exists. Full App.getAXStateAndScreenshot showed Open at the START of the tree; tail-only inspection hid it. The intended filename was set through the observed File name edit, but foreground/tab changes prevented stable completion. Use fresh combined state and the exact returned controls/region. Never act on a screenshot showing another app. A real chooser event after Space on the file input allowed the banner upload. Verify success in the uploader and then reload plus actual project preview.

## 2026-10-30 — Browser capture clocks and static tails

Video production lost more than an hour to inferred recording in-points and static ending holds. Native Playwright screencast frames do not necessarily span the host wall-clock recording duration. A real retained baseline captured for about 36 seconds decoded to 29.766 seconds, including a 1.000-second magenta sync slate, leaving only 28.766 usable seconds for a 30-second beat. `python tools/demo/sync.py --media .runtime/demo-slate/raw/baseline-1793360604810.webm --seconds 30` correctly rejected it. The public onFrame JPEG subscriber also delayed delivery by up to ten seconds on the hosted software-rendering runner.

Use path-only native capture, a recorded editorial slate decoded from actual pixels, and real post-roll hover paints beyond the published window. Preserve individual completed beats and structured failure receipts before rendering. Never infer usable footage from Node start time, enlarge a passing tolerance or add artificial video padding. Verify the final encoded bytes, with audio/video ending within one frame and captions in bounds. A failed raw clip or stale inherited failure file is not the latest run's verdict; bind receipts to the exact raw filename and source SHA.

## 2026-10-30 — SDK readiness is not a visible map

The original live browser checks found twelve AX site markers and no map errors, but the actual map container had zero height because lazy-loaded MapLibre CSS overrode `.map-canvas` positioning. A timing-valid 145-second video was consequently visually invalid. Native computed DOM and decoded frames, not AX labels, exposed the defect. Use a selector more specific than provider CSS, require positive unclipped viewport geometry and visible controls, and inspect actual painted geographic pixels. New tests reject the retained real blank frame and accept the fixed native screenshot with unchanged pixel criteria. Re-recorded final media must also receive visual review.


## 2026-11-01 — Capture preparation exceeded the shot; clipped probes and misleading contact sheets

Approved Take1 run41228706765 stopped S5 after50.867s of aggregate actions against27s. It had1Coverage+1CapacityPOST; noS6/S7. This is not a capacity result or proof that isolated map loading took50.867s. Preserve out/take-1-attempt and original3cf3driver/50ed668fZIP. Prepare/load/verify the actual map and recovery Summary BEFORE their shot clocks, keep Run→outcome inside S4/S7, and reject the original in-window delay with the unchanged scheduler guard. Current offline control is `node scripts/check_take_timing.mjs` (use --help first); it imports only the exported scheduler, not the actual driver.

Decoded S2 frame at16.5s contains the912x550 map-only rectangle at0,0 and gray padding, matching an element screenshot probe. The mechanism is inferred, not instrument-measured. Avoid element screenshot probes while recording; proposed driver2 uses fullviewport plus in-memory translated inner80% crop, with all pixel probes outside source cut windows. Verify actual decoded frames before release; source checks are not a clean take.

A20frame contact sheet at tilewidth384 became all gray despite real decoded clip frames. Caller `--tile-width 392` produced every actual still correctly, with even-height stamp/padding; original script/skill remain untouched. Do not mistake a contact-sheet artifact for a black underlying video. Extract a direct frame to distinguish them. Never erase the original artifact or relax map/clock gates.

Capture wall-clock marks are not calibrated first-frame timestamps. Observed raw103.8s versus105.3s stop remains evidence; two-second handles do not calibrate it. Decode cut boundaries and verify actual Run and result are included. Existing October30 sync-slate lesson still applies.
