/**
 * Click-outside dismissal for the overlay panel (notes editor / library slider).
 * Runs under the DOM shim — no Chromium. Mounts with a null document so no
 * backend is touched; the panel chrome (the aside) is what we assert on.
 */
import "./support/register-dom";
import "./support/register-chrome";

import { afterEach, expect, test } from "bun:test";
import { act, waitFor } from "@testing-library/react";
import { mountOverlay } from "../extension/reader/overlay";

afterEach(() => {
  document.body.innerHTML = "";
});

function mountWithTab(initialTab: "notes" | "library"): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    mountOverlay(host, { initialTab });
  });
  return host;
}

test("pointer-down outside the open panel closes it", async () => {
  const host = mountWithTab("notes");
  await waitFor(() => {
    expect(host.querySelector('[data-testid="overlay-sidebar"]')).not.toBeNull();
  });

  const outside = document.createElement("div");
  document.body.appendChild(outside);
  act(() => {
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });

  await waitFor(() => {
    expect(host.querySelector('[data-testid="overlay-sidebar"]')).toBeNull();
  });
});

test("pointer-down inside the panel leaves it open", async () => {
  const host = mountWithTab("notes");
  const sidebar = await waitFor(() => {
    const el = host.querySelector('[data-testid="overlay-sidebar"]');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });

  act(() => {
    sidebar.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(host.querySelector('[data-testid="overlay-sidebar"]')).not.toBeNull();
});

test("pointer-down on the tab rail leaves the panel open", async () => {
  const host = mountWithTab("notes");
  const nav = await waitFor(() => {
    const el = host.querySelector("nav");
    expect(el).not.toBeNull();
    return el as HTMLElement;
  });

  act(() => {
    nav.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(host.querySelector('[data-testid="overlay-sidebar"]')).not.toBeNull();
});
