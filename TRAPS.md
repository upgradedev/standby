# Traps

## 2026-10-30 — Browser capture clocks and static tails

Video production lost more than an hour to inferred recording in-points and static ending holds. Native Playwright screencast frames do not necessarily span the host wall-clock recording duration. A real retained baseline captured for about 36 seconds decoded to 29.766 seconds, including a 1.000-second magenta sync slate, leaving only 28.766 usable seconds for a 30-second beat. `python tools/demo/sync.py --media .runtime/demo-slate/raw/baseline-1793360604810.webm --seconds 30` correctly rejected it. The public onFrame JPEG subscriber also delayed delivery by up to ten seconds on the hosted software-rendering runner.

Use path-only native capture, a recorded editorial slate decoded from actual pixels, and real post-roll hover paints beyond the published window. Preserve individual completed beats and structured failure receipts before rendering. Never infer usable footage from Node start time, enlarge a passing tolerance or add artificial video padding. Verify the final encoded bytes, with audio/video ending within one frame and captions in bounds. A failed raw clip or stale inherited failure file is not the latest run's verdict; bind receipts to the exact raw filename and source SHA.

## 2026-10-30 — SDK readiness is not a visible map

The original live browser checks found twelve AX site markers and no map errors, but the actual map container had zero height because lazy-loaded MapLibre CSS overrode `.map-canvas` positioning. A timing-valid 145-second video was consequently visually invalid. Native computed DOM and decoded frames, not AX labels, exposed the defect. Use a selector more specific than provider CSS, require positive unclipped viewport geometry and visible controls, and inspect actual painted geographic pixels. New tests reject the retained real blank frame and accept the fixed native screenshot with unchanged pixel criteria. Re-recorded final media must also receive visual review.
