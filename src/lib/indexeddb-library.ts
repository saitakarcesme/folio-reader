import type { LibraryRepository } from "@/lib/library-repository";
import type {
  DocumentMetadata,
  DocumentUpdate,
  StoredDocument,
} from "@/types/library";

const DATABASE_NAME = "folio-library";
const DATABASE_VERSION = 1;
const DOCUMENTS_STORE = "documents";
const FILES_STORE = "files";

interface FileRecord {
  id: string;
  blob: Blob;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("IndexedDB request failed")),
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted")),
    );
    transaction.addEventListener("error", () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed")),
    );
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        const documents = database.createObjectStore(DOCUMENTS_STORE, {
          keyPath: "id",
        });
        documents.createIndex("lastOpenedAt", "lastOpenedAt");
        documents.createIndex("createdAt", "createdAt");
      }
      if (!database.objectStoreNames.contains(FILES_STORE)) {
        database.createObjectStore(FILES_STORE, { keyPath: "id" });
      }
    });

    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    });
    request.addEventListener("error", () => {
      databasePromise = null;
      reject(request.error ?? new Error("Could not open the Folio library"));
    });
  });

  return databasePromise;
}

class IndexedDbLibraryRepository implements LibraryRepository {
  async list() {
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    const done = transactionDone(transaction);
    const documents = await requestResult<DocumentMetadata[]>(
      transaction.objectStore(DOCUMENTS_STORE).getAll(),
    );
    await done;
    return documents.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getMetadata(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENTS_STORE, "readonly");
    const done = transactionDone(transaction);
    const document = await requestResult<DocumentMetadata | undefined>(
      transaction.objectStore(DOCUMENTS_STORE).get(id),
    );
    await done;
    return document;
  }

  async getFile(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(FILES_STORE, "readonly");
    const done = transactionDone(transaction);
    const record = await requestResult<FileRecord | undefined>(
      transaction.objectStore(FILES_STORE).get(id),
    );
    await done;
    return record?.blob;
  }

  async add(document: StoredDocument) {
    const database = await openDatabase();
    const transaction = database.transaction(
      [DOCUMENTS_STORE, FILES_STORE],
      "readwrite",
    );
    transaction.objectStore(DOCUMENTS_STORE).add(document.metadata);
    transaction
      .objectStore(FILES_STORE)
      .add({ id: document.metadata.id, blob: document.file } satisfies FileRecord);
    await transactionDone(transaction);
  }

  async update(id: string, updates: DocumentUpdate) {
    const database = await openDatabase();
    const transaction = database.transaction(DOCUMENTS_STORE, "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const document = await requestResult<DocumentMetadata | undefined>(store.get(id));
    if (!document) {
      transaction.abort();
      throw new Error("Document not found");
    }
    const updated = { ...document, ...updates };
    store.put(updated);
    await done;
    return updated;
  }

  async delete(id: string) {
    const database = await openDatabase();
    const transaction = database.transaction(
      [DOCUMENTS_STORE, FILES_STORE],
      "readwrite",
    );
    transaction.objectStore(DOCUMENTS_STORE).delete(id);
    transaction.objectStore(FILES_STORE).delete(id);
    await transactionDone(transaction);
  }
}

export const libraryRepository: LibraryRepository =
  new IndexedDbLibraryRepository();
