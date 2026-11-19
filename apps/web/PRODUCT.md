# Ember

## Platform

web

## Stack

React PWA with IndexedDB local-first persistence; NestJS and PostgreSQL sync API.

## Users

Initially one owner tracking workouts on an Android phone. Possible additional users later, not initial multi-tenant scope.

## Product Purpose

Replace Strong's daily logging workflow without template or analytics paywalls: a personal-use-first, self-hosted tracker, not a branded Strong clone or an AI coach. Ember is the owner's source of truth for training history; history imported from Strong exports keeps its source cells and repeated blocks, and the app has no import flow. Make progressive overload visible through actual per-exercise performance and complete inspectable history.

## Operating Context

Start a template or repeat a historical workout. Adjust prefilled weight/repetition targets and explicitly confirm completed sets. Training splits vary: never encode a fixed program. Best comparable historical performance is the preferred reference. Dumbbells are recorded per dumbbell, barbells include the bar, and assisted-machine values mean assistance.

## Capabilities and Constraints

Weighted, assisted, bodyweight, duration and cardio exercise rows are supported; broader cardio workflows remain future scope.

Excluded unless the owner changes it: rest timers, alerts, notifications required for core use, nutrition, body-part measurements, social features, streaks and milestone counts, manual Sync Now, a Backup & Recovery panel, a user-facing export flow, and in-app flagging, exclusion or data-cleanup controls.

Active-workout notification: silent ("Workout active", the start time, "Tap to resume"; never exercise names or loads), on by default where the browser supports service-worker notifications (Android Chrome; iPhone and iPad on iOS 16.4+ once added to the Home Screen). The OS permission is asked once, from the first Start workout tap; logging never waits on it. A swiped-away notification stays away while Ember is in the background and returns when Ember is opened or brought back; it clears on finish, discard, replacement or switching it off, and a tap opens the logger. It is an ordinary notification: never promise a live timer, Live Activity or guaranteed ongoing panel.

Feedback: short synthesised sounds mark accomplishments only (starting, checking a set, finishing an exercise or workout, a new PR), loud enough to hear over music; haptics also confirm changes such as unticking, adding or removing. Browsing is silent. Both are on by default with their own Settings switches, mix with music instead of pausing it, and never block or fail logging. They are confirmation cues, not alerts.

Access and sync: the owner's Tailscale identity, with no separate app password. Completed history, templates and body weight sync automatically and silently while connected; actionable failures stay visible. Unfinished workouts remain device-local. Sync is not off-device backup; the server database has a nightly encrypted off-device backup with a restore drill (`ops/README.md`). Storage recovery APIs and database backup safeguards remain intact.

### Screens and evidence

The main navigation is **Profile / History / Workout / Exercises**, Profile first. An unfinished workout reopens in the expanded logger.

- **Profile:** totals; weekly Workouts / Volume / Time against the usual week (median of earlier full weeks); sets per muscle over the last four weeks (1 per primary set, ½ per secondary, cardio none) against the usual; new records from the last four weeks; body weight; Settings from the cog.
- **Body weight:** kg entries with an editable date and time, corrected or deleted (with Undo). Fewer than two entries show an explicit empty or one-entry state, never a line. Entries sync and are in recovery exports. They are independent of lifted weights, volume, records, drafts, templates and imported history; imported history carries no body weight and none is inferred.
- **History:** workouts by month with duration, volume, the records set at the time and each exercise's top set (an actual set: the heaviest weight with the most reps at it). A workout opens every set, its records and the Epley estimate for weighted sets of 1–10 reps, plus Repeat and Save as template. Imported durations are preserved; repeats and templates start fresh. Any workout can be edited or deleted; both sync at the expected revision, untouched sets keep their stored values and import evidence, and deletions are final.
- **Workout:** templates show what Start will prefill (the latest matching sets, else the template's values), a rough length from the owner's minutes per set and when last done. Exercises come only from the catalog or recorded names; adding or replacing with one already present is refused with an explanation, and imported repeated blocks are preserved. Prefilled numbers are unchecked targets; an edit unchecks a set only when making it invalid, and Finish saves only completed, valid sets. After a save, a celebration shows duration, sets, volume, the records set against earlier history (heaviest weight, session volume and estimated 1RM for weighted work, most reps for bodyweight; never for assisted or timed work or a first session) and its exercises.
- **Exercises:** catalog and exact recorded names with body-part filters and a Most done / A–Z sort. Details have **Charts / History / Records / About**: drawings, equipment and muscles, actual sets, inspectable charts with exact-value session lists opening source workouts, and source-linked records.

Weighted charts default to Heaviest weight, with Best reps, Volume and Epley estimates (weighted sets of 1–10 reps; a single rep uses the recorded load); bodyweight work has rep trends; assistance uses least assistance and reps. Best reps/load may come from different weights/rep counts and are not automatically comparable strength gains. Records include estimated 1RM, heaviest weight, best set and session volume, least assistance, most reps, and heaviest weight by exact rep count. Every recorded set counts toward records, charts, set evidence and targets. When a chosen weight has no history, set evidence shows the nearest actual lighter and heavier recorded sets, never a converted equivalent. Duration/distance-specific charts are not implemented. Weight is normalized to kg and distance to km, keeping the source values.

Catalog content and licensing: `docs/catalog.md`. About shows drawings, equipment and muscles only, without credit text; AI-assisted drawings are never credited as Everkinetic/wger work. Preserve original licenses and attribution/share-alike obligations; they are not a license for the app. A custom exercise outside the catalog keeps its history and analytics.

## Brand Commitments

Use a restrained shadcn-style visual family with an independent palette; Strong informs generic workflows only, never its branding or assets.

## Evidence on Hand

Production holds the owner's real history, including Strong imports (no templates or body weight). Publishable examples and tests must be synthetic.

## Product Principles

- Logging speed and recoverability come before dashboard decoration.
- Actual performance comes before estimated strength.
- Every metric is named precisely and traceable to its sets.
- Preserve imported evidence and make uncertainty visible.
- Private data stays on the owner's device and private infrastructure, with encrypted off-device backup; no telemetry or external processing of workout history.

## Open Decisions

Conflict-resolution UX; watch or health integration. Nothing of the latter is built; if it is, it must be fully automatic after setup and never duplicate sessions or overwrite recorded sets.

## Remaining Release Gates

Real Android phone installation and workout testing, including the active-workout notification there and on an installed iPhone; conflict merge; a recovery rehearsal on a rebuilt machine (the off-device restore is drilled on the current host only); wider catalog coverage; broader cardio workflows.
