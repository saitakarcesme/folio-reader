import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type ArticleBlockType = "heading" | "paragraph" | "list-item";

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
  endsLine: boolean;
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  height: number;
  fontSize: number;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function appendText(current: string, next: string, gap: number, fontSize: number) {
  if (!current) return next.trimStart();
  if (!next) return current;
  const needsSpace = gap > Math.max(1.4, fontSize * 0.12)
    && !/\s$/.test(current)
    && !/^[,.;:!?%\])}]/.test(next);
  return `${current}${needsSpace ? " " : ""}${next}`;
}

function makeLines(items: PositionedText[]) {
  const lines: { items: PositionedText[]; y: number; height: number }[] = [];
  let active: (typeof lines)[number] | null = null;

  for (const item of items) {
    const tolerance = Math.max(2, item.height * 0.38);
    if (!active || Math.abs(active.y - item.y) > tolerance) {
      active = { items: [item], y: item.y, height: item.height };
      lines.push(active);
    } else {
      active.items.push(item);
      active.y = (active.y * (active.items.length - 1) + item.y) / active.items.length;
      active.height = Math.max(active.height, item.height);
    }
    if (item.endsLine) active = null;
  }

  return lines.map<TextLine>((line) => {
    const ordered = [...line.items].sort((a, b) => a.x - b.x);
    let text = "";
    let right = ordered[0]?.x ?? 0;
    for (const item of ordered) {
      text = appendText(text, item.text, item.x - right, item.fontSize);
      right = Math.max(right, item.x + item.width);
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      x: ordered[0]?.x ?? 0,
      y: line.y,
      height: line.height,
      fontSize: median(ordered.map((item) => item.fontSize)) || line.height,
    };
  }).filter((line) => line.text);
}

function isListItem(text: string) {
  return /^(?:[•●▪◦‣]|[-–—]|\d{1,3}[.)]|[A-Za-z][.)])\s+/.test(text);
}

function isLikelyHeading(line: TextLine, bodySize: number) {
  if (line.text.length > 150) return false;
  if (line.fontSize >= bodySize * 1.2) return true;
  return line.text.length <= 90
    && line.text.length >= 3
    && line.fontSize >= bodySize * 1.03
    && /\p{L}/u.test(line.text)
    && line.text === line.text.toLocaleUpperCase()
    && !/[.!?]$/.test(line.text);
}

function joinParagraph(previous: string, next: string) {
  if (/[-‐‑]$/.test(previous) && /^\p{Ll}/u.test(next)) {
    return `${previous.slice(0, -1)}${next}`;
  }
  return `${previous} ${next}`;
}

function buildArticlePage(lines: TextLine[], plainText: string): ExtractedArticlePage {
  if (!lines.length) return { blocks: [], plainText };

  const bodySize = median(lines.filter((line) => line.text.length > 24).map((line) => line.fontSize))
    || median(lines.map((line) => line.fontSize))
    || 12;
  const blocks: ArticleBlock[] = [];
  let paragraph: TextLine | null = null;

  const flushParagraph = () => {
    if (!paragraph) return;
    blocks.push({ type: "paragraph", text: paragraph.text });
    paragraph = null;
  };

  for (const line of lines) {
    if (isLikelyHeading(line, bodySize)) {
      flushParagraph();
      blocks.push({ type: "heading", text: line.text });
      continue;
    }
    if (isListItem(line.text)) {
      flushParagraph();
      blocks.push({
        type: "list-item",
        text: line.text.replace(/^(?:[•●▪◦‣]|[-–—]|\d{1,3}[.)]|[A-Za-z][.)])\s+/, ""),
      });
      continue;
    }
    if (!paragraph) {
      paragraph = { ...line };
      continue;
    }

    const verticalGap = Math.abs(paragraph.y - line.y);
    const lineHeight = Math.max(paragraph.height, line.height, bodySize);
    const startsNewParagraph = verticalGap > lineHeight * 1.8
      || (/[.!?…][”’\])}]?$/.test(paragraph.text)
        && Math.abs(line.x - paragraph.x) > bodySize * 1.35
        && verticalGap > lineHeight * 1.15);

    if (startsNewParagraph) {
      flushParagraph();
      paragraph = { ...line };
    } else {
      paragraph.text = joinParagraph(paragraph.text, line.text);
      paragraph.y = line.y;
      paragraph.height = line.height;
    }
  }
  flushParagraph();
  return { blocks, plainText };
}

async function extractArticleBlocks(page: PDFPageProxy): Promise<ExtractedArticlePage> {
  const [content, viewport] = await Promise.all([
    page.getTextContent({ includeMarkedContent: false }),
    Promise.resolve(page.getViewport({ scale: 1 })),
  ]);
  const items: PositionedText[] = content.items.flatMap((item) => {
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
      endsLine: item.hasEOL,
    }];
  });

  const lines = makeLines(items).filter((line) => {
    const normalized = line.text.replace(/[\s–—-]/g, "");
    const isBarePageNumber = /^\d{1,4}$/.test(normalized);
    const isPageEdge = line.y < viewport.height * 0.08 || line.y > viewport.height * 0.94;
    return !(isBarePageNumber && isPageEdge);
  });
  const plainText = items.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();
  return buildArticlePage(lines, plainText);
}

