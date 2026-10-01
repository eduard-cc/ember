# Gym Log

A local interactive workout-tracker prototype: editable set logging, repeatable workouts and inspectable exercise progress. The product name is temporary.

## Run locally

Requires a current Node.js release and npm.

```sh
npm ci --include=dev
npm run dev
```

Open http://127.0.0.1:5188. The initial dataset is clearly labelled synthetic demo data. Workouts and changes are saved only in this browser profile, not to a server or backup. Unreadable or unsupported saved data is preserved and blocks automatic saving; reset requires explicit confirmation. Cancel reset if the original needs recovery first.

To make a private Strong export available in the development preview:

```sh
GYM_LOG_CSV=/absolute/path/to/strong-export.csv npm run dev
```

The development server binds to loopback. The configured export is served only through a development-only route with caching disabled. Do not expose this server on a public or tailnet interface. Private exports must never be copied into `public/`, tracked files, screenshots for publication, or build output. `.local/source.json` records this machine's input location and is intentionally ignored. The UI also accepts a local CSV file with an import preview and explicit replacement.

## Checks

```sh
npm run test:run
npm run typecheck
npm run test:e2e
npm run build
```

Browser tests use the installed Google Chrome executable; see `playwright.config.ts` for the exact path and preview lifecycle. Domain tests use synthetic fixtures. No private export is required for tests or builds.

## Mobile workout logging

The active logger uses a compact editable-name/Finish header and full-width exercise sections. At 390px, the synthetic preview's first weight field begins at y=279.5px and is 137px wide; at 320px it is 102px wide. Set inputs are at least 16px, and logging controls retain 44px touch targets. Portrait and short phone landscape use four-column rows instead of a permanent trash column.

Swipe left on a row or its set-number/completion control to reveal Delete, then tap Delete explicitly. Tap the set-number action (or use keyboard Enter/Space) for the same non-gesture action. Input-started swipes remain native input interactions. Undo restores the latest deleted set, its order, values and completion without reverting subsequent edits. Undo is available within the current logger view only; it is not a persisted recovery stack. Desktop keeps a visible remove control.

Empty markers mean uncompleted targets; only explicit confirmation records a completed set, and changing values clears it. Finish still requires confirmation and excludes unfinished sets. Historical comparison links open the actual source workout.

While editing, mobile bottom navigation hides rather than covering the field. Focus and visualViewport resize/scroll keep the active input visible. Browser checks exercise actual Chromium touch dispatch, vertical scrolling, cancellation, keyboard actions, narrow/landscape layout and a resized viewport. They do **not** establish real phone keyboard behavior; on-device verification remains outstanding.

## Boundaries

This is not yet a supported gym-logging replacement. No backend, authentication, server synchronization, installable/offline app shell, backup automation, deployment, comprehensive exercise instructions, health integration, or native active-workout indicator is implemented. Optional bodyweight tracking and full cardio support belong to the product scope, not necessarily this design prototype. Nearby-weight fallback, user-facing suspicious-set correction/exclusion controls and exporting newly logged workouts are not implemented yet.

History retains imported source values and repeated row occurrences. Weight is normalized to kg and distance to km for analysis. Estimated 1RM uses Epley for weighted sets of 2–10 reps; a single rep uses its recorded load. This is an estimated performance proxy, not a measured maximum or training prescription. Assisted and bodyweight exercises do not use resistance-strength estimates. Recorded machine weights are not comparable across equipment changes.

`AGENTS.md` contains workflow, privacy and architecture context. `PRODUCT.md` describes product scope. `DESIGN.md` describes the prototype's built visual language.

Everything remains local. No GitHub remote or CI/CD has been configured.
