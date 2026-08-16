# Auftrag: LV-Preisassistent nach GitHub und Vercel übernehmen

Du arbeitest lokal auf meinem PC im entpackten Projektordner. Handle als eigenständiger Coding-Agent: analysiere den vorhandenen Quellcode, führe Änderungen aus, teste sie, committe und pushe sie selbst. Bitte fordere mich nicht dazu auf, Dateien manuell zu GitHub hochzuladen oder selbst zu pushen. Pausiere nur bei einer notwendigen Browser-Anmeldung, einer kostenpflichtigen Auswahl oder einer sicherheitsrelevanten Entscheidung.

## Ziel

Übernimm den vorhandenen „LV Preisassistent“ vollständig in dieses private GitHub-Repository:

`https://github.com/Fatlind05/lv-preisassistent`

Danach soll das Repository mit Vercel verbunden sein. Jeder spätere Push auf `main` soll automatisch eine neue Vercel-Produktionsversion auslösen. Die bisherige funktionierende Seite darf erst abgeschaltet werden, wenn die Vercel-Version vollständig geprüft ist.

## Wichtige Ausgangslage

- Der Ordner enthält den vollständigen Quellcode der bisherigen App.
- Die bisherige App läuft als Vinext/Cloudflare-Worker-Anwendung.
- Sie verwendet Cloudflare D1 für Datensätze und R2 für Originaldateien.
- `.openai/hosting.json`, `worker/index.ts`, `vite.config.ts`, `db/index.ts` und `app/lib/document-storage.ts` gehören zu dieser bisherigen Architektur.
- Die tatsächlichen bereits hochgeladenen PDFs/Bilder und Datenbankinhalte sind **nicht** in diesem Quellcode-Paket enthalten. Sie liegen in der bisherigen privaten Hosting-Umgebung.
- Behalte deshalb die alte Live-Version als Rückfallmöglichkeit. Lösche oder überschreibe dort nichts.
- Committe niemals Passwörter, Tokens, `.env.local` oder andere Zugangsdaten.

## Arbeitsweise und GitHub

1. Prüfe zuerst `git --version`, `gh --version`, `gh auth status`, `node --version` und `npm --version`.
2. Falls GitHub noch nicht angemeldet ist, starte `gh auth login` und warte nur auf meine Browser-Freigabe. Frage niemals nach einem Passwort oder Token im Chat.
3. Prüfe, ob das Ziel-Repository leer ist. Arbeite ausschließlich mit `Fatlind05/lv-preisassistent`.
4. Initialisiere Git im aktuellen Projektordner, falls nötig, setze `main` als Hauptbranch und setze das GitHub-Repository als `origin`.
5. Erstelle zuerst einen unveränderten Baseline-Commit und Tag `sites-v10-original`, damit die ursprüngliche Version jederzeit wiederhergestellt werden kann.
6. Migriere anschließend auf demselben Repository zu einer Vercel-kompatiblen Anwendung.
7. Führe relevante Tests und einen Produktions-Build aus, bevor du auf `main` pushst.
8. Committe mit klaren kurzen Nachrichten und pushe selbst. Verwende keinen manuellen Datei-Upload.

## Vercel-Migration

Baue aus dem vorhandenen Projekt eine normale Next.js-App-Router-Anwendung für Vercel. Erhalte Oberfläche, Bedienung und fachliche Logik. Tausche nur die hostingabhängigen Teile aus.

