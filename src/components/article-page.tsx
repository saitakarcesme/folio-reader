"use client";

import { memo, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { extractArticlePage, type ArticleBlock } from "@/lib/pdf-text";

interface ArticlePageProps {
  document: PDFDocumentProxy;
  pageNumber: number;
  documentTitle: string;
}

export const ArticlePage = memo(function ArticlePage({ document, pageNumber, documentTitle }: ArticlePageProps) {
  const wrapperRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(pageNumber <= 2);
  const [blocks, setBlocks] = useState<ArticleBlock[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNearViewport(true),
      { rootMargin: "1600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport || blocks) return;
    let disposed = false;
    const extract = async () => {
      setFailed(false);
      try {
        const extracted = await extractArticlePage(document, pageNumber);
        if (!disposed) setBlocks(extracted.blocks);
      } catch (error) {
        console.error(error);
        if (!disposed) setFailed(true);
      }
    };
    void extract();
    return () => { disposed = true; };
  }, [blocks, document, nearViewport, pageNumber, retry]);

  const unavailable = failed || blocks?.length === 0;

  return (
    <section
      ref={wrapperRef}
      id={`pdf-page-${pageNumber}`}
      className={`article-page ${unavailable ? "article-page-unavailable" : ""}`}
      data-page={pageNumber}
      aria-labelledby={`article-page-label-${pageNumber}`}
    >
      {pageNumber === 1 && (
        <header className="article-document-header">
          <span>Reflowed from PDF</span>
          <h1>{documentTitle}</h1>
        </header>
      )}
      <h2 id={`article-page-label-${pageNumber}`} className="visually-hidden">Page {pageNumber}</h2>
      {!blocks && !failed && <div className="article-loading" aria-label={`Preparing page ${pageNumber}`}><span className="spinner" /></div>}
      {failed && <div className="article-unavailable" data-reader-control role="alert"><p>Reading view paused on this page.</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button><span>Or double-tap and choose PDF to view the original page.</span></div>}
      {blocks?.length === 0 && <p className="article-note">No readable text was found on this page. It may contain only an image. Double-tap, then choose PDF to view the original page.</p>}
      {blocks?.map((block, index) => {
        if (block.type === "heading") return <h3 key={index}>{block.text}</h3>;
        if (block.type === "list-item") return <p className="article-list-item" key={index}>{block.text}</p>;
        return <p key={index}>{block.text}</p>;
      })}
      <footer className="article-page-number" aria-hidden="true">{pageNumber}</footer>
    </section>
  );
});
