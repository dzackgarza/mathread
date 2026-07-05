# MathRead Data Integrity Remediation Plan

> Tier: implementation-adjacent
> Parent plan: `projects/mathread/plans/index`
> Externalized fit: GitHub tree root + parent issue #2

## Purpose / Observable Result
- **What someone can do or verify after this work**: 
  - Save notes without fear of losing edits due to concurrent writes or stale reader tabs (detected via conflict UI).
  - Open and read local PDFs dropped into the library directory without provenance, and see corrupted/broken PDFs flagged instead of crashing the app.
  - Log read history events transactionally and concurrently without losing data or corrupting JSON files.
  - Write region clips concurrently without filename collisions.
  - Highlight text containing special characters or quotes without breaking note file syntax.
- **Why the current state is insufficient**: 
  - Autosaves blindly overwrite notes, leading to data loss if the file is edited elsewhere.
  - `library.json` read history uses non-atomic read-modify-write.
  - Folder-based scanning crashes on broken PDFs or missing provenance.
  - Clip indexes are calculated from static glob scans, allowing collisions.
  - Annotation attributes are interpolated unescaped, corrupting Markdown when they contain quotes.
- **Observable completion condition**: 
  - Complete python and bun test suites passing.
  - E2E tests proving note stale conflict prompts, atomic writes, SQLite read state transactions, and robust scanning behavior.

## Scope
- **Included**:
  - Migration of read history to SQLite database (`library.db`).
  - Stale overwrite protection via mtime tags (ETags) for note GET/PUT endpoints.
  - HTML-entity escaping/unescaping in Pandoc annotation fenced-div serializers.
  - Monotone incrementing clip indexes with disk file existence checks.
  - Atomic PDF writes using temporary files and directory scanning robustness.
- **Excluded**:
  - Migrating notes/annotations into a database (clarified target is keeping notes in markdown).
  - Third-party library upgrades or PDF.js bundle replacements.
- **Preserved behavior**:
  - Co-located `.md` and `.assets/` file structure in the library root.
  - Extension-based capture flow and PDF.js viewer mounting.
- **Constraints and prohibitions**:
  - Do not call `uv run` inside Bun tests (use `.venv/bin/mathread` or `.venv/bin/python` to prevent lock hangs, as per project trap memory).

## Invariants
- If an autosave note edit has a stale version tag, the server returns HTTP 409 Conflict.
- The SQLite database uses Write-Ahead Logging (WAL) for concurrency.
- PNG clip writes must not overwrite any existing clip file.

