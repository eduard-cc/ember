---
name: Gym Log
description: Local workout ledger and inspectable exercise progress.
colors:
  offwhite: "#f4f6f4"
  white: "#fff"
  graphite: "#202823"
  forest: "#245c46"
  muted: "#647269"
  border: "#e0e6e0"
  selected: "#eaf2ec"
  focus: "#619c80"
  danger: "#a23828"
  danger-bg: "#fff1ef"
  unchecked: "#88968b"
  text-selection: "#c9dfd1"
typography:
  headline:
    fontFamily: "'Inter Variable', Inter, sans-serif"
    fontSize: "30px"
    fontWeight: 650
    lineHeight: 1.25
    letterSpacing: "-1.1px"
  title:
    fontSize: "16px"
    fontWeight: 650
    letterSpacing: "-0.3px"
  body:
    fontSize: "13px"
    lineHeight: 1.65
rounded:
  input: "7px"
  button: "8px"
  card: "10px"
  dialog: "12px"
---

# Design System: Gym Log

## Overview

Gym Log is a frontend-only React prototype with a single light theme, not a production PWA. It follows a restrained shadcn-style visual family with an independent forest palette. Editable set rows lead the interface; summaries and historical evidence support logging rather than compete with it.

## Colors

- **Primary:** Forest marks primary actions, completed-set checkmarks, selected metrics, source links and chart lines. Primary-button hover uses `#194b38`.
- **Neutral:** Offwhite grounds the page; white carries cards and navigation. Graphite is primary text, muted carries secondary descriptions, and border separates surfaces.
- **Selection:** Selected navigation and exercise choices use the pale selected background with forest text. Completed inputs use `#f1f7f0` with `#cdddcf` borders.
- **Feedback:** Danger text and danger-bg identify destructive actions and inline import errors. Persistence failures use a separate banner (`#fff1eb`, `#973525`). Notices use pale green (`#edf5ec`) with a `#c9dbcd` border.

## Typography

Inter Variable is bundled locally through `@fontsource-variable/inter` and inherits the incumbent frontend's sans-serif family; Inter and generic sans-serif are fallbacks. There is no separate display or monospace family.

- Page headings use the headline role; at the mobile breakpoint they reduce to 27px. Section titles use the title role; analytics titles use 18px and dialog titles 20px.
- Paragraphs use the body role. Buttons use 13px/550; fields use 14px, with centered desktop set values at 15px/550. Mobile editable workout names and set values use 16px; numeric and decimal input modes retain their units.
- Secondary labels and table text use 10–12px. Eyebrows use 10px/650 with 1.5px tracking, reducing to 9px on mobile.
- The completion count uses 32px/600 with -1px tracking; its denominator uses 20px/400. Numeric fields, counts and tables use tabular numerals.

## Layout

- Desktop has a fixed 220px white sidebar and matching workspace offset. The header is 77px high. Main content is centered within 1240px, with padding `35px 42px 60px`.
- The workout logger pairs a flexible ledger with a 260px right-hand summary, separated by 26px. The summary sticks 25px from the top; exercise cards stack with 18px gaps.
- At 1100px and below, the sidebar becomes 180px, main padding becomes 28px, and the summary column becomes 220px. At 850px and below, the sidebar becomes 150px and the summary flows below the ledger.
- At 600px and below, the sidebar becomes fixed 72px bottom navigation with safe-area padding; branding and sidebar footnotes disappear. The workspace has no left offset, the header is 57px, and main padding is `12px 12px 98px` to clear navigation. Phone landscape (width up to 900px and height up to 500px) uses the same compact layout, with 56px navigation and 82px bottom padding.
- Progress uses a 220px exercise picker beside flexible analytics, with a 22px gap. The picker reduces to 180px at 1100px; at 850px it flows above analytics with horizontally scrollable choices.
- Mobile set rows have four columns: 44px set-number action, two flexible values, and 44px completion. The permanent removal column is desktop-only. Full-width exercise sections use 8px horizontal padding, light rules and no outer corner rounding; historical comparison stays in a compact source action. Inputs and selects have a minimum 44px height; icon buttons are 44px square. Dialog actions stack in reverse order.

