export interface ListedObject {
  key: string;
  byteSize: number;
  lastModified: Date | null;
}

export interface ListObjectsPage {
  objects: ListedObject[];
  isTruncated: boolean;
  nextContinuationToken: string | null;
}

export interface ObjectStore {
  upload(key: string, data: Buffer, contentType: string): Promise<unknown>;
  download(key: string, options?: { signal?: AbortSignal }): Promise<Buffer>;
  stream(key: string): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<{ success: boolean; key?: string; error?: Error }>;
  listObjectsPage(
    prefix: string,
    continuationToken?: string | null,
    maxKeys?: number
  ): Promise<ListObjectsPage>;
}

export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Invalid storage key");
  }
}
