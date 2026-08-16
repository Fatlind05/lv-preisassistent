type StoredObject = {
  body: BodyInit;
  writeHttpMetadata(headers: Headers): void;
};

type DocumentBucket = {
  put(
    key: string,
    value: ArrayBuffer,
    options?: Record<string, unknown>,
  ): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
};

/**
 * Temporary Vercel preview boundary. Private document storage is connected in
 * the next migration step; the preview must not pretend that uploads persist.
 */
export async function getDocumentBucket(): Promise<DocumentBucket> {
  throw new Error(
    "Das Dateiarchiv ist in dieser Vorschau noch nicht eingerichtet.",
  );
}
