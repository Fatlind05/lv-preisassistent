import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasAccess } from "../lib/server-auth";
import AccessForm from "./access-form";

export const metadata: Metadata = {
  title: "Zugang | LV Preisassistent",
};

type AccessPageProps = {
  searchParams: Promise<{ redirect?: string | string[] }>;
};

function safeRedirect(value: string | string[] | undefined): string {
  const path = Array.isArray(value) ? value[0] : value;
  return path?.startsWith("/") && !path.startsWith("//") ? path : "/";
}

export default async function AccessPage({ searchParams }: AccessPageProps) {
  const redirectTo = safeRedirect((await searchParams).redirect);
  if (await hasAccess()) redirect(redirectTo);
  return <AccessForm redirectTo={redirectTo} />;
}
