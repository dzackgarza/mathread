/**
 * Standalone unit suite for the print module: under a DOM shim with a fake
 * viewer application, the blob-frame mechanics are proven without any real
 * browser or dialog — the frame is created hidden, carries a blob of the
 * document bytes, and prints its own window on load.
 */
import "./support/register-dom";

import { expect, test } from "bun:test";
import { printDocument } from "../extension/reader/print.js";

test("printDocument hands the document bytes to a hidden native blob frame", async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const application = {
    initializedPromise: Promise.resolve(),
    pdfDocument: {
      getData: async () => bytes,
    },
  };
  const frame = (await printDocument(application));
  expect(frame.dataset.testid).toBe("print-frame");
  expect(frame.style.display).toBe("none");
  expect(frame.src.startsWith("blob:")).toBe(true);
  expect(document.body.contains(frame)).toBe(true);

  // The load listener prints the frame's own window — the native pipeline.
  let printed = 0;
  Object.defineProperty(frame, "contentWindow", {
    value: { print: () => { printed += 1; } },
  });
  frame.dispatchEvent(new Event("load"));
  expect(printed).toBe(1);

  // A second print replaces the previous frame instead of accumulating.
  const second = (await printDocument(application));
  expect(document.body.contains(frame)).toBe(false);
  expect(document.body.contains(second)).toBe(true);
});

test("printDocument refuses to run without an open document", async () => {
  const application = {
    initializedPromise: Promise.resolve(),
    pdfDocument: null,
  };
  expect(printDocument(application)).rejects.toThrow("No document is open to print");
});
