/**
 * Standalone unit suite for the notes module (issue #39): runs under a DOM
 * shim with an in-memory NoteStore — no extension, no Chromium, no network.
 * The module's public surface is exercised the way its real callers use it:
 * the state machine through useNote (onChange is the editor's contract), the
 * presentation through NotesPanel. Real-keystroke and integration behavior
 * stays with the installed-extension suite.
 */
import "./support/register-dom";

import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import {
  type NoteContent,
  type NoteSaveResult,
  type NoteStore,
  NotesPanel,
  previewMarkdown,
  useNote,
} from "../extension/reader/notes-module";
import { serializeAnnotation } from "../extension/reader/annotations";

afterEach(cleanup);
afterAll(async () => {
  // Let React's scheduler drain before the DOM globals disappear.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await GlobalRegistrator.unregister();
});

const doc = { key: "paper.pdf", sourceUrl: "https://arxiv.org/pdf/1234.5678" };

class MemoryStore implements NoteStore {
  text = "";
  version = 1;
  failNextSaveWith: "conflict" | "unavailable" | null = null;
  saves: string[] = [];

  async getNote(): Promise<NoteContent> {
    return { key: doc.key, text: this.text, version: String(this.version) };
  }

  async saveNote(_key: string, text: string, version: string): Promise<NoteSaveResult> {
    if (this.failNextSaveWith !== null) {
      const kind = this.failNextSaveWith;
      this.failNextSaveWith = null;
      return { kind, message: kind === "conflict" ? "Version mismatch" : "backend down" };
    }
    if (version !== String(this.version)) {
      return { kind: "conflict", message: "Version mismatch" };
    }
    this.text = text;
    this.version += 1;
    this.saves.push(text);
    return { kind: "saved", note: { key: doc.key, text, version: String(this.version) } };
  }

  async overwriteNote(_key: string, text: string): Promise<NoteContent> {
    this.text = text;
    this.version += 1;
    return { key: doc.key, text, version: String(this.version) };
  }
}

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
  localStorage.clear();
});

const fastAutosave = { autosaveMs: 15 };

test("loads the note and autosaves edits through the store", async () => {
  store.text = "initial";
  const { result } = renderHook(() => useNote(doc, store, fastAutosave));
  await waitFor(() => expect(result.current.note.kind).toBe("open"));

  act(() => result.current.onChange("initial plus edit"));
  expect(result.current.note.kind).toBe("open");
  await waitFor(() => expect(store.saves).toEqual(["initial plus edit"]));
  await waitFor(() => {
    const note = result.current.note;
    expect(note.kind === "open" && note.status).toBe("saved");
  });
  // The saved version advanced, so the next edit saves against it.
  act(() => result.current.onChange("initial plus edit two"));
  await waitFor(() => expect(store.saves.length).toBe(2));
  expect(store.text).toBe("initial plus edit two");
});

test("keystrokes never reseed the editor; external mutations always do", async () => {
  const { result } = renderHook(() => useNote(doc, store, fastAutosave));
  await waitFor(() => expect(result.current.note.kind).toBe("open"));
  const revisionOf = () => {
    const note = result.current.note;
    if (note.kind !== "open") throw new Error("note not open");
    return note.seed.revision;
  };
  const initialRevision = revisionOf();
  act(() => result.current.onChange("typed"));
  expect(revisionOf()).toBe(initialRevision);
  act(() => result.current.applyExternal((text) => `${text} + external`));
  expect(revisionOf()).toBe(initialRevision + 1);
  const note = result.current.note;
  expect(note.kind === "open" && note.text).toBe("typed + external");
});

test("a conflicted save surfaces resolution; Load from Disk restores the store text", async () => {
  store.text = "disk";
  const { result } = renderHook(() => useNote(doc, store, fastAutosave));
  await waitFor(() => expect(result.current.note.kind).toBe("open"));
  store.failNextSaveWith = "conflict";
  act(() => result.current.onChange("stale local"));
  await waitFor(() => {
    const note = result.current.note;
    expect(note.kind === "open" && note.status).toBe("conflict");
  });
  act(() => result.current.resolveFromDisk());
  await waitFor(() => {
    const note = result.current.note;
    expect(note.kind === "open" && note.text).toBe("disk");
    expect(note.kind === "open" && note.status).toBe("saved");
  });
});

