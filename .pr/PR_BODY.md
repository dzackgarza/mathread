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

## Issue-scoped lifecycle gate — required

- [x] Linked triaged issue: #34.
- [x] This PR is returned to draft while the current-head policy gate and review loop run.
- [x] The PR scope maps to #34's reader/browser navigation contract; unrelated reader and backend work is excluded.
- [x] Ready-for-review is requested only after the current policy gate and evidence below are complete.
- [x] Accepted feedback has committed remediation; rejected feedback has a top-level `Review feedback disposition ledger`.

## Policy alignment gate — required

<!-- policy-alignment-gate -->

### Tier 0 — every PR

- [x] Evaluated `POLICY.RUNTIME_DEFAULT`; the canonical `POLICY.*` record files named by the template are absent from this checkout, so no unavailable record is claimed as loaded.
- [x] No fallback, runtime default, optional core state, swallowed error, or partial-success path is introduced.
  The reader observes history mutations and otherwise leaves the browser event unhandled.
- [x] No empty/falsy-literal fallback is added or reclassified as safe.

### Tier 1 — QC-tooling changes

- [x] Not applicable: this PR changes no QC tool-config, review, detector, or QC justfile.

## Implementation

1. The reader observes public browser history mutations and entries for the current PDF fingerprint, then delegates handled traversal to the existing PDF.js history API.
2. Alt-modified arrows bypass the ordinary reader page-turn branch when PDF.js has no matching internal destination.
3. Production-path tests enter through PDF interception, `pdf-launch.html`, and `mathreadReaderFrame`.

## Claim map

- [x] **#34 — Reader/browser navigation handoff**
  - Proof obligations claimed: handled internal back and forward; fall-through browser back and forward; PDF.js page, viewport, and zoom restoration; source-preserving current-view links; no backend view-state writes.
  - Partial / not claimed: browser-wide history redesign, custom PDF engine work, PDF.js vendor API changes, backend persistence changes, or multi-client semantics.
  - Evidence required: one real built-extension browser run through `pdf-launch.html` and `mathreadReaderFrame`, with real keyboard input that distinguishes all four paths; inspected screenshots for the internal navigation states; backend request evidence showing no view-state write.
  - Current evidence:
    - `bun test --max-concurrency=1 --test-name-pattern 'reader hands Alt-Left|production launch iframe|reader preserves PDF-internal navigation history' tests/extension-rendering-boundary.test.ts` passes internal back/forward, browser back/forward fall-through, browser-history back followed by PDF-internal Alt-Right, and retained Alt-Up/Down reader page navigation.
    - The production screenshots were inspected for the linked, back, and forward states; page 1 restores at 110% and page 2 restores at 78%.
    - `bun test --max-concurrency=1 tests/extension-numdam-rendering.test.ts` passes the installed-extension current-view/source-link proof.
    - The push gate passed the full Python/Bun suite, including all installed-extension boundary tests.

## Automated gates

- The repository's commit and push hooks run the global Bun/Python QC layers.
- The PR becomes ready after the focused browser proof, manual screenshot inspection, and push gate complete.

## Review focus

Review the owner boundary first: PDF.js must remain the sole internal navigator, Chrome must receive an unhandled Alt-arrow, and the backend must remain uninvolved in reader view state.
Reject any proof that bypasses `pdf-launch.html`, uses private PDF.js fields, or would pass while browser navigation is still suppressed.
