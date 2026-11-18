# UI, phone gestures and the installed PWA

Read before UI, layout, gesture, accessibility or installed-PWA work. `apps/web/DESIGN.md` is the visual contract; this file holds conventions and traps.

## Styling conventions

- `apps/web/src/index.css` is the only stylesheet; everything else is Tailwind v4 utilities, with no `!` important modifiers.
- Amber is the only accent. Every border names a token (`border-border`); there is no global border colour.
- Shared primitives live in `apps/web/src/components/ui/`.
- Keep hook classes such as `app-shell`, `settings-panel` and `nav-item`: tests and JS select on them.
- Tailwind `max-[480px]:` applies below 480px, not at it.
- A Recharts `<Cell>` without `fill` renders black: give every cell its own fill (`apps/web/src/views/ProfileView.tsx`).

## Layout and rendered size

- Verify SVG label sizes in rendered CSS pixels in the Pixel 6 Playwright device, not only their declared font-size: a wide fixed viewBox can shrink labels below readable size.
- End the exercise-header ⋯ dots flush with the drawn 30px completion box's right edge, not its centre, and keep them centred in their 44px target so its pressed/open wash surrounds them: the target is shifted 9px into the card's side padding instead of nudging the icon inside it. Measure the drawn dots, not the 18px icon box: Lucide's ellipsis spans 4 to 20 of 24 viewBox units. Assert dots/column geometry on phone.

## Dialogs, prompts and accessibility

- The editors' Discard changes? drawer covers the editor, so Radix hides the editor from the accessibility tree while it is open: role queries scoped to the editor dialog find nothing then. Select it by its class (`.history-editor`, `.template-editor`) in tests, and check that Keep editing, Escape and back each return focus to the last field.
- Never toggle a CSS animation by focus modality on a surface that stays open (`.pushed-page:has(:focus-visible)` sets `animation: none`): the pointer press that moves focus off a programmatically focused field restores the animation and replays the slide-in, so the press lands on whatever slid under it. The pushed editor uses its own `.editor-pushed` class for that reason.
- Dialogs stack (`apps/web/DESIGN.md` "Nested surfaces stack"): keep the parent open under its child rather than closing and reopening it. The Dialog scrim shares the surfaces' `z-50`, so stacked portals layer in opening order; a lower scrim would leave the parent undimmed above the child's scrim.
- Keep a dialog's content in state that outlives `open` (for example `{id, open}`), or the content blanks during the close fade.
- Take a layer's focus-return target from the opening event's `currentTarget`, never `document.activeElement`: Safari on iPhone doesn't focus a tapped button.
- Block dismissal of a vaul drawer with `dismissible={false}` (as the Finish drawer does while saving), not only in `onOpenChange`: by then the drawer has already slid away.
- Radix handles Escape before an inline menu sees it; give an open menu the first chance at Escape.
- If the tabs or another fixed control vanish from the accessibility tree, look for `inert` or `aria-hidden` ancestors first: the logger sheet makes the tabs and the covered library inert (`apps/web/src/App.tsx`).
- `<main>` is `hidden` while `sync.locked`, but Radix dialogs portal outside it: anything showing history must unmount while `sync.locked`.
- Never put an `aria-live` region inside the logger or an editor. Radix's `hideOthers` keeps every `[aria-live]` element and its ancestors exposed, so the logger behind a modal stays in the accessibility tree. Portal live regions to `document.body` (see the reorder announcement in `apps/web/src/views/WorkoutView.tsx` and `Announcement` in `apps/web/src/components/StateNotice.tsx`, which condition pills and strips use).

## Number inputs (`apps/web/src/components/ReplaceInput.tsx`)

Focus dims the value and the first typed digit replaces it. Never select the text on focus (`select()` or a whole-value `setSelectionRange`): that opens the phone's native Cut/Copy bar, which nothing can suppress. The replacement uses a native `beforeinput` listener, because React's `onBeforeInput` has no `inputType`, and parks the caret by switching the field to `type='text'` for one `setSelectionRange` (otherwise typing 62.5 can give 2.56). The fallback `onChange` diffs against the text captured on focus, not the stored number: `080` against a stored `80` once saved 805. Browser tests can't prove the native bar stays away; that needs a real phone.

