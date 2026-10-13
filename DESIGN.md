---
name: Gym Log
description: Mobile-first workout ledger with inspectable evidence and durable local saving.
colors:
  paper-bg: 'hsl(38.6 43.8% 93.7%)'
  ink-fg: 'hsl(270 7.5% 15.7%)'
  paper-surface: 'hsl(42 55.6% 96.5%)'
  paper-muted: 'hsl(33.7 7.8% 40%)'
  paper-border: 'hsl(39.1 19.7% 77.1%)'
  paper-soft: 'hsl(37.1 36.8% 88.8%)'
  night-bg: 'hsl(252 10.2% 9.6%)'
  night-fg: 'hsl(38.6 31.8% 91.4%)'
  night-surface: 'hsl(260 9.1% 12.9%)'
  night-muted: 'hsl(36 9.2% 68%)'
  night-border: 'hsl(270 6.9% 22.7%)'
  night-soft: 'hsl(262.5 9.1% 17.3%)'
  pine-primary: '#236349'
  pine-on-primary: '#fff'
  pine-tint: '#e2ece2'
  pine-night-primary: '#88c3a1'
  pine-night-on-primary: '#13291d'
  pine-night-tint: '#24362d'
  ocean-primary: '#176478'
  ocean-on-primary: '#fff'
  ocean-tint: '#e0eaee'
  ocean-night-primary: '#87c6d8'
  ocean-night-on-primary: '#132c35'
  ocean-night-tint: '#24343b'
  copper-primary: '#894722'
  copper-on-primary: '#fff'
  copper-tint: '#f4e8dd'
  copper-night-primary: '#e9ad82'
  copper-night-on-primary: '#352216'
  copper-night-tint: '#3c2e24'
  danger: '#9d362e'
  danger-tint: '#f8e7e1'
  night-danger: '#f3a49b'
  night-danger-tint: '#452722'
