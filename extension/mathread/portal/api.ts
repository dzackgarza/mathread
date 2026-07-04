// Client for the mathread reading-portal backend. Ported into the extension itself (see
// projects/mathread agent-memory plan "in-extension-self-contained-reader-editor"), so
// there is no vite-dev-proxy/nginx /api rewrite to rely on: the backend origin is read
// straight from the extension manifest's host_permissions, same as capture-client.ts.
//
// Types mirror the Pydantic models in mathread's src/mathread/models.py by hand - there is
// no schema codegen, so new backend fields must be added here too.

import { backendOriginFromManifest } from '../capture-client';

declare const chrome: {
  runtime: {
    getManifest(): { host_permissions?: string[] };
  };
};

const API_BASE = backendOriginFromManifest(chrome.runtime.getManifest());

export interface LibraryEntry {
  key: string;
  stored_path: string;
  pdf_url: string;
  source_url: string;
  capture: 'capture-url' | 'capture-bytes';
  original_sha256: string;
  title: string;
  has_note: boolean;
  first_read: string; // ISO 8601
  last_read: string; // ISO 8601
  last_position: number; // scroll fraction 0..1, 0 = first page
}

async function ok(response: Response): Promise<Response> {
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${response.url}`);
  }
  return response;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLibraryEntry(value: unknown): LibraryEntry {
  invariant(isRecord(value), 'MathRead library entry must be an object');
  invariant(typeof value.key === 'string', 'MathRead library entry must declare key');
  invariant(typeof value.stored_path === 'string', 'MathRead library entry must declare stored_path');
  invariant(typeof value.pdf_url === 'string', 'MathRead library entry must declare pdf_url');
  invariant(typeof value.source_url === 'string', 'MathRead library entry must declare source_url');
  const capture = value.capture;
  invariant(capture === 'capture-url' || capture === 'capture-bytes', 'MathRead library entry must declare capture');
  invariant(typeof value.original_sha256 === 'string', 'MathRead library entry must declare original_sha256');
  invariant(typeof value.title === 'string', 'MathRead library entry must declare title');
  invariant(typeof value.has_note === 'boolean', 'MathRead library entry must declare has_note');
  invariant(typeof value.first_read === 'string', 'MathRead library entry must declare first_read');
  invariant(typeof value.last_read === 'string', 'MathRead library entry must declare last_read');
  invariant(typeof value.last_position === 'number', 'MathRead library entry must declare last_position');
  return {
    key: value.key,
    stored_path: value.stored_path,
    pdf_url: value.pdf_url,
    source_url: value.source_url,
    capture,
    original_sha256: value.original_sha256,
    title: value.title,
    has_note: value.has_note,
    first_read: value.first_read,
    last_read: value.last_read,
    last_position: value.last_position,
  };
}

function parseLibrary(value: unknown): LibraryEntry[] {
  invariant(Array.isArray(value), 'MathRead library response must be an array');
  return value.map(parseLibraryEntry);
}

function parseNoteResponse(value: unknown): string {
  invariant(isRecord(value), 'MathRead note response must be an object');
  invariant(typeof value.text === 'string', 'MathRead note response must declare text');
  return value.text;
}

function parseImageUploadResponse(value: unknown): string {
  invariant(isRecord(value), 'MathRead image upload response must be an object');
  invariant(typeof value.relative_path === 'string', 'MathRead image upload response must declare relative_path');
  return value.relative_path;
}

export async function getLibrary(): Promise<LibraryEntry[]> {
  const response = await ok(await fetch(`${API_BASE}/library`));
  return parseLibrary(await response.json());
}

export async function getNote(key: string): Promise<string> {
  const response = await ok(await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}`));
  return parseNoteResponse(await response.json());
}

export async function putNote(key: string, text: string): Promise<void> {
  await ok(
    await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, text }),
    }),
  );
}

/** Upload a captured region PNG; returns its note-relative path (e.g. "foo.assets/clip-01.png"). */
export async function postNoteImage(key: string, png: Blob): Promise<string> {
  const form = new FormData();
  form.append('image', png, 'clip.png');
  const response = await ok(
    await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}/image`, { method: 'POST', body: form }),
  );
  return parseImageUploadResponse(await response.json());
}

/** URL serving an uploaded clip PNG back for note previews. */
export function noteAssetUrl(key: string, filename: string): string {
  return `${API_BASE}/notes/${encodeURIComponent(key)}/assets/${encodeURIComponent(filename)}`;
}

export type BackendHealth =
  | { ok: true; detail: string }
  | { ok: false; detail: string };

/** Cheap reachability + readiness probe against GET /status for the header light. */
export async function backendHealth(): Promise<BackendHealth> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/status`);
  } catch (error) {
    return { ok: false, detail: `MathRead backend unreachable at ${API_BASE}: ${error}` };
  }
  if (!response.ok) {
    return { ok: false, detail: `MathRead backend error: ${response.status} ${response.statusText}` };
  }
  const value: unknown = await response.json();
  invariant(isRecord(value), 'MathRead backend status must be an object');
  invariant(typeof value.ready === 'boolean', 'MathRead backend status must declare ready');
  invariant(typeof value.root === 'string', 'MathRead backend status must declare root');
  return value.ready
    ? { ok: true, detail: `MathRead backend ready - ${API_BASE} -> ${value.root}` }
    : { ok: false, detail: `MathRead backend storage not ready: ${value.root}` };
}

export function pdfUrl(key: string): string {
  return `${API_BASE}/pdf/${encodeURIComponent(key)}`;
}

/** Trash a library item: removes the PDF, its sidecar note, assets, and read-history. */
export async function deleteLibraryEntry(key: string): Promise<void> {
  await ok(await fetch(`${API_BASE}/library/${encodeURIComponent(key)}`, { method: 'DELETE' }));
}

export async function postReadEvent(key: string, position: number): Promise<void> {
  await ok(
    await fetch(`${API_BASE}/read-event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, position }),
    }),
  );
}
