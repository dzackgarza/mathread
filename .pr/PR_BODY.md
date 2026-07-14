## Intended result

An installed MathRead reader leaves Alt-Left and Alt-Right to Chrome's native history traversal.
PDF.js's existing browser-history entries therefore handle internal document navigation when present; otherwise Chrome follows normal parent-tab history.
PDF.js continues to own page, viewport, zoom, and navigation state.

## Scope

- Included: the `reader.html` non-interference guard and the production `pdf-launch.html` redirect into a top-level reader.
- Excluded: a custom PDF navigation engine, PDF.js vendor modifications, backend-owned reader state, session or multi-client machinery, and unrelated shortcut changes.
- Preserved: PDF.js links, current-view/source URLs, browser navigation, editor shortcut isolation, and key-only backend read-recency events.

## GitHub tracking

- Target issue: #34
- Milestone: Reader navigation parity (#35)
- References only:
  - Refs #34
- References only:
  - Refs #35
  - Refs #5

## Issue-scoped lifecycle gate — required

- [x] Linked triaged issue: #34.
- [x] This PR is returned to draft while the current-head policy gate and review loop run.
- [x] The PR scope maps to #34's reader/browser navigation contract; unrelated reader and backend work is excluded.
- [ ] Mark ready only after the current-head review and CI gates complete.
- [x] Accepted feedback has committed remediation; rejected feedback has a top-level `Review feedback disposition ledger`.

## Policy alignment gate — required

<!-- policy-alignment-gate -->

### Tier 0 — every PR

- [x] Evaluated `POLICY.RUNTIME_DEFAULT`; the canonical `POLICY.*` record files named by the template are absent from this checkout, so no unavailable record is claimed as loaded.
- [x] No fallback, runtime default, optional core state, swallowed error, or partial-success path is introduced.
  The reader leaves browser history unhandled and does not mirror PDF.js state.
- [x] No empty/falsy-literal fallback is added or reclassified as safe.

### Tier 1 — QC-tooling changes

- [x] Not applicable: this PR changes no QC tool-config, review, detector, or QC justfile.

## Implementation

1. PDF.js writes and restores its own entries through the browser history API.
2. Alt-modified left and right arrows bypass the ordinary reader page-turn branch without being consumed, leaving Chrome to traverse that history.
3. Production-path tests enter through PDF interception and `pdf-launch.html`, which replaces itself with top-level `reader.html`.

## Claim map

- **#34 — Reader/browser navigation handoff (implemented and evidenced; PR remains draft for current-head review)**
  - Required proof obligations: an explicit, policy-compliant keyboard command router; native browser internal back and forward; native browser parent-history traversal; PDF.js page, viewport, and zoom restoration; source-preserving current-view links; no backend view-state writes.
  - Partial / not claimed: browser-wide history redesign, custom PDF engine work, PDF.js vendor API changes, backend persistence changes, or multi-client semantics.
  - Evidence required: one real built-extension browser run through `pdf-launch.html` into top-level `reader.html`, with real Chrome Alt-left/right behavior covering all four paths; inspected screenshots for the internal navigation states; backend request evidence showing no view-state write.
  - Current evidence:
    - A headed Xvfb Chromium run loaded the built extension and sent native X11 `Alt+Left` and `Alt+Right` events with `xdotool`.
      With no PDF-internal entry, Alt-Left reached the course page and Alt-Right returned to the top-level reader.
    - The same native-key run followed a PDF.js internal link, restored page 1, viewport, and 110% zoom with Alt-Left, then restored page 2, viewport, and 78% zoom with Alt-Right.
      The reader made no view-state backend write; the test retained its key-only read-recency assertion.
    - The rendered top-level reader screenshots were inspected for the initial page and the linked PDF.js destination.
    - The current head passed the full local push gate. Current-head GitHub review and CI remain the only draft gate.

## Automated gates

- The repository's commit and push hooks run the global Bun/Python QC layers.
- The PR becomes ready after the current-head review and CI gates complete.

## Review focus

Review the owner boundary first: PDF.js must remain the sole internal navigator, Chrome must receive an unhandled Alt-arrow, and the backend must remain uninvolved in reader view state.
Reject any proof that bypasses the production `pdf-launch.html` redirect, uses private PDF.js fields, or would pass while browser navigation is still suppressed.
