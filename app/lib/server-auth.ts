import { cookies } from "next/headers";
import { ACCESS_COOKIE_NAME, verifyAccessToken } from "./access-token";

export type Actor = {
  userId: string;
  email: string | null;
  displayName: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("Zugangscode erforderlich.");
    this.name = "UnauthorizedError";
  }
}

export async function hasAccess(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyAccessToken(cookieStore.get(ACCESS_COOKIE_NAME)?.value);
}

export async function requireActor(): Promise<Actor> {
  if (!(await hasAccess())) throw new UnauthorizedError();
  return {
    userId: "shared-code-access",
    email: null,
    displayName: "Fatlind",
  };
}
