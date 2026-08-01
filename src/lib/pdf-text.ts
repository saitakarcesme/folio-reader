import type { PDFPageProxy } from "pdfjs-dist";

export type ArticleBlockType = "heading" | "paragraph" | "list-item";

export interface ArticleBlock {
  type: ArticleBlockType;
  text: string;
}

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

export async function extractArticleBlocks(page: PDFPageProxy): Promise<ArticleBlock[]> {
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
  if (!lines.length) return [];

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
  return blocks;
}
