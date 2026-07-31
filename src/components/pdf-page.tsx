"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { ReaderMode, ReaderTheme } from "@/types/library";

interface PdfPageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  mode: ReaderMode;
  zoom: number;
  brightness: number;
  theme: ReaderTheme;
}

export const PdfPage = memo(function PdfPage({ document, pageNumber, mode, zoom, brightness, theme }: PdfPageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTask = useRef<RenderTask | null>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [ratio, setRatio] = useState(1 / 1.414);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: "1200px 800px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper || !nearViewport) {
      if (!nearViewport && canvas) {
        renderTask.current?.cancel();
        canvas.width = 1;
        canvas.height = 1;
        setRendered(false);
      }
      return;
    }

    let disposed = false;
    const render = async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (disposed) return;
        const base = page.getViewport({ scale: 1 });
        setRatio(base.width / base.height);
        const available = Math.max(260, Math.min(1000, wrapper.clientWidth - (mode === "continuous" ? 24 : 32)));
        const cssWidth = available * zoom;
        const viewport = page.getViewport({ scale: cssWidth / base.width });
        const density = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * density);
        canvas.height = Math.floor(viewport.height * density);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas is unavailable");
        renderTask.current?.cancel();
        renderTask.current = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0],
          background: "#ffffff",
        });
        await renderTask.current.promise;
        if (!disposed) { setRendered(true); setFailed(false); }
        page.cleanup();
      } catch (error) {
        if (!disposed && (error as Error).name !== "RenderingCancelledException") {
          console.error(error);
          setFailed(true);
        }
      }
    };
    void render();

    const observer = new ResizeObserver(() => {
      if (nearViewport) void render();
    });
    observer.observe(wrapper);
    return () => {
      disposed = true;
      observer.disconnect();
      renderTask.current?.cancel();
    };
  }, [document, mode, nearViewport, pageNumber, zoom]);

  return (
    <div
      ref={wrapperRef}
      id={`pdf-page-${pageNumber}`}
      data-page={pageNumber}
      className={`pdf-page-slot ${mode}`}
      style={{ "--page-ratio": ratio } as React.CSSProperties}
      aria-label={`Page ${pageNumber}`}
    >
      <div className={`pdf-paper theme-${theme}`} style={{ filter: `brightness(${brightness})` }}>
        <canvas ref={canvasRef} className={rendered ? "rendered" : ""} />
        {!rendered && !failed && <span className="page-loading" />}
        {failed && <span className="page-error">Page could not be rendered.</span>}
      </div>
    </div>
  );
});
