/**
 * Reference print mechanism (Scholar reader): hand the raw PDF bytes to a
 * hidden iframe as a blob URL and print that — the browser's native PDF
 * print pipeline renders near-instantly and prints only the document, never
 * the reader page or its overlays. PDF.js's canvas-rasterizing print service
 * is bypassed entirely. Standalone module: the viewer application is a
 * parameter, so the mechanics unit-test under a DOM shim.
 */

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

let printFrame = null;

export async function printDocument(application) {
  assert(
    application !== null && typeof application === "object",
    "PDF.js application is unavailable for printing",
  );
  await application.initializedPromise;
  const pdfDocument = application.pdfDocument;
  assert(
    pdfDocument !== null && typeof pdfDocument === "object",
    "No document is open to print",
  );
  const data = await pdfDocument.getData();
  if (printFrame !== null) {
    printFrame.remove();
  }
  const blobUrl = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  printFrame = document.createElement("iframe");
  printFrame.style.display = "none";
  printFrame.dataset.testid = "print-frame";
  printFrame.addEventListener(
    "load",
    () => {
      assert(
        printFrame !== null && printFrame.contentWindow !== null,
        "MathRead print frame has no window",
      );
      printFrame.contentWindow.print();
    },
    { once: true },
  );
  printFrame.src = blobUrl;
  document.body.append(printFrame);
  return printFrame;
}
