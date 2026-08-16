import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, verifyAccessToken } from "./app/lib/access-token";

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === "/code" ||
    pathname.startsWith("/code/") ||
    pathname === "/api/access" ||
    pathname === "/api/files/upload"
  );
}

export default async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    pathname === "/sign-in" ||
    pathname.startsWith("/sign-in/") ||
    pathname === "/sign-up" ||
    pathname.startsWith("/sign-up/")
  ) {
    return NextResponse.redirect(new URL("/code", request.url));
  }
  if (isPublicRoute(pathname)) return NextResponse.next();

  const token = request.cookies.get(ACCESS_COOKIE_NAME)?.value;
  if (await verifyAccessToken(token)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Bitte zuerst den Zugangscode eingeben." },
      { status: 401 },
    );
  }

  const accessUrl = new URL("/code", request.url);
  accessUrl.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(accessUrl);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
