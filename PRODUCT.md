# Ember

## Platform

web

## Stack

React, TypeScript, Vite, Tailwind and application-owned shadcn-style UI. Lean NestJS and PostgreSQL backend, with IndexedDB/Dexie local-first persistence and a production PWA shell.

## Users

Initially one owner tracking workouts on a phone. Possible additional users later, not initial multi-tenant scope.

## Product Purpose

Replace Strong's daily logging workflow without template or analytics paywalls. Ember is the source of truth for the owner's training history: their Strong history was imported once, and Strong import is retired. Make progressive overload visible through actual per-exercise performance and complete inspectable history.

## Operating Context

Start a template or repeat a historical workout. Adjust prefilled weight/repetition targets and explicitly confirm completed sets. Training splits vary. Best comparable historical performance is the preferred reference. Dumbbells are recorded per dumbbell, barbells include the bar, and assisted-machine values mean assistance. Machine changes between gyms limit longitudinal comparability.

## Capabilities and Constraints

Implemented: unlimited editable templates, empty start, existing-library exercise selection, repeat-from-history, resilient device-local active-workout saving, per-exercise analytics, imported Strong history (one-time, now retired) and body-weight logging. Weighted, assisted, bodyweight, duration and cardio exercise rows are supported; broader cardio workflows remain future scope. No rest timers, notifications required for core use, nutrition, body-part measurements, social features, or watch support initially. A silent active-workout notification ("Workout active", the start time, "Tap to resume"; never exercise names or loads) is on by default where the browser supports service-worker notifications: Android Chrome and, once added to the Home Screen, iPhone and iPad on iOS 16.4+. The OS permission is asked once, from the first Start workout tap; logging never waits on it. It is shown once per workout, stays dismissed if swiped away, clears on finish, discard, replacement or switching it off, and a tap opens the logger. It is an ordinary notification, not a live timer, Live Activity or guaranteed ongoing panel, and it is not yet verified on a physical Android phone or iPhone.
The private mobile trial uses the owner's Tailscale identity with no separate app password. Completed history and templates sync automatically while connected; unfinished workouts remain device-local. Sync is not off-device backup; the server database is backed up nightly, encrypted, off-device, and a restore from it has been verified on this host. Routine sync is silent, with no manual Sync Now or Backup & Recovery panel; actionable failures remain visible. Storage recovery APIs and database backup safeguards remain intact. Conflict merge, a recovery rehearsal on a rebuilt machine and real phone acceptance remain incomplete.

### Navigation and evidence

The main navigation is **Profile / History / Workout / Exercises**, with Profile selected initially. An unfinished device-local workout reopens in the expanded logger.