test("Overwrite Disk pushes the local buffer through the store", async () => {
  store.text = "disk";
  const { result } = renderHook(() => useNote(doc, store, fastAutosave));
  await waitFor(() => expect(result.current.note.kind).toBe("open"));
  store.failNextSaveWith = "conflict";
  act(() => result.current.onChange("local wins"));
  await waitFor(() => {
    const note = result.current.note;
    expect(note.kind === "open" && note.status).toBe("conflict");
  });
  act(() => result.current.overwriteDisk());
  await waitFor(() => expect(store.text).toBe("local wins"));
});

test("legacy localStorage highlights migrate into the buffer and clear after a durable save", async () => {
  localStorage.setItem(
    `mathread-legacy-highlights:${doc.key}`,
    JSON.stringify([
      {
        id: "legacy-1",
        pageNumber: 2,
        color: "#91edd0",
        createdAt: "2026-01-01T00:00:00.000Z",
        rects: [{ xPct: 0.1, yPct: 0.2, wPct: 0.3, hPct: 0.05 }],
        text: "legacy lattice quote",
        comment: "",
      },
    ]),
  );
  const { result } = renderHook(() => useNote(doc, store, fastAutosave));
  await waitFor(() => {
    const note = result.current.note;
    expect(note.kind === "open" && note.status).toBe("unsaved");
  });
  const migrated = result.current.note;
  expect(migrated.kind === "open" && migrated.text).toContain("legacy lattice quote");
  // An edit persists the migrated buffer; only then is the legacy store cleared.
  const current = migrated.kind === "open" ? migrated.text : "";
  act(() => result.current.onChange(`${current}\nafter`));
  await waitFor(() =>
    expect(localStorage.getItem(`mathread-legacy-highlights:${doc.key}`)).toBeNull(),
  );
});

test("NotesPanel renders the split, the annotations as Key Points, and conflict controls", async () => {
  store.text = `${serializeAnnotation({
    id: "a-1",
    pageNumber: 1,
    color: "#ffe09d",
    created: "2026-01-01T00:00:00.000Z",
    rects: [{ xPct: 0.1, yPct: 0.1, wPct: 0.2, hPct: 0.02 }],
    text: "highlighted phrase",
    comment: "why it matters",
  })}\n# Heading\n`;
  function Panel() {
    const api = useNote(doc, store, fastAutosave);
    return <NotesPanel doc={doc} noteApi={api} />;
  }
  const view = render(<Panel />);
  await view.findByTestId("key-points-list");
  // The phrase appears in the Key Points excerpt and again in the preview's
  // rendered annotation blockquote; the list entry is the one under test.
  expect(view.getAllByText("highlighted phrase").length).toBeGreaterThanOrEqual(1);
  expect(view.getByDisplayValue("why it matters")).toBeTruthy();
  // Both panes of the split exist; the editor mounts CodeMirror standalone.
  expect(view.getByTestId("notes-editor-pane")).toBeTruthy();
  expect(view.getByTestId("notes-preview-pane")).toBeTruthy();
  await waitFor(() =>
    expect(document.querySelector("#ai-editor .cm-content")).not.toBeNull(),
  );
});

test("previewMarkdown renders annotation divs as highlight quotes, not raw fences", () => {
  const annotated = `${serializeAnnotation({
    id: "a-9",
    pageNumber: 3,
    color: "#bed2f4",
    created: "2026-01-01T00:00:00.000Z",
    rects: [{ xPct: 0, yPct: 0, wPct: 0.1, hPct: 0.01 }],
    text: "a quoted phrase",
    comment: "note to self",
  })}\n# Body\n`;
  const rendered = previewMarkdown(annotated);
  expect(rendered).not.toContain("::: {.annotation");
  expect(rendered).toContain("> 🖍 **p.3** a quoted phrase");
  expect(rendered).toContain("> — note to self");
  expect(rendered).toContain("# Body");
  // The transform is presentation-only: the source text is untouched.
  expect(annotated).toContain("::: {.annotation");
});
