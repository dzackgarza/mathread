## Intended result

An installed MathRead reader delegates Alt-Left and Alt-Right to PDF.js only when that document has a traversable internal destination.
Otherwise the browser retains its normal parent-tab navigation.
PDF.js continues to own page, viewport, zoom, and navigation state.

## Scope

- Included: the `reader.html` keyboard handoff and its real `pdf-launch.html`/`mathreadReaderFrame` proof path.
- Excluded: a custom PDF navigation engine, PDF.js vendor modifications, backend-owned reader state, session or multi-client machinery, and unrelated shortcut changes.
- Preserved: PDF.js links, current-view/source URLs, browser navigation, editor shortcut isolation, and key-only backend read-recency events.

## GitHub tracking

- Target issue: #34
- Milestone: Reader navigation parity (#35)
- Closes on merge:
  - Closes #34
- References only:
  - Refs #35
  - Refs #5

## Implementation plan

1. Add an installed-extension red proof that enters through PDF interception and distinguishes PDF-internal from parent-browser Alt-arrow navigation.
2. Gate keyboard cancellation on a parsed current-document browser history entry and delegate only to the existing PDF.js history API.
3. Extend the production-path proof to cover both directions, restored PDF.js view state, source-preserving links, and the absence of backend navigation-state writes.

## Claim map

- [ ] **#34 — Reader/browser navigation handoff**
  - Proof obligations claimed: handled internal back and forward; fall-through browser back and forward; PDF.js page, viewport, and zoom restoration; source-preserving current-view links; no backend view-state writes.
  - Partial / not claimed: browser-wide history redesign, custom PDF engine work, PDF.js vendor API changes, backend persistence changes, or multi-client semantics.
  - Evidence required: one real built-extension browser run through `pdf-launch.html` and `mathreadReaderFrame`, with real keyboard input that distinguishes all four paths; inspected screenshots for the internal navigation states; backend request evidence showing no view-state write.
  - Current evidence: PR #26 proves only a top-level reader internal-history case and is insufficient for this production iframe handoff.

## Automated gates

- The repository's commit and push hooks run the global Bun/Python QC layers.
- The PR remains draft until the focused browser proof and claimed issue criteria have current evidence.

## Review focus

Review the owner boundary first: PDF.js must remain the sole internal navigator, Chrome must receive an unhandled Alt-arrow, and the backend must remain uninvolved in reader view state.
Reject any proof that bypasses `pdf-launch.html`, uses private PDF.js fields, or would pass while browser navigation is still suppressed.
