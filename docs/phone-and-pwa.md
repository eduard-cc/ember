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
- Anchor fixed exercise-detail panels to the centred 1480px workspace (`max-w-[1480px]` in `src/App.tsx`), not the viewport edge. Assert panel and logger bounds at 1000, 1440, 1920 and 2560px and after a resize; a passing 1440px screenshot misses ultrawide misalignment.
- Position the exercise-header ⋯ glyph at the right content edge (the set checkbox column's right edge), not its centre. Keep the 44px target inside the card and assert glyph/column geometry on phone and desktop.

## Dialogs, prompts and accessibility

- Inline discard prompts in long editors must scroll into view and take keyboard focus on every dirty dismissal, not only the first. Test close/Escape, scroll back to the fields without answering, then close/Escape again.
- `<main>` is `hidden` while `sync.locked`, but Radix dialogs portal outside it: anything showing history must unmount while `sync.locked`.
- Never put an `aria-live` region inside the logger or an editor. Radix's `hideOthers` keeps every `[aria-live]` element and its ancestors exposed, so the logger behind a modal stays in the accessibility tree. Portal live regions to `document.body` (see the reorder announcement in `src/views/WorkoutView.tsx`).

## Back gesture (`src/state/back.ts`)

Chrome lets the back gesture skip history entries a page added without a fresh user tap, and an in-page back resets that tap. Never re-`pushState` after a back. To keep a layer that declined to close, step forward onto the entry that still exists (`history.go(+n)`, ignoring its popstate). Playwright's in-page `history.back()` counts as a tap and hides the problem, so drive back with CDP `Page.navigateToHistoryEntry` and assert there is no `NavigationEntryMarkedSkippable` audit issue (`tests/e2e/back-gesture.spec.ts`).

## Drag gestures

A release between a hold timer and the React effect that attaches listeners is lost and leaves scrolling blocked. Hand the pointer over explicitly (track up/cancel until the new owner claims it), register a non-passive window `touchmove` only for the press, and let the click-swallow guard expire after release and ignore `detail === 0`. Test with an injected pointerup right after the timer, and assert the held row starts under the finger in a list too short to scroll.

## Installed Android PWA

- Chrome fills the bottom gesture-bar strip from the manifest `theme_color`/`background_color` only; page `meta theme-color` and CSS can't reach it. The manifest uses Night `#17161b` by owner choice.
- Manifest changes reach the phone only after the service-worker shell update is applied and Chrome's periodic WebAPK update check runs.
- Updates require explicit confirmation and a saved, draft-free transition; never reload an active logger silently. The production shell precaches only a finite allowlist (see docs/deploy.md).