interface OperatorGlyph {
  unicode?: string;
  fontChar?: string;
  width?: number;
  isSpace?: boolean;
}

function readOperatorGlyphs(value: unknown): { text: string; width: number } {
  if (typeof value === "string") return { text: value, width: 0 };
  if (typeof value === "number") return { text: value < -120 ? " " : "", width: Math.max(0, -value) };
  if (!Array.isArray(value)) {
    if (!value || typeof value !== "object") return { text: "", width: 0 };
    const glyph = value as OperatorGlyph;
    const unicode = glyph.unicode ?? (glyph.fontChar && !/[\uE000-\uF8FF]/u.test(glyph.fontChar) ? glyph.fontChar : "");
    return { text: glyph.isSpace ? " " : unicode ?? "", width: glyph.width ?? 0 };
  }

  let text = "";
  let width = 0;
  for (const part of value) {
    const extracted = readOperatorGlyphs(part);
    text += extracted.text;
    width += extracted.width;
  }
  return { text, width };
}

/**
 * PDF.js builds this same operator list to paint a page. Some iPhone Safari
 * versions can render that list but fail while streaming getTextContent().
 * Reading the already-decoded glyphs gives Article mode an independent path.
 */
export async function extractArticlePageFromOperators(page: PDFPageProxy): Promise<ExtractedArticlePage> {
  const [{ OPS }, operatorList, viewport] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    page.getOperatorList(),
    Promise.resolve(page.getViewport({ scale: 1 })),
  ]);
  const lines: TextLine[] = [];
  let text = "";
  let fontSize = 12;
  let lineFontSize = fontSize;
  let lineX = 0;
  let lineY = viewport.height;
  let currentX = 0;
  let currentY = viewport.height;

  const flush = () => {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (normalized) {
      lines.push({ text: normalized, x: lineX, y: lineY, height: lineFontSize, fontSize: lineFontSize });
    }
    text = "";
    lineFontSize = fontSize;
    lineX = currentX;
    lineY = currentY;
  };

  const moveTo = (x: number, y: number) => {
    if (text) {
      const verticalMove = Math.abs(y - lineY) > Math.max(1.5, lineFontSize * 0.22);
      const movedBack = x < currentX - Math.max(2, lineFontSize * 0.35);
      if (verticalMove || movedBack) flush();
      else if (x - currentX > Math.max(1.5, lineFontSize * 0.18) && !/\s$/.test(text)) text += " ";
    }
    currentX = x;
    currentY = y;
    if (!text) {
      lineX = x;
      lineY = y;
    }
  };

  const appendRun = (value: unknown) => {
    const run = readOperatorGlyphs(value);
    if (!run.text) return;
    if (!text) {
      lineX = currentX;
      lineY = currentY;
      lineFontSize = fontSize;
    }
    text += run.text;
    currentX += (run.width / 1000) * Math.max(fontSize, 1);
  };

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const operation = operatorList.fnArray[index];
    const args = operatorList.argsArray[index] ?? [];
    if (operation === OPS.beginText || operation === OPS.endText) {
      flush();
    } else if (operation === OPS.setFont) {
      fontSize = Math.max(1, Math.abs(Number(args[1])) || 12);
      if (!text) lineFontSize = fontSize;
    } else if (operation === OPS.setTextMatrix) {
      moveTo(Number(args[4]) || 0, Number(args[5]) || 0);
    } else if (operation === OPS.moveText || operation === OPS.setLeadingMoveText) {
      moveTo(currentX + (Number(args[0]) || 0), currentY + (Number(args[1]) || 0));
    } else if (operation === OPS.nextLine) {
      flush();
    } else if (operation === OPS.showText || operation === OPS.showSpacedText) {
      appendRun(args[0]);
    } else if (operation === OPS.nextLineShowText) {
      flush();
      appendRun(args[0]);
    } else if (operation === OPS.nextLineSetSpacingShowText) {
      flush();
      appendRun(args[2]);
    }
  }
  flush();

  const filteredLines = lines.filter((line) => {
    const normalized = line.text.replace(/[\s–—-]/g, "");
    const isBarePageNumber = /^\d{1,4}$/.test(normalized);
    const isPageEdge = line.y < viewport.height * 0.08 || line.y > viewport.height * 0.94;
    return !(isBarePageNumber && isPageEdge);
  });
  const plainText = filteredLines.map((line) => line.text).join(" ").replace(/\s+/g, " ").trim();
  return buildArticlePage(filteredLines, plainText);
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
