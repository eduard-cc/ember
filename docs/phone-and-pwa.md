# UI, phone gestures and the installed PWA

Read before UI, layout, gesture, accessibility or installed-PWA work. DESIGN.md is the visual contract; this file holds conventions and traps.

## Styling conventions

- `src/index.css` is the only stylesheet; everything else is Tailwind v4 utilities, with no `!` important modifiers.
- Amber is the only accent. Every border names a token (`border-border`); there is no global border colour.
- Shared primitives live in `src/components/ui/`.
- Keep hook classes such as `app-shell`, `settings-panel` and `nav-item`: tests and JS select on them.
- Other agents also open PRs against this repo (`claude/*` branches). Check open PRs and those branches before starting UI work.

## Layout and rendered size

- Verify SVG label sizes in rendered CSS pixels on Pixel 6, not only their declared font-size: a wide fixed viewBox can shrink labels below readable size.
- End the exercise-header ⋯ dots flush with the drawn 30px completion box's right edge, not its centre, and keep the 44px ⋯ target's right edge on the content edge (the completion target's), so its pressed/open wash keeps the card's side margin. Measure the drawn dots, not the 18px icon box: Lucide's ellipsis ends at 20 of 24 viewBox units, so the icon is nudged 9px right inside the target. Assert dots/column geometry on phone.

## Dialogs, prompts and accessibility

- The editors' Discard changes? drawer covers the editor, so Radix hides the editor from the accessibility tree while it is open: role queries scoped to the editor dialog find nothing then. Select it by its class (`.history-editor`, `.template-editor`) in tests, and check that Keep editing, Escape and back each return focus to the last field.
- Never toggle a CSS animation by focus modality on a surface that stays open (`.pushed-page:has(:focus-visible)` sets `animation: none`): the pointer press that moves focus off a programmatically focused field restores the animation and replays the slide-in, so the press lands on whatever slid under it. The pushed editor uses its own `.editor-pushed` class for that reason.
- Dialogs stack (DESIGN.md "Nested surfaces stack"): keep the parent open under its child rather than closing and reopening it. The Dialog scrim shares the surfaces' `z-50`, so stacked portals layer in opening order; a lower scrim would leave the parent undimmed above the child's scrim.
- `<main>` is `hidden` while `sync.locked`, but Radix dialogs portal outside it: anything showing history must unmount while `sync.locked`.
- Never put an `aria-live` region inside the logger or an editor. Radix's `hideOthers` keeps every `[aria-live]` element and its ancestors exposed, so the logger behind a modal stays in the accessibility tree. Portal live regions to `document.body` (see the reorder announcement in `src/views/WorkoutView.tsx` and `Announcement` in `src/components/StateNotice.tsx`, which condition pills and strips use).

## Back gesture (`src/state/back.ts`)

Chrome lets the back gesture skip history entries a page added without a fresh user tap, and an in-page back resets that tap. Never re-`pushState` after a back. To keep a layer that declined to close, step forward onto the entry that still exists (`history.go(+n)`, ignoring its popstate). Playwright's in-page `history.back()` counts as a tap and hides the problem, so drive back with CDP `Page.navigateToHistoryEntry` and assert there is no `NavigationEntryMarkedSkippable` audit issue (`tests/e2e/back-gesture.spec.ts`).

## Drag gestures

A release between a hold timer and the React effect that attaches listeners is lost and leaves scrolling blocked. Hand the pointer over explicitly (track up/cancel until the new owner claims it), register a non-passive window `touchmove` only for the press, and let the click-swallow guard expire after release and ignore `detail === 0`. Test with an injected pointerup right after the timer, and assert the held row starts under the finger in a list too short to scroll.

## Installed Android PWA

- Production builds include a manifest, icons and a finite service-worker app-shell cache. After one successful online load the shell reopens offline on IndexedDB. API responses, exports, JSON payloads and arbitrary runtime requests are never cached. No native background sync or ongoing Android notification is implied.
- Chromium touch/viewport tests don't prove comfort on the real phone keyboard; on-device validation is still outstanding.
- Chrome fills the bottom gesture-bar strip from the manifest `theme_color`/`background_color` only; page `meta theme-color` and CSS can't reach it. The manifest uses Night `#17161b` by owner choice.
- Manifest changes reach the phone only after the service-worker shell update is applied and Chrome's periodic WebAPK update check runs.
- Updates require explicit confirmation and a saved, draft-free transition; never reload an active logger silently. The production shell precaches only a finite allowlist (see docs/deploy.md).
