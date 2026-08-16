export async function getDocumentBucket(): Promise<R2Bucket> {
  const { env } = await import("cloudflare:workers");
  const bucket = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!bucket) {
    throw new Error("Das Dateiarchiv ist noch nicht verfügbar.");
  }
  return bucket;
}
