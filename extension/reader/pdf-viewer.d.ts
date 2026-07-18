// The PDF.js Chromium viewer surface the reader relies on. The overlay shares
// reader.html's document with the viewer, so it reaches this global directly.
// Relocated from the retired capture-ui when the backend-served-PDF path was
// dropped (the reader always loads PDFs at their source URL).
type MathReadPdfViewerApplication = {
  url: string;
  initializedPromise: Promise<unknown>;
  page: number;
  eventBus?: {
    on(
      eventName: "pagechanging",
      listener: (event: { pageNumber: number }) => void,
    ): void;
    on(eventName: "pagerendered", listener: () => void): void;
    off(eventName: "pagerendered", listener: () => void): void;
  };
  pdfViewer: {
    currentPageNumber: number;
    currentScaleValue: string | null;
  };
};

declare global {
  interface Window {
    PDFViewerApplication?: MathReadPdfViewerApplication;
  }
}

export {};