- Verwende die vorhandene Next.js-/React-Oberfläche weiter.
- Stelle die Skripte auf einen normalen Next.js-Build um (`next dev`, `next build`, `next start`).
- Entferne Vinext-, Wrangler- und Worker-Abhängigkeiten aus der Vercel-Hauptversion, soweit sie dort nicht benötigt werden. Die Baseline und der Tag müssen die alte Architektur weiterhin enthalten.
- Ersetze Cloudflare D1 durch Neon Postgres aus dem Vercel Marketplace.
- Verwende Drizzle ORM mit PostgreSQL-Schema und überprüften Migrationen.
- Initialisiere die Datenbank lazy, damit `next build` nicht wegen einer noch fehlenden `DATABASE_URL` abstürzt.
- Ersetze R2 durch **privaten Vercel Blob Storage**.
- Nutze für bis zu 25 MB große Dateien direkte Client-Uploads zu Vercel Blob, damit keine Serverless-Request-Grenze verletzt wird. Der Server soll nur Upload-Tokens ausgeben und anschließend Metadaten registrieren.
- Originaldateien müssen privat bleiben und nur nach Anmeldung über eine geschützte Route geöffnet werden können.
- Lege `.env.example` nur mit Variablennamen und Erklärungen an. Keine echten Werte committen.
- Richte einen angemessenen Login für mich und meine Mitarbeiter ein. Nutze einen etablierten Vercel-kompatiblen Auth-Anbieter; frage mich nur dann, wenn eine einmalige Konto- oder Tarifentscheidung notwendig ist.

## Fachliche Funktionen, die erhalten bleiben müssen

### Alte Referenz-LVs

- Bis zu 500 alte Referenzdateien verwalten.
- Unterstützte Formate: `.xlsx`, `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`.
- Maximale Dateigröße aktuell 25 MB.
- Originaldatei sicher archivieren und später in der App wieder vollständig öffnen.
- Exakte Dubletten über SHA-256 erkennen und mit „bereits vorhanden“ ablehnen.
- Dateien, die nur fast gleich sind oder kleine Änderungen besitzen, sind **keine** Dubletten und müssen aufgenommen werden.
- Übersicht über Dateiname, Dateityp, Größe, Hausverwaltung, Anzahl Positionen, Status, Prüfhaken und Datum.
- Getrennte Kennzeichnung für alte Referenz-LVs und neu bearbeitete LVs.

### Leere oder ungewöhnlich kurze Referenz-LVs

- Ein scheinbar leeres oder deutlich kürzeres Referenz-LV darf gespeichert werden.
- Es erhält eine Warnung „Bitte prüfen“ und einen dauerhaft sichtbaren roten Punkt.
- Nach Prüfung kann der Nutzer einen Haken setzen; Status „Geprüft“.
- Der Haken muss wieder entfernbar sein.
- Der rote Punkt bleibt auch nach der Prüfung bestehen, damit das auffällige Dokument erkennbar bleibt.

### Auslesen und Struktur

- Excel, textbasierte PDFs, gescannte PDFs und normale Bilder auslesen.
- Bestehende clientseitige PDF.js-/Tesseract-OCR-Logik möglichst weiterverwenden, damit lange OCR-Läufe nicht in einer Vercel Function stattfinden.
- Kurztext und Langtext gemeinsam auswerten.
- Langtexte aus PDF-Anmerkungen bzw. Detailfeldern übernehmen, sofern sie im Dokument enthalten sind.
- Hausverwaltung erkennen und zuordnen.
- Positionen in `Gerüst`, `Innenarbeiten`, `Außenarbeiten` und `Sonstiges` strukturieren.
- Original-PDF oder Originalbild in der App in einer richtigen Vorschau öffnen können.

### Preiszuordnung

- Hauptkriterium ist die Leistungsbezeichnung aus Kurztext plus Langtext.
- Die Einheit ist **kein Matching-Kriterium** und darf einen ansonsten sicheren Treffer nicht verhindern.
- Menge und Einheit eines neuen LVs niemals verändern.
- Nur den **E-Preis/Einheitspreis** automatisch eintragen.
- Der Gesamtpreis bleibt Sache der vorhandenen Mengen-/Formellogik.
- Bereits vorhandene E-Preise nicht überschreiben.
- Nur sichere Treffer automatisch übernehmen.
- Bestehende Matching-Regeln erhalten:
  - Textähnlichkeit mindestens `0.88`.
  - Bei nicht exakt gleichem Text Abstand zum zweitbesten Treffer mindestens `0.06`.
  - Preisstreuung alter Treffer höchstens `25 %`.
  - Preis aus dem Median der sicheren alten Preise bilden.