## Back gesture (`apps/web/src/state/back.ts`)

Chrome lets the back gesture skip history entries a page added without a fresh user tap, and an in-page back resets that tap. Never re-`pushState` after a back. To keep a layer that declined to close, step forward onto the entry that still exists (`history.go(+n)`, ignoring its popstate). A layer that the declining layer opens in response (a Discard changes? prompt) shares that entry rather than pushing one: Chrome marks an entry pushed within roughly 50 ms of a gesture back skippable, so a push there fails only some of the time and mostly on the faster bundled build. Playwright's in-page `history.back()` counts as a tap and hides the problem, so drive back with CDP `Page.navigateToHistoryEntry` and assert there is no `NavigationEntryMarkedSkippable` audit issue (`apps/web/tests/e2e/back-gesture.spec.ts`).

## Drag gestures

A release between a hold timer and the React effect that attaches listeners is lost and leaves scrolling blocked. Hand the pointer over explicitly (track up/cancel until the new owner claims it), register a non-passive window `touchmove` only for the press, and let the click-swallow guard expire after release and ignore `detail === 0`. Test with an injected pointerup right after the timer, and assert the held row starts under the finger in a list too short to scroll.

Row handlers check physical DOM containment (`event.currentTarget.contains(event.target)`), because events from a portaled dialog bubble through the React tree. Moving pointer capture from a pressed control to its row also fires `lostpointercapture` on that control, so the row cancels only on losing its own capture (`apps/web/src/components/SetRow.tsx`). Set deletions are functional updates by stable exercise and set ids: two exit animations can finish in the same frame.

## Installed Android PWA

- Production builds include a manifest, icons and a finite service-worker app-shell cache. After one successful online load the shell reopens offline on IndexedDB. API responses, exports, JSON payloads and arbitrary runtime requests are never cached. No native background sync is implied.
- The active-workout notification (`apps/web/src/pwa/workout-notification.ts`) uses `registration.showNotification` with no push server, so it needs an active service worker: none in dev or the e2e build, which is why `apps/web/tests/e2e/workout-notification.spec.ts` stubs only `Notification` and the real show/tap path lives in `apps/web/tests/pwa/notification.spec.ts` and `apps/web/tests/pwa/build.test.ts`. Only the tab that owns the draft shows or clears it, after hydration; a read-only tab leaves it to the owner tab. It is shown at most once per visit (a page load or a return to the foreground, which App reconciles through the state's `visit` count): a dismissed notification stays away through edits, autosaves and the background, and the next open or return shows it again; one still shown for the workout is left alone. Nothing about a dismissal is stored, and only Settings turns it off for good. The worker's `notificationclick` only focuses an open Ember window (posting `EMBER_RESUME_WORKOUT` so the logger opens without a reload) or opens `/`; it never reads notification data or workout storage.
- Ask for notification permission only inside a Start tap (`askOnStart`) or a Settings tap: browsers ignore or penalise requests without a user gesture. iPhone Safari tabs have no `Notification`; only the Home Screen app on iOS 16.4+ can notify. Physical Android and iPhone behaviour (badge rendering, tap after the app was killed, `getNotifications` returning `data`, which keeps a shown notification from being replaced on each return) is not yet verified.
- Chromium touch/viewport tests don't prove comfort on a real phone keyboard; on-device validation is still outstanding.
- Chrome fills the bottom gesture-bar strip from the manifest `theme_color`/`background_color` only; page `meta theme-color` and CSS can't reach it. The manifest uses Night `#17161b`.
- Manifest changes reach the phone only after the service-worker shell update is applied and Chrome's periodic WebAPK update check runs.
- Updates require explicit confirmation and a saved, draft-free transition; never reload an active logger silently. The production shell precaches only a finite allowlist (see `ops/README.md`).
