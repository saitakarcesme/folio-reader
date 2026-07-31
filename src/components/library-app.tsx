"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useObjectUrl } from "@/hooks/use-object-url";
import { formatBytes, formatDate, nameFromFile } from "@/lib/format";
import { libraryRepository } from "@/lib/indexeddb-library";
import { createPdfCover, openPdf } from "@/lib/pdf";
import type { DocumentMetadata } from "@/types/library";

function Cover({ document, priority = false }: { document: DocumentMetadata; priority?: boolean }) {
  const coverUrl = useObjectUrl(document.coverBlob);
  return (
    <div className="book-cover">
      {coverUrl ? (
        <Image src={coverUrl} alt={`${document.name} cover`} fill priority={priority} unoptimized sizes="(max-width: 540px) 42vw, (max-width: 900px) 24vw, 190px" />
      ) : <Icon name="file" />}
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return <div className="progress-track" aria-hidden="true"><span style={{ width: `${Math.round(value * 100)}%` }} /></div>;
}

function LibraryBook({ document, onOpen, onRename, onDelete }: { document: DocumentMetadata; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article className="library-book">
      <div className="book-visual">
        <button className="cover-button" onClick={onOpen} aria-label={`Open ${document.name}`}><Cover document={document} /></button>
        <button className="book-menu-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={`More options for ${document.name}`}><Icon name="ellipsis" /></button>
        {menuOpen && (
          <div className="book-menu" role="menu">
            <button role="menuitem" onClick={() => { setMenuOpen(false); onRename(); }}>Rename</button>
            <button className="danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(); }}>Delete</button>
          </div>
        )}
      </div>
      <button className="book-details" onClick={onOpen}>
        <strong>{document.name}</strong>
        <span>{document.pageCount} pages · {formatDate(document.createdAt)}</span>
        {document.progress > 0 && <Progress value={document.progress} />}
      </button>
    </article>
  );
}

export function LibraryApp() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [uploadState, setUploadState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<DocumentMetadata | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DocumentMetadata | null>(null);

  const reload = useCallback(async () => {
    try { setDocuments(await libraryRepository.list()); }
    catch { setError("Folio could not open its on-device library."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void libraryRepository.list()
      .then(setDocuments)
      .catch(() => setError("Folio could not open its on-device library."))
      .finally(() => setLoading(false));
  }, []);

  const recent = useMemo(() => {
    const opened = documents.filter((document) => document.lastOpenedAt);
    return (opened.length ? opened : documents).slice().sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt))[0];
  }, [documents]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? documents.filter((document) => document.name.toLocaleLowerCase().includes(normalized)) : documents;
  }, [documents, query]);

  const openDocument = (id: string) => router.push(`/reader/${id}`);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    for (const [index, file] of Array.from(files).entries()) {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) { setError(`${file.name} is not a PDF.`); continue; }
      if (file.size === 0) { setError(`${file.name} is empty.`); continue; }
      setUploadState(files.length > 1 ? `Preparing ${index + 1} of ${files.length}…` : "Preparing your PDF…");
      let pdf;
      try {
        pdf = await openPdf(file);
        const coverBlob = await createPdfCover(pdf);
        const now = Date.now();
        const metadata: DocumentMetadata = {
          id: crypto.randomUUID(), name: nameFromFile(file.name), originalFileName: file.name,
          pageCount: pdf.numPages, fileSize: file.size, createdAt: now, updatedAt: now,
          lastOpenedAt: null, currentPage: 1, pageOffset: 0, progress: 0, bookmarks: [],
          readerMode: "continuous", readerTheme: "system", brightness: 1, coverBlob,
        };
        await libraryRepository.add({ metadata, file });
      } catch (cause) {
        console.error(cause);
        setError(`${file.name} could not be added. It may be damaged or password protected.`);
      } finally { await pdf?.cleanup(); }
    }
    if (navigator.storage?.persist) void navigator.storage.persist();
    setUploadState(null);
    if (fileInput.current) fileInput.current.value = "";
    await reload();
  };

  const saveRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    await libraryRepository.update(renameTarget.id, { name: renameValue.trim(), updatedAt: Date.now() });
    setRenameTarget(null); await reload();
  };

  const deleteDocument = async () => {
    if (!deleteTarget) return;
    await libraryRepository.delete(deleteTarget.id); setDeleteTarget(null); await reload();
  };

  return (
    <main className="library-shell">
      <input ref={fileInput} className="visually-hidden" type="file" accept="application/pdf,.pdf" aria-label="Choose PDF files" multiple onChange={(event) => void upload(event.target.files)} />
      <header className="library-header">
        <div><p className="eyebrow">Your reading space</p><h1>Folio</h1></div>
        <button className="primary-button compact" onClick={() => fileInput.current?.click()}><Icon name="plus" /><span>Add PDF</span></button>
      </header>

      {error && <div className="notice" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss"><Icon name="x" /></button></div>}

      <section className="continue-section" aria-labelledby="continue-heading">
        <div className="section-heading"><h2 id="continue-heading">Continue Reading</h2></div>
        {loading ? <div className="continue-placeholder skeleton" /> : recent ? (
          <button className="continue-card" onClick={() => openDocument(recent.id)}>
            <Cover document={recent} priority />
            <div className="continue-copy">
              <span className="continue-kicker">{recent.lastOpenedAt ? "Pick up where you left off" : "Ready when you are"}</span>
              <h3>{recent.name}</h3><p>Page {recent.currentPage} of {recent.pageCount} · {formatBytes(recent.fileSize)}</p>
              <Progress value={recent.progress} />
              <span className="continue-action">{recent.progress > 0 ? "Continue" : "Start reading"}<Icon name="chevronRight" /></span>
            </div>
          </button>
        ) : (
          <button className="continue-empty" onClick={() => fileInput.current?.click()}>
            <span className="empty-icon"><Icon name="upload" /></span>
            <span><strong>Add your first PDF</strong><small>It stays private and available offline on this device.</small></span>
            <Icon name="chevronRight" />
          </button>
        )}
      </section>

      <section className="library-section" aria-labelledby="library-heading">
        <div className="section-heading library-title-row">
          <div><h2 id="library-heading">Library</h2>{!loading && <span>{documents.length} {documents.length === 1 ? "document" : "documents"}</span>}</div>
          {documents.length > 0 && <label className="search-field"><Icon name="search" /><span className="visually-hidden">Search library</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><Icon name="x" /></button>}</label>}
        </div>
        {loading ? (
          <div className="library-grid" aria-label="Loading library">{Array.from({ length: 4 }, (_, index) => <div className="book-skeleton skeleton" key={index} />)}</div>
        ) : filtered.length ? (
          <div className="library-grid">{filtered.map((document) => <LibraryBook key={document.id} document={document} onOpen={() => openDocument(document.id)} onRename={() => { setRenameTarget(document); setRenameValue(document.name); }} onDelete={() => setDeleteTarget(document)} />)}</div>
        ) : documents.length ? <div className="no-results"><Icon name="search" /><strong>No matches</strong><span>Try a different title.</span></div>
          : <div className="library-empty"><p>Your PDFs will appear here with their own covers and reading progress.</p></div>}
      </section>

      {uploadState && <div className="working-overlay" role="status"><span className="spinner" /><strong>{uploadState}</strong><small>Generating a cover and saving it on this device</small></div>}

      {renameTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRenameTarget(null)}><form className="dialog" onSubmit={(event) => { event.preventDefault(); void saveRename(); }}><h2>Rename document</h2><label>Title<input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} maxLength={160} /></label><div className="dialog-actions"><button type="button" onClick={() => setRenameTarget(null)}>Cancel</button><button className="primary-button" disabled={!renameValue.trim()}>Save</button></div></form></div>}

      {deleteTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDeleteTarget(null)}><div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">Delete “{deleteTarget.name}”?</h2><p>The PDF and its reading progress will be removed from this device.</p><div className="dialog-actions"><button onClick={() => setDeleteTarget(null)}>Cancel</button><button className="danger-button" onClick={() => void deleteDocument()}>Delete</button></div></div></div>}
    </main>
  );
}
