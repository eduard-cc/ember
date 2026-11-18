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
  button: '6px'
  input: '6px'
  card: '12px'
---

# Design System: Ember

## Scope and character

Ember is a fast workout ledger with its evidence one step away. The desktop layouts (from 1000px) are legacy: don't break them deliberately, but design, test and verify new work at phone sizes only. A restrained shadcn family, warm Paper/Ink and Night neutrals, Inter and one Amber accent; hairline borders and spacing set hierarchy, and workout controls are thumb-friendly. Never Strong's branding or assets.

A visual change never replaces storage, sync or ownership behaviour (`docs/sync-and-history.md`) or rewrites saved history.

## Palette, type and shape

- `src/index.css` is the only stylesheet and the source of the tokens above; `[data-theme='dark']` selects Night. Amber is the only accent (no accent picker), and the focus ring equals primary.
- Primary marks Start, Finish, confirmed checks, navigation and personal-record dots. Secondary is the selected-segment wash with Amber text. Chart series stay neutral (`chart-primary`); past weekly bars use `chart-secondary` with its edge stroke, the current week Amber. Volume is not a strength colour. Body-weight changes carry no good/bad colour.
- Destructive text identifies removal; solid destructive fill is reserved for a confirmation. Cancel workout and undoable Delete entry are outlined destructive-text actions. Storage errors use destructive; check the unused warning token's distinction from Amber before using it.
- System theme is the default and follows live OS changes; Light/Dark override it. The appearance preference (`ember:appearance:v1`) is separate from workout data; a failed preference write keeps the tab usable, says so and never changes workout-saving claims.
- Inter Variable is bundled locally: no CDN, display font or ornamental monospace. Use the type styles above and weights 400/500/600/700. Input text is at least 16px; chart axes at least 11 CSS px. Every value, count and date used for comparison uses tabular numerals.
- Corners: controls and tinted notes `rounded-md` (6px); set checks, inline menu rows and PR tags `rounded-sm` (4px); cards, banners, centred dialogs and drawer tops `rounded-card` (12px). Full-screen panels, edge-to-edge bands and chart bars stay square. Flat cards have 1px token borders, not decorative shadows. Dialog elevation uses `--shadow` and a 60% Paper / 85% Night scrim.
- The icon is the Ember heart (`EmberHeart`), also the launch splash and celebration heart. The `public/icons/` PNGs (maskable glyph inside the 40% safe circle) and `favicon.svg` share its traced paths: change the mark in all of them together. Manifest splash and gesture-strip colours stay Night: Android ignores the page theme there.

## Workspace and navigation

- The workspace is `100dvh`; the body never scrolls, and the library, logger and modal surfaces have their own contained scrollers.
- Phones: bottom tabs with 44px targets and no top brand or gear. Switching tabs opens the new tab at its top. The expanded logger is a full-screen sheet with a fixed name/Finish header; the tabs and covered library are inert while it is open.
- The tab bar turns invisible while a non-search input is focused, keeping its layout space so blur cannot move a Save button between pointer-down and pointer-up. Search fields use `type='search'`, so the tabs stay usable. `visualViewport` resize/scroll and focus reveal the active field in its nearest scroller with 14px clearance. Short landscape stays a phone layout.
- Minimizing preserves the durable draft, values, explicit checks, clock and scroll. The resume strip takes layout space (at least 64px). Reload restores the draft expanded, with no entry animation at launch.

## Shared components and mobile baseline

`src/components/ui/` is the shared primitive layer, keeping one visual and disabled-state vocabulary. Buttons and set actions are at least 44px, primary drawer actions 48px, menu rows 56px. Focus is a visible 2px primary ring with 2px offset, inset where the control fills its row.