- **Profile:** workout/set totals since the first workout; Every week (Workouts / Volume / Time over 3M / 6M / 1Y) leading with last full week against the usual week (median of earlier full weeks), the running week marked "so far", and a week list whose workouts open in place; New records from the last four weeks, each opening its exercise's Records; recorded sets per body part over the last four weeks against the usual, each opening Exercises filtered to it; body weight; and, from the cog beside its title, Settings (appearance, sounds and haptics, the workout notification, app updates). Settings is full-screen on phones, a side panel on desktop; desktop, logger and locked-state gears remain available.
- **Feedback:** short synthesised sounds mark accomplishments (starting, checking a set, finishing an exercise or workout, a new PR), loud enough to hear over music; haptics (vibration on Android, the system tick on iPhone) also confirm changes such as unticking, adding or removing. Browsing the app is silent. Both are on by default with their own Settings switches, mix with music instead of pausing it, and never block or fail logging. They are confirmation cues, not alerts or notifications.
- **Body weight (Profile):** kg entries with date and time (default now, editable for backdating) added or corrected through a phone drawer / desktop dialog. A chart shows the selected range (1M to All), and newest-first rows open for correction or deletion (with Undo). Fewer than two entries show an explicit empty/one-entry state, never a drawn line. Entries sync between devices like history and are included in recovery exports. They are independent of lifted weights, volume, records, drafts, templates and imported history; the imported Strong history had no body-weight data and none is inferred.
- **History:** workouts grouped by month, each card showing duration, volume, the personal records it set at the time and every exercise's top set (an actual set: the heaviest weight with the most reps at it); search behind the title's search button (a focused inline field on phones and desktop, cleared when closed) and pagination. A card opens the workout's every set, with its records and the Epley estimate for weighted sets of 1–10 reps, plus Repeat and Save as template. Finishing an in-app workout records elapsed minutes from its local start time (whole minutes from one minute on); sessions under a minute show "<1 min", and unknown (zero) durations show none. Existing completed/imported durations are preserved, and repeats/templates start fresh. Any workout can be edited (name, start, duration, exercises, set values) or deleted from its ⋯ menu; both sync at the expected revision, untouched sets keep their stored values and import evidence, and deletions are final.
- **Workout:** empty start and editable templates. Each template card shows its exercises with what Start will prefill (the latest matching sets, else the template's own values), a rough length from the owner's own minutes per set, and when it was last done; it opens a preview with Start workout. Exercise additions use a full-screen searchable/filterable catalog picker, also in template editing, using existing catalog or recorded exercises only. Adding or replacing with an exercise already in the workout is blocked with an explanation; existing imported repeated blocks are preserved. Swipe a set left to reveal Delete, then tap it (the set-number action is the non-gesture alternative); deletion has no alert or undo banner. Prefilled numbers are targets and stay unchecked until completed; editing a value clears completion, and Finish saves only completed, valid sets; minimize/resume keeps the local draft and shows elapsed time and completed/total sets. Once the finished workout is saved, a celebration screen shows its duration, sets and volume, the personal records it set against all earlier history (heaviest weight, session volume and estimated 1RM for weighted work, most reps for bodyweight; never for assisted or timed work or a first session) and its exercises; Done or back returns to History with the workout on top. There are no streaks or milestone counts. Tapping an exercise's name or drawing in the active workout opens its details over the logger; closing them returns to the workout unchanged. Holding an exercise's heading lifts it into a compact list to drag it to a new position (also Move up/down in its ⋯ menu), in the logger and the workout editors.
- **Exercises:** searchable catalog and exact recorded/custom names and body-part filters, with each exercise's workout count at the right and a remembered Most done / A–Z sort (Most done by default). Details have **Charts / History / Records / About**, initially Charts with history and About otherwise. On phones they open as a pushed page over the preserved list or logger, with Back returning to the same place. They show available drawings, equipment and muscle information, actual sets, metric/range chart segments with inspectable headlines, exact-value session lists opening source workouts, and source-linked records. Charts open on the last three months (wider when that holds fewer than two sessions); metric definitions sit behind an ⓘ instead of on the page.

Weighted charts default to Heaviest weight, with Best reps, Volume and Epley estimates (weighted sets of 1–10 reps; a single rep uses the recorded load); bodyweight work has rep trends; assistance uses least assistance and reps, not resistance formulas. Best reps/load may come from different weights/rep counts and are not automatically comparable strength gains. Records include estimated 1RM, heaviest weight, best set and session volume, least assistance, most reps, and heaviest weight by exact rep count. Every recorded set counts toward records, charts, set evidence and targets; imported data was cleaned once before its import and is otherwise corrected by editing the workout, not reviewed, flagged or excluded in the app. When a chosen weight has no history, set evidence shows the nearest actual lighter and heavier recorded sets, never a converted equivalent. Duration/distance-specific charts are not implemented. Volume is recorded load × reps, not evidence of hypertrophy; machine loads are not equated across gyms. Weight is normalized to kg and distance to km, keeping the source values.

Catalog instructions and muscle data, and most drawings, use attributable Everkinetic/wger content. Gaps may be filled with reviewed AI-assisted drawings made for Ember, always labelled as AI-assisted and never attributed to Everkinetic/wger; an exercise with no drawing that passes review stays without one. The catalog data keeps item-level title, author, source/license URLs and adaptations; About shows drawings, equipment and muscles only, without instructions or credit text. Preserve original licenses and applicable attribution/share-alike obligations; these content licenses are not a blanket license for the app. Coverage varies; a custom exercise outside the catalog still retains its history and analytics.

## Brand Commitments

Use a restrained shadcn-style visual family with an independent palette; do not reproduce Strong branding.

## Evidence on Hand

The owner's Strong history was imported once into production and now lives in Ember. It had no separate templates or bodyweight logs, so body weight starts empty and is entered in the app. Publishable examples and tests must be synthetic.

## Product Principles

- Logging speed and recoverability come before dashboard decoration.
- Actual performance comes before estimated strength.
- Every metric is named precisely and traceable to its sets.
- Preserve imported evidence and make uncertainty visible.
- Private data stays on the owner's device and private infrastructure, with encrypted off-device backup; no telemetry or external processing of workout history. Storage export/recovery functions remain technical capabilities, not a current user-facing export flow.

## Open Decisions

Conflict-resolution UX; future watch or health integration. Amber is the only accent.

## Remaining Release Gates

Real phone installation and workout testing, including the active-workout notification there and on an installed iPhone; a recovery rehearsal on a rebuilt machine (the restore from remote is verified on this host only); wider catalog and instruction coverage; broader cardio workflows.
