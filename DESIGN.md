---
name: Ember
description: Mobile-first workout ledger with inspectable evidence and durable local saving.
colors:
  paper-bg: 'hsl(38.6 43.8% 93.7%)'
  ink-fg: 'hsl(270 7.5% 15.7%)'
  paper-surface: 'hsl(42 55.6% 96.5%)'
  paper-muted: 'hsl(37.9 20% 81.4%)'
  paper-muted-fg: 'hsl(33.7 7.8% 40%)'
  paper-border: 'hsl(39.1 19.7% 77.1%)'
  paper-accent: 'hsl(37.1 36.8% 88.8%)'
  night-bg: 'hsl(252 10.2% 9.6%)'
  night-fg: 'hsl(38.6 31.8% 91.4%)'
  night-surface: 'hsl(260 9.1% 12.9%)'
  night-muted: 'hsl(266.7 8.7% 20.2%)'
  night-muted-fg: 'hsl(36 9.2% 68%)'
  night-border: 'hsl(270 6.9% 22.7%)'
  night-accent: 'hsl(262.5 9.1% 17.3%)'
  primary: '#9e5700'
  primary-foreground: 'hsl(38.6 43.8% 93.7%)'
  primary-tint: '#f5ead6'
  secondary: 'hsl(34.3 38.2% 89.2%)'
  secondary-foreground: '#9e5700'
  night-primary: '#f5b13d'
  night-primary-foreground: 'hsl(252 10.2% 9.6%)'
  night-primary-tint: '#332b1f'
  night-secondary: 'hsl(265.7 8.2% 16.7%)'
  night-secondary-foreground: '#f5b13d'
  destructive: 'hsl(6 62% 42%)'
  destructive-foreground: 'hsl(8 60% 96%)'
  night-destructive: 'hsl(4 70% 66%)'
  night-destructive-foreground: 'hsl(4 40% 12%)'
  warning: 'hsl(34 80% 30%)'
  night-warning: 'hsl(36 70% 58%)'
  info: 'hsl(200 60% 33%)'
  night-info: 'hsl(200 55% 62%)'
  success: 'hsl(150 50% 27%)'
  night-success: 'hsl(148 40% 55%)'
  chart-primary: 'hsl(270 7% 30%)'
  chart-secondary: 'hsl(37 16% 74%)'
  chart-secondary-edge: 'hsl(37 12% 48%)'
  night-chart-primary: 'hsl(38 28% 80%)'
  night-chart-secondary: 'hsl(36 6% 48%)'
  scrim: 'hsl(252 10.2% 9.6%)'
  night-scrim: 'hsl(252 12% 3%)'
