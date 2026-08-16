"use client";

import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type AccessFormProps = {
  redirectTo: string;
};

export default function AccessForm({ redirectTo }: AccessFormProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Der Zugang konnte nicht geöffnet werden.");
      }
      router.replace(redirectTo);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Der Zugang konnte nicht geöffnet werden.",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="access-page">
      <section className="access-card" aria-labelledby="access-title">
        <div className="access-brand" aria-label="LV Preisassistent">
          <span className="access-brand-mark">LV</span>
          <span>
            <strong>LV Preisassistent</strong>
            <small>Preise sicher übernehmen</small>
          </span>
        </div>

        <div className="access-heading">
          <span className="access-icon" aria-hidden="true">
            <KeyRound size={24} />
          </span>
          <div>
            <p className="access-kicker">Geschützter Bereich</p>
            <h1 id="access-title">Zugangscode eingeben</h1>
          </div>
        </div>

        <p className="access-intro">
          Gib den vierstelligen Code ein, um den LV Preisassistenten zu öffnen.
        </p>

        <form className="access-form" onSubmit={submitCode}>
          <label htmlFor="access-code">Zugangscode</label>
          <input
            id="access-code"
            name="code"
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={12}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "access-error" : "access-note"}
            autoFocus
            required
          />
          <button type="submit" disabled={submitting || !code}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}
            {submitting ? "Wird geöffnet …" : "Webseite öffnen"}
          </button>
        </form>

        <p id="access-error" className="access-error" role="alert" aria-live="polite">
          {error}
        </p>
        <p id="access-note" className="access-note">
          <ShieldCheck size={16} aria-hidden="true" />
          Der Zugang bleibt auf diesem Gerät sieben Tage geöffnet.
        </p>
      </section>
    </main>
  );
}
