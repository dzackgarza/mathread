// Extension options page: backend health surface + reader settings persisted to
// chrome.storage.local under "mathread.settings" (read by poc/reader.js at boot).
import { backendHealth } from "./portal/api";
import { backendOriginFromManifest } from "./capture-client";

declare const chrome: {
  runtime: {
    getManifest(): { host_permissions?: string[] };
  };
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};

export type ReaderSettings = {
  autosaveMs: number;
  fitWidthOnOpen: boolean;
  lineNumbers: boolean;
};

export const settingsStorageKey = "mathread.settings";

const settingsDefaults: ReaderSettings = {
  autosaveMs: 800,
  fitWidthOnOpen: false,
  lineNumbers: true,
};

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`options page is missing #${id}`);
  }
  return found as T;
}

const backendDot = element<HTMLSpanElement>("backend-dot");
const backendSummary = element<HTMLSpanElement>("backend-summary");
const backendDetail = element<HTMLDivElement>("backend-detail");
const fitWidthInput = element<HTMLInputElement>("fit-width-on-open");
const lineNumbersInput = element<HTMLInputElement>("line-numbers");
const autosaveInput = element<HTMLInputElement>("autosave-ms");
const saveButton = element<HTMLButtonElement>("save");
const saveStatus = element<HTMLSpanElement>("save-status");

async function refreshBackendStatus(): Promise<void> {
  backendDot.classList.remove("ok", "down");
  backendSummary.textContent = "Checking…";
  const origin = backendOriginFromManifest(chrome.runtime.getManifest());
  const health = await backendHealth();
  backendDot.classList.add(health.ok ? "ok" : "down");
  backendSummary.textContent = health.ok ? `Ready at ${origin}` : `Unavailable at ${origin}`;
  backendDetail.textContent = health.ok
    ? health.detail
    : `${health.detail}\nStart it with: just serve (in the mathread repo)`;
}

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get([settingsStorageKey]);
  const raw = stored[settingsStorageKey];
  const settings: ReaderSettings = {
    ...settingsDefaults,
    ...(typeof raw === "object" && raw !== null ? (raw as Partial<ReaderSettings>) : {}),
  };
  fitWidthInput.checked = settings.fitWidthOnOpen;
  lineNumbersInput.checked = settings.lineNumbers;
  autosaveInput.value = String(settings.autosaveMs);
}

async function saveSettings(): Promise<void> {
  const autosaveMs = Number(autosaveInput.value);
  if (!Number.isFinite(autosaveMs) || autosaveMs < 200 || autosaveMs > 10_000) {
    saveStatus.textContent = "Autosave delay must be 200–10000 ms";
    saveStatus.style.color = "#ea4335";
    return;
  }
  const settings: ReaderSettings = {
    autosaveMs,
    fitWidthOnOpen: fitWidthInput.checked,
    lineNumbers: lineNumbersInput.checked,
  };
  await chrome.storage.local.set({ [settingsStorageKey]: settings });
  saveStatus.style.color = "#34a853";
  saveStatus.textContent = "Saved";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 2_000);
}

element<HTMLButtonElement>("backend-refresh").addEventListener("click", () => {
  void refreshBackendStatus();
});
saveButton.addEventListener("click", () => {
  void saveSettings();
});

void refreshBackendStatus();
void loadSettings();
