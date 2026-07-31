import type { PDFDocumentProxy } from "pdfjs-dist";

let configured = false;

async function pdfJs() {
  const pdfModule = await import("pdfjs-dist");
  if (!configured) {
    pdfModule.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
    configured = true;
  }
  return pdfModule;
}

export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const pdfModule = await pdfJs();
  const data = await blob.arrayBuffer();
  return pdfModule.getDocument({ data }).promise;
}

export async function createPdfCover(document: PDFDocumentProxy) {
  const page = await document.getPage(1);
  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min(1.5, 360 / unscaled.width);
  const viewport = page.getViewport({ scale });
  const canvas = window.document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("Cover generation failed"))),
      "image/webp",
      0.84,
    );
  });
  page.cleanup();
  return blob;
}
