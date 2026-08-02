"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ArticlePage } from "@/components/article-page";
import { Icon } from "@/components/icons";
import { PdfPage } from "@/components/pdf-page";
import { libraryRepository } from "@/lib/indexeddb-library";
import { openPdf } from "@/lib/pdf";
import { extractArticlePage } from "@/lib/pdf-text";
import type { DocumentMetadata, ReaderMode, ReaderTheme } from "@/types/library";

interface SearchResult { page: number; excerpt: string; }

const themes: { value: ReaderTheme; label: string }[] = [
  { value: "system", label: "Auto" }, { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" }, { value: "dark", label: "Dark" },
];

const modes: { value: ReaderMode; label: string }[] = [
  { value: "article", label: "Article" }, { value: "continuous", label: "PDF" },
  { value: "paged", label: "Paged" },
  { value: "horizontal", label: "Horizontal" },
];

const isVerticalMode = (mode: ReaderMode) => mode === "article" || mode === "continuous";

export function ReaderClient({ id }: { id: string }) {
  const router = useRouter();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [zoom, setZoom] = useState(1);
  const hideTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const restored = useRef(false);
  const searchRun = useRef(0);
  const gesture = useRef({ startX: 0, startY: 0, startedAt: 0, lastTapAt: 0, lastTapX: 0, lastTapY: 0, toggledAt: 0, moved: false, maxPointers: 0, pointers: new Set<number>(), longTimer: 0 });

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setControlsVisible(false); setSettingsOpen(false); setSearchOpen(false);
    }, 4200);
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true); scheduleHide();
  }, [scheduleHide]);

  const toggleControls = useCallback(() => {
    setControlsVisible((visible) => {
      if (!visible) scheduleHide();
      else { setSettingsOpen(false); setSearchOpen(false); }
      return !visible;
    });
  }, [scheduleHide]);

  const triggerGestureControls = useCallback(() => {
    const now = performance.now();
    if (now - gesture.current.toggledAt < 240) return;
    gesture.current.toggledAt = now;
    toggleControls();
  }, [toggleControls]);

  useEffect(() => {
    let disposed = false;
    let loadedPdf: PDFDocumentProxy | null = null;
    const load = async () => {
      try {
        const [storedMetadata, file] = await Promise.all([libraryRepository.getMetadata(id), libraryRepository.getFile(id)]);
        if (!storedMetadata || !file) throw new Error("This document is no longer in your library.");
        loadedPdf = await openPdf(file);
        if (disposed) { await loadedPdf.cleanup(); return; }
        const isLegacyDocument = typeof storedMetadata.articleFontSize !== "number";
        const opened = await libraryRepository.update(id, {
          lastOpenedAt: Date.now(),
          readerMode: isLegacyDocument ? "article" : storedMetadata.readerMode,
          articleFontSize: storedMetadata.articleFontSize ?? 19,
        });
        setMetadata(opened); setPdf(loadedPdf);
      } catch (error) { if (!disposed) setLoadError((error as Error).message || "The PDF could not be opened."); }
      finally { if (!disposed) setLoading(false); }
    };
    void load();
    return () => { disposed = true; if (hideTimer.current) clearTimeout(hideTimer.current); if (saveTimer.current) clearTimeout(saveTimer.current); void loadedPdf?.cleanup(); };
  }, [id]);

  const saveProgress = useCallback((next: DocumentMetadata) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void libraryRepository.update(id, {
        currentPage: next.currentPage, pageOffset: next.pageOffset, progress: next.progress,
        bookmarks: next.bookmarks, readerMode: next.readerMode, readerTheme: next.readerTheme,
        brightness: next.brightness, articleFontSize: next.articleFontSize, updatedAt: Date.now(),
      });
    }, 500);
  }, [id]);

  const updateMetadata = useCallback((updates: Partial<DocumentMetadata>) => {
    setMetadata((current) => {
      if (!current) return current;
      const next = { ...current, ...updates };
      saveProgress(next); return next;
    });
  }, [saveProgress]);

  const jumpToPage = useCallback((page: number, smooth = true) => {
    const viewport = viewportRef.current;
    const target = document.getElementById(`pdf-page-${page}`);
    if (!viewport || !target) return;
    if (metadata?.readerMode === "article" || metadata?.readerMode === "continuous") {
      viewport.scrollTo({ top: target.offsetTop, behavior: smooth ? "smooth" : "instant" });
    } else {
      viewport.scrollTo({ left: target.offsetLeft, behavior: smooth ? "smooth" : "instant" });
    }
    updateMetadata({ currentPage: page, progress: pdf && pdf.numPages > 1 ? (page - 1) / (pdf.numPages - 1) : 0 });
  }, [metadata?.readerMode, pdf, updateMetadata]);

  useEffect(() => {
    if (!pdf || !metadata || restored.current) return;
    restored.current = true;
    const timer = window.setTimeout(() => {
      const viewport = viewportRef.current;
      const target = document.getElementById(`pdf-page-${metadata.currentPage}`);
      if (!viewport || !target) return;
      if (isVerticalMode(metadata.readerMode)) viewport.scrollTop = target.offsetTop + target.clientHeight * metadata.pageOffset;
      else viewport.scrollLeft = target.offsetLeft;
    }, 180);
    return () => window.clearTimeout(timer);
  }, [metadata, pdf]);

  const recordVisiblePage = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport || !pdf || !metadata) return;
    const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest<HTMLElement>("[data-page]");
    let page = center ? Number(center.dataset.page) : metadata.currentPage;
    if (!isVerticalMode(metadata.readerMode)) page = Math.round(viewport.scrollLeft / Math.max(1, viewport.clientWidth)) + 1;
    page = Math.min(pdf.numPages, Math.max(1, page));
    const element = document.getElementById(`pdf-page-${page}`);
    const pageOffset = isVerticalMode(metadata.readerMode) && element ? Math.min(1, Math.max(0, (viewport.scrollTop - element.offsetTop) / element.clientHeight)) : 0;
    const progress = pdf.numPages > 1 ? Math.min(1, Math.max(0, (page - 1 + pageOffset) / (pdf.numPages - 1))) : pageOffset;
    if (page !== metadata.currentPage || Math.abs(pageOffset - metadata.pageOffset) > 0.02) updateMetadata({ currentPage: page, pageOffset, progress });
  }, [metadata, pdf, updateMetadata]);

  const onScroll = () => {
    if (scrollFrame.current) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = requestAnimationFrame(recordVisiblePage);
  };

  useEffect(() => {
    const flush = () => { if (metadata) void libraryRepository.update(id, { currentPage: metadata.currentPage, pageOffset: metadata.pageOffset, progress: metadata.progress, bookmarks: metadata.bookmarks, readerMode: metadata.readerMode, readerTheme: metadata.readerTheme, brightness: metadata.brightness, articleFontSize: metadata.articleFontSize, updatedAt: Date.now() }); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [id, metadata]);

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-reader-control]")) return;
    const state = gesture.current;
    state.pointers.add(event.pointerId); state.maxPointers = Math.max(state.maxPointers, state.pointers.size);
    if (state.pointers.size === 1) {
      state.startX = event.clientX; state.startY = event.clientY; state.startedAt = performance.now(); state.moved = false;
      state.longTimer = window.setTimeout(() => { if (!state.moved && state.pointers.size === 1) { navigator.vibrate?.(10); triggerGestureControls(); } }, 600);
    }
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const state = gesture.current;
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 9) { state.moved = true; clearTimeout(state.longTimer); }
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const state = gesture.current; clearTimeout(state.longTimer); state.pointers.delete(event.pointerId);
    if (state.pointers.size > 0) return;
    const now = performance.now();
    if (event.pointerType === "mouse") {
      state.maxPointers = 0;
      return;
    }
    if (!state.moved && now - state.startedAt < 360) {
      if (state.maxPointers >= 2) triggerGestureControls();
      else if (now - state.lastTapAt < 420 && Math.hypot(event.clientX - state.lastTapX, event.clientY - state.lastTapY) < 48) { triggerGestureControls(); state.lastTapAt = 0; }
      else { state.lastTapAt = now; state.lastTapX = event.clientX; state.lastTapY = event.clientY; }
    }
    state.maxPointers = 0;
  };
  const onPointerCancel = () => {
    const state = gesture.current;
    clearTimeout(state.longTimer);
    state.moved = true;
    state.pointers.clear();
    state.maxPointers = 0;
  };

  const changeMode = (mode: ReaderMode) => {
    updateMetadata({ readerMode: mode, pageOffset: 0 }); setSettingsOpen(false);
    requestAnimationFrame(() => window.setTimeout(() => jumpToPage(metadata?.currentPage ?? 1, false), 30));
  };

  const toggleBookmark = () => {
    if (!metadata) return;
    const bookmarks = metadata.bookmarks.includes(metadata.currentPage) ? metadata.bookmarks.filter((page) => page !== metadata.currentPage) : [...metadata.bookmarks, metadata.currentPage].sort((a, b) => a - b);
    updateMetadata({ bookmarks }); revealControls();
  };

  const runSearch = async (event: React.FormEvent) => {
    event.preventDefault(); if (!pdf || !query.trim()) return;
    const run = ++searchRun.current; setSearching(true); setSearchProgress(0); setSearchResults([]);
    const needle = query.trim().toLocaleLowerCase(); const matches: SearchResult[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const { plainText: text } = await extractArticlePage(pdf, pageNumber);
      const index = text.toLocaleLowerCase().indexOf(needle);
      if (index >= 0) matches.push({ page: pageNumber, excerpt: text.slice(Math.max(0, index - 46), Math.min(text.length, index + needle.length + 72)) });
      if (run !== searchRun.current) return;
      if (pageNumber % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      setSearchProgress(pageNumber / pdf.numPages);
    }
    if (run === searchRun.current) { setSearchResults(matches); setSearching(false); }
  };

  const pageNumbers = useMemo(() => pdf ? Array.from({ length: pdf.numPages }, (_, index) => index + 1) : [], [pdf]);
  const isBookmarked = metadata?.bookmarks.includes(metadata.currentPage) ?? false;

  if (loading) return <main className="reader-state"><span className="spinner" /><p>Opening your book…</p></main>;
  if (loadError || !metadata || !pdf) return <main className="reader-state"><Icon name="file" /><h1>Unable to open PDF</h1><p>{loadError}</p><button className="primary-button" onClick={() => router.replace("/")}>Back to Library</button></main>;

  return (
    <main className={`reader-shell theme-${metadata.readerTheme} ${metadata.readerMode === "article" ? "article-reader" : ""} ${controlsVisible ? "controls-visible" : ""}`}>
      <div ref={viewportRef} className={`reader-viewport mode-${metadata.readerMode}`} onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("[data-reader-control]")) { event.preventDefault(); triggerGestureControls(); } }} onContextMenu={(event) => event.preventDefault()}>
        <div className="page-list" style={{ "--reader-zoom": zoom, "--article-font-size": `${metadata.articleFontSize}px`, filter: metadata.readerMode === "article" ? `brightness(${metadata.brightness})` : undefined } as React.CSSProperties}>
          {metadata.readerMode === "article"
            ? pageNumbers.map((pageNumber) => <ArticlePage key={pageNumber} document={pdf} pageNumber={pageNumber} documentTitle={metadata.name} />)
            : pageNumbers.map((pageNumber) => <PdfPage key={pageNumber} document={pdf} pageNumber={pageNumber} mode={metadata.readerMode} zoom={zoom} brightness={metadata.brightness} theme={metadata.readerTheme} />)}
        </div>
      </div>

      <header className="reader-topbar" data-reader-control aria-hidden={!controlsVisible}>
        <button onClick={() => router.replace("/")} aria-label="Back to Library"><Icon name="arrowLeft" /></button>
        <div className="reader-title"><strong>{metadata.name}</strong><span>Page {metadata.currentPage} of {metadata.pageCount}</span></div>
        <div className="reader-top-actions">
          <button onClick={() => { setSearchOpen((open) => !open); setSettingsOpen(false); revealControls(); }} aria-label="Search document"><Icon name="search" /></button>
          <button onClick={toggleBookmark} aria-label={isBookmarked ? "Remove bookmark" : "Bookmark page"}><Icon name={isBookmarked ? "bookmarkFill" : "bookmark"} /></button>
        </div>
      </header>

      <footer className="reader-bottombar" data-reader-control aria-hidden={!controlsVisible} onPointerDown={revealControls}>
        <div className="page-scrubber"><span>{metadata.currentPage}</span><input aria-label="Page" type="range" min="1" max={metadata.pageCount} value={metadata.currentPage} onChange={(event) => jumpToPage(Number(event.target.value), false)} /><span>{metadata.pageCount}</span></div>
        <div className="reader-tools">
          <button onClick={() => changeMode(metadata.readerMode === "article" ? "continuous" : "article")} aria-label={`Reading mode: ${metadata.readerMode}`}><Icon name={metadata.readerMode === "article" ? "article" : metadata.readerMode === "horizontal" ? "horizontal" : "grid"} /><span>{modes.find((mode) => mode.value === metadata.readerMode)?.label}</span></button>
          <button onClick={() => { setSettingsOpen((open) => !open); setSearchOpen(false); revealControls(); }} aria-label="Reading settings"><Icon name="settings" /><span>Display</span></button>
        </div>
      </footer>

      {settingsOpen && <aside className="reader-panel settings-panel" data-reader-control aria-label="Reading settings" onPointerDown={revealControls}>
        <div className="panel-handle" /><div className="panel-heading"><strong>Display</strong><button onClick={() => setSettingsOpen(false)} aria-label="Close"><Icon name="x" /></button></div>
        <label className="brightness-control"><span><Icon name="sun" /> Brightness</span><input type="range" min="0.65" max="1.15" step="0.05" value={metadata.brightness} onChange={(event) => updateMetadata({ brightness: Number(event.target.value) })} /></label>
        <div className="setting-group"><span>Appearance</span><div className="segmented themes">{themes.map((theme) => <button key={theme.value} className={metadata.readerTheme === theme.value ? "selected" : ""} onClick={() => updateMetadata({ readerTheme: theme.value })}>{metadata.readerTheme === theme.value && <Icon name="check" />}{theme.label}</button>)}</div></div>
        <div className="setting-group"><span>Reading mode</span><div className="segmented reading-modes">{modes.map((mode) => <button key={mode.value} className={metadata.readerMode === mode.value ? "selected" : ""} onClick={() => changeMode(mode.value)}>{mode.label}</button>)}</div></div>
        {metadata.readerMode === "article"
          ? <div className="zoom-row"><span>Text size</span><div><button onClick={() => updateMetadata({ articleFontSize: Math.max(16, metadata.articleFontSize - 1) })} aria-label="Decrease text size">A−</button><span>{metadata.articleFontSize}px</span><button onClick={() => updateMetadata({ articleFontSize: Math.min(28, metadata.articleFontSize + 1) })} aria-label="Increase text size">A+</button></div></div>
          : <div className="zoom-row"><span>Page size</span><div><button onClick={() => setZoom((value) => Math.max(.75, value - .15))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(2.5, value + .15))} aria-label="Zoom in">+</button></div></div>}
      </aside>}

      {searchOpen && <aside className="reader-panel search-panel" data-reader-control aria-label="Search PDF" onPointerDown={revealControls}>
        <div className="panel-handle" /><form onSubmit={runSearch}><Icon name="search" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this PDF" aria-label="Search this PDF" /><button type="button" onClick={() => { searchRun.current += 1; setSearchOpen(false); }} aria-label="Close"><Icon name="x" /></button></form>
        {searching && <div className="search-status"><span>Searching…</span><ProgressBar value={searchProgress} /></div>}
        {!searching && query && <div className="search-summary">{searchResults.length} {searchResults.length === 1 ? "page" : "pages"} found</div>}
        <div className="search-results">{searchResults.map((result) => <button key={result.page} onClick={() => { jumpToPage(result.page); setSearchOpen(false); }}><strong>Page {result.page}</strong><span>{result.excerpt || "Match found"}</span><Icon name="chevronRight" /></button>)}</div>
      </aside>}

    </main>
  );
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track"><span style={{ width: `${value * 100}%` }} /></div>;
}
