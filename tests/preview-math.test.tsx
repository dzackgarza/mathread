/**
 * Math rendering in the notes preview (rehype-mathjax over react-markdown).
 * Runs under the DOM shim — no Chromium. Proves the markdown editor typesets
 * mathematics with the shared pandoc macro set, which it previously did not.
 */
import "./support/register-dom";

import { afterEach, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Preview } from "../extension/mathread/portal/components/Preview";

afterEach(cleanup);

// A rendered container's textContent is a string; narrow it once at the
// boundary rather than defaulting a nullable.
function textOf(container: HTMLElement): string {
  const text = container.textContent;
  assert(text !== null, "rendered container has text content");
  return text;
}

test("typesets inline and display math to MathJax SVG, leaving no literal $ source", async () => {
  const { container } = render(
    <Preview markdown={"Inline $x^2 + y^2 = z^2$ and display $$\\int_0^\\infty e^{-x^2}\\,dx$$"} />,
  );
  await waitFor(() => {
    expect(container.querySelectorAll("mjx-container").length).toBeGreaterThanOrEqual(2);
  });
  expect(container.querySelector("mjx-container svg")).not.toBeNull();
  expect(textOf(container)).not.toContain("$");
});

test("resolves the shared pandoc macros (\\CC, \\coloneqq) rather than echoing source", async () => {
  const { container } = render(<Preview markdown={"$\\CC$ and $x \\coloneqq y$"} />);
  await waitFor(() => {
    expect(container.querySelectorAll("mjx-container").length).toBeGreaterThanOrEqual(2);
  });
  const text = textOf(container);
  expect(text).not.toContain("\\CC");
  expect(text).not.toContain("coloneqq");
});

test("remark-math extracts math before emphasis, so underscores are not italicized", async () => {
  const { container } = render(<Preview markdown={"$a_1 x_2 + b_3 y_4$"} />);
  await waitFor(() => {
    expect(container.querySelector("mjx-container")).not.toBeNull();
  });
  expect(container.querySelector("em")).toBeNull();
});
