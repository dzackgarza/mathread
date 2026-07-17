/**
 * The notes module (issue #39): note state, autosave, conflict resolution,
 * legacy migration, the half/half editor+preview panel, and the Key Points
 * list — fully standalone. The backend is an injected NoteStore, so the
 * module unit-tests in isolation under a DOM shim with no extension, no
 * browser, and no network.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor } from "../mathread/portal/components/Editor";
import { Preview } from "../mathread/portal/components/Preview";
import {
  type Annotation,
  parseAnnotations,
  removeAnnotation,
  upsertAnnotation,
} from "./annotations";

export interface NoteContent {
  key: string;
  text: string;
  version?: string | undefined;
}

export type NoteSaveResult =
  | { kind: "saved"; note: NoteContent }
  | { kind: "conflict"; message: string }
  | { kind: "unavailable"; message: string };

/** The persistence boundary the module is tested against. */
export interface NoteStore {
  getNote(key: string): Promise<NoteContent>;
  saveNote(key: string, text: string, version: string): Promise<NoteSaveResult>;
  overwriteNote(key: string, text: string): Promise<NoteContent>;
}

export type OverlayDocument = { key: string; sourceUrl: string };

function versionOf(note: NoteContent): string {
  if (note.version === undefined) {
    throw new Error("MathRead note response must declare a version");
  }
  return note.version;
}

type NoteState =
  | { kind: "closed" }
  | { kind: "loading" }
  | {
      kind: "open";
      text: string;
      // The editor is seeded per revision and owns its buffer between
      // revisions; feeding keystroke state back into its value prop would
      // race React's async updates against the CodeMirror document.
      seed: { text: string; revision: number };
      version: string;
      status: "saved" | "saving" | "unsaved" | "conflict" | "error";
      message: string | null;
    };


export type NoteApi = {
  note: NoteState;
  onChange: (text: string) => void;
  applyExternal: (mutate: (text: string) => string) => void;
  resolveFromDisk: () => void;
  overwriteDisk: () => void;
};

