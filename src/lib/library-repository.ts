import type {
  DocumentMetadata,
  DocumentUpdate,
  StoredDocument,
} from "@/types/library";

export interface LibraryRepository {
  list(): Promise<DocumentMetadata[]>;
  getMetadata(id: string): Promise<DocumentMetadata | undefined>;
  getFile(id: string): Promise<Blob | undefined>;
  add(document: StoredDocument): Promise<void>;
  update(id: string, updates: DocumentUpdate): Promise<DocumentMetadata>;
  delete(id: string): Promise<void>;
}
