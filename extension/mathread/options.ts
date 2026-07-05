// Extension options page: backend health surface + reader settings persisted to
// chrome.storage.local under "mathread.settings" (read by reader.js at boot).
import { backendHealth, getBackendStatus, openLibraryRoot } from "./portal/api";
import { backendOriginFromManifest } from "./capture-client";
import {
  type MathReadSettings,
  loadMathReadSettings,
  settingsStorageKey,
} from "./settings";

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
const libraryRoot = element<HTMLSpanElement>("library-root");
const libraryInbox = element<HTMLSpanElement>("library-inbox");
const openLibraryRootButton = element<HTMLButtonElement>("open-library-root");
const openLibraryRootStatus = element<HTMLSpanElement>("open-library-root-status");
const autoCapturePdfsInput = element<HTMLInputElement>("auto-capture-pdfs");
const fitWidthInput = element<HTMLInputElement>("fit-width-on-open");
const lineNumbersInput = element<HTMLInputElement>("line-numbers");
const autosaveInput = element<HTMLInputElement>("autosave-ms");
const saveButton = element<HTMLButtonElement>("save");
const saveStatus = element<HTMLSpanElement>("save-status");

async function refreshBackendStatus(): Promise<void> {
  backendDot.classList.remove("ok", "down");
  backendSummary.textContent = "Checking…";
  libraryRoot.textContent = "Checking…";
  libraryInbox.textContent = "Checking…";
  openLibraryRootButton.disabled = true;
  const origin = backendOriginFromManifest(chrome.runtime.getManifest());
  const health = await backendHealth();
  backendDot.classList.add(health.ok ? "ok" : "down");
  backendSummary.textContent = health.ok ? `Ready at ${origin}` : `Unavailable at ${origin}`;
  if (!health.ok) {
    backendDetail.textContent = `${health.detail}\nStart it with: just serve (in the mathread repo)`;
    libraryRoot.textContent = "Unavailable";
    libraryInbox.textContent = "Unavailable";
    return;
  }
  const status = await getBackendStatus();
  backendDetail.textContent = [
    health.detail,
    `Service: ${status.service.name} ${status.service.version}`,
    `Storage ready: ${status.ready ? "yes" : "no"}`,
  ].join("\n");
  libraryRoot.textContent = status.root;
  libraryInbox.textContent = status.inbox;
  openLibraryRootButton.disabled = !status.capabilities.open_root;
}

async function loadSettings(): Promise<void> {
  const settings = await loadMathReadSettings(chrome.storage.local);
  autoCapturePdfsInput.checked = settings.autoCapturePdfs;
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
  const settings: MathReadSettings = {
    autoCapturePdfs: autoCapturePdfsInput.checked,
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
openLibraryRootButton.addEventListener("click", () => {
  openLibraryRootButton.disabled = true;
  openLibraryRootStatus.style.color = "#e6e6e6";
  openLibraryRootStatus.textContent = "Opening…";
  void openLibraryRoot()
    .then(() => {
      openLibraryRootStatus.style.color = "#34a853";
      openLibraryRootStatus.textContent = "Opened";
    })
    .catch(error => {
      openLibraryRootStatus.style.color = "#ea4335";
      openLibraryRootStatus.textContent = `Open failed: ${error}`;
    })
    .finally(() => {
      void refreshBackendStatus();
    });
});
saveButton.addEventListener("click", () => {
  void saveSettings();
});

void refreshBackendStatus();
void loadSettings();
