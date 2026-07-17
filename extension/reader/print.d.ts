/** Types for the standalone print module (print.js ships verbatim as JS). */
export interface PrintableApplication {
  initializedPromise: Promise<unknown>;
  pdfDocument: { getData(): Promise<Uint8Array> } | null;
}

export function printDocument(
  application: PrintableApplication,
): Promise<HTMLIFrameElement>;
