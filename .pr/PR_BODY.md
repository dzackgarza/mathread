## Intended result

Implement data integrity protections to remediate all concurrent write, file corruption, and serialization risks identified in Issue #2.

## Scope

- Included:
  - SQLite database migration for read history.
  - Stale note overwrite protection via strong opaque version tags (`mtime_ns + size`).
  - HTML attribute escaping/unescaping for annotations.
  - Paper-keyed clip subtrees (`clips/<paper_key>/`) with collision-proof naming.
  - Atomic PDF writes and robust directory scanning.
  - Visible parser errors for malformed annotations (with line numbers and parse context where available).
- Excluded: Migrating notes/annotations into a database; third-party library upgrades.
- Preserved behavior: Co-located `.md` note files in the library root.

## GitHub tracking

- Target issue set / subtree: #2
- Milestone: None
- Closes on merge:
  - Closes #2
- References only:
  - None

## Implementation plan

1. Migrate read history to SQLite database (`library.db`) with WAL.
2. Implement atomic PDF writes and robust directory scanning.
3. Add note concurrency and strong versioning checks on backend.
4. Implement frontend UI conflict handling (overwrite/reload).
5. Move clips to paper-keyed subtrees with collision-proof naming.
6. Add HTML escaping and detailed syntax warnings for malformed annotations.

## Claim map

- [x] **#2 - Task 1: SQLite Read History Database**
  - Proof obligations claimed: Read history moved to SQLite database `library.db` with WAL mode; json migration completed.
  - Evidence required: Pytest unit tests verifying concurrent database updates and JSON-to-SQLite migration.
  - Current evidence: `tests/test_portal.py` covers database creation, JSON migration, malformed legacy JSON rejection, delete cleanup, and `test_concurrent_read_events_persist_all_key_updates`.

- [x] **#2 - Task 2: Robust Folder Scan & Atomic PDF Writes**
  - Proof obligations claimed: Atomic PDF write-then-replace logic; directory scan handles local and corrupted PDFs.
  - Evidence required: Pytest tests proving corrupted and provenance-less PDFs are listed gracefully.
  - Current evidence: `tests/test_portal.py` covers atomic PDF writes, provenance-less local PDFs, and corrupted PDF listing; `tests/extension-boundary.test.ts` covers opening provenance-less local PDFs from the backend copy.

- [x] **#2 - Task 3: Note Concurrency & Versioning (Backend)**
  - Proof obligations claimed: Note versioning with strong opaque tokens (`mtime_ns + size`); backend checks version and returns HTTP 409 on mismatch.
  - Evidence required: Pytest unit tests verifying concurrent database updates and conflict detection.
  - Current evidence: `tests/test_portal.py::test_note_optimistic_concurrency_conflict_and_overwrite`.

- [x] **#2 - Task 4: UI Note Conflict Handling (Frontend)**
  - Proof obligations claimed: Tracking and sending version tokens; catching HTTP 409 and displaying reload/overwrite UI in reader.js.
  - Evidence required: Extension bundle build outputs, Playwright e2e/unit tests proving conflict handling logic.
  - Current evidence: `tests/extension-boundary.test.ts::reader Key Points panel blocks stale autosave and resolves disk conflicts` proves disk is not overwritten on stale autosave, then exercises Load from Disk and Overwrite Disk.

- [x] **#2 - Task 5: Paper-Keyed Clip Subtree & Naming**
  - Proof obligations claimed: Clips organized under path-sanitized `clips/<paper_key>/` subdirs (rejecting traversal); concurrent clip writes use exclusive creation (`O_CREAT | O_EXCL`) and retry on conflict.
  - Evidence required: Pytest and E2E tests verifying clip subdirectory creation, index increments, and concurrent write-retry safety.
  - Current evidence: `tests/test_portal.py` covers captured-URL clip trees, provenance-less local clip trees, existing filename increment without overwrite, traversal rejection, cleanup on delete, and concurrent HTTP clip uploads.

- [x] **#2 - Task 6: Annotation Escaping & Detailed Error Reporting**
  - Proof obligations claimed: Escaped attributes in annotations; detailed malformed parser warnings with line/context.
  - Evidence required: Unit tests in `tests/annotations.test.ts` verifying quote round-trips and parser errors.
  - Current evidence: `tests/annotations.test.ts` covers quoted attribute round-trip, strict malformed-block errors, mutation blocking, and unescaped quote syntax errors; `tests/extension-boundary.test.ts` keeps note persistence at the browser/backend boundary.

## Automated gates

- Python QC: `just test` (pytest)
- TypeScript QC: `tsc --noEmit` & `just build`
- Latest local verification: `just test` passed with 31 Python tests, 2 arXiv integration tests, 17 extension-boundary tests, and 21 annotation/shim tests.
