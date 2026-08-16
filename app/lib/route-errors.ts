import { UnauthorizedError } from "./server-auth";

export function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "23505",
  );
}

export function safeErrorResponse(
  error: unknown,
  publicMessage: string,
  status = 500,
): Response {
  if (error instanceof UnauthorizedError) {
    return Response.json({ error: "Bitte zuerst den Zugangscode eingeben." }, { status: 401 });
  }

  const reference = crypto.randomUUID().slice(0, 8);
  console.error(`[${reference}] ${publicMessage}`, error);
  return Response.json({ error: publicMessage, reference }, { status });
}
