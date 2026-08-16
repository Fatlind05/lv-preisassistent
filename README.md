# LV Preisassistent

Der LV Preisassistent liest ausgefüllte Leistungsverzeichnisse ein, baut daraus
ein privates Preisarchiv auf und übernimmt nur ausreichend sichere Treffer in
neue LVs. Excel, PDF sowie JPG/PNG/WEBP werden unterstützt.

## Technik

- Next.js 16 und React 19
- Clerk für Anmeldung und serverseitige Zugriffskontrolle
- Neon Postgres mit Drizzle ORM
- privater Vercel Blob Store für Originaldateien
- Vitest für Matcher- und Dateisicherheitsregeln

## Lokal starten

Voraussetzung ist Node.js 22. Nach `npm install` die Variablen aus
`.env.example` setzen oder mit `vercel env pull .env.local` aus dem verknüpften
Vercel-Projekt laden.

```bash
npm run db:migrate
npm run dev
```

## Prüfen und deployen

```bash
npm run test
npm run lint
npm run build
vercel deploy
```

Uploads sind auf 25 MB begrenzt. Die Upload-Route prüft Dateiendung,
Content-Type, Dateisignatur und SHA-256-Prüfsumme, bevor sie einen Datensatz
anlegt. Sämtliche Daten- und Download-Routen verlangen zusätzlich zur
Vercel-Zugriffssperre eine gültige Clerk-Sitzung.