## Elevation & Depth

Cards stay flat: white fill, a 1px border and spacing establish hierarchy. Only the centered confirmation dialog uses a shadow (`0 16px 70px #14251a33`) above a dim overlay (`#14251a66`). Buttons transition background over .12s; reduced-motion preferences remove transitions and animations.

## Shapes

Use the input, button, card and dialog radii from the token layer. Smaller supporting elements use 5–6px corners; notices use 9px. The completion track is 5px high with rounded ends. Dashed borders distinguish add-exercise, file-import and empty-state surfaces from recorded content.

## Components

- **Buttons:** Application-owned primitives expose primary, secondary, ghost and danger variants; secondary is the default. Buttons have minimum 44px height, `0 15px` padding and an 8px icon/text gap. Secondary and ghost hover use `#edf1ed`; disabled buttons retain their appearance at .45 opacity.
- **Fields:** White fields have a 1px `#d9e1d9` border and `9px 12px` padding. Set fields use `#f8faf7`; disabled fields use `#edf1ed`. Focus-visible controls receive a 3px focus-colored outline with 3px offset. Numeric spinners are hidden.
- **Navigation:** Desktop choices use muted text, 46px minimum height and rounded selected backgrounds. Mobile choices stack icons over 10px labels; active choices keep forest text without a filled background. The active-workout dot is hidden on mobile.
- **Set completion:** Unchecked rows show an empty outlined marker, never a checkmark. Prefilled values remain targets until explicitly checked. Completed rows show a forest check button, green-tinted inputs and a stronger forest set index. Editing a value clears completion; invalid unfinished sets cannot be confirmed. Template editing omits completion controls.
- **Set deletion:** Swipe left from a row or its set-number/completion control to reveal Cancel and Delete; a swipe never removes a set. Input-started gestures are left to native editing. Native `pan-y`, vertical-intent abandonment, pointer cancellation/leave and click suppression keep scrolling and completion separate. Set-number actions also work with keyboard Enter/Space; desktop retains persistent removal. Undo restores the latest removed set with its original values, completion and relative order, preserving subsequent edits. In-memory exercise identity distinguishes duplicate names and survives zero-set exercises; removing the original exercise disables undo rather than restoring elsewhere. Undo is transient: changing views/reloading or a later deletion loses the prior opportunity.
- **Mobile workout header:** Editable labelled name and protected Finish are the visible header. Introductory copy is removed from the active mobile logger; the page heading remains accessible. Bottom navigation hides while an input has focus, returning on blur. Focus/resize and visualViewport resize/scroll reveal the active field with a 12px clearance; no assumption that viewport emulation reproduces an Android keyboard.
- **Workout summary:** Valid completed sets drive the count and progress track. Finish remains disabled without a completed set. A confirmation dialog explains that only valid completed sets are saved and unfinished sets are excluded.
- **Progress:** A forest SVG line and points sit on dashed horizontal guides; date positions reflect elapsed time. Metric buttons and a time-range selector control the view. The exact-value table below names date, metric value/unit and source; source actions open the corresponding history workout. Recorded-set chips retain flagged/excluded labels. Empty charts explain missing eligible sets rather than invent values.
- **Metric copy:** Estimated 1RM is explicitly an Epley estimate, session volume is recorded load × reps, and assistance labels say less is better. Source sets preserve the distinction between measured work and derived metrics.
- **Source and saved status:** The header displays the dataset's source label in a small bordered badge, separate from “Saved on this device” or “Not saved.” Persistence failure also produces an alert and an in-memory-only draft note. The footer states local storage only and no cloud backup; imported history does not change synthetic preset targets silently.

## Do's and Don'ts

- **Do** preserve explicit units, per-dumbbell and assistance guidance, source links, completion state and visible saving failures.
- **Do** keep examples synthetic and exact chart values inspectable without relying on hover.
- **Don't** replace editable targets with ornamental dashboard metrics or treat unconfirmed sets as completed work.
- **Don't** imply cloud synchronization, backup, a dark theme or production PWA behavior that the prototype does not provide.