typography:
  body: {fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', lineHeight: 1.5}
  page-title: {fontSize: '24px', fontWeight: 600, lineHeight: 1.333, letterSpacing: '-0.025em'}
  section-title: {fontSize: '18px', fontWeight: 600, lineHeight: 1.35}
  card-title: {fontSize: '16px', fontWeight: 600, lineHeight: 1.5}
  label: {fontSize: '12px', fontWeight: 500, lineHeight: 1.333}
  caption: {fontSize: '11px', lineHeight: 1}
  set-value: {fontSize: '18px', fontWeight: 600, lineHeight: 1.5}
  stat: {fontSize: '28px', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em'}
rounded:
  button: '0'
  input: '0'
---

# Design System: Ember

## Scope and character

Ember is a fast workout ledger with its evidence one step away. The shipped redesign uses a restrained shadcn component family, warm Paper/Ink and Night neutrals, bundled Inter and one Amber accent. Square corners, hairline borders and spacing establish hierarchy; the workout controls are gym-specific and thumb-friendly. Generic logging conventions inform the workflow, not Strong's branding or assets.

This is the contract for the real application, not the synthetic approval prototype. The IndexedDB writer, local active draft, immutable outbox, authentication/ownership gates, conflict retention and finite PWA shell remain authoritative. A visual change never substitutes prototype storage or rewrites saved history. Synthetic examples are not production data.

## Palette, type and shape

- `src/index.css` is the only stylesheet and source of the semantic tokens above. `[data-theme='dark']` selects Night. Amber is the only accent: light `#9e5700`, Night `#f5b13d`; `primary-tint` is `#f5ead6` / `#332b1f`, and the focus ring equals primary. No accent picker.
- Primary marks Start, Finish, confirmed checks, navigation and personal-record dots. Secondary is the selected-segment wash with Amber text. Chart series stay neutral (`chart-primary`); past weekly bars use `chart-secondary` with its edge stroke, the current week Amber. Volume is not a strength colour. Body-weight changes carry no good/bad colour.
- Destructive text identifies removal; solid destructive fill is reserved for a confirmation. Cancel workout and undoable Delete entry are outlined destructive-text actions. Storage errors use destructive; do not repurpose the currently unused warning token without checking its distinction from Amber.
- System theme is the default and follows live OS changes. Light/Dark override it. The validated versioned `ember:appearance:v1` preference is separate from workout data; old accent fields are ignored. Failed preference storage keeps the current tab usable and reports the failure, without changing workout-saving claims.
- Inter Variable is bundled locally, with Inter/system-ui/sans-serif fallbacks and `cv11`. No CDN, display font or ornamental monospace. Named styles: page-title 24px/600, section-title 18px/600, card-title 16px/600, label 12px/500, caption 11px, set-value 18px/600, stat 28px/600. Page/stat tracking is −.025em/−.02em. Use weights 400/500/600/700, not 550/650.
- Body copy is 14px/1.5 in muted foreground; input text is at least 16px. Set inputs are centered 18px/600. Button labels are 14px/500; exercise-list names are 14px/500, body parts 12px. Chart axes must render at 11 CSS px or larger. All values, counts and dates used for comparison use tabular numerals.
- Buttons, fields, cards, panels, dialogs and drawer surfaces are square. Only inherently circular marks (the live dot, switches, chart dots and the drawer handle) are rounded. Flat cards have 1px token borders, not decorative shadows. Dialog elevation uses `--shadow` and a 60% Paper / 85% Night scrim.
- The icon is Ember's heart-and-flame with a long shadow on navy `#1F2D3D`. The document theme colour follows Paper `#f6f1e8` / Night `#17161b` before first paint; manifest splash/gesture-strip colours stay Night by owner choice because Android does not follow page theme there.

## Workspace and navigation

The workspace is `100dvh`, centered up to 1480px. Body does not scroll; the library, logger and modal surfaces have their own contained scrollers.

| Surface          | Below 1000px                                                                                                                                                                                                                                 | From 1000px                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Main navigation  | Bottom Profile / History / Workout / Exercises tabs, initially Workout; 56px row plus 1px border and safe-area bottom. Equal flexible columns, 44px minimum targets, 11px labels; no top brand or gear. Active tab has a 2px Amber top rule. | 48px header, Ember at left, text-only destinations, Settings at right; selected link has foreground text and Amber underline.               |
| Library          | 24px 18px 30px padding; page-title h1 scrolls with content.                                                                                                                                                                                  | 26px 32px 40px padding; content stays beside the logger when open.                                                                          |
| Active logger    | Full-screen sheet with fixed workout-name/Finish header, elapsed time and completed/total sets. Tabs/covered library are inert and inaccessible while expanded.                                                                              | 500px right column; the library remains interactive.                                                                                        |
| Settings         | Full-screen modal panel, not a centered phone card.                                                                                                                                                                                          | Full-height right panel with 16px viewport inset, up to 520px.                                                                              |
| Exercise details | Full-screen pushed page over the list or logger, with a Back arrow.                                                                                                                                                                          | Inline in Exercises; from the logger, exactly covers its 500px column, anchored to the centered 1480px workspace even on ultrawide screens. |
| Exercise picker  | Full-screen searchable panel; keep the full-screen geometry for keyboard/back reliability.                                                                                                                                                   | Full-screen surface with a 900px content column.                                                                                            |

The phone tab bar becomes invisible while a non-search input is focused, preserving layout space so blur cannot move a Save button between pointer-down and pointer-up. History and Exercises search fields use `type='search'`, so searching keeps the tabs visible and usable; History search stays inline above its results on phones and desktop. `visualViewport` resize/scroll and focus reveal the active field in its nearest internal scroller with 14px clearance. Short landscape remains a phone layout; compact horizontal navigation and logger chrome leave room for editable rows.

Minimizing preserves the durable draft, values, explicit checks, clock and same-session scroll. The resume strip participates in layout: at least 64px high, `card` ground, 3px Amber inset edge, Amber chevron, bold workout name and muted elapsed/sets line with a small live dot. The dot may ping unless motion is reduced. Hover uses the accent wash and foreground metadata, only on hover-capable pointers. Reload restores the draft expanded; no artificial entry animation at launch.

## Shared components and mobile baseline

`src/components/ui/` is the shared primitive layer. Button/Input/Card/EmptyState, SettingsGroup/List/Row, SectionHeading, InlineError and ContentFieldset keep one visual and disabled-state vocabulary. Buttons and set actions are at least 44px; primary drawer actions are at least 48px; menu rows 56px. Focus is a visible 2px primary ring with 2px offset, inset where the control fills its row.

The drawer (vaul), responsive dialog, toggle/toggle-group, chart/ChartTooltip plus chart-touch hook, sonner and skeleton are standard restrained shadcn-style components. Ember's adapters add explicit border tokens, its theme, focus return and preference-aware haptics. `--radius: 0` makes copied component radius tokens square; drawer surfaces explicitly stay square.

- `ResponsiveDialog` uses a vaul bottom drawer below 1000px and the centered Dialog above it. Every confirmation and phone ⋯ menu uses this system, not a native browser confirm. Phone confirmations put the primary action on top, but initially focus the safe choice. Descriptions, Escape, focus trapping/return and scrim dismissal remain part of the contract.
- Responsive drawers include the template preview, workout detail, Previous evidence, Body weight form, shell-update confirmation, unreadable-device-state reset and logger/template/workout destructive confirmations. Maximum height is constrained by the dynamic viewport, with contained scrolling and safe-area footer padding.
- Full-screen exceptions are Settings, template editing, History editing, exercise picking, the pushed exercise page and the post-save celebration. They do not become centered cards on phones. Editors keep dirty-dismissal prompts and existing back semantics.
- Nested surfaces stack. A surface opened from another (History drawer → Edit/Delete, logger or editor → exercise picker, logger → exercise page) leaves its parent mounted underneath, and dismissing it (control, Escape, back gesture) returns to the parent as it was: same scroll and focus on the control that opened it. Full-screen children that cover their parent (editors, the picker, the exercise page) show a ← Back control before the title instead of ✕; partial bottom drawers and confirmations keep ✕ or their Keep button, since the parent shows behind them. Stacked dialogs layer in opening order, each scrim dimming everything beneath it. Actions that leave for another place (Repeat, Save as template, source links) close the stack; a menu row closes its menu before its action runs.
- `ActionSheet` is a phone drawer containing menu rows, initially focused on the first action, with arrow/Home/End support. Closing returns focus before handing off an action. Desktop menus retain their inline placement and flip above the trigger if needed; an outside closing tap is consumed, not passed through to a set.
- `SegmentToggle` is an outline ToggleGroup: square outline segments, secondary selected wash, Amber selected text, 44px touch targets. Body-part chips and Most done / A–Z use the same typography and selected-state styling; body parts scroll horizontally without widening the page. No selection animation on frequently used filters.
- Toasts use sonner's `Toaster` through `src/components/toasts.tsx`: top center below the safe area on phones (swipe up to dismiss), bottom right on desktop, one visible at a time. App mounts one; Settings mounts its own inside the panel, below its title and Close, because the modal's focus trap would keep the keyboard from an Undo outside it. The App toaster hides while Settings is open. Toast buttons are 44px tall.
- No tap highlight/text-size inflation; controls use `touch-action: manipulation`, no selection or iOS callout; input editing remains native. Page overscroll is disabled, internal scrolling contained. Hover states must be capability-gated. Do not truncate comparison values or dates; wrap/reposition metadata before shrinking an action.

## Motion and feedback

Use the established curves: strong ease-out `cubic-bezier(.23,1,.32,1)`, ease-in-out `cubic-bezier(.77,0,.175,1)` for on-screen movement and drawer `cubic-bezier(.32,.72,0,1)`. No `transition: all`, scale-from-zero, sluggish ease-in or hover-only actions. Prefer transform/opacity, and interruptible transitions for repeated state changes. The set tint/check drawing and the deliberate celebration are scoped exceptions using clip-path/stroke and decorative effects.

| Interaction                       | Motion                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone exercise page               | Slides from right over 340ms, exits right over 240ms on the drawer curve; retains closing content. Desktop placement does not slide.                                                              |
| Exercise tab underline            | One shared Amber 2px line, sliding by transform over 200ms strong ease-out for pointer activation. Arrow/Home/End navigation moves focus and selection immediately, with no underline transition. |
| Bottom drawer                     | 250ms entry / 180ms exit, drawer curve; dragging remains vaul's native interaction.                                                                                                               |
| Centered responsive dialog        | 180ms fade and scale from 95%; 140ms exit.                                                                                                                                                        |
| Phone logger                      | 420ms up / 300ms down, drawer curve; no motion for a launch-restored draft. Library hides only after coverage.                                                                                    |
| Press                             | Buttons sink to .97 on touch; whole rows/cards to .985, excluding a card's own menu. Keyboard focus does not receive the press transform.                                                         |
| Set confirmation                  | Tint sweeps from check across row over 320ms, wipes out in 140ms; box .86 → 1.08 → 1 over 360ms with a drawn check path. Last checked set adds a drawing badge and one 900ms heading tint flash.  |
| Reorder                           | Other rows shift over 220ms, drop settles over 180ms and briefly tints the dropped card.                                                                                                          |
| Chart inspection / metric changes | Immediate; no series, headline or keyboard animation.                                                                                                                                             |

Reduced motion removes movement, smooth scrolling and transitions, stops the live ping and number rolling, and keeps only the celebration's gentle 200ms fades. No sparks or growing glow under reduced motion. Content and actions must remain usable while optional motion plays.

`src/feedback/` ports the approved prototype's Web Audio synthesis: start, set (an ascending major-pentatonic step per checked set), unset, exercise, finish, pr, delete and tick. Sounds and Haptics have independent Settings switches, both on by default, persisted as validated `ember:feedback:v1` outside workout data. Failed preference writes keep the tab's choice and say so. Turning a switch on gives a tick.

Where supported, audio uses an ambient session so music is not paused and the iPhone silent switch is respected. Android haptics use `navigator.vibrate`; iOS 18+ uses the hidden checkbox-switch label tick on touch devices. Unsupported or denied feedback never throws or blocks logging. Do not promise on-device behaviour proven only in Chromium.

Explicit checks cue set, the exercise's final check cues exercise 160ms later, unticking cues unset. Starting an empty/template/repeated workout cues start after any replacement approval. Set/exercise removal and discard cue delete. Opening menus/Finish, selecting segments and actions cue tick; chart inspection gives only a preference-aware haptic per selected point. Keystrokes and completion cleared by editing are silent.

## Workout ledger

Each exercise heading combines a drawing/name/details target, completion status and a separate 44px ⋯ menu. Set columns remain Set / Previous / kg (or Assist. kg / Seconds) / Reps (or km) / Done. The grid is `44px minmax(66px,1fr) minmax(52px,.86fr) minmax(48px,.78fr) 48px`, 6px gaps, at least 56px rows; below 350px gaps reduce to 4px and side padding to 12px. Exercise padding is 20px 16px 18px, 22px 24px in the desktop logger. Completion's target is 44×44px with a 30px visible empty marker; checked rows use a tint that runs edge to edge across the card's side padding (columns stay in place) and lose field chrome.

- Prefilled values are editable targets, never completed sets. Start uses latest eligible matching name/type history for routine/addition targets, repeating the last target if necessary; no matching evidence means blanks. History Repeat copies that exact workout. Duration, cardio, assistance and bodyweight retain their own units and validity rules.
- Focus dims a value without selecting text; the first digit replaces it, preserving native caret editing/Backspace and avoiding the phone's selection toolbar. Weight Enter advances to reps; reps Enter confirms a valid unchecked set and blurs; duration/cardio keep their appropriate Enter path. Edits clear completion. Blank/invalid sets cannot be completed or saved by Finish.
- Previous shows the latest matching session's actual set and date. Its drawer includes exact sets and best reps at the entered weight, with source links. When none match, say so and show Nearest recorded lighter/heavier actual sets (Less/More assistance where applicable), never a converted equivalent.
- Add/Replace use the shared full-screen catalog/recorded-exercise picker, search, horizontal body-part filters and Recent/All rows. The header names the Add destination or exact Replace source and the set-replacement consequence. Title/Back and search/filters stay above contained results; the phone panel follows the visual viewport, with long context scrolling separately on short screens. Selecting an existing name adds/replaces then closes; Back/Escape/back gesture changes nothing. Already-present rows say “Already in workout/template” before selection; tapping one explains why it cannot be used without changing the query. Changing filters clears that explanation and returns results to the top. Imported repeated blocks remain distinct. No custom creation or type selector.
- A left swipe reveals explicit Delete, never completes/deletes merely by dragging. Preserve `pan-y`, pointer identity/cancel, containment for portaled events and post-swipe click suppression. The set-number action is the accessible alternative (phone ActionSheet, desktop row reveal). Deletion has no alert/undo banner and preserves survivors; no permanent trash column.
- Hold a heading or its ⋯ 400ms to reorder; a tap on ⋯ still opens its menu. A compact 56px-row list lifts under the finger, auto-scrolls near edges and uses slot ticks. Release keeps exercise identity/sets/checks; Escape/cancel/refused edits restore order. Each ⋯ also provides Move up/down with a polite position announcement portaled outside the logger/editor. Never put a live region inside a modal-covered logger.
- Replace an existing draft, discard and Finish require explicit confirmation. Finish explains completed/unchecked counts and calls the real atomic transaction. Errors keep the draft and stay visible; success opens only after commit. Active workouts never sync to the server.

## Workout, History and shared exercise rows

Workout opens with Quick start / Start empty workout, then Templates and a 44px Create template action. Cards use flat bordered card surfaces, 12px spacing, two columns on desktop and one beside an open logger. Template rows show the prescription that Start will actually prefill via `routineTargets`, not stale template values. Cards include exercise count, an estimated duration derived from known historical minutes per set (rounded to five, omitted without evidence), and last-done wording. Up to four exercises and “+ N more” preview the template. Opening shows all rows and Start workout; ⋯ opens Edit/Delete, and Delete confirms while preserving history.

Template creation and editing use `EditorPanel`: full-screen on phones, a 680px-bounded desktop side panel, fixed title/dismiss control (Close, or Back when opened from another surface) and Cancel/Save footer, and one contained body scroller. The phone panel follows visual-viewport height and offset during keyboard resize/pan. Compact name and exercise/set counts precede editor rows; Add exercise follows them. Target-only rows omit Previous and completion columns, showing only Set and the exercise's actual fields (kg/reps, assistance/reps, reps, seconds, seconds/km). Logger columns are unchanged. Blank targets remain valid template prescriptions; name and an exercise are required. Close, Cancel, Escape and Back ask before discarding a changed draft; every request focuses the pinned safe decision, and Keep editing returns to the last field. Saving disables changes/dismissal until the existing transaction resolves; failure keeps the editor and a visible retry message, success closes and returns focus to its entry point.

`ExerciseLine` is shared by template/history cards and previews and the finish screen: 40px drawing, two-line 14px/500 name with safe word breaking, body part in muted 12px, then right-aligned tabular actual/prescribed values. Do not infer a best set from a formula:

- Finished work shows its actual top set: heaviest weight, then most reps at that weight, with set count beneath. Units remain explicit: `75 kg × 8`, bodyweight `12 reps`, holds `60 s`, cardio `1.2 km · 5:00`, assistance `−20 kg × 8` announced as assistance. Amber Trophy means a record set in that workout.
- Templates show a shared load over paired reps (`72.5 kg` / `3 × 8 reps`), bodyweight label over reps, or varied-load top target set over count; blank targets show count only. Never pair an independent weight range with an unrelated reps list.

History groups newest-first cards under sticky month labels, flush with the internal scroller edge on solid background, with matching workout count at right. Cards have a 36px weekday/day column, two-line workout title and compact icon stats: known duration, recorded weighted volume when positive, records set at that time. Under a hairline are up to five ExerciseLines and “+ N more”; below 350px these span the full card. The whole card is one accessible button with a card-level focus ring. Show 20 initially, then Show older workouts adds 20. A just-finished card has an Amber border.

History's title search action reveals a focused inline field on phones and desktop, filtering results as you type. The tabs stay available during search; closing search, Escape or phone back clears it. Search matches names, exercises, dates and months; opening search starts empty. Source-workout navigation clears filtering and includes the source's page. Empty/no-match states say what happened without hiding the query.

The workout drawer shows full date/time, duration/sets/volume/PR stats, every exercise and set, each record kind, and a formula-labelled Epley column only for weighted sets of 1–10 reps. Repeated blocks stay distinct. A pinned footer holds Repeat, Save as template and ⋯ Edit/Delete; Repeat gets its own row on narrow phones. Opening Edit transfers focus to the history editor's title. It opens over the drawer and shares template editing's `EditorPanel`, pinned Back/Cancel/Save, contained keyboard-aware body and safe dirty-dismissal decision. Finished workout metadata groups name, native local start and duration in minutes (stacked on phones), followed by exercise/set counts and target-only rows. Keep editing restores the last editor field; pending saving blocks edits and dismissal, and a failed save focuses its pinned retry/reopen message without dropping the draft. Expected revisions, retained original import cells, conflicts and repeated blocks remain intact; the editor never silently overwrites peers. Back, Cancel or a save returns to the drawer (showing the saved workout) and focuses its ⋯. Delete opens its confirmation over the drawer: Keep returns there; a delete closes both onto the list.

## Exercises and inspectable analytics

Exercises combines catalog and exact recorded names without fuzzy merging: search, body-part chips, Recent and All sections, remembered Most done / A–Z sort. Only body parts with exercises appear. Browsing and picking share filtered “N of total exercises” counts and a Clear filters action beside the chips that resets search/body part and focuses search without changing the browsing sort. Picker All rows remain A–Z regardless of the saved browsing preference; Recent retains recency order. Rows are at least 64px, pressable, with drawing, two-line name and body part, and an unshrinking right-hand 16px/600 Amber unique-workout count (absent when zero, announced as “Performed in N workouts”). A repeated block counts once for this list/header, not once in its analytics.

Details order is **Charts / History / Records / About**. Charts is initially selected with history, otherwise About. The header contains Back, drawing, full wrapping name, body part and workout count. The tablist has the shared sliding underline and roving arrow/Home/End keyboard navigation. Phone details layer over the still-mounted list or logger; desktop inline details hide the mounted list without clearing its query, body-part filter or sort. Back restores the original row focus and list scroll. From the logger, source navigation minimizes the draft and opens the workout in History. Details receive only finished/imported history.

About groups the available drawings, exercise facts (body part/equipment) and muscles into restrained sections, with a bounded drawing pair and an explicit missing-drawing state. It shows no instruction or credit text. Custom names retain history/charts/records with an explicit not-in-catalog state. Catalog metadata retains source, author, adaptation and license URLs. AI-assisted Ember drawings stay marked as such in the data, never attributed to Everkinetic/wger; restore a credits view before any public release. Never silently merge variants or drop repeated sets.

- Weighted chart default: Heaviest weight; alternatives Best reps, Volume and Est. 1RM (Epley). Assistance: Least assistance and Best reps, no resistance estimate. Bodyweight: Best reps. Duration/distance trends remain unimplemented, with a clear empty state.
- Range segments: 1M / 3M / 6M / 1Y / All. `TrendArea` uses ChartContainer/ChartTooltip, Recharts, calendar-month ticks, a padded round y-domain and readable 11px labels. Distinct real tick values must remain distinct after formatting.
- Headline is latest value plus change from the first in range, success-coloured when better (less assistance is better). Hover/hold-slide/keyboard inspection shows the selected point's date/value and winning actual set. Volume identifies its heaviest source set, not a fabricated combined set. Duplicate timestamps retain point identity and the matching active marker.
- Every session has a dot; strict improvements over prior workouts get Amber PR dots, not ties or the first workout. PR computation precedes range filtering. Series are neutral, active dot Amber, cursor dashed. Do not animate chart series or headline changes.
- A newest-first Sessions list is the exact-value/source alternative: full date, actual set, exact metric/unit, record mark and source-workout chevron, minimum 56px. Phone date/set stack; values never truncate. Empty/one-session states are explicit, no fabricated line.
- History keeps every exercise block separate, with a date-first, whole-header source-workout target, workout name and set count. Numbered rows pair the exact recorded load/reps (or the type's own units); weighted Epley values are smaller secondary evidence. Show ten blocks initially, then twenty more per action.
- Records leads with actual heaviest load/least assistance and the complete exact-rep load list, followed by other recorded metrics. Every full-width source row shows its value, actual source set when applicable, date and workout; ties keep the domain's original winner. Formula-labelled Epley sits last in its own Estimated strength section, limited to weighted sets of 1–10 reps (one rep uses actual load). Never apply it to assistance, bodyweight or timed work.

Profile has one muted totals line, not stat tiles, then Every week with Workouts / Volume / Time segments. Twelve local Monday-based weeks use square bars; headline is this week's value and the average of the preceding eleven complete weeks. Inspection changes the shown week, not the comparison average. The chart's accessible summary lists every exact weekly value; local dates keep DST from splitting buckets. Volume is recorded weighted load × reps, time known workout minutes only. Neither volume nor different machine loads establish comparable strength/hypertrophy.

## Finish celebration

Only a successful finished-workout commit opens the full-screen “Workout complete” dialog over History. The heart-and-flame lights once (Amber gradient, subtle overshoot, radial glow, twelve rising sparks); content rises in a short stagger. Then workout name/date, Duration / Sets / Volume (NumberFlow count-up; units wrap on narrow screens), New personal records when earned, and every exercise as an ExerciseLine. Short landscape reduces the heart; the content scrolls and Done stays pinned.

Records use the same domain definitions as Records against earlier history: heaviest weight, session volume, bounded Epley estimate for weighted work; reps for bodyweight. No first-session record, ties, assisted/timed records, streaks or milestone counts. One row per exercise names every record kind, its headline value and gain; record rows play pr as they arrive, finish plays on open and Done ticks. Reduced motion keeps fades only. Done/Escape/back closes and focuses the new History card.

## Save and connection states

Events get toasts, conditions stay on the page. Toasts are few and never block:

- No toast when the screen already shows the result: confirmed deletes, saved edits, Finish, starting a workout, set changes.
- An action with an existing Undo path gets a neutral toast with Undo for about 5s (body-weight delete). A failed restore becomes a Retry toast.
- A result that lands off-screen gets a success toast for about 3.5s (Save as template, which opens the Workout tab).
- A failed one-off action gets an error toast with Retry and Dismiss that stays until used or swiped (template save; body-weight Undo). Errors inside an open dialog or editor stay inline there and are not repeated as toasts.
- While a workout is running only failures toast; Settings' Undo still shows, since it is that delete's only undo.
- Ongoing conditions (read-only tab, unavailable or unsaved data, sync issues, connection and download state) remain the banners below. Sonner's live region announces toasts.

Titled notices share the existing neutral/destructive banner tokens: read-only access, unavailable saved data, failed local writes, retained sync issues and connection/download guidance. Healthy background sync and brief pending work stay quiet. An unavailable server gets neutral guidance and the real pending-change count when present; automatic reconnect remains the only retry path. Partial first downloads stay labelled in the page, logger or Settings, never silently presented as an empty history. Revoked trust keeps owned content and its portals unmounted; Settings remains reachable. Unsupported Web Locks gives browser guidance, not a reload action that cannot fix it.

The logger autosaves without a header notice; a failed save surfaces through its error state. Finish keeps its confirmation open and disables submission/dismissal during saving; failure stays in that dialog and success celebrates only after the atomic commit. Global failed-save guidance is not repeated beside the owning editor's error. Notice live text is portaled outside the logger/editor and announced only while its visual surface is accessible; covered background notices do not repeat modal feedback. Exercise completion is an inspectable labelled group, not an always-live ancestor inside the logger.

## Settings, body weight and shell updates

On phones the Settings entry is the cog at Profile's top right, outside the disabled content fieldset so read-only/maintenance states can open it. Desktop keeps its header gear; logger and locked states keep their own gears. No Profile Settings row. Closing restores the entry trigger.

Settings uses SettingsGroup sections 40px apart: Appearance (three 48px System/Light/Dark choices; selected 2px Amber ring on card), Feedback (two 64px full-row switches), Body weight and App update when available. Notices/retained sync issues are readable inside it. Manual sync, import, JSON Backup & Recovery and in-app data-cleanup controls are not Settings features; underlying recovery/backup capabilities remain intact. Owned history unmounts while sync is locked, including portaled forms.

Body weight is separate from workout load. Add weight/newest-first entries open the responsive form (drawer on phones), focusing kg and returning to Add weight on close. Kg accepts comma/point, above 0 through 500, at most two decimals. Date/time defaults to now and supports backdating, stacked below kg on phones. Save/Cancel and undoable Delete retain validation, revision conflict messages and the existing local transaction/sync semantics. Cancel/back writes nothing. Inputs and submit reflect disabled/saving state even outside the parent's fieldset. Delete shows an Undo toast for that one deletion; it ends when the toast closes, another edit starts or Settings closes.

The chart shows all live measurements with a neutral line and inspectable exact kg/date/time, no success/failure colour. None: one explicit empty state and no chart; one: honest one-entry state, no line. The newest-first accessible entry list is the exact-value alternative. Read-only tabs see entries but cannot edit; untrusted installations see no owned history.

App update appears only with a waiting production shell. Apply shell update opens the responsive explicit confirmation, not a browser confirm. Applying requires the existing saved, draft-free, trusted installation-lock transition, including cross-tab checks. Cancel changes nothing. Applying never reloads the current page; the owner closes all tabs and reopens later. The unreadable-device-data reset also requires an explicit responsive confirmation and retains the original bytes; it is never a server-history reset.

## Back, safety and verification

Every transient layer holds one same-document back entry: picker/details, drawer/menu, Settings, editors, celebration and the expanded phone logger. Back closes only the newest; dirty history edits ask and preserve the changes. Main tabs add no history. Chrome can skip entries added without user activation: preserve `src/state/back.ts`'s forward-onto-existing-entry strategy rather than pushing again after a refused back. A launch-restored logger arms on the first tap.

Hook classes (`app-shell`, `library-scroll`, `settings-panel`, `dialog-content`, `exercise-detail-panel`, `workout-sheet`, `set-row`, etc.) are test/viewport contracts; keep them. No live region inside a covered logger/editor. Portaled owned data must unmount on sync lock, not merely hide under main. Preference persistence is not workout saving; saved means the IndexedDB transaction committed, not a cosmetic timer. Sync is not off-device recovery.

Verify the populated app at Pixel 6 (412×915), 320px, short landscape and desktop, in Paper/Night, plus middle/ultrawide widths where panels change layout. Stress long/unbreakable/non-Latin names, four-digit counts/loads, many sets, empty/one/large histories and enlarged text. Measure overflow, reachable 44px actions and chart labels, then inspect screenshots. Use synthetic data only and abort API writes in live checks. Chromium touch/viewport emulation does not satisfy real Android/iPhone keyboard, gesture, audio or haptic acceptance; those remain release gates in PRODUCT.md.
