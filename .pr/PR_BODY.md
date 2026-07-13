## Intended result

The extension-owned PDF reader offers two source-preserving copy actions:

- **Copy current view link** copies the original PDF URL with MathRead page, viewport, and zoom state.
- **Copy plain link** copies the original PDF URL without MathRead view state.

Following a current-view link returns the reader to the copied view without exposing a backend-local reader identity.

## Scope

Included:

- Reader menu actions for current-view and plain source links.
- Source URL state serialization and reader-launch restoration for page, viewport, and zoom.
- Real-extension browser proof using the canonical Numdam PDF and the system clipboard.
- Rendered screenshots of the reader copy-action menu at desktop and narrow viewports.

Excluded:

- Browser Alt-Left navigation behavior (#27).
- Concurrent read-event response contracts (#28).
- Moving reader and library workflows into the extension app (#10).

## GitHub tracking

- Target issue: #9
- Milestone: Source-preserving PDF links
- Closes on merge: `Closes #9`
- References only: `Refs #29`

## Claim map

- [ ] **#9 — source-preserving PDF link copy actions**
  - Proof obligations claimed:
    - Current-view copying preserves the original PDF URL and encodes page, viewport, and zoom state.
    - Plain-link copying preserves the original PDF URL and carries no MathRead view state.
    - Neither copied value uses `markdown-editor.localhost` or a backend-local reader identity.
    - The actions execute from the extension-owned reader and copied current-view links round-trip to the captured view.
  - Evidence required:
    - A real extension-browser run against the canonical Numdam PDF, exercising both menu actions through the system clipboard.
    - Direct URL assertions for source identity and the current-view/plain-link distinction.
    - Rendered desktop and narrow-viewport screenshots inspected for the menu state.
  - Current evidence: pending implementation.

## Automated gates

- Focused Numdam extension-browser test while iterating.
- Repository commit hooks and push/CI gates.

## Review focus

- Query-state ownership and restoration must stay in the source URL / extension launch path.
- Clipboard failures must not produce a success message or a fallback identity.
- The proof must exercise the real extension reader and clipboard, not a helper-only or mocked path.
