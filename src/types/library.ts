export type ReaderMode = "continuous" | "paged" | "horizontal";
export type ReaderTheme = "system" | "light" | "sepia" | "dark";

export interface DocumentMetadata {
  id: string;
  name: string;
  originalFileName: string;
  pageCount: number;
  fileSize: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  currentPage: number;
  pageOffset: number;
  progress: number;
  bookmarks: number[];
  readerMode: ReaderMode;
  readerTheme: ReaderTheme;
  brightness: number;
  coverBlob: Blob;
}

export interface StoredDocument {
  metadata: DocumentMetadata;
  file: Blob;
}

export type DocumentUpdate = Partial<
  Pick<
    DocumentMetadata,
    | "name"
    | "updatedAt"
    | "lastOpenedAt"
    | "currentPage"
    | "pageOffset"
    | "progress"
    | "bookmarks"
    | "readerMode"
    | "readerTheme"
    | "brightness"
  >
>;