## Sources and Current State
- **Canonical sources**:
  - Pre-pass specification: [data_integrity_prepass.md](file:///home/dzack/.gemini/antigravity-cli/brain/6416949f-0985-426c-a750-2b099a57ddf2/data_integrity_prepass.md)
  - Issue description: https://github.com/dzackgarza/mathread/issues/2
- **Relevant existing behavior**:
  - `write_note` and `read_note` use pure path-based text writes.
  - `_load_history` parses a single global `library.json` file.
  - Annotation parsing uses regular expressions `OPEN_RE` and `ATTR_RE`.
- **Assumptions already verified**:
  - Test suite passes cleanly on main.
  - `pikepdf` is available and functioning in the virtual environment.

## Execution Graph
- **Stacked prerequisites**:
  - SQLite database migration and atomic PDF writes (backend) must complete before robust scanning is tested.
  - Note versioning support on backend must complete before frontend conflict UI can be implemented.

## Task Plan

### Task 1: SQLite Read History Database
- **Obligation served**: Move mutable history from `library.json` to SQLite (`library.db`) with WAL mode.
- **Files**: `src/mathread/library.py`, `src/mathread/models.py`
- **Preconditions**: SQLite3 module imported.
- **Change**:
  - Implement `_get_db(root)` creating `library.db` with WAL mode and `read_history` table schema.
  - Implement database-level migration of existing `library.json` data on db startup, followed by unlinking `library.json`.
  - Rewrite `_load_history`, `_save_history` (removed), `record_read_event`, and `delete_library_entry` to write/read from SQLite.
- **Acceptance criteria**:
  - History is stored in SQLite database.
  - Legacy `library.json` is successfully migrated and deleted.
- **Proof / verification**:
  - Write pytest unit tests in `tests/test_portal.py` verifying database creation, concurrent read updates, and correct data retrieval.
- **Commit boundary**: `feat: migrate read history to SQLite with WAL and json migration`

### Task 2: Robust Folder Scan & Atomic PDF Writes
- **Obligation served**: Prevent partial PDF writes and tolerate provenance-less or corrupt PDFs.
- **Files**: `src/mathread/capture.py`, `src/mathread/library.py`, `src/mathread/models.py`
- **Preconditions**: Task 1 complete.
- **Change**:
  - In `store_pdf`, write bytes to `destination.with_suffix(".tmp")` first, then use `.replace()` (atomic rename) to replace target.
  - In `list_library`, catch errors when parsing PDF metadata.
  - If a PDF opens but lacks provenance: populate `LibraryEntry` with optional/null fields, but mark `invalid=False`.
  - If a PDF fails to open (corrupted): populate `LibraryEntry` with `invalid=True` and `error_message="Error detail"`.
- **Acceptance criteria**:
  - Aborted writes don't leave broken files at final path.
  - Local PDFs without metadata are listed without crashing.
  - Corrupted PDFs are listed as invalid rather than raising exceptions.
- **Proof / verification**:
  - Add pytest test cases dropping a valid-but-unmarked PDF and a corrupted file into library root, checking that listing still works.
- **Commit boundary**: `feat: implement atomic PDF writes and robust scans`

### Task 3: Note Concurrency & Versioning (Backend)
- **Obligation served**: Track note versions and reject stale writes.
- **Files**: `src/mathread/library.py`, `src/mathread/portal.py`, `src/mathread/models.py`
- **Preconditions**: Task 2 complete.
- **Change**:
  - Add `version` (string containing float mtime) to `NoteContent` model.
  - Update `read_note` to return a tuple `(text, version)`. If note does not exist, return `("", "")`.
  - Update `write_note(root, key, text, version, force=False)`. If file exists and `version != current_mtime` (and `force` is False), raise a `HTTPException(409)`.
  - Update portal PUT endpoint to accept `NoteContent` and optional query parameter `force`.
- **Acceptance criteria**:
  - Note GET includes `version` property.
  - Note PUT checks `version` and returns 409 Conflict if stale.
- **Proof / verification**:
  - Write pytest tests simulating concurrent note updates and verifying that stale version tags fail with HTTP 409.
- **Commit boundary**: `feat: backend note optimistic concurrency checks`

### Task 4: UI note conflict handling (Frontend)
- **Obligation served**: Prompt the user to resolve note overwrite conflicts.
- **Files**: `extension/mathread/portal/api.ts`, `extension/reader/reader.js`, `extension/mathread/portal/App.tsx`
- **Preconditions**: Task 3 complete.
- **Change**:
  - Update `LibraryEntry` and `NoteContent` typescript definitions in `portal/api.ts`.
  - Update `getNote` to return `{ text, version }`. Update `putNote(key, text, version, force)` to pass the version string and force parameter.
  - In `reader.js`:
    - Track note version in a local variable.
    - If `putNote` fails with a conflict error (409):
      - Clear autosave timer, set editor state to conflict.
      - Render UI modal/alert offering "Overwrite Disk" or "Load from Disk".
      - "Overwrite" repeats `putNote` with `force=true`.
      - "Load" fetches the latest version, replaces editor content, and resets state.
- **Acceptance criteria**:
  - Frontend prompts user when conflict is detected.
  - Editor content remains intact during conflict resolution.
- **Proof / verification**:
  - E2E Playwright test simulating stale save conflict and user resolving it.
- **Commit boundary**: `feat: frontend note conflict resolution UI`

### Task 5: Collision-Proof Clip Naming
- **Obligation served**: Prevent simultaneous region clip captures from overwriting assets.
- **Files**: `src/mathread/library.py`
- **Preconditions**: None.
- **Change**:
  - In `write_note_image`: implement a `while` loop that checks if target `clip-NN.png` exists, incrementing `NN` until a free filename is found, before writing bytes.
- **Acceptance criteria**:
  - Clip files are never overwritten.
- **Proof / verification**:
  - Pytest test verifying clip index monotone increment when file is already present.
- **Commit boundary**: `fix: implement collision-proof clip writing`

### Task 6: Annotation Escaping & Error Reporting
- **Obligation served**: Escape special characters and surface syntax warnings.
- **Files**: `extension/reader/annotations.ts`, `extension/reader/reader.js`
- **Preconditions**: None.
- **Change**:
  - Implement `escapeHtml` / `unescapeHtml` helpers in `annotations.ts`.
  - Escape attributes in `serializeAnnotation`. Decode attributes when matching `ATTR_RE` in parsing.
  - Create `parseAnnotationsWithErrors` which collects syntax errors (missing close fence, invalid rects/pages) into an array of string messages.
  - In `reader.js`, call `parseAnnotationsWithErrors` and render syntax error warnings in the note status panel.
- **Acceptance criteria**:
  - Annotation text with quotes round-trips.
  - Syntax errors in notes are displayed as warnings.
- **Proof / verification**:
  - Unit tests in `tests/annotations.test.ts` verifying quote escaping, unescaping, and syntax error tracking.
- **Commit boundary**: `feat: add annotation escaping and parsing error UI`

## System-Level Validation
- **Real boundary checks**:
  - Verify full browser-extension build: `just build`.
  - Validate all tests pass locally: `just test`.
- **Regression checks**:
  - Confirm capture flow functions without regressions using the existing test suite.
  - Ensure typescript type checking compiles: `tsc --noEmit`.