- `ResponsiveDialog` is a vaul bottom drawer below 1000px and a centred Dialog above. Every confirmation (wording: `docs/product-decisions.md`) and phone ⋯ menu uses it, never a browser confirm. Phone confirmations put the primary action on top but initially focus the safe choice. Descriptions, Escape, focus trapping/return and scrim dismissal are part of the contract.
- Drawers are bounded by the visible viewport, with contained scrolling and safe-area footer padding. On phones a drawer ends where the keyboard begins and returns to its own height when the keyboard goes, even if a field keeps focus (`ResponsiveDialogContent` follows `visualViewport`; vaul's `repositionInputs` is off).
- Full-screen exceptions: Settings, the template and history editors, the exercise picker, the pushed exercise page and the celebration. They never become centred cards on phones. Editors ask before discarding a changed draft in a Discard changes? drawer, which is its own back layer.
- Nested surfaces stack. A surface opened from another leaves its parent mounted underneath; dismissing it (control, Escape, back gesture) returns to the parent as it was, with the same scroll and focus on the control that opened it. Full-screen children that cover their parent show ← Back before the title instead of ✕; partial drawers and confirmations keep ✕ or their Keep button. Stacked dialogs layer in opening order, each scrim dimming everything beneath it. Source links open the workout drawer over the surface they sit on, and closing it returns to the tapped row. Actions that leave for another place (Repeat, Save as template) close the stack; a menu row closes its menu before its action runs.
- `ActionSheet` focuses its first row and supports arrow/Home/End; closing returns focus before handing off the action. An outside closing tap is consumed, never passed through to a set.
- Segments, chips and sort share one selected styling; chips scroll horizontally without widening the page. No selection animation on frequently used filters.
- Toasts (`src/components/toasts.tsx`) show one at a time. App hides its Toaster while Settings is open, because the modal's focus trap would keep the keyboard from a toast's action; the exercise picker mounts its own.
- No tap highlight or text-size inflation; controls use `touch-action: manipulation`, with no selection or iOS callout, while input editing stays native. Page overscroll is disabled. Hover is capability-gated. Never truncate comparison values or dates: wrap or move metadata before shrinking an action.

## Motion and feedback

Curves: strong ease-out `cubic-bezier(.23,1,.32,1)`, ease-in-out `cubic-bezier(.77,0,.175,1)` for on-screen movement, drawer `cubic-bezier(.32,.72,0,1)`. No `transition: all`, scale-from-zero, sluggish ease-in or hover-only actions. Prefer transform/opacity and interruptible transitions for repeated state changes; the set tint/check drawing and the celebration are scoped exceptions.

- Durations live in `src/index.css`; drawers and the phone logger use the drawer curve, and a launch-restored draft or keyboard tab navigation does not animate.
- Presses sink buttons and rows slightly on touch (not a card's own menu); keyboard focus gets no press.
- Chart inspection and metric changes are immediate: never animate series, headlines or keyboard inspection.

Reduced motion removes movement, smooth scrolling, transitions, the live ping and number rolling, keeping only gentle celebration fades. Content and actions stay usable while optional motion plays.

`src/feedback/` synthesizes the sounds with Web Audio. Sounds and Haptics have independent Settings switches, both on by default, stored as `ember:feedback:v1` outside workout data. Turning Sounds on plays the set-check sound; turning Haptics on gives a tick. Audio uses an ambient session where supported, so music keeps playing and the iPhone silent switch is respected. Android uses `navigator.vibrate`; iOS 18+ uses the hidden checkbox-switch tick on touch devices. Unsupported or denied feedback never throws or blocks logging. Never promise on-device behaviour proven only in Chromium.

- Only accomplishments make a sound (start, set, exercise, finish, pr), each with a haptic. The exercise's final check cues exercise 160ms after set; start cues after any replacement approval.
- Haptic only: unticking, Add set, adding an exercise, removals and discard, and gestures (each inspected chart point, a swipe reaching delete, a reorder lift and each slot it passes).
- Silent: navigation (menus, cards, rows, tabs, filters, sort, segments, the Finish confirmation, Done), keystrokes and completion cleared by editing.
- Levels carry over music at the same phone volume: a set check near -20 LUFS momentary, start, exercise and PR near -18, finish near -15, into a -3 dBFS limiter that only catches stacked peaks. Re-measure with `node scripts/feedback-levels.mjs` after changing any voice or level.

## Workout ledger

- Exercise headings combine a drawing/name target (opening details over the logger), completion status and a separate 44px ⋯ menu. A finished exercise shows a check badge on its drawing and a plain "Done", never a second check. Set columns are Set / Previous / kg (or Assist. kg / Seconds) / Reps (or km) / Done, with at least 56px rows; the completion target is 44×44px. Checked rows tint edge to edge with columns in place.
- Prefilled values are editable targets, never completed sets. Start uses the latest eligible matching history, repeating the last target if needed; no matching evidence means blanks. History Repeat copies that exact workout. Duration, cardio, assistance and bodyweight keep their own units and validity rules.
- Focus dims a value without selecting text; the first digit replaces it, keeping native caret editing without the phone's selection toolbar. Weight Enter advances to reps; reps Enter confirms a valid unchecked set and blurs. Edits clear completion. Blank or invalid sets can't be completed or saved by Finish.
- Previous shows the latest matching session's actual set; its drawer shows recorded sets only (`PRODUCT.md`).
- Add/Replace use the shared full-screen picker of catalog and recorded names. Selecting adds/replaces and closes; Back/Escape/back gesture changes nothing. Rows already in the workout say so before selection, and tapping one shows a short error toast, leaving the query alone. Changing filters returns results to the top. No custom creation or type selector.
- A left swipe reveals an explicit Delete; dragging alone never completes or deletes. Preserve `pan-y`, pointer identity/cancel, containment for portaled events and post-swipe click suppression. The set-number action is the accessible alternative. Deletion has no alert or undo banner and preserves the other sets.
- Hold a heading or its ⋯ 400ms to reorder; a tap on ⋯ still opens its menu. The compact list lifts under the finger, auto-scrolls near edges and ticks per slot. Release keeps exercise identity, sets and checks; Escape, cancel or a refused edit restores the order. Each ⋯ also has Move up/down with a polite position announcement portaled outside the logger or editor.
- Replacing an existing draft, discarding and Finish need explicit confirmation. Finish states completed/unchecked counts and calls the real atomic transaction; errors keep the draft and stay visible, and the celebration opens only after commit.

## Editors, history and exercise rows

- Template and history editors share `EditorPanel`, built from the logger's pieces: ✕ (or ← Back) at left, a centred label, and the Amber Save where Finish sits, so Save stays visible with the keyboard open. They drop only the Done column, so values sit where they do while logging. The phone panel follows visual-viewport height and offset.
- Save with nothing changed just closes an existing item. While saving, edits and dismissal are locked; a failure keeps the editor, Save reads Retry and an inline destructive strip under the header holds the message and focus, never also a toast. Validation focuses the first problem inline. ✕/←, Escape and back on a changed draft open Discard changes? (Discard on top, Keep editing focused); keeping returns to the last field. Success returns focus to the entry point.
- History editing marks changed values and added sets in Amber and counts them in the card subtitle, showing what Save would write. Its Previous shows only the session before that workout, without source links. Expected revisions, retained import cells, conflicts and repeated blocks stay intact; the editor never silently overwrites peers.
- Template cards show what Start will actually prefill (`routineTargets`), never stale template values; blank targets are valid prescriptions, and duration estimates are omitted without evidence.
- `ExerciseLine` never infers a best set from a formula. Finished work shows its actual top set (heaviest weight, then most reps at it) with explicit units: `75 kg × 8`, `12 reps`, `60 s`, `1.2 km · 5:00`, assistance `−20 kg × 8` announced as assistance. Templates show a shared load over paired reps or the top target set; never pair an independent weight range with an unrelated reps list.
- Empty and no-match search states keep the query visible. The workout drawer shows every set and a formula-labelled Epley column only for weighted sets of 1–10 reps; repeated blocks stay distinct.

## Exercises and inspectable analytics

- The list never fuzzy-merges names. A repeated block counts once in the workout count, never once in its analytics. Picker All rows stay A–Z whatever the saved browsing sort. Details receive only finished and imported history.
- About shows drawings, equipment and muscles, with an explicit missing-drawing state and no instruction or credit text. Custom names keep history, charts and records with a not-in-catalog state. AI-assisted drawings stay marked as such in the data (`docs/catalog.md`); restore a credits view before any public release.
- Metrics per exercise type, records and the Epley bounds: `PRODUCT.md`. Duration/distance trends show a clear empty state.
- Charts open on 3M, widened to 6M, 1Y, then All until at least two sessions fall inside. `TrendArea` uses calendar-month ticks and readable 11px labels; distinct tick values must stay distinct after formatting.
- The headline is the latest value plus change from the first in range (less assistance is better). Inspection shows the selected point's date, value and winning actual set; Volume names its heaviest source set, never a fabricated combined set. Duplicate timestamps keep point identity and the matching active marker.
- Every session has a dot; strict improvements over prior workouts get Amber PR dots, never ties or the first workout. PR computation precedes range filtering.
- Definitions stay off the page, behind an ⓘ drawer; no permanent notes or disclaimers under a chart.
- A newest-first exact-value Sessions list is the chart's alternative: values never truncate, never repeat what the value already says, and open their source workout. Empty and one-session states are explicit, never a fabricated line.
- Records rows show the computed value with its source actual set and open the source workout; ties keep the domain's original winner.

## Profile

- Weekly charts use local Monday weeks (DST-safe). The headline is the last full week, or the running week while all history is in it, against "usual": the median of earlier full weeks in range, hidden below two. Inspection changes the headline week, never the usual. The running week is marked "so far"; the accessible summary and the week list give every exact value.
- Muscles (`muscleSets`, counting in `PRODUCT.md`): names outside the catalog count toward none. `BodyFigure` is decorative and `aria-hidden` (its regions are under 44px), so the list is the control. Untracked muscles are plain body, never tone 0; more training reads as more Amber in both themes.
- New records come from `recentRecords`: each workout's records at the time, actual before estimate.
- Nothing on Profile judges a value good or bad.
- Body weight is separate from workout load (the screen doesn't say so). Kg accepts a comma or a point. An existing entry opens without the keyboard so Delete entry stays in view. Cancel/back writes nothing. Its change uses foreground text, never success/failure colour. Fewer than two entries show an explicit state, never a line. Delete's Undo toast covers that one deletion and ends when the toast closes, another edit starts or Profile is left.

## Finish celebration

Only a successful finished-workout commit opens "Workout complete"; its records are `PRODUCT.md`'s, never ties. Done stays pinned in short landscape. Done/Escape/back closes onto the new History card.

## Save and connection states

Events get toasts; conditions stay on the page. Toasts are few and never block:

- No toast when the screen already shows the result (deletes, saved edits, Finish, set changes). An Undo path gets a neutral Undo toast; a result that lands off-screen gets a success toast (Save as template).
- A failed one-off action gets a Retry toast that stays until used; a refused tap with nothing to retry gets a brief error toast. Errors inside an open dialog or editor stay inline, never repeated as toasts.
- While a workout runs only failures toast, plus body weight's Undo and Save as template's confirmation (the logger covers the new card).

Conditions come in three tiers (`src/components/Conditions.tsx`). Each shows in exactly one place (the open logger or editor, else the page or open Settings) with one details drawer. Nothing shows when all is well; healthy sync and brief pending work stay quiet.

- Quiet, heals by itself: Connecting…, Offline (with the real pending count), Downloading history. A small outlined pill with a 44px target; no Retry, since reconnection is automatic.
- Needs you: the read-only tab, a neutral strip with Reload. Unsupported Web Locks gives browser guidance, not a reload that cannot fix it.
- Problem: Changes not synced, Can't save on this phone, Saved data can't be read. A tinted destructive strip with Details. Not-synced details list each held-back change and its reason, with no resolve action; unreadable data offers its reset behind its own confirmation.

Pills and strips sit in the layout, never over it, so logging, editing and Finish/Save stay reachable. A partial download is labelled at the end of History, never shown as an empty history. A sync lock stays a full page; revoked trust keeps owned content and its portals unmounted, while Settings stays reachable. The launch heart appears only after a 400ms delay, so a quick launch shows nothing; 5s without an answer hands over to the locked page.

The logger autosaves without a notice; a failed save surfaces through its error state. Finish disables submission and dismissal while saving and keeps failures in its dialog. Global failed-save guidance is not repeated beside an editor's own error. Live text is announced only while its surface is accessible: problems and the read-only tab assertively, quiet conditions politely.

## Settings and shell updates

- The phone Settings entry is Profile's cog, outside the disabled content fieldset so read-only and maintenance states can open it. Closing restores focus to it.
- The notification row says honestly when the phone has not allowed or has blocked notifications, and shows only a short Add to Home Screen or not-available line where the browser cannot notify.
- Settings never gains the controls `PRODUCT.md` excludes. Owned history, including portaled forms, unmounts while sync is locked; body weight also while saved data is unreadable.
- App update appears only with a waiting production shell and applies through an explicit confirmation that requires the saved, draft-free, trusted installation-lock transition, including cross-tab checks. Applying never reloads the current page. The unreadable-data reset also needs its own confirmation, keeps the original bytes and is never a server-history reset.

## Back, safety and verification

Every transient layer (picker, details, drawer, menu, Settings, editors, celebration, the expanded phone logger) holds one same-document back entry. Back closes only the newest; dirty edits ask and keep the changes. Main tabs add no history. Preserve `src/state/back.ts`'s forward-onto-existing-entry strategy (`docs/phone-and-pwa.md`). A launch-restored logger arms on the first tap.

Hook classes, live regions and sync-lock unmounting: `docs/phone-and-pwa.md`. Saved means the IndexedDB transaction committed, never a cosmetic timer.

Verify the populated app at Pixel 6 (412×915), 320px and short landscape, in Paper and Night. Stress long, unbreakable and non-Latin names, four-digit counts and loads, many sets, empty/one/large histories and enlarged text; measure overflow, reachable 44px actions and chart labels, then inspect screenshots. Use synthetic data; abort API writes in live checks. Chromium emulation does not satisfy real Android or iPhone keyboard, gesture, audio or haptic acceptance (release gates in `PRODUCT.md`).
