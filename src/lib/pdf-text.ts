import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type ArticleBlockType = "heading" | "paragraph" | "list-item" | "quote";

export interface ArticleBlock {
  type: ArticleBlockType;
  text: string;
}

interface ExtractedArticlePage {
  blocks: ArticleBlock[];
  plainText: string;
}

interface DocumentExtractionState {
  cache: Map<number, Promise<ExtractedArticlePage>>;
  tail: Promise<void>;
  preferOperators: boolean;
}

const extractionStates = new WeakMap<PDFDocumentProxy, DocumentExtractionState>();

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  order: number;
}

interface TextLine {
  text: string;
  x: number;
  right: number;
  y: number;
  height: number;
  fontSize: number;
  order: number;
}

type Matrix = [number, number, number, number, number, number];

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .normalize("NFC");
}

function appendText(current: string, next: string, gap: number, fontSize: number) {
  if (!current) return next.trimStart();
  if (!next) return current;
  const punctuationBoundary = /[.;:!?]$/u.test(current) && /^\p{L}/u.test(next);
  const needsSpace = (gap > Math.max(1.25, fontSize * 0.1) || punctuationBoundary)
    && !/\s$/.test(current)
    && !/^[,.;:!?%\])}’”]/u.test(next);
  return `${current}${needsSpace ? " " : ""}${next}`;
}

function makeLines(rawItems: PositionedText[]) {
  const seen = new Set<string>();
  const items = rawItems.flatMap((item) => {
    const text = normalizeText(item.text);
    if (!text.trim()) return [];
    const fingerprint = `${text}\u0000${Math.round(item.x * 2)}\u0000${Math.round(item.y * 2)}`;
    if (seen.has(fingerprint)) return [];
    seen.add(fingerprint);
    return [{ ...item, text }];
  }).sort((a, b) => b.y - a.y || a.x - b.x || a.order - b.order);

  const lines: { items: PositionedText[]; y: number; height: number; order: number }[] = [];
  let active: (typeof lines)[number] | null = null;
  for (const item of items) {
    const tolerance = Math.max(1.6, item.height * 0.34);
    if (!active || Math.abs(active.y - item.y) > tolerance) {
      active = { items: [], y: item.y, height: item.height, order: item.order };
      lines.push(active);
    }
    active.items.push(item);
    active.y = median(active.items.map((entry) => entry.y));
    active.height = Math.max(active.height, item.height);
    active.order = Math.min(active.order, item.order);
  }

  return lines.flatMap<TextLine>((line) => {
    const ordered = [...line.items].sort((a, b) => a.x - b.x || a.order - b.order);
    const segments: PositionedText[][] = [];
    for (const item of ordered) {
      const segment = segments.at(-1);
      const previous = segment?.at(-1);
      const previousRight = previous ? previous.x + Math.max(previous.width, 0) : item.x;
      if (!segment || item.x - previousRight > Math.max(44, item.fontSize * 4.5)) segments.push([item]);
      else segment.push(item);
    }
    return segments.map((segment) => {
      let text = "";
      let right = segment[0]?.x ?? 0;
      for (const item of segment) {
        text = appendText(text, item.text, item.x - right, item.fontSize);
        right = Math.max(right, item.x + Math.max(item.width, 0));
      }
      return {
        text: text.replace(/\s+/g, " ").trim(),
        x: segment[0]?.x ?? 0,
        right,
        y: line.y,
        height: line.height,
        fontSize: median(segment.map((item) => item.fontSize)) || line.height,
        order: Math.min(...segment.map((item) => item.order)),
      };
    });
  }).filter((line) => line.text);
}

function orderLines(lines: TextLine[]) {
  if (lines.length < 2) return lines;

  // Most PDFs encode visual order, but fallback operator streams occasionally do
  // not. Use page coordinates while keeping nearly coincident baselines stable.
  return [...lines].sort((a, b) => {
    const baselineTolerance = Math.max(2, Math.min(a.height, b.height) * 0.42);
    if (Math.abs(a.y - b.y) <= baselineTolerance) return a.x - b.x || a.order - b.order;
    return b.y - a.y;
  });
}

function isListItem(text: string) {
  return /^(?:[•●▪◦‣]|[-–—]|\d{1,3}[.)]|[A-Za-zÇĞİÖŞÜçğıöşü][.)])\s+/u.test(text);
}

function stripListMarker(text: string) {
  return text.replace(/^(?:[•●▪◦‣]|[-–—]|\d{1,3}[.)]|[A-Za-zÇĞİÖŞÜçğıöşü][.)])\s+/u, "");
}

