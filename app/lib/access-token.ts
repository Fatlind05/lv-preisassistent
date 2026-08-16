export const ACCESS_COOKIE_NAME = "lv-preisassistent-access";
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

const DEFAULT_ACCESS_CODE = "2005";
const LOCAL_SESSION_SECRET = "lv-preisassistent-local-session";
const encoder = new TextEncoder();

function accessCode(): string {
  return process.env.APP_ACCESS_CODE?.trim() || DEFAULT_ACCESS_CODE;
}

function sessionSecret(): string {
  return process.env.ACCESS_SESSION_SECRET?.trim() || LOCAL_SESSION_SECRET;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function createAccessToken(): Promise<string> {
  return sign("lv-preisassistent:granted");
}

export async function verifyAccessToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  return constantTimeEqual(token, await createAccessToken());
}

export async function verifyAccessCode(code: string): Promise<boolean> {
  if (!code || code.length > 32) return false;
  const [submitted, expected] = await Promise.all([
    sign(`code:${code}`),
    sign(`code:${accessCode()}`),
  ]);
  return constantTimeEqual(submitted, expected);
}