export function useNote(
  doc: OverlayDocument | null,
  store: NoteStore,
  options: { autosaveMs: number } = { autosaveMs: 800 },
): NoteApi {
  const { autosaveMs } = options;
  const [note, setNote] = useState<NoteState>({ kind: "closed" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingLegacyKey = useRef<string | null>(null);

  useEffect(() => {
    if (doc === null) {
      return;
    }
    setNote({ kind: "loading" });
    void store.getNote(doc.key).then((loaded: NoteContent) => {
      const migration = migrateLegacyHighlights(doc.key, loaded.text);
      if (migration.kind === "invalid") {
        setNote({
          kind: "open",
          text: loaded.text,
          seed: { text: loaded.text, revision: 1 },
          version: versionOf(loaded),
          status: "saved",
          message:
            "Legacy highlights were not migrated because their saved shape is invalid.",
        });
        return;
      }
      if (migration.kind === "migrated") {
        pendingLegacyKey.current = migration.storageKey;
      }
      const text = migration.kind === "migrated" ? migration.text : loaded.text;
      setNote({
        kind: "open",
        text,
        seed: { text, revision: 1 },
        version: versionOf(loaded),
        status: migration.kind === "migrated" ? "unsaved" : "saved",
        message: null,
      });
    });
  }, [doc]);

  const persist = useCallback(
    (key: string, text: string, version: string) => {
      void store.saveNote(key, text, version).then(
        (result: NoteSaveResult) => {
          setNote((current) => {
            if (current.kind !== "open") {
              return current;
            }
            if (result.kind === "saved") {
              if (pendingLegacyKey.current !== null) {
                localStorage.removeItem(pendingLegacyKey.current);
                pendingLegacyKey.current = null;
              }
              return { ...current, version: versionOf(result.note), status: "saved", message: null };
            }
            if (result.kind === "conflict") {
              return {
                ...current,
                status: "conflict",
                message: result.message ?? "Version mismatch",
              };
            }
            return {
              ...current,
              status: "error",
              message: result.message ?? "Backend unavailable",
            };
          });
        },
      );
    },
    [store],
  );

  const onChange = useCallback(
    (text: string) => {
      if (doc === null) {
        return;
      }
      setNote((current) => {
        if (current.kind !== "open") {
          return current;
        }
        if (saveTimer.current !== null) {
          clearTimeout(saveTimer.current);
        }
        const version = current.version;
        saveTimer.current = setTimeout(() => {
          persist(doc.key, text, version);
        }, autosaveMs);
        return { ...current, text, status: "saving", message: null };
      });
    },
    [doc, persist],
  );

  const resolveFromDisk = useCallback(() => {
    if (doc === null) {
      return;
    }
    void store.getNote(doc.key).then((loaded: NoteContent) => {
      setNote((current) => ({
        kind: "open",
        text: loaded.text,
        seed: {
          text: loaded.text,
          revision: current.kind === "open" ? current.seed.revision + 1 : 1,
        },
        version: versionOf(loaded),
        status: "saved",
        message: null,
      }));
    });
  }, [doc]);

  const overwriteDisk = useCallback(() => {
    setNote((current) => {
      if (current.kind !== "open" || doc === null) {
        return current;
      }
      void store.overwriteNote(doc.key, current.text).then((saved: NoteContent) => {
        setNote((again) =>
          again.kind === "open"
            ? { ...again, version: versionOf(saved), status: "saved", message: null }
            : again,
        );
      });
      return current;
    });
  }, [doc]);

  const applyExternal = useCallback(
    (mutate: (text: string) => string) => {
      if (doc === null) {
        return;
      }
      setNote((current) => {
        if (current.kind !== "open") {
          return current;
        }
        const text = mutate(current.text);
        if (text === current.text) {
          return current;
        }
        if (saveTimer.current !== null) {
          clearTimeout(saveTimer.current);
        }
        const version = current.version;
        saveTimer.current = setTimeout(() => {
          persist(doc.key, text, version);
        }, autosaveMs);
        // External mutations reseed the editor; keystrokes never do.
        return {
          ...current,
          text,
          seed: { text, revision: current.seed.revision + 1 },
          status: "saving",
          message: null,
        };
      });
    },
    [doc, persist],
  );

  return { note, onChange, applyExternal, resolveFromDisk, overwriteDisk };
}

export function NotesPanel({
  doc,
  noteApi,
}: {
  doc: OverlayDocument | null;
  noteApi: NoteApi;
}) {
  const { note, onChange, applyExternal, resolveFromDisk, overwriteDisk } = noteApi;
  // The editor element is memoized per seed revision: keystrokes re-render
  // the panel (status, preview), and a re-rendered controlled CodeMirror can
  // reset its document to the stale value prop mid-typing.
  const seed = note.kind === "open" ? note.seed : null;
  const editorElement = useMemo(
    () =>
      seed === null ? null : (
        <Editor key={seed.revision} value={seed.text} onChange={onChange} />
      ),
    [seed, onChange],
  );
  if (doc === null || note.kind === "loading") {
    return (
      <p data-testid="notes-waiting" className="p-4 text-sm text-zinc-500">
        Waiting for the document…
      </p>
    );
  }
  if (note.kind === "closed") {
    return null;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800/60 px-4 py-1.5 text-xs">
        <span id="notes-path" data-testid="notes-path" className="font-mono text-zinc-500">
          {doc.key.replace(/\.pdf$/, ".md")}
        </span>
        <span id="notes-status" role="status" data-testid="notes-status" className="text-zinc-400">
          {note.status === "saved" && "Saved"}
          {note.status === "saving" && "Saving…"}
          {note.status === "unsaved" && "Unsaved changes"}
          {note.status === "conflict" && "Save failed: conflict"}
          {note.status === "error" && "Save failed: backend unavailable"}
        </span>
      </div>
      {note.message !== null && (
        <div
          id="notes-error"
          data-testid="notes-error"
          className="flex items-center gap-3 border-b border-amber-900/40 bg-amber-950/40 px-4 py-2 text-xs text-amber-200"
        >
          <span>{note.message}</span>
          <button
            type="button"
            className="rounded border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40"
            onClick={resolveFromDisk}
          >
            Load from Disk
          </button>
          <button
            type="button"
            className="rounded border border-amber-700 px-2 py-0.5 hover:bg-amber-900/40"
            onClick={overwriteDisk}
          >
            Overwrite Disk
          </button>
        </div>
      )}
      <KeyPointsList note={note} applyExternal={applyExternal} />
      {/* The half/half split: editor and live preview side by side, always. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-800">
        <div id="ai-editor" className="min-h-0 overflow-hidden" data-testid="notes-editor-pane">
          {editorElement}
        </div>
        <div id="notes-preview" className="min-h-0 overflow-auto" data-testid="notes-preview-pane">
          <Preview markdown={previewMarkdown(note.text)} />
        </div>
      </div>
    </div>
  );
}

type LegacyRect = { xPct: number; yPct: number; wPct: number; hPct: number };
type LegacyAnnotation = {
  id: string;
  pageNumber: number;
  color: string;
  created: string;
  rects: LegacyRect[];
  text: string;
  comment: string;
};

type LegacyMigration =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "migrated"; text: string; storageKey: string };

function migrateLegacyHighlights(key: string, current: string): LegacyMigration {
  const storageKey = `mathread-legacy-highlights:${key}`;
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    return { kind: "none" };
  }
  const parsed = parseLegacyHighlights(raw);
  if (parsed === null) {
    return { kind: "invalid" };
  }
  const migrated = parsed.reduce(
    (text, annotation) => upsertAnnotation(text, annotation),
    current,
  );
  if (migrated === current) {
    return { kind: "none" };
  }
  return { kind: "migrated", text: migrated, storageKey };
}

function parseLegacyHighlights(raw: string): LegacyAnnotation[] | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const annotations: LegacyAnnotation[] = [];
  for (const candidate of value) {
    const annotation = parseLegacyHighlight(candidate);
    if (annotation === null) {
      return null;
    }
    annotations.push(annotation);
  }
  return annotations;
}

function parseLegacyHighlight(value: unknown): LegacyAnnotation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string"
    || typeof candidate.pageNumber !== "number"
    || !Number.isInteger(candidate.pageNumber)
    || candidate.pageNumber < 1
    || typeof candidate.color !== "string"
    || typeof candidate.createdAt !== "string"
    || !Array.isArray(candidate.rects)
    || typeof candidate.text !== "string"
    || typeof candidate.comment !== "string"
  ) {
    return null;
  }
  const created = new Date(candidate.createdAt);
  if (!Number.isFinite(created.getTime())) {
    return null;
  }
  const rects: LegacyRect[] = [];
  for (const legacyRect of candidate.rects) {
    const rect = parseLegacyRect(legacyRect);
    if (rect === null) {
      return null;
    }
    rects.push(rect);
  }
  return {
    id: candidate.id,
    pageNumber: candidate.pageNumber,
    color: candidate.color,
    created: created.toISOString(),
    rects,
    text: candidate.text,
    comment: candidate.comment,
  };
}

function parseLegacyRect(value: unknown): LegacyRect | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { xPct, yPct, wPct, hPct } = value as Record<string, unknown>;
  if (
    typeof xPct !== "number" || !Number.isFinite(xPct)
    || typeof yPct !== "number" || !Number.isFinite(yPct)
    || typeof wPct !== "number" || !Number.isFinite(wPct)
    || typeof hPct !== "number" || !Number.isFinite(hPct)
  ) {
    return null;
  }
  return { xPct, yPct, wPct, hPct };
}

function KeyPointsList({
  note,
  applyExternal,
}: {
  note: Extract<NoteState, { kind: "open" }>;
  applyExternal: (mutate: (text: string) => string) => void;
}) {
  const annotations = safeAnnotations(note.text);
  if (annotations.length === 0) {
    return null;
  }
  return (
    <section
      data-testid="key-points-list"
      className="max-h-48 shrink-0 overflow-auto border-b border-zinc-800/60 px-3 py-2"
    >
      {annotations.map((annotation) => (
        <article
          key={annotation.id}
          data-highlight-id={annotation.id}
          className="mb-2 flex items-start gap-2 text-xs"
        >
          <span
            className="mt-0.5 h-3 w-3 shrink-0 rounded-sm"
            style={{ background: annotation.color }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-zinc-300" title={annotation.text}>
              {annotation.text}
            </p>
            <CommentField annotation={annotation} applyExternal={applyExternal} />
          </div>
          <button
            type="button"
            title="Remove highlight"
            data-testid="highlight-remove"
            className="shrink-0 rounded border border-zinc-800 px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            onClick={() => applyExternal((text) => removeAnnotation(text, annotation.id))}
          >
            ×
          </button>
        </article>
      ))}
    </section>
  );
}

function CommentField({
  annotation,
  applyExternal,
}: {
  annotation: Annotation;
  applyExternal: (mutate: (text: string) => string) => void;
}) {
  const [draft, setDraft] = useState(annotation.comment);
  return (
    <input
      className="highlight-item-comment mt-1 w-full rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-zinc-200 placeholder:text-zinc-600"
      placeholder="Add comment…"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== annotation.comment) {
          applyExternal((text) =>
            upsertAnnotation(text, { ...annotation, comment: draft }),
          );
        }
      }}
    />
  );
}

/**
 * The preview renders annotation divs as readable highlight quotes instead of
 * raw pandoc fence syntax. The sidecar format is untouched; this is a
 * presentation-only transform.
 */
export function previewMarkdown(text: string): string {
  const annotations = safeAnnotations(text);
  let rendered = text;
  for (const annotation of annotations) {
    const block = findAnnotationBlock(rendered, annotation.id);
    if (block === null) {
      continue;
    }
    const comment = annotation.comment.length > 0 ? `\n> — ${annotation.comment}` : "";
    rendered = rendered.replace(
      block,
      `> 🖍 **p.${annotation.pageNumber}** ${annotation.text}${comment}\n`,
    );
  }
  return rendered;
}

function findAnnotationBlock(text: string, id: string): string | null {
  const open = text.indexOf(`::: {.annotation id="${id}"`);
  if (open === -1) {
    return null;
  }
  const close = text.indexOf(":::", text.indexOf("\n", open));
  if (close === -1) {
    return null;
  }
  return text.slice(open, close + ":::".length + 1);
}

function safeAnnotations(text: string): Annotation[] {
  try {
    return parseAnnotations(text);
  } catch {
    return [];
  }
}

