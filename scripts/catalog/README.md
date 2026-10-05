# Catalog drawings

The licensed base catalog is built by `generate.py` from reviewed open-source
mappings. Do not replace or reattribute those illustrations or text sources.

## App-owned illustrations

Missing illustrations may be generated specifically for Gym Log. They are marked
`app-owned`, authored by `Gym Log`, and explicitly described as AI-assisted. This
label describes app-created provenance, not a claim that AI output has exclusive
copyright or a Creative Commons license. Existing licensed sources retain their
original attribution and terms. The reference image guides visual style only;
no reference pixels are bundled in the new assets.

Raw PNGs stay outside git in `~/.cache/gym-log-catalog/generated/`. The tracked
`generated-manifest.json` records reviewed attempts, acceptance, and SHA-256 hashes
of accepted sources. Rejected and unreviewed images must never be bundled.

Reproduce the approved additions (Pillow with WebP support and the repository's
Node/Prettier dependencies from `npm ci --include=dev` required):

```sh
python3 scripts/catalog/generated.py
# Or, with a restored source cache:
python3 scripts/catalog/generated.py --source-dir /path/to/generated
npm run test:run -- tests/catalog.test.ts
npm run typecheck
```

The sibling script imports `generate.line_mask`, so cropping, ink extraction,
8-level quantisation, maximum 240-pixel side, and lossless WebP conversion are the
same as existing drawings. It refuses mismatched source hashes or replacement of
licensed images, and validates all sources before changing assets. Run it after
`generate.py` if rebuilding the licensed base catalog.

## QA and continuation

Use `image_generate` with the reference image and square aspect ratio. Describe
body position, grip, bar/handle orientation and camera angle explicitly. Inspect
every generated output with `vision_analyze` for exact exercise/variant, limb
count, equipment coherence and style. Regenerate up to three times; leave the
exercise without a drawing if none passes. Record every attempt in the manifest.
After bundling, inspect the resulting 240px masks and 44px thumb equivalents on
light and dark backgrounds. `ExerciseThumb` uses each asset's alpha as a CSS mask
filled with the theme foreground (not a white-paper image or simple inversion).

Current generation is **partial**: 17 generated outputs, six approved, seven
rejected, four awaiting QA. The vision provider hit its session limit during QA,
with a later reported reset. Some catalog exercises remain without drawings. No unreviewed output is bundled.

Rejected attempts and reasons are in `generated-manifest.json`. Pending review:
`face-pull-cable` attempt 1, `plank` attempt 1,
`reverse-fly-machine` attempt 4 (third regeneration) and
`seated-palms-up-wrist-curl-dumbbell` attempt 1. Their raw paths are recorded under the cache's `attempts/`.
The remaining exercises without drawings come next.
