# Catalog drawings

The licensed base catalog is built by `generate.py` from reviewed open-source
mappings. Do not replace or reattribute those illustrations or text sources.
Everkinetic drawings come from `dist/png`; when an exercise has none there,
`generate.py` falls back to the artist's finished source exports
`src/images-ai/<id>-S.ai.png` and `-F.ai.png` ("ai" = Adobe Illustrator, same
licence and attribution). Build from a full Everkinetic checkout, including
`src/`, or those drawings are dropped.

## App-owned illustrations

Missing illustrations may be generated specifically for Gym Log. They are marked
`app-owned`, credited to `Gym Log (AI-assisted, gpt-image-2)`, and explicitly described as AI-assisted. This
label describes app-created provenance, not a claim that AI output has exclusive
copyright or a Creative Commons license. Existing licensed sources retain their
original attribution and terms. Licensed Everkinetic reference drawings guide visual style only;
no reference pixels are bundled in the new assets.

Raw PNGs stay outside git in `~/.cache/gym-log-catalog/generated/`: one QA record
per exercise in `qa/<slug>.json` (status `accepted`, `rejected` or `unreviewed`,
SHA-256, attempts, notes) and accepted sources in `accepted/<slug>.png`. Like the
licensed drawings, each exercise shows a start and a finish pose: a record's ordered
`poses` list (`accepted/<slug>-0.png` start, `-1.png` finish, each with its SHA-256)
is bundled as `<slug>-0.webp` and `<slug>-1.webp`. Holds without a progression
(Plank) keep a single drawing. Pairs were owner-reviewed for movement order,
anatomy and matching equipment; review notes live in `reviews/`. The
tracked `generated-manifest.json` is written from those records and lists every
reviewed exercise, its status, attempt count and the SHA-256 of accepted sources:
`sha256` is the finish pose (or the only drawing) and `startSha256` the start pose
of a pair.
Rejected and unreviewed images are never bundled, and an app-owned drawing whose
record is no longer accepted is removed on the next run.

Reproduce the bundled additions (Pillow with WebP support and the repository's
Node/Prettier dependencies from `npm ci --include=dev` required):

```sh
python3 scripts/catalog/generated.py
# Or, with a restored source cache:
python3 scripts/catalog/generated.py --source-dir /path/to/generated
npm run test:run -- tests/catalog.test.ts
npm run typecheck
```

The script imports `generate.line_mask`, so cropping, ink extraction, 8-level
quantisation, maximum 240-pixel side and lossless WebP conversion match the
licensed drawings. It refuses mismatched source hashes and never replaces or
edits a licensed illustration or its attribution. All inputs are validated before
any asset changes. Run it after `generate.py` when rebuilding the licensed base.

Each bundled drawing is credited `Gym Log (AI-assisted, gpt-image-2)`, license
`app-owned`, with an adaptation note saying it is AI-assisted and not an
Everkinetic or wger work.

## QA and continuation

Generate with `image_generate` (gpt-image-2) using licensed Everkinetic drawings as
style references only. Every candidate must pass, on the raw full-size image:

1. A style audit: faceless egg head without hair or ears, thick uniform outlines,
   no shading or hatching, sparse interior lines.
2. An independent strict physical-logic audit: limb counts, no twisted torso,
   cables continuous from a pulley on a grounded column, machine parts and pivots
   connected to a grounded base, handles gripped, correct dumbbell/plate count,
   nothing passing through the body, and not confusable with another exercise.

Then inspect its 240px mask beside licensed masks on light and dark backgrounds.
Local post-processing is limited to operations that cannot change the pose
(removing small isolated specks, uniform line thickening); the result is
re-audited. About six attempts per exercise; an exercise without a passing
drawing stays without one. `generated-manifest.json` is the current status.