function isLikelyHeading(line: TextLine, bodySize: number) {
  if (line.text.length > 150) return false;
  if (line.fontSize >= bodySize * 1.22) return true;
  return line.text.length <= 90
    && line.text.length >= 3
    && line.fontSize >= bodySize * 1.04
    && /\p{L}/u.test(line.text)
    && line.text === line.text.toLocaleUpperCase()
    && !/[.!?…][”’\])}]?$/u.test(line.text);
}

function endsSentence(text: string) {
  return /[.!?…:][”’\])}]?$/u.test(text);
}

function joinWrappedText(previous: string, next: string) {
  const normalizedNext = next.trim();
  if (/[-‐‑]$/u.test(previous) && /^\p{Ll}/u.test(normalizedNext)) {
    return `${previous.slice(0, -1)}${normalizedNext}`;
  }
  if (/[/–—]$/u.test(previous) || /^[,.;:!?%\])}’”]/u.test(normalizedNext)) {
    return `${previous}${normalizedNext}`;
  }
  return `${previous} ${normalizedNext}`;
}

function typicalLineStep(lines: TextLine[], bodySize: number) {
  const steps: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const step = previous.y - current.y;
    if (step > bodySize * 0.72 && step < bodySize * 2.1) steps.push(step);
  }
  return median(steps) || bodySize * 1.28;
}

function buildArticlePage(rawLines: TextLine[], fallbackPlainText: string): ExtractedArticlePage {
  const lines = orderLines(rawLines);
  if (!lines.length) return { blocks: [], plainText: fallbackPlainText };

  const bodyCandidates = lines.filter((line) => line.text.length > 20 && !/^\d{1,4}$/.test(line.text));
  const bodySize = median(bodyCandidates.map((line) => line.fontSize))
    || median(lines.map((line) => line.fontSize))
    || 12;
  const bodyLines = lines.filter((line) => line.fontSize <= bodySize * 1.14 && line.text.length > 12);
  const bodyLeft = median((bodyLines.length ? bodyLines : lines).map((line) => line.x));
  const lineStep = typicalLineStep(bodyLines.length > 2 ? bodyLines : lines, bodySize);
  const indentation = Math.max(bodySize * 1.35, 14);
  const plainText = lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim()
    || fallbackPlainText;

  const blocks: ArticleBlock[] = [];
  let active: { type: ArticleBlockType; text: string; first: TextLine; last: TextLine } | null = null;

  const flush = () => {
    if (!active) return;
    blocks.push({ type: active.type, text: active.text.trim() });
    active = null;
  };

  const startsWithQuote = (text: string) => /^[“„«"‘']/u.test(text.trim());

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const previousLine = index > 0 ? lines[index - 1] : null;
    const nextLine = lines[index + 1] ?? null;
    const gap = previousLine ? previousLine.y - line.y : 0;
    const indented = line.x > bodyLeft + indentation;
    const adjacentIndented = Boolean(
      (previousLine && previousLine.x > bodyLeft + indentation)
      || (nextLine && nextLine.x > bodyLeft + indentation),
    );
    const heading = isLikelyHeading(line, bodySize);
    const listItem = isListItem(line.text);
    const quote: boolean = !heading && !listItem && (
      startsWithQuote(line.text)
      || (indented && adjacentIndented && line.text.length > 18)
    );
    const type: ArticleBlockType = heading ? "heading" : listItem ? "list-item" : quote ? "quote" : "paragraph";
    const text = listItem ? stripListMarker(line.text) : line.text;

    if (!active) {
      active = { type, text, first: line, last: line };
      continue;
    }

    const sameFont = Math.abs(active.last.fontSize - line.fontSize) <= bodySize * 0.16;
    const normalGap = gap > 0 && gap <= lineStep * 1.44;
    const aligned = Math.abs(line.x - active.first.x) <= indentation;
    const listContinuation = active.type === "list-item"
      && type === "paragraph"
      && normalGap
      && line.x >= active.first.x - bodySize * 0.2;
    const wrappedHeading = active.type === "heading" && type === "heading" && normalGap && sameFont;
    const wrappedQuote = active.type === "quote" && type === "quote" && normalGap;
    const wrappedParagraph = active.type === "paragraph"
      && type === "paragraph"
      && normalGap
      && sameFont
      && (aligned || !endsSentence(active.text) || line.x <= bodyLeft + indentation * 0.45);

    if (listContinuation || wrappedHeading || wrappedQuote || wrappedParagraph) {
      active.text = joinWrappedText(active.text, text);
      active.last = line;
      continue;
    }

    flush();
    active = { type, text, first: line, last: line };
  }
  flush();
  return { blocks, plainText };
}

