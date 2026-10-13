# Gym Log

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React, TypeScript, Vite, Tailwind and application-owned shadcn-style UI. Lean NestJS and PostgreSQL backend, with IndexedDB/Dexie local-first persistence and a production PWA shell.

## Users

Initially one owner tracking workouts on a phone. Possible additional users later, not initial multi-tenant scope.

## Product Purpose

Replace Strong's daily logging workflow without template or analytics paywalls. Make progressive overload visible through actual per-exercise performance and complete inspectable history.

## Operating Context

Start a template or repeat a historical workout. Adjust prefilled weight/repetition targets and explicitly confirm completed sets. Training splits vary. Best comparable historical performance is the preferred reference. Dumbbells are recorded per dumbbell, barbells include the bar, and assisted-machine values mean assistance. Machine changes between gyms limit longitudinal comparability.

## Capabilities and Constraints

Implemented: unlimited editable templates, empty start, custom exercises, repeat-from-history, resilient device-local active-workout saving, per-exercise analytics and CSV migration. Weighted, assisted, bodyweight, duration and cardio exercise rows are supported; separate bodyweight tracking and broader cardio workflows remain future scope. No rest timers, notifications required for core use, nutrition, body-part measurements, social features, or watch support initially. Silent Android active-workout notifications remain optional and unverified on-device.
The private mobile trial uses the owner's Tailscale identity with no separate app password. Completed history and templates sync automatically while connected; unfinished workouts remain device-local. Sync is not off-device backup; the server database is backed up nightly, encrypted, off-device, and a restore from it has been verified on this host. Routine sync is silent, with no manual Sync Now or Backup & Recovery panel; actionable failures remain visible. Storage recovery APIs and database backup safeguards remain intact. Conflict merge, a recovery rehearsal on a rebuilt machine and real phone acceptance remain incomplete.

### Implemented Phase 2 navigation and evidence

- **Profile:** workout/set totals, this week's workout count, a 12-week frequency chart, a Flagged sets review list (only when the import flagged sets) and Settings.
- **History:** complete source details, search/pagination, Repeat and Save as template.
- **Workout:** empty start and editable templates. Exercise additions use a full-screen searchable/filterable catalog picker, also in template editing, with custom-name creation and an explicit type choice. Set deletion has no undo banner. Targets remain unchecked until completed; minimize/resume keeps the local draft and shows elapsed time and completed/total sets. Tapping an exercise's name or drawing in the active workout opens its details over the logger; closing them returns to the workout unchanged.
- **Exercises:** searchable catalog and exact recorded/custom names, body-part filters and recent exercises, with each exercise's workout count at the right and a remembered A–Z / Most done sort. Details have **About / History / Charts / Records**, with available instructional content, actual sets, exact trend tables and source-linked records.

Weighted charts show best reps, best load, session volume and bounded Epley estimates; assistance uses least assistance and reps, not resistance formulas. Best reps/load may come from different weights/rep counts and are not automatically comparable strength gains. Records include heaviest weight by exact rep count. Any recorded set can be excluded from analytics, and included again, from exercise History, the source workout or Profile's Flagged sets list; excluded sets stay visible and labelled but do not count toward records, charts, set evidence or targets. Raw values are unchanged, and a reviewed Strong reimport carries exclusions to the same raw row (vanished rows are reported). Correcting a set's values remains incomplete. When a chosen weight has no history, set evidence shows the nearest actual lighter and heavier recorded sets, never a converted equivalent. Duration/distance-specific charts are not implemented. Volume is recorded load × reps, not evidence of hypertrophy; machine loads are not equated across gyms.

Catalog instructions and muscle data, and most drawings, use attributable Everkinetic/wger content. Gaps may be filled with reviewed AI-assisted drawings made for Gym Log, always labelled as AI-assisted and never attributed to Everkinetic/wger; an exercise with no drawing that passes review stays without one. The catalog data keeps item-level title, author, source/license URLs and adaptations; About shows drawings, equipment and muscles only, without instructions or credit text. Preserve original licenses and applicable attribution/share-alike obligations. Coverage varies; a custom exercise outside the catalog still retains its history and analytics.

## Brand Commitments

Gym Log is a temporary name. Use a restrained shadcn-style visual family with an independent palette; do not reproduce Strong branding.

## Evidence on Hand

A private Strong CSV is available outside the repository. Its historical set rows support history import and performance analytics; it does not contain separate templates or bodyweight logs. Publishable examples and tests must be synthetic.

## Product Principles

- Logging speed and recoverability come before dashboard decoration.
- Actual performance comes before estimated strength.
- Every metric is named precisely and traceable to its sets.
- Preserve imported evidence and make uncertainty visible.
- Private data stays on the owner's device and private infrastructure, with encrypted off-device backup; no telemetry or external processing of workout history. Storage export/recovery functions remain technical capabilities, not a current user-facing export flow.

## Open Decisions

Permanent product name; conflict-resolution UX; future watch or health integration. Pine is the approved default accent, with Ocean and Copper options.
