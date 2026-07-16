# MathRead Data Integrity Remediation Plan

> Tier: implementation-adjacent Parent plan: `projects/mathread/plans/index` Externalized fit: GitHub tree root + parent issue #2

## Purpose / Observable Result

- **What someone can do or verify after this work**:

  - Save notes without fear of losing edits due to concurrent writes or stale reader tabs (detected via conflict UI).

  - Open and read local PDFs dropped into the library directory without provenance, and see corrupted/broken PDFs flagged instead of crashing the app.

  - Log read history events transactionally and concurrently without losing data or corrupting JSON files.

  - Browse region clips for a paper in a dedicated `clips/<paper_key>/` subtree without having to parse the `.md` note file.

  - Capture clips concurrently without filename collisions or asset overwrites.

  - Highlight text containing special characters or quotes without breaking note file syntax.

  - View detailed, repairable warning messages (including exact line numbers and source context) when note file annotations are malformed.

- **Why the current state is insufficient**:

  - Autosaves blindly overwrite notes, leading to data loss if the file is edited elsewhere.

  - `library.json` read history uses non-atomic read-modify-write.

  - Folder-based scanning crashes on broken PDFs or missing provenance.

  - Clips are co-located in a single folder without separation by paper key, preventing independent browsing.

  - Clip indexes are calculated from static glob scans, allowing collisions.

  - Annotation attributes are interpolated unescaped, corrupting Markdown when they contain quotes.

  - Malformed annotation blocks are swallowed or trigger generic warnings without repairable context.

- **Observable completion condition**:

  - Complete python and bun test suites passing.

  - E2E tests proving note stale conflict prompts, atomic PDF writes, SQLite read state transactions, paper-keyed clip subtrees with browseability tests, and detailed annotation warning UI (with line/context details).

## Scope

- **Included**:

  - Migration of read history to SQLite database (`library.db`).

  - Stale overwrite protection via strong opaque version tags (`mtime_ns + size`) and returning updated tags after writes.

  - HTML-entity escaping/unescaping in Pandoc annotation fenced-div serializers.

  - Paper-identity keyed clip subtrees (`clips/<paper_key>/`) with monotone incrementing indexes and existence checking.

  - Atomic PDF writes using temporary files and directory scanning robustness.

  - Structured parse warning reporting for malformed annotations, returning line number, column, and context snippet.

- **Excluded**:

  - Migrating notes/annotations into a database (clarified target is keeping notes in markdown).

  - Third-party library upgrades or PDF.js bundle replacements.

- **Preserved behavior**:

  - Co-located `.md` note files in the library root.

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

- **Obligation served**: Track note versions and reject stale writes using strong opaque tokens.

- **Files**: `src/mathread/library.py`, `src/mathread/portal.py`, `src/mathread/models.py`

- **Preconditions**: Task 2 complete.

- **Change**:

  - Define note version as a strong opaque token composed of `mtime_ns + size`.

  - Update `NoteContent` model to include a `version` string field.

  - Update `read_note` to return a tuple `(text, version)`. If the note file does not exist, return `("", "")`.

  - Update `write_note(root, key, text, version, force=False)`. If the file exists and `version` does not match the file's current version token (and `force` is False), raise a `HTTPException(409)`.

  - On a successful write, compute the new strong version token and return it in the PUT response.

  - Update portal PUT endpoint to accept `NoteContent` (including `version`) and optional `force` query parameter, returning the new version tag.

- **Acceptance criteria**:

  - Note GET returns the opaque `version` token.

  - Note PUT validates the provided `version` token and returns `HTTP 409 Conflict` if stale.

  - Note PUT response includes the updated `version` token upon success.

- **Proof / verification**:

  - Write pytest tests simulating concurrent note updates and verifying that stale version tags fail with HTTP 409, and that successful writes return the new version tag.

- **Commit boundary**: `feat: backend note optimistic concurrency checks`

### Task 4: UI note conflict handling (Frontend)

- **Obligation served**: Prompt the user to resolve note overwrite conflicts and track strong versions.

- **Files**: `extension/mathread/portal/api.ts`, `extension/reader/reader.js`, `extension/mathread/portal/App.tsx`

- **Preconditions**: Task 3 complete.

- **Change**:

  - Update `NoteContent` TypeScript definitions in `portal/api.ts` to expect the opaque `version` tag.

  - Update `getNote` to return `{ text, version }`. Update `putNote(key, text, version, force)` to return `{ version }` containing the new token upon success.

  - In `reader.js`:

    - Track the current note version token in a local state variable, updating it with the value returned from `getNote` and after every successful `putNote`.

    - If `putNote` fails with `409`:

      - Clear the autosave timer and block editing.

      - Render a UI modal/alert offering "Overwrite Disk" or "Load from Disk".

      - "Overwrite" repeats `putNote` with `force=true` (and the current version token), then saves the new version token returned from the server.

      - "Load" fetches the latest content and version token, replaces the editor content, and updates the local version token.