function filterPageFurniture(lines: TextLine[], pageHeight: number) {
  const likelyBodySize = median(lines.filter((line) => line.text.length > 20).map((line) => line.fontSize))
    || median(lines.map((line) => line.fontSize));
  return lines.filter((line) => {
    const normalized = line.text.replace(/[\s–—-]/g, "");
    const isBarePageNumber = /^\d{1,4}$/.test(normalized);
    const isPageEdge = line.y < pageHeight * 0.08 || line.y > pageHeight * 0.94;
    const isSmallRunningFurniture = isPageEdge && line.fontSize < likelyBodySize * 0.82;
    return !(isPageEdge && (isBarePageNumber || isSmallRunningFurniture));
  });
}

async function extractArticleBlocks(page: PDFPageProxy): Promise<ExtractedArticlePage> {
  const [content, viewport] = await Promise.all([
    page.getTextContent({ includeMarkedContent: false }),
    Promise.resolve(page.getViewport({ scale: 1 })),
  ]);
  const items: PositionedText[] = content.items.flatMap((item, order) => {
    if (!("str" in item) || !item.str.trim()) return [];
    const [, b, c, d, x, y] = item.transform;
    const fontSize = Math.max(item.height || 0, Math.hypot(c, d), Math.hypot(item.transform[0], b));
    return [{
      text: item.str,
      x,
      y,
      width: Math.abs(item.width),
      height: Math.max(item.height || 0, fontSize, 1),
      fontSize: Math.max(fontSize, 1),
      order,
    }];
  });

  const lines = filterPageFurniture(makeLines(items), viewport.height);
  const plainText = items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
  return buildArticlePage(lines, plainText);
}

interface OperatorGlyph {
  unicode?: string;
  fontChar?: string;
  width?: number;
  isSpace?: boolean;
}

function readOperatorGlyphs(value: unknown): { text: string; advance: number } {
  if (typeof value === "string") return { text: value, advance: value.length * 500 };
  if (typeof value === "number") return { text: value < -120 ? " " : "", advance: -value };
  if (!Array.isArray(value)) {
    if (!value || typeof value !== "object") return { text: "", advance: 0 };
    const glyph = value as OperatorGlyph;
    const unicode = glyph.unicode ?? (glyph.fontChar && !/[\uE000-\uF8FF]/u.test(glyph.fontChar) ? glyph.fontChar : "");
    return { text: glyph.isSpace ? " " : unicode ?? "", advance: glyph.width ?? 0 };
  }

  let text = "";
  let advance = 0;
  for (const part of value) {
    const extracted = readOperatorGlyphs(part);
    text += extracted.text;
    advance += extracted.advance;
  }
  return { text, advance };
}

function multiply(first: Matrix, second: Matrix): Matrix {
  return [
    first[0] * second[0] + first[2] * second[1],
    first[1] * second[0] + first[3] * second[1],
    first[0] * second[2] + first[2] * second[3],
    first[1] * second[2] + first[3] * second[3],
    first[0] * second[4] + first[2] * second[5] + first[4],
    first[1] * second[4] + first[3] * second[5] + first[5],
  ];
}

function translate(matrix: Matrix, x: number, y: number): Matrix {
  return multiply(matrix, [1, 0, 0, 1, x, y]);
}

function matrixFromArgs(args: unknown[]): Matrix {
  const candidate = args.length === 1 && (Array.isArray(args[0]) || ArrayBuffer.isView(args[0]))
    ? Array.from(args[0] as ArrayLike<number>)
    : args;
  const values = candidate.slice(0, 6).map(Number);
  return values.length === 6 && values.every(Number.isFinite)
    ? values as Matrix
    : [1, 0, 0, 1, 0, 0];
}

/**
 * PDF.js builds this same operator list to paint a page. Some iPhone Safari
 * versions can render that list but fail while streaming getTextContent().
 * Reading the decoded glyphs provides an independent, geometry-aware path.
 */
