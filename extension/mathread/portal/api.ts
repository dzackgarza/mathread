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
  pdf_url?: string | undefined;
  source_url?: string | undefined;
  capture?: 'capture-url' | 'capture-bytes' | undefined;
  original_sha256?: string | undefined;
  title: string;
  has_note: boolean;
  first_read: string; // ISO 8601
  last_read: string; // ISO 8601
  last_position: number; // scroll fraction 0..1, 0 = first page
  invalid?: boolean | undefined;
  error_message?: string | undefined;
}

export interface NoteContent {
  key: string;
  text: string;
  version?: string | undefined;
}

export interface BackendStatus {
  backend_url: string;
  portal_url: string;
  root: string;
  service: {
    name: string;
    version: string;
  };
  storage: {
    root_exists: boolean;
    root_writable: boolean;
  };
  capabilities: {
    capture: boolean;
    open_file: boolean;
    reveal_file: boolean;
    open_root: boolean;
  };
  ready: boolean;
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

function nullableStringField(value: Record<string, unknown>, field: string, context: string): string | undefined {
  const candidate = value[field];
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  invariant(typeof candidate === 'string', `${context} ${field} must be a string`);
  return candidate;
}

function nullableBooleanField(value: Record<string, unknown>, field: string, context: string): boolean | undefined {
  const candidate = value[field];
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  invariant(typeof candidate === 'boolean', `${context} ${field} must be a boolean`);
  return candidate;
}

function nullableCaptureMode(value: Record<string, unknown>): LibraryEntry['capture'] {
  const candidate = value.capture;
  if (candidate === undefined || candidate === null) {
    return undefined;
  }
  invariant(candidate === 'capture-url' || candidate === 'capture-bytes', 'MathRead library entry capture mode is invalid');
  return candidate;
}

function parseLibraryEntry(value: unknown): LibraryEntry {
  invariant(isRecord(value), 'MathRead library entry must be an object');
  invariant(typeof value.key === 'string', 'MathRead library entry must declare key');
  invariant(typeof value.stored_path === 'string', 'MathRead library entry must declare stored_path');

  invariant(typeof value.title === 'string', 'MathRead library entry must declare title');
  invariant(typeof value.has_note === 'boolean', 'MathRead library entry must declare has_note');
  invariant(typeof value.first_read === 'string', 'MathRead library entry must declare first_read');
  invariant(typeof value.last_read === 'string', 'MathRead library entry must declare last_read');
  invariant(typeof value.last_position === 'number', 'MathRead library entry must declare last_position');

  return {
    key: value.key,
    stored_path: value.stored_path,
    pdf_url: nullableStringField(value, 'pdf_url', 'MathRead library entry'),
    source_url: nullableStringField(value, 'source_url', 'MathRead library entry'),
    capture: nullableCaptureMode(value),
    original_sha256: nullableStringField(value, 'original_sha256', 'MathRead library entry'),
    title: value.title,
    has_note: value.has_note,
    first_read: value.first_read,
    last_read: value.last_read,
    last_position: value.last_position,
    invalid: nullableBooleanField(value, 'invalid', 'MathRead library entry'),
    error_message: nullableStringField(value, 'error_message', 'MathRead library entry'),
  };
}

function parseLibrary(value: unknown): LibraryEntry[] {
  invariant(Array.isArray(value), 'MathRead library response must be an array');
  return value.map(parseLibraryEntry);
}

function booleanField(value: Record<string, unknown>, field: string, context: string): boolean {
  const candidate = value[field];
  invariant(typeof candidate === 'boolean', `${context} must declare ${field}`);
  return candidate;
}

function stringField(value: Record<string, unknown>, field: string, context: string): string {
  const candidate = value[field];
  invariant(typeof candidate === 'string', `${context} must declare ${field}`);
  return candidate;
}

function parseBackendStatus(value: unknown): BackendStatus {
  invariant(isRecord(value), 'MathRead backend status must be an object');
  const service = value.service;
  invariant(isRecord(service), 'MathRead backend status must declare service');
  const storage = value.storage;
  invariant(isRecord(storage), 'MathRead backend status must declare storage');
  const capabilities = value.capabilities;
  invariant(isRecord(capabilities), 'MathRead backend status must declare capabilities');
  return {
    backend_url: stringField(value, 'backend_url', 'MathRead backend status'),
    portal_url: stringField(value, 'portal_url', 'MathRead backend status'),
    root: stringField(value, 'root', 'MathRead backend status'),
    service: {
      name: stringField(service, 'name', 'MathRead backend service'),
      version: stringField(service, 'version', 'MathRead backend service'),
    },
    storage: {
      root_exists: booleanField(storage, 'root_exists', 'MathRead backend storage'),
      root_writable: booleanField(storage, 'root_writable', 'MathRead backend storage'),
    },
    capabilities: {
      capture: booleanField(capabilities, 'capture', 'MathRead backend capabilities'),
      open_file: booleanField(capabilities, 'open_file', 'MathRead backend capabilities'),
      reveal_file: booleanField(capabilities, 'reveal_file', 'MathRead backend capabilities'),
      open_root: booleanField(capabilities, 'open_root', 'MathRead backend capabilities'),
    },
    ready: booleanField(value, 'ready', 'MathRead backend status'),
  };
}

function parseNoteResponse(value: unknown): NoteContent {
  invariant(isRecord(value), 'MathRead note response must be an object');
  invariant(typeof value.key === 'string', 'MathRead note response must declare key');
  invariant(typeof value.text === 'string', 'MathRead note response must declare text');
  const version = value.version;
  if (version !== undefined && version !== null) {
    invariant(typeof version === 'string', 'MathRead note version must be a string');
  }
  return {
    key: value.key,
    text: value.text,
    version: version ?? undefined,
  };
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

export async function getBackendStatus(): Promise<BackendStatus> {
  const response = await ok(await fetch(`${API_BASE}/status`));
  return parseBackendStatus(await response.json());
}

export async function openLibraryRoot(): Promise<void> {
  await ok(await fetch(`${API_BASE}/library/open-root`, { method: 'POST' }));
}

export async function getNote(key: string): Promise<NoteContent> {
  const response = await ok(await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}`));
  return parseNoteResponse(await response.json());
}

export async function putNote(key: string, text: string, version?: string): Promise<NoteContent> {
  const response = await ok(
    await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, text, version }),
    }),
  );
  return parseNoteResponse(await response.json());
}

export async function overwriteNote(key: string, text: string): Promise<NoteContent> {
  const response = await ok(
    await fetch(`${API_BASE}/notes/${encodeURIComponent(key)}/overwrite`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key, text }),
    }),
  );
  return parseNoteResponse(await response.json());
}

/** Upload a captured region PNG; returns its note-relative path (e.g. "../clips/<paper-key>/clip-01.png"). */
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
  const status = parseBackendStatus(await response.json());
  return status.ready
    ? { ok: true, detail: `MathRead backend ready - ${API_BASE} -> ${status.root}` }
    : { ok: false, detail: `MathRead backend storage not ready: ${status.root}` };
}

export function pdfUrl(key: string): string {
  return `${API_BASE}/pdf/${encodeURIComponent(key)}`;
}

/** Trash a library item: removes the PDF, its note, assets, and read-history. */
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
