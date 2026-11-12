# Catalog drawings

Read before proposing, generating, editing, QA-ing or bundling exercise catalog drawings. `scripts/catalog/README.md` documents the pipeline and attribution; this file holds the working rules and failure modes.

## Current state and sources

- Every catalog exercise has a drawing (`tests/catalog.test.ts`, "gives every exercise a drawing"); a new exercise needs one before it ships.
- Before proposing new drawing work, read the QA records in `~/.cache/ember-catalog/generated/qa/*.json` (status, attempts, notes) and `scripts/catalog/generated-manifest.json`.
- Licensed sources first: re-check wger (`/api/v2/exerciseimage/?exercise=<id>`) for new licensed drawings. Everkinetic `src/images-ai/<id>-S/-F.ai.png` exports (Illustrator, same CC BY-SA licence) hold finished drawings missing from `dist/`; `generate.py` falls back to them. free-exercise-db has only photos, which the catalog excludes.
- Missing drawings come from reference-guided generation plus review rounds. Generic unguided attempts do not converge, and targeted edits of near-misses rarely fix structural problems (floating pads, safety-filter blocks).

## Everkinetic mappings (`scripts/catalog/generate.py`)

- `dist/png` drawings are artist-cropped (legs, feet, plates cut off). `EK_FULL_FIGURE` maps exercises to the uncropped `src/images-ai` exports, ordered (start, finish) for display; some exports label S/F backwards, so review order by eye.
- `thicken()` strips specks and picks the `MinFilter` size that brings the final mask closest to `EK_STROKE_WIDTH`; fixed sizes left large/small sources too faint or heavy.
- Keep shrugs on `dist`: at full-figure scale the shoulder lift is invisible. `EK_UPPER_BODY` crops only the narrow dumbbell/cable shrugs (same box for both poses, hands and weight fully in frame); cropping barbell/Smith shrugs strips plates and rails.
- `EK_TEXT_ONLY` keeps Everkinetic steps but drops its drawing when it shows another variant (Pull Up (Assisted) reuses the chin-up-assisted QA poses; redrawing that pair means updating both records' hashes).
- Check that an Everkinetic id's title matches the exercise before mapping it.
- A full `generate.py` run takes several minutes: run it as a background process, never inside a tool call with a short timeout.
- A fresh worktree needs `NODE_ENV=development npm ci --include=dev` before `generated.py` (it runs the repo's Prettier).

## App-owned (AI-assisted) drawings

- Generate them as app-owned assets with explicit AI-assisted attribution (`Ember (AI-assisted, gpt-image-2)`, enforced by `tests/catalog.test.ts`). Preserve every licensed asset and source. Cache raw PNGs outside git, record source hashes and QA decisions, and reuse `generate.line_mask`.
- Every app-owned drawing is an approved start/finish pair (`qa/<slug>.json` `poses` list, `accepted/<slug>-0/-1.png`), except holds without a progression (Plank, a single drawing). Generate the second pose by editing the approved first so person, machine and angle match. Check which pose the approved drawing actually shows before labelling it start or finish.
- When a pose keeps failing against an approved partner whose machine is wrong, redraw both poses from one real-machine reference (video frames) instead of forcing it.
- Bundle with `scripts/catalog/generated.py`: it reads `qa/<slug>.json` status and removes app-owned drawings that are no longer accepted.
- Successful generation is not approval: a drawing ships only once it has passed review.

## Style

- Match Everkinetic or don't ship: faceless egg heads, no hair, thick uniform outline, no hatching or shading, minimal muscle lines, equipment reduced to what the body touches, tight crop. QA side by side with licensed masks, and inspect both 240px masks and CSS-mask thumbnails on light and dark backgrounds.
- "Minimal muscle lines" alone still yields anatomy-chart figures. Append explicit bans ("no ears, no finger knuckle lines, no shoe laces, no six-pack") to the prompt prefix. For a style-only failure, a targeted "remove interior lines, keep pose" edit usually passes.
- Thin AI lines read faint at 240px. A uniform `MinFilter` dilation on the raw PNG brings stroke width into the licensed range without changing the pose; re-audit afterwards.

## Prompting and pose limits

- In pure side view, ab wheels come out edge-on; ask for a full circle facing the viewer with the handle pointing at the viewer.
- Use front three-quarter angles for pulldowns and two-dumbbell movements so bars stay visibly left-right and dumbbells stay separate.
- Editing an approved drawing into a new pose keeps the style but rarely fixes pose limits. gpt-image-2 would not draw a front rack with high elbows (cleans, thrusters), readable upturned palms (wrist curls), a barbell across the body in a front raise, visibly raised heels on a calf raise, or a coherent barbell hip thrust. Don't spend attempts on these; find another source or plan a different approach.

## QA and fixing defects

- Style QA misses physics errors. Before showing or accepting any AI drawing, run a separate strict physical-logic audit on the raw full-size image: cables are one straight continuous line, fully visible, never hidden behind legs; every machine part connects to the base (no floating pads or pulleys); the handle is attached and gripped; the body isn't twisted; limb counts are right.
- A single physics audit is noisy. Accept only after two independent physics passes plus style, and break ties with a targeted yes/no question about the specific defect.
- Fix a single defect with a targeted image edit; regenerate when there are several. If the provider's safety filter blocks an edit (wording like "crunched down" or "kneeling" can trip it), a local luminance threshold removes grey specks without changing geometry.
- When a whole-image edit won't fix a small local defect and breaks other parts, edit a crop around the defect, binarise it, and paste it back with a tight hard-edged mask covering only the changed region; re-audit the seam.
- Re-audit after any edit or post-processing.
