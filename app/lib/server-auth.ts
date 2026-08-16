import { auth, currentUser } from "@clerk/nextjs/server";

export type Actor = {
  userId: string;
  email: string | null;
  displayName: string;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("Nicht angemeldet.");
    this.name = "UnauthorizedError";
  }
}

export async function requireActor(): Promise<Actor> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(" ");

  return {
    userId,
    email,
    displayName: fullName || email || "Angemeldeter Benutzer",
  };
}
