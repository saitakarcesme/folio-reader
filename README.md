# Folio

Folio is a mobile-first, offline-capable PDF library and reader built for iPhone Home Screen use. PDFs never leave the browser: files, generated covers, reading position, bookmarks, and display preferences are stored locally in IndexedDB.

## Features

- Real multi-file PDF upload with automatic first-page cover generation
- Searchable library with rename, delete, metadata, and reading progress
- Continue Reading that restores the page and position within that page
- Responsive Article mode that reflows selectable PDF text into mobile-friendly headings and paragraphs
- Lazy, virtualized PDF.js rendering that releases distant canvases
- Continuous vertical, page-snapped, and horizontal reading modes
- Native browser pinch-to-zoom plus reader page-size controls
- A distraction-free reader: controls appear only after a double tap, 600 ms hold, or two-finger tap
- PDF text search, per-page bookmarks, brightness, system/light/sepia/dark themes
- Standalone PWA metadata, Apple touch icon and launch images, safe-area handling, and offline app shell
- Responsive layouts tuned for 320, 375, 390, 430, and 768 px viewports plus desktop

## Local development

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. HTTPS or localhost is required for production service-worker behavior. The service worker registers only in production so development refreshes remain predictable.

Run the complete local validation:

```bash
npm run check
```

## Architecture

The App Router provides two UI surfaces:

- `/` renders the library.
- `/reader/[id]` renders a document from its IndexedDB identifier.

`src/lib/library-repository.ts` is the storage contract. `src/lib/indexeddb-library.ts` is the first implementation. A future Supabase-backed implementation can satisfy the same contract while preserving UI components. Metadata and PDF blobs live in separate object stores, so listing the library does not read every full PDF into memory.

PDF.js is loaded only by client-side PDF workflows. Uploading parses the real file, counts its pages, renders page one to a compact WebP cover, and commits the file plus metadata in one IndexedDB transaction. The reader uses IntersectionObserver and ResizeObserver: pages within an extended viewport are rendered at a device-pixel-ratio capped at 2; distant canvases are cancelled and released.

Article mode is the default for new files and is applied once to libraries created before the feature existed. It extracts text locally, page by page near the viewport, and uses PDF coordinates and font metrics to rebuild lines, paragraphs, headings, and lists. Extraction work is serialized per document and cached to keep memory use predictable on iPhone. If Safari's PDF.js text stream fails, Folio switches that document to an independent fallback which rebuilds text from the decoded glyph operators already used to render the page; later pages use the working path directly. Bundled PDF.js CMaps, standard fonts, and WASM helpers support PDFs with embedded or non-Latin font encodings while remaining offline-capable. The original continuous, paged, and horizontal PDF views remain available. Image-only/scanned pages cannot be reflowed without OCR and show a clear notice instead.

Reading position is represented by a page number and a fractional offset within the page. Changes are debounced during reading and flushed on `pagehide`. Reader settings, Article text size, and bookmarks are stored with the same document metadata.

## Offline and PWA behavior

`public/sw.js` caches the library shell, a route-neutral reader shell, the manifest, icons, and loaded Next.js assets. Navigations use network-first behavior, falling back to the cached shell. Previously uploaded PDFs remain available because their source blobs are stored in IndexedDB rather than the HTTP cache. The app asks the browser for persistent storage after a successful upload; browsers may still apply their own storage policies.

On iOS, use Safari’s Share menu and choose **Add to Home Screen**. Folio declares standalone display mode, `viewport-fit=cover`, safe-area padding, dynamic viewport height, light/dark theme colors, an Apple touch icon, and launch artwork for current 393 px and 430 px iPhone classes.

Service workers update on the next navigation and activation. If testing a new production build after a prior install, reload once while online before testing offline.

## Privacy and limitations

- No upload API, analytics, account system, or remote storage is used.
- Browser storage is device- and browser-profile-specific. Clearing Safari website data removes the library.
- Password-protected or malformed PDFs may be rejected.
- Web applications cannot reliably intercept iPhone power or volume button combinations. Folio intentionally uses only touch gestures it can handle safely.
- Native pinch zoom is browser-controlled. Folio also provides explicit page-size controls for predictable zooming across platforms.

No environment variables or secrets are required for this version.
