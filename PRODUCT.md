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

Unlimited templates, custom exercises, repeat-from-history, resilient active-workout saving, per-exercise analytics, CSV migration, optional bodyweight and basic cardio. No rest timers, notifications required for core use, nutrition, body-part measurements, social features, or watch support initially. Silent Android active-workout notifications remain optional and unverified on-device.
The private mobile trial uses the owner's Tailscale identity with no separate app password. Completed history and templates sync automatically while connected; unfinished workouts remain device-local. Sync is not off-device backup; the server database is backed up nightly, encrypted, off-device, and a restore from it has been verified on this host. Conflict merge, a recovery rehearsal on a rebuilt machine and real phone acceptance remain incomplete.

## Brand Commitments

Gym Log is a temporary name. Use a restrained shadcn-style visual family with an independent palette; do not reproduce Strong branding.

## Evidence on Hand

A private Strong CSV is available outside the repository. Its historical set rows support history import and performance analytics; it does not contain separate templates or bodyweight logs. Publishable examples and tests must be synthetic.

## Product Principles

- Logging speed and recoverability come before dashboard decoration.
- Actual performance comes before estimated strength.
- Every metric is named precisely and traceable to its sets.
- Preserve imported evidence and make uncertainty visible.
- Private data stays local; the owner can export their data again.

## Open Decisions

Permanent product name and palette approval; conflict-resolution UX; future watch or health integration.