- Unsichere, mehrdeutige oder stark abweichende Positionen offen lassen und deutlich erklären.
- Die 88 % sind Textähnlichkeit und keine Einheitengenauigkeit.
- Bei Hausverwaltung und Arbeitskategorie zuerst im passenden Bereich suchen, aber einen sinnvollen Fallback behalten, wenn dort keine Referenz existiert.

### Ergebnis

- Bei Excel-Dateien eine Kopie erzeugen, in der nur leere E-Preis-Zellen sicher befüllt werden.
- Keine Mengen, Einheiten, Positionstexte oder Formeln beschädigen.
- Treffer, offene Positionen, Quelle, Ähnlichkeit und Begründung übersichtlich anzeigen.
- Vor dem Download eine Prüfübersicht ermöglichen.

## Datenmodell

Übernimm die vorhandenen fachlichen Tabellen sinngemäß nach Postgres:

- `reference_files`
- `price_entries`
- `processing_jobs`
- `stored_documents`

Behalte insbesondere Fingerprint-Unique-Constraints, Dokumentstatus, `reviewed_at`, Hausverwaltung, Arbeitskategorie, Kurztext, Langtext, E-Preis und Herkunft bei. Passe SQLite-spezifische Typen und Defaults sauber an Postgres an.

## Vercel und automatische Deployments

1. Prüfe `vercel --version` und `vercel whoami`.
2. Falls nötig, starte die einmalige Vercel-Anmeldung und warte auf meine Browser-Freigabe.
3. Erstelle oder verbinde ein Vercel-Projekt namens `lv-preisassistent` mit dem GitHub-Repository.
4. Provisioniere Neon Postgres und Vercel Blob über Vercel/Marketplace, damit die Umgebungsvariablen sicher im Projekt gesetzt werden.
5. Führe Datenbankmigrationen kontrolliert aus.
6. Verbinde `main` mit Produktion; Pull Requests und andere Branches dürfen Preview-Deployments erzeugen.
7. Deploye erst, wenn der Build lokal erfolgreich ist.
8. Prüfe nach dem Deployment mindestens:
   - Anmeldung und Zugriffsschutz,
   - Upload einer Excel-Datei,
   - Upload und Öffnen einer PDF,
   - Upload und Öffnen eines Bildes,
   - exakte Dublettenerkennung,
   - fast gleiche Datei wird trotzdem angenommen,
   - Warnung/roter Punkt/Prüfhaken,
   - E-Preis-Matching trotz anderer Einheit,
   - kein Überschreiben vorhandener Preise,
   - Download einer korrekt befüllten Excel-Kopie.
9. Scanne Build- und Laufzeitfehler. Gib mir erst dann die Produktions-URL.
10. Lass die bisherige Seite online, bis ich die neue Vercel-Seite ausdrücklich freigegeben habe.

## Bereits vorhandene Daten

Das Paket enthält keine privaten D1-/R2-Inhalte. Erfinde keine Migration und behaupte nicht, die alten PDFs seien bereits übernommen. Sobald die Vercel-App funktioniert, kläre mit mir den sichersten Weg:

- bei wenigen vorhandenen Dateien: kontrollierter erneuter Upload über die neue App;
- bei vielen Dateien: separater, überprüfbarer Export-/Importprozess mit Fingerprint-Abgleich.

Keine Datei darf verloren gehen, doppelt angelegt oder öffentlich zugänglich gemacht werden.

## Abschlussbericht

Berichte am Ende kurz und konkret:

- GitHub-Repository und letzter Commit,
- erfolgreiche Tests und Build,
- Vercel-Produktions-URL und Status,
- eingerichtete Datenbank-/Dateispeicherung ohne Geheimwerte,
- ob bestehende Daten noch migriert werden müssen,
- wie zukünftige Änderungen automatisch gepusht und veröffentlicht werden.

Beginne jetzt mit einer Bestandsaufnahme des aktuellen Ordners. Ändere fachliche Funktionen nicht unnötig und frage nur bei echten Konto-, Kosten- oder Sicherheitsentscheidungen nach.