export async function extractArticlePageFromOperators(page: PDFPageProxy): Promise<ExtractedArticlePage> {
  const [{ OPS }, operatorList, viewport] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    page.getOperatorList(),
    Promise.resolve(page.getViewport({ scale: 1 })),
  ]);
  const items: PositionedText[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const ctmStack: Matrix[] = [];
  let textMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let lineMatrix: Matrix = [1, 0, 0, 1, 0, 0];
  let fontSize = 12;
  let horizontalScale = 1;
  let leading = 0;
  let order = 0;

  const moveLine = (x: number, y: number) => {
    lineMatrix = translate(lineMatrix, x, y);
    textMatrix = [...lineMatrix];
  };

  const appendRun = (value: unknown) => {
    const run = readOperatorGlyphs(value);
    const text = normalizeText(run.text);
    const advance = (run.advance / 1000) * fontSize * horizontalScale;
    if (text.trim()) {
      const renderMatrix = multiply(ctm, textMatrix);
      const scaleX = Math.hypot(renderMatrix[0], renderMatrix[1]) || 1;
      const scaleY = Math.hypot(renderMatrix[2], renderMatrix[3]) || 1;
      items.push({
        text,
        x: renderMatrix[4],
        y: renderMatrix[5],
        width: Math.abs(advance * scaleX),
        height: Math.max(1, Math.abs(fontSize * scaleY)),
        fontSize: Math.max(1, Math.abs(fontSize * scaleY)),
        order: order++,
      });
    }
    textMatrix = translate(textMatrix, advance, 0);
  };

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];
    if (operation === OPS.save) {
      ctmStack.push([...ctm]);
    } else if (operation === OPS.restore) {
      ctm = ctmStack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (operation === OPS.transform) {
      ctm = multiply(ctm, matrixFromArgs(args));
    } else if (operation === OPS.beginText) {
      textMatrix = [1, 0, 0, 1, 0, 0];
      lineMatrix = [1, 0, 0, 1, 0, 0];
    } else if (operation === OPS.setFont) {
      fontSize = Math.max(1, Math.abs(Number(args[1])) || 12);
    } else if (operation === OPS.setHScale) {
      horizontalScale = (Number(args[0]) || 100) / 100;
    } else if (operation === OPS.setLeading) {
      leading = Number(args[0]) || 0;
    } else if (operation === OPS.setTextMatrix) {
      textMatrix = matrixFromArgs(args);
      lineMatrix = [...textMatrix];
    } else if (operation === OPS.moveText) {
      moveLine(Number(args[0]) || 0, Number(args[1]) || 0);
    } else if (operation === OPS.setLeadingMoveText) {
      leading = -(Number(args[1]) || 0);
      moveLine(Number(args[0]) || 0, Number(args[1]) || 0);
    } else if (operation === OPS.nextLine) {
      moveLine(0, -leading);
    } else if (operation === OPS.showText || operation === OPS.showSpacedText) {
      appendRun(args[0]);
    } else if (operation === OPS.nextLineShowText) {
      moveLine(0, -leading);
      appendRun(args[0]);
    } else if (operation === OPS.nextLineSetSpacingShowText) {
      moveLine(0, -leading);
      appendRun(args[2]);
    }
  }

  const lines = filterPageFurniture(makeLines(items), viewport.height);
  const plainText = lines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
  return buildArticlePage(lines, plainText);
}

function stateFor(document: PDFDocumentProxy) {
  let state = extractionStates.get(document);
  if (!state) {
    state = { cache: new Map(), tail: Promise.resolve(), preferOperators: false };
    extractionStates.set(document, state);
  }
  return state;
}

async function serialize<T>(state: DocumentExtractionState, task: () => Promise<T>) {
  const previous = state.tail;
  let release: () => void = () => {};
  state.tail = new Promise<void>((resolve) => { release = resolve; });
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function extractWithRetry(document: PDFDocumentProxy, state: DocumentExtractionState, pageNumber: number) {
  let lastError: unknown = new Error("PDF text extraction failed");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let page: PDFPageProxy | null = null;
    try {
      page = await document.getPage(pageNumber);
      if (!state.preferOperators) {
        try {
          const extracted = await extractArticleBlocks(page);
          if (extracted.blocks.length || extracted.plainText) return extracted;
        } catch (error) {
          lastError = error;
          state.preferOperators = true;
        }
      }

      try {
        const extracted = await extractArticlePageFromOperators(page);
        if (extracted.blocks.length || extracted.plainText) state.preferOperators = true;
        return extracted;
      } catch (operatorError) {
        lastError = new AggregateError([lastError, operatorError], "Both PDF text extraction paths failed");
      }
    } catch (pageError) {
      lastError = pageError;
    } finally {
      page?.cleanup();
    }
    if (attempt < 2) await wait(160 * (attempt + 1));
  }
  throw lastError;
}

export function extractArticlePage(document: PDFDocumentProxy, pageNumber: number) {
  const state = stateFor(document);
  const cached = state.cache.get(pageNumber);
  if (cached) return cached;

  const extraction = serialize(state, () => extractWithRetry(document, state, pageNumber));
  state.cache.set(pageNumber, extraction);
  void extraction.catch(() => {
    if (state.cache.get(pageNumber) === extraction) state.cache.delete(pageNumber);
  });
  return extraction;
}