- **Acceptance criteria**:

  - Frontend prompts user when conflict is detected.

  - Editor content remains intact during conflict.

  - Successful writes update the client-side version tag with the server's new token.

- **Proof / verification**:

  - E2E Playwright test simulating stale save conflict, user resolving it via overwrite/reload, and subsequent saves functioning correctly with the updated token.

- **Commit boundary**: `feat: frontend note conflict resolution UI`

### Task 5: Paper-Keyed Clip Subtree & Naming

- **Obligation served**: Store clips in a paper-keyed subtree so they can be browsed independently, and prevent naming collisions under concurrent writes.

- **Files**: `src/mathread/library.py`

- **Preconditions**: None.

- **Change**:

  - Establish a path policy where note image clips are stored in a subdirectory keyed by the paper's library key: `<library_root>/clips/<paper_key>/clip-NN.png`.

  - Sanitize and validate `paper_key` to ensure it is a single path component, rejecting any key containing path traversal components (e.g., `..`, `/`, `\`).

  - In `write_note_image(root, key, image_bytes)`:

    - Locate or create the directory `clips/<paper_key>/` under the library root.

    - Implement a loop starting at `NN = 1` attempting to write the file to `clips/<paper_key>/clip-NN.png` using exclusive file creation (`O_CREAT | O_EXCL` via Python's `"xb"` mode).

    - If a `FileExistsError` is raised, increment `NN` and retry the exclusive write until it succeeds.

    - Return the relative asset path `clips/<paper_key>/clip-NN.png`.

- **Acceptance criteria**:

  - Clips live in a dedicated, traversal-safe `clips/<paper_key>/` directory.

  - Users can browse the clips for a specific paper without parsing the markdown note file.

  - Clip files are never overwritten; simultaneous writes use monotone incrementing index names with retry-on-conflict semantics.

- **Proof / verification**:

  - Add pytest test verifying that clips are created in `clips/<paper_key>/` and that subsequent clips increment the index when files are already present.

  - Add a concurrency test showing that simultaneous writes to the same key successfully write all clips without collision.

  - Add browseability acceptance tests that verify directory listing of the subtree shows all clips.

- **Commit boundary**: `feat: implement paper-keyed clip subtrees and collision-proof naming`

### Task 6: Annotation Escaping & Detailed Error Reporting

- **Obligation served**: Escape special characters and surface detailed, repairable syntax warnings.

- **Files**: `extension/reader/annotations.ts`, `extension/reader/reader.js`

- **Preconditions**: None.

- **Change**:

  - Implement `escapeHtml` / `unescapeHtml` helpers in `annotations.ts`.

  - Escape attributes in `serializeAnnotation`. Decode attributes when matching `ATTR_RE` in parsing.

  - Re-implement `parseAnnotationsWithErrors` to parse the note file and collect detailed syntax errors.
    Each error object must contain:

    - `message`: description of the syntax error

    - `line`: 1-based line number in the note file where the malformed block begins

    - `column`: column number if available

    - `context`: 3-line snippet of source context containing the malformed block (so the user has enough detail to locate and repair it).

  - In `reader.js`, render these detailed syntax errors in the note status panel with clear source line references and code-block context hints.

- **Acceptance criteria**:

  - Annotation text with quotes round-trips successfully.

  - Syntax errors in notes display the exact line number, column, and context snippet for user-friendly repair.

- **Proof / verification**:

  - Unit tests in `tests/annotations.test.ts` verifying quote escaping, unescaping, and error tracking with exact line and context assertions.

- **Commit boundary**: `feat: add annotation escaping and parsing error UI`

## System-Level Validation

- **Real boundary checks (incorporating all Issue #2 targets)**:

  - Verify full browser-extension build: `just build`.

  - Validate all tests pass locally: `just test` (proving SQLite, atomic writes, stale conflicts, clip subtrees, and annotation warnings).

  - Run the new E2E tests specifically targeting:

    1. Note write optimistic concurrency checks (HTTP 409, Overwrite/Reload UI).

    2. Atomic PDF writes and robust scanning.

    3. Creation and listing of paper-keyed clip subdirs under `clips/<paper_key>/`.

    4. Detailed malformed annotation parser error messages containing line and context snippets.

- **Regression checks**:

  - Confirm capture flow functions without regressions using the existing test suite.

  - Ensure typescript type checking compiles: `tsc --noEmit`.