typography:
  body: {fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', lineHeight: 1.5}
  headline: {fontSize: '28px', fontWeight: 650, lineHeight: 1.2, letterSpacing: '-0.035em'}
  title: {fontSize: '18px', fontWeight: 650, letterSpacing: '-0.02em'}
  set-value: {fontSize: '18px', fontWeight: 600, lineHeight: 1.2}
rounded:
  button: '0'
  input: '0'
---

# Design System: Gym Log

## Overview

The owner-approved redesign is an **Operate** surface: a fast editable set ledger, with the library and evidence one step away. It uses a warm Paper/Ink and Night neutral family with independent Pine, Ocean and Copper accents, bundled Inter and square controls. Generic Strong logging conventions inform the workflow; no Strong branding or assets are reproduced.

This document describes the implemented React app (`src/App.tsx`, `src/styles.css` and its views/components), not the standalone approval prototype. The real IndexedDB writer, immutable outbox, API authentication, recovery and finite PWA shell remain authoritative. There is no data/schema migration or prototype-storage substitution in this redesign. Synthetic development examples are not production history.

## Colors

- Paper/Ink and Night use the bg/fg/surface/muted/border/soft tokens above. Neutrals stay neutral when the accent changes.
- **Pine is the approved default**. Ocean and Copper are configurable; controls use each theme's primary/on-primary/tint trio. Preference swatches deliberately retain light-accent colors in Night.
- Primary carries Start, Finish, confirmed checks, current navigation, links, trends and the resume bar. Tint marks completed rows and selected appearance choices. Danger colors identify destructive controls and storage/recovery errors.
- System is the default theme and follows live `prefers-color-scheme` changes. Light and Dark are explicit overrides. A validated, versioned `gym-log:appearance:v1` setting is separate from workout data. Denied appearance storage keeps the current tab usable and reports that the preference could not be saved; it never changes workout-saving claims.
- The HTML `theme-color` starts in Paper `#f6f1e8`; the inline head script (before first paint) and the appearance setting switch it to Paper or Night `#17161b`, which colours the status bar. The manifest `theme_color`/`background_color` are Night: installed Android apps fill the bottom gesture-bar strip and splash from the manifest alone, which cannot follow the theme, and a light strip under the dark app looked broken (owner chose Night). Neither changes the existing PWA icons.

## Typography

- Inter Variable is bundled locally via `@fontsource-variable/inter`, with Inter/system-ui/sans-serif fallbacks and `cv11`. No font CDN, display family or ornamental monospace is used.
- Body is 14px/1.5. Page headings are 28px/650 with −.035em tracking; exercise headings are 17px/650/1.35. Workout names are 18px/650, reducing to 16px below 350px. Tertiary headings are 16px/650.
- Set values are centered 18px/600, with tabular numerals. General inputs are 16px; button labels are 14px/550. Supporting text is 12–13px, column/navigation labels 11px, Previous dates 10px. Counts, source values and history tables use tabular numerals.

## Layout

- The workspace occupies `100dvh`, centered up to 1480px. Body scrolling is disabled; library, logger and dialogs have separate internal scroll regions.
- Below 1000px, the active logger is a full-screen sheet with a compact fixed name/Finish header, completed/total sets and elapsed time. Save failures remain visible in the logger. The covered library is both inert and hidden from accessibility. Its navigation is unavailable until the workout is minimized.
- At 1000px and above, the logger is a 500px right column next to the interactive library. Desktop library padding is 26px 32px 40px, topbar minimum 72px. Routine cards use two columns without the logger and one column beside it; analytics stack within the narrower adjacent library.
- Mobile library padding is 24px 18px 30px; its topbar is at least 64px. Profile, History, Workout and Exercises navigation targets are at least 56px high, with safe-area bottom padding. The named resume bar is at least 64px and participates in layout rather than covering records.
- Exercise sections use 20px 16px 18px padding (22px 24px in the desktop logger). Rows have **Set / Previous / kg (or Assist. kg/Seconds) / Reps (or km) / Done** columns: `44px minmax(66px,1fr) minmax(52px,.86fr) minmax(48px,.78fr) 48px`, 6px gaps and at least 56px row height. Below 350px, side padding is 12px and gaps 4px.
- Set-number/Previous actions and fields have at least 44px height; completion is 48×48px with a 30px visible outlined marker. Standard controls are at least 44px, appearance choices 48px. Five columns intentionally trade the former wide two-field mobile grid for per-set historical evidence.
- Portrait 390×844 and 320×740, short landscape 844×390, and desktop 1440×1000 are browser-tested. Focus/resize/visualViewport updates reveal inputs in the relevant internal scroller with 14px clearance. Library navigation is hidden by visibility while an input is focused, preserving its layout space so blur cannot move a Save button between pointer down/up.

## Elevation & Depth

Flat surfaces, 1px borders and spacing establish hierarchy. The adjacent workout sheet has no shadow. Modal dialogs use `0 12px 48px #17161b26` in Paper and `0 12px 48px #0006` in Night above a `#17161b80` overlay. Buttons transition background for 120ms; reduced-motion removes transitions, animations and smooth scrolling. Selection, caret, scrollbar and keyboard-focus colors come from the active palette.

## Shapes

Buttons, inputs, panels and dialogs are square. Completed values lose field borders rather than becoming pills. Dialogs are normally at most 520px wide, within a 24px viewport gutter, height constrained and internally scrollable. Settings is a full-height right-hand modal panel on desktop (16px inset), full-screen below 1000px. Lucide supplies the existing icon vocabulary.

## Components

- **Library:** Four tabs are Profile / History / Workout / Exercises, initially Workout. Profile shows workout/set totals, this week's workouts and the last 12 weeks of workouts per week (average excluding the current partial week), with Settings. Workout contains editable routines (existing template records) and Start empty workout. History retains repeat, source details, search, pagination and Save as template. Exercises combines the catalog with exact historical/custom names, search, body-part filters, recent rows and thumbnails; no recorded names are fuzzy-matched or merged. Each row ends with a bare count of the unique workouts that included it (an exercise repeated as separate blocks in one workout counts once): right-aligned, never shrunk, 17px/650 primary colour with tabular numerals, absent when never performed, and announced as "Performed in N workouts". Names wrap to at most two lines before truncating, so 3–4 digit counts don't squeeze them. A square two-segment **A–Z / Most done** toggle (44px, `aria-pressed`) sorts the All list; Most done orders by that count, ties A–Z, never-performed last, and combines with search and body-part filters. The choice is a device preference in `gym-log:exercise-sort:v1`, separate from workout data. Recent stays by recency, and the shared Add exercise picker stays A–Z without the toggle.
- **Exercise details:** About / History / Charts / Records sit below the name, thumbnail, body part and "N workouts", the same unique-workout count as the Exercises list. History, Charts and Records stay per exercise block, so an exercise repeated within one workout appears there once per block. History is the initial tab when the exercise has been performed, otherwise About. About shows available drawings, body part, equipment and muscle data only; no instructions or credit text. Custom exercises say they are not in the catalog. History lists exact sets with flags/exclusions and source links. Charts provides applicable metrics, a time-range selector, a date-spaced trend and exact-value/source tables. Records provides eligible best performances and a heaviest-weight-by-exact-reps table. All use actual imported/native history, never demonstration summaries.
- **Catalog credits:** AI-assisted drawings made for Gym Log match the Everkinetic line style and are credited "Gym Log (AI-assisted, gpt-image-2)", app-owned, with no Everkinetic/wger attribution. Bundled Everkinetic/wger content keeps original title, author, source and license URLs plus adaptation metadata. Attribution stays in the catalog data; the app shows no credits, so restore a credits view before any public release. Cropped/resized/recoloured drawings and plain-text instructions retain their original licenses and applicable attribution/share-alike obligations. Content coverage varies and does not imply source-project endorsement.
- **Exercise details from the logger:** In the active workout, each card's thumbnail and name are one button ("Show details for <name>", at least 44px high, covering the thumbnail, name and completion line, with the standard focus ring) that opens the same Exercise details as the library. On mobile they fill the screen; on desktop they exactly cover the 500px workout column. Both use a modal dialog over the logger, which stays mounted underneath, so values, checks, scroll position and the clock are untouched. Back to workout, Escape or the overlay close it and focus returns to the name button. There is no Android back-gesture handling, because the app has no history-state navigation yet. History, Charts and Records come only from finished and imported workouts, never the open draft. Exclude/Include work as in the library and are disabled while the logger is. A source-workout link closes the details and behaves like Previous evidence: it minimizes the logger and opens History, keeping the draft. The ⋯ menu stays a separate control. The completion status sits visually over the button but is not part of its name. The template editor keeps a plain heading without a details button. The dialog lives inside the logger, so it unmounts while sync is locked.
- **Active sheet:** Minimize reveals all four library tabs and the named resume bar with elapsed time and completed/total sets, without discarding the draft or rebuilding the ledger. Values, explicit checks and same-session scroll position survive resume; scroll position is transient, not serialized. Reload restores the durable draft and opens the sheet.
- **Fast entry:** Focus selects the existing number. Weight Enter moves to reps; reps Enter explicitly completes only a valid unchecked set and blurs. Duration Enter validates/completes seconds; cardio moves seconds to distance. Bodyweight retains its noneditable load and editable reps. Numeric input modes, units and existing `validSet` bounds are preserved. Blank/invalid values cannot be completed or contribute to Finish.
- **Completion:** Unchecked targets retain bordered editable fields and an empty square, never a check. Confirmation adds tint, a primary check and a colored index. Editing any numeric value clears completion. An exercise reads check + Done only when every nonempty set is valid and confirmed; adding/editing a set returns it to a count. Finish is disabled with no valid completed set.
- **Targets:** Routine starts and exercise additions use the latest eligible actual matching name/type history, repeating its last available target for extra routine rows. No matching evidence means blank values. Repeating History copies that exact workout, not newer history. Every resulting draft is unchecked. Add exercise opens a full-screen picker shared with the Exercises library: search, body-part chips, Recent/All sections and thumbnail rows. Selecting a row adds it and closes the picker; Close or Escape leaves the draft untouched. A query without an exact name offers Create, followed by Weighted/Assisted/Bodyweight/Duration/Cardio choices. Template editing uses the same picker. Each exercise heading has a 44px ⋯ **Exercise options** menu with **Replace exercise** and **Remove exercise**, in the logger and the template editor. It is inline, not portaled, and opens below ⋯, flipping above it when there isn't room below. Escape or an outside tap closes it and focus returns to ⋯; a transparent backdrop takes that closing tap, so it never also completes a set or presses anything else. Tab closes it and continues from ⋯. Focus moving elsewhere closes it, so only one menu is open at a time. Remove drops the exercise immediately, without confirmation or undo, and focus moves to the next card's ⋯, else the previous card's, else Add exercise. Replace opens the same picker titled Replace exercise; the pick takes the same position with fresh history targets and the old sets, completed ones included, are discarded. Closing the picker changes nothing. Add set copies the last row unchecked. Routine editing uses targets-only rows and never records completed work.
- **Evidence:** Each Previous cell shows the latest matching session's actual set/date. Its dialog lists that session's exact sets, flags/exclusions, and best reps at the selected row's exact entered weight with date/source workout (an unflagged set wins over a flagged one; flagged evidence says so). Assistance is explicitly labelled; duration/distance does not receive resistance estimates. No exact-weight history is stated plainly ("No sets at X kg"), followed by a **Nearest recorded** section: the best-reps actual set at the closest lighter and heavier recorded weights (Less/More assistance for assisted work), each with date and a source-workout button, worded as actual sets, never an inferred equivalent. Source navigation minimizes the logger and focuses the corresponding History entry.
- **Set exclusion:** Recorded sets in exercise History, expanded History workouts and Profile's Flagged sets list carry a ghost **Exclude**/**Include** button (44px target, accessible name naming the set and its values). No confirmation, because it is reversible; the state change is shown immediately: the row dims, gains an "excluded" label and the action flips to Include. Values are never struck through, so the owner can still read what they are judging.
- **Delete:** Native `pan-y` preserves scrolling. A left swipe from a non-input row area reveals Cancel/Delete; it never deletes or confirms by itself. Vertical intent, pointer cancellation/leave and post-swipe click suppression remain intact. Set-number actions provide explicit keyboard-accessible deletion. Deletion removes the selected set without an alert or undo banner, preserving remaining values, completion and order. Stable transient identity distinguishes duplicate exercise names and zero-set exercises.
- **Protected transitions:** Another routine, repeat or empty start requires an explicit replace-draft confirmation while a draft exists. Finish explains valid completed sets and excluded unchecked sets; saving delegates to the existing atomic finish transaction. A failed commit retains the draft, displays the storage error rather than a success claim, and permits retry.
- **Settings:** Appearance, local Strong CSV preview/import and explicit PWA update paths remain available. Manual sync controls and the JSON Backup & Recovery panel are absent. Radix modal focus trapping/return, descriptions and close actions remain part of the modal design. Sync lock/read-only ownership does not disable opening Settings; protected import/update paths retain their disabled-state gates. Untrusted owned workout data remains hidden. Import notices and retained sync issues are readable in the modal, not trapped underneath it. Storage recovery APIs, validation/confirmation safeguards and server backup tools remain intact; they are not Settings features.
- **Durability:** Loading/saving/saved/error remain real workout-writer states, not appearance persistence or a delayed visual timer. Routine success status is not displayed as a permanent label; errors still surface. A saved state means the IndexedDB transaction committed. Storage errors remain visible inside the mobile logger; finish errors remain visible in its confirmation. Server synchronization runs silently in ordinary use and retains immutable pending-operation behavior. Authentication/ownership blocks and rejected sync operations still surface; routine connection/success states do not need a permanent card. Device saving and server sync are not off-device backup.
- **Analytics:** Weighted charts show best reps, best load, session volume and estimated 1RM; assisted charts show best reps and least assistance; bodyweight work has rep trends. Duration/distance-specific trends are not implemented. Best reps/load are not matched-weight/matched-rep comparisons: weights/reps can differ, so inspect the exact source sets. Records exclude excluded sets and retain source links. Exact-value/source tables remain alternatives to charts. Epley estimates stay formula-labelled and bounded to appropriate weighted work. Bodyweight, assistance and duration/distance do not gain resistance formulas; recorded machine loads are not treated as equivalent across equipment changes.

## Do's and Don'ts

- **Do** keep the ledger primary, units explicit, values editable, checks intentional and historical evidence traceable.
- **Do** preserve one writer, immutable outbox payloads, security/ownership gates, retained source bytes and storage/recovery failures.
- **Do** use synthetic fixtures and local bundled assets for publishable examples.
- **Don't** copy approval-preview sample state/storage into the app, rewrite saved data for appearance, infer equivalent historical performances or claim saving before transaction commit.
- **Don't** call Chromium emulation native phone keyboard evidence, server sync off-device recovery, or this UI approval completion of the remaining release gates. Real-device acceptance and disaster-recovery rehearsal remain separate gates; existing encrypted off-device backups are not a UI saving claim.
