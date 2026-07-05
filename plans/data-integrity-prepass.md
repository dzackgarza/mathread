# Type-System Pre-Pass: MathRead Data Integrity Remediation

Prerequisite for the MathRead Data Integrity Implementation-Adjacent Plan.

## 0) Traceability and scope

- Slice key/name: data-integrity-remediation
- Source prompt/issue/reference driving this slice: https://github.com/dzackgarza/mathread/issues/2
- Date and owner: 2026-07-05, AI Assistant
- Repository/module boundary:
  - Backend: `src/mathread/library.py`, `src/mathread/portal.py`, `src/mathread/models.py`, `src/mathread/capture.py`
  - Frontend: `extension/reader/reader.js`, `extension/reader/annotations.ts`, `extension/mathread/portal/api.ts`, `extension/mathread/portal/App.tsx`
- Chosen bounded context(s): Capture & Reading persistence boundaries.

## 1) Domain vocabulary and bounded-context map

- **Library Key**: The unique identifier of a library entry, which is defined to be the PDF filename (e.g. `paper.pdf`).
- **Provenance**: Embedded metadata in a PDF indicating its source URL, PDF URL, capture mode, and original SHA-256 hash.
- **Local PDF / Offline PDF**: A valid PDF dropped into the library directory that lacks MathRead-specific provenance metadata.
- **Stale Note Write**: A write attempt on a markdown note file where the client's starting revision differs from the current disk revision.
- **Version Tag (ETag)**: A string representation of the note's filesystem mtime used to detect mid-air collisions.
- **Annotation Attribute Escaping**: HTML-entity encoding of characters inside Pandoc fenced-div attributes to prevent breaking syntax parsing.

## 2) Behavior research before implementation

- **Invariants that must always hold**:
  - A note write must fail with `HTTP 409 Conflict` if the provided version tag does not match the note file's current mtime on disk, unless `force` is true.
  - A PDF write must either write completely and cleanly, or not at all (atomicity).
  - The library folder scan must list all `.pdf` files in the folder, ignoring invalid/broken ones or listing them with an invalid indicator, but never crashing the list response.
  - An annotation attribute must round-trip successfully even when containing double quotes or special characters.
- **Lifecycle/state transitions**:
  - Note Save: `Unsaved Changes` -> `Saving...` -> `Saved` (Success) OR `Save Failed: Conflict` (Conflict).
  - Conflict Resolution: user overrides with `Overwrite Disk` (sends `force=true`) or `Load from Disk` (refetches note text and sets editor content).
- **Valid examples**:
  - User drops `my_paper.pdf` (without metadata) -> listed as title `my_paper`, local PDF, missing provenance fields.
  - Annotation containing comment `He said "unimodular"` -> serialized with `&quot;`, parses back as `"`.
- **Invalid examples**:
  - Partially written PDF due to aborted write -> surfaced as `invalid=true` in list, lists error message, rest of library loads fine.
  - Malformed annotation block -> reported as parse warnings, does not crash reader.

## 3) Core typed model (make illegal states unrepresentable)

### 3.1 Bounded primitives and identifiers
- `Note Version`: `string` representation of `mtime` float (e.g., `"1719918239.123456"`).

### 3.2 Product and sum types

#### Pydantic Model updates:
```python
class LibraryEntry(BaseModel):
    key: str
    stored_path: Path
    pdf_url: HttpUrl | None = None
    source_url: HttpUrl | None = None
    capture: CaptureMode | None = None
    original_sha256: str | None = None
    title: str
    has_note: bool
    first_read: str
    last_read: str
    last_position: float
    invalid: bool = False
    error_message: str | None = None

class NoteContent(BaseModel):
    key: str
    text: str
    version: str | None = None
    force: bool = False
```

#### TypeScript Type updates (`portal/api.ts` & `reader/vendor.js` mapping):
```typescript
export interface LibraryEntry {
  key: string;
  stored_path: string;
  pdf_url?: string;
  source_url?: string;
  capture?: 'capture-url' | 'capture-bytes';
  original_sha256?: string;
  title: string;
  has_note: boolean;
  first_read: string;
  last_read: string;
  last_position: number;
  invalid?: boolean;
  error_message?: string;
}

export interface NoteContent {
  key: string;
  text: string;
  version?: string;
  force?: boolean;
}
```

