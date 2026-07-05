import type { ExtensionLocalStorage } from "./capture-client";

export type MathReadSettings = {
  autoCapturePdfs: boolean;
  autosaveMs: number;
  fitWidthOnOpen: boolean;
  lineNumbers: boolean;
};

export const settingsStorageKey = "mathread.settings";

export const settingsDefaults: MathReadSettings = {
  autoCapturePdfs: true,
  autosaveMs: 800,
  fitWidthOnOpen: false,
  lineNumbers: true,
};

export async function loadMathReadSettings(storage: ExtensionLocalStorage): Promise<MathReadSettings> {
  const stored = await storage.get([settingsStorageKey]);
  return parseMathReadSettings(stored[settingsStorageKey]);
}

export function parseMathReadSettings(value: unknown): MathReadSettings {
  if (value === undefined) {
    return { ...settingsDefaults };
  }
  invariant(isRecord(value), "MathRead settings must be an object");
  const settings = {
    autoCapturePdfs: optionalBooleanField(value, "autoCapturePdfs", settingsDefaults.autoCapturePdfs),
    autosaveMs: optionalNumberField(value, "autosaveMs", settingsDefaults.autosaveMs),
    fitWidthOnOpen: optionalBooleanField(value, "fitWidthOnOpen", settingsDefaults.fitWidthOnOpen),
    lineNumbers: optionalBooleanField(value, "lineNumbers", settingsDefaults.lineNumbers),
  };
  invariant(
    settings.autosaveMs >= 200 && settings.autosaveMs <= 10_000,
    "MathRead settings autosaveMs must be between 200 and 10000",
  );
  return settings;
}

function optionalBooleanField(
  value: Record<string, unknown>,
  field: keyof MathReadSettings,
  defaultValue: boolean,
): boolean {
  const candidate = value[field];
  if (candidate === undefined) {
    return defaultValue;
  }
  invariant(typeof candidate === "boolean", `MathRead settings ${field} must be a boolean`);
  return candidate;
}

function optionalNumberField(
  value: Record<string, unknown>,
  field: keyof MathReadSettings,
  defaultValue: number,
): number {
  const candidate = value[field];
  if (candidate === undefined) {
    return defaultValue;
  }
  invariant(typeof candidate === "number" && Number.isFinite(candidate), `MathRead settings ${field} must be a number`);
  return candidate;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
