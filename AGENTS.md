# Gym Log agent context

## Purpose and scope

Gym Log is a temporary product name. Build a personal-use-first, self-hosted workout tracker inspired by Strong's fast logging workflow, with unlimited templates and inspectable per-exercise analytics. It is not a branded Strong clone or an AI coach. The initial deliverable is a local interactive frontend prototype, not a production replacement.

## Confirmed workflow

- Primary device: a phone. Mobile-first PWA eventually, desktop useful for history and analysis.
- Training splits change: never encode a fixed program.
- Start from an editable template, an empty workout, or repeat any historical workout.
- Repeating prefills editable targets; every set remains uncompleted until explicitly confirmed.
- Alongside logging, prefer best comparable historical sets: most reps at the chosen weight, date and source workout visible. No exact match means show actual nearby evidence, not an invented equivalent.
- Searchable, extensive exercise catalog and custom exercises. Keep exercise variants distinct.
- Dumbbell weight is per dumbbell; barbell weight includes the bar; assisted pull-up/dip load means assistance. These conventions are consistent in the owner's history.
- Ordinary set metadata can be added later. Basic cardio (duration/distance) and optional bodyweight are in product scope.
- No rest timers, audible alerts, nutrition, body-fat/body-part measurements, social features, or watch integration initially.
- A silent active-workout Android notification is an optional feasibility experiment, not a core requirement. Do not promise native ongoing-service behavior from web notifications.

## Analytics invariants

Lead with reps at the same weight and weight at comparable reps. Show complete exercise history, rep-specific records, per-session volume and set counts, estimated-strength trends, and workouts per week. Every trend must expose source sets. Volume is recorded load times reps, not proof of strength or hypertrophy. Estimated 1RM is secondary, formula-labelled, bounded to low-repetition resistance sets; lack of effort data prevents claims of true maximum strength. Never apply resistance formulas to assistance, unweighted work, or duration/distance. Machine weights can differ between gyms: keep recorded-load trends without equating different machines or inventing adjustments. Preserve raw imported values; flag and allow correction/exclusion of suspicious sets. Never silently discard repeated rows or auto-merge exercise names.

## Privacy and data import

Personal exports stay outside tracked source, public assets, build output, CI, screenshots intended for publication, and external services. Use synthetic fixtures in committed work. No telemetry or cloud processing in the prototype. The original export must remain unchanged.
The supplied CSV is semicolon-delimited UTF-8 with Date, Workout Name, Exercise Name, Set Order, Weight, Weight Unit, Reps, RPE, Distance, Distance Unit, Seconds, Notes, Workout Notes, Workout Duration. Parse quoted/multiline CSV properly; blanks and zero differ. Local timestamps have no timezone. The export has historical workouts/sets, not separate template or bodyweight records. Create templates from historical workouts rather than claiming missing records were restored.
Keep source occurrence identity separate from cross-export reconciliation. Duplicate candidates require review; reimport must not accidentally multiply history. Malformed imports must leave existing data intact.

## Stack and architecture

Prototype: React + TypeScript + Vite, application-owned shadcn-style primitives, Tailwind CSS, Lucide icons. Keep parsing and metrics in pure domain functions, UI/state separate. Browser-local persistence is prototype storage, not backed-up production storage.
Target architecture: a React frontend (TanStack Router/Query when needed), lean NestJS API with PostgreSQL, local-first active-workout persistence and explicit synchronization. Do not copy Redis, queues, banking, or email infrastructure without an actual need.
Future hosting: separate app/database/config/containers on this machine, private Tailscale HTTPS access, isolated staging, tested immutable image releases and host-side deployment. This is a target, not implemented CI/CD.

## Design and delivery

Use PRODUCT.md for durable product facts and DESIGN.md for the built visual system. Strong informs generic workflows, not exact branded UI/assets. Requested frontend design process: claude-design. Preserve a restrained shadcn style with an independent color scheme and gym-specific thumb-friendly controls. Hit targets at least 44px; visible keyboard focus, exact-value chart alternatives, reduced-motion support, desktop/mobile browser verification.
The owner authorized the private GitHub repository and branch/PR delivery. Keep the repository private; never publish personal history, credentials or recovery archives. Future changes use verified, independently reviewed feature branches and PRs. Never merge without explicit approval. Deployment, Tailscale changes, spending and other external communication require separate authorization. Preserve unrelated work. Prefer tests before domain behavior; verify observable Playwright flows and typecheck/build before handoff.

## Current local foundation

- IndexedDB/Dexie owns durable local state. Legacy migration retains original bytes; invalid storage blocks writes. Report saved only after transaction commit.
- One writer tab holds a Web Lock. Active workouts stay on their starting installation and never enter server sync. Finish atomically saves completed history, queues its operation, and removes the draft.
- NestJS/PostgreSQL API lives in server/. Only dedicated gym-log-local resources on 127.0.0.1:55439 are allowed. API binds 127.0.0.1:5190; Vite proxies same-origin requests.
- Sessions use HttpOnly cookies and memory-only CSRF. The private trial opts into Tailscale identity authentication, with the exact allowed owner in external config; there is no app password or permanent sync card. API stays loopback-only behind Serve, which strips spoofed identity headers. Never enable Funnel or accept arbitrary tailnet users. Password mode remains for existing local development/test paths. Outbox retries preserve immutable operation identity. Revision conflicts remain visible and retained; do not silently overwrite peer data.
- Reviewed Strong replacement touches imported history only. Compare complete current imported membership/content before an identical-file no-op; retained source hashes are provenance, not proof of current identity.
- Recovery exports validated versioned JSON including source evidence, owner/revision provenance and deliberately local drafts, without session secrets. Restore pauses edits/sync, requires confirmation, and rebuilds create-only operations rather than replaying acknowledgements.
- Production PWA caches only a finite shell allowlist. Updates require explicit confirmation and a saved, draft-free transition; never reload an active logger silently.
- Foundation is local-only, not production deployment. Real phone validation, private HTTPS, interactive owner provisioning, and off-device encrypted backups remain release gates.

## Development

See package.json and README.md for verified commands: npm ci --include=dev, npm run dev, npm run typecheck, npm run test:run, npm run test:e2e, npm run test:integration, npm run test:recovery, npm run test:pwa, npm run build. Server checks use npm --prefix server run typecheck/build/test:e2e. Do not run fixed-port integration suites concurrently. Fixtures are synthetic and databases disposable. Do not invent successful check output; state production gaps explicitly.