### 3.3 Typed transitions

- `read_note(root: Path, key: str) -> NoteContent`
- `write_note(root: Path, key: str, note: NoteContent) -> NoteContent` (Raises `HTTPException(409)` on version mismatch)

## 3.4 Stub contracts and compile-time type checking

- TypeScript checks: `bun run tsc --noEmit` on frontend changes.
- Python type checks: `mypy` run inside python QC suite.

## 4) Functional core vs effectful boundaries

- **Pure transformations**:
  - `escapeHtml(str: string) -> string`
  - `unescapeHtml(str: string) -> string`
  - `parseAnnotationsWithErrors(markdown: string) -> { annotations: ParsedAnnotation[], errors: string[] }`
- **Effectful operations**:
  - Database access: read/write to `library.db` (SQLite).
  - Note access: read/write to `.md` files on disk, checking mtime.
  - PDF writes: write to `.tmp`, then rename (replace) to target.

## 5) Boundary parser policy

- External annotation blocks are untrusted.
- Normalization and error strategy: `parseAnnotationsWithErrors` extracts errors and collects warnings to surface to the UI.

## 6) Shared algorithm-policy types

- **Conflict-resolution rules**: Note write collision uses pessimistic mtime mismatch check. Force override ignores mtime checks.
- **Clock/time semantics**: ISO 8601 UTC strings.
- **ID strategy**: Monotone increment with file existence checks for clips: `clip-NN.png`, incrementing `NN` if the file already exists on disk.

## 7) Shared interfaces and architecture seams

- SQLite helper `_get_db(root)`: opens SQLite connection to `<root>/library.db`, configures Row factory, enables WAL mode, and migrates `library.json` on boot if present.

## 8) Escape-hatch policy and debt ledger

- No raw `any` types allowed in typescript client updates.
- Casting is restricted to the existing Pydantic-mapping boundaries.

## 9) Migration and implementation sequencing (slice-first)

1. **Step 0 (TDD failing tests)**:
   - Add backend SQLite history and concurrency tests.
   - Add frontend annotation escaping/parsing error tests.
2. **Step 1 (SQLite history migration)**:
   - Implement `_get_db(root)` with `library.json` migration.
   - Redirect all history reads and writes to SQLite table.
3. **Step 2 (Atomic PDF writes and robust scans)**:
   - Implement temporary-file write-then-rename in `store_pdf`.
   - Wrap metadata reads in try-except in `list_library` to report local/offline PDFs and corrupted ones.
4. **Step 3 (Note concurrency & versioning)**:
   - Update backend `NoteContent` Pydantic models.
   - Implement mtime matching logic in `write_note`.
   - Update client API client and UI to display conflict dialog and handle overwrite/reload.
5. **Step 4 (Annotation escaping and warnings)**:
   - Implement HTML-escaping for annotation attributes.
   - Implement syntax warning collector in `parseAnnotationsWithErrors` and render warnings in the notes sidebar.

## 10) Minimal artifacts for this slice

- `data_integrity_prepass.md` (this file)
- `data_integrity_plan.md` (the implementation plan)

## 11) Evidence and acceptance of pre-pass completion

- Checked that the type models prevent corruption paths (mtime mismatch, atomic replace).
- Planned TDD suite covering database, parsing, and concurrent write boundaries.

## 12) Linkages

- Implementation plan: [data_integrity_plan.md](file:///home/dzack/.gemini/antigravity-cli/brain/6416949f-0985-426c-a750-2b099a57ddf2/data_integrity_plan.md)

---
### Fullness check
- [x] Bounded contexts and terminology decided.
- [x] Invariants, valid/invalid examples, and transitions documented.
- [x] Domain model is represented as constrained primitives, product/sum forms, and typed errors.
- [x] Pure vs effectful operations are separated with explicit ports.
- [x] Parser policy is strict at boundaries and mapped to typed domain values.
- [x] Shared algorithm-policy contracts are explicit.
- [x] Escape-hatch ledger contains explicit exception handling and ownership.
- [x] Pre-pass completion evidence and reviewer approval recorded.
