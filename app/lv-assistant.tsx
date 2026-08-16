"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderUp,
  Image as ImageIcon,
  Layers3,
  LoaderCircle,
  LogOut,
  LockKeyhole,
  RefreshCw,
  ScanText,
  Search,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fingerprintFile, downloadMatchedDocument, parseLvFile } from "./lib/lv-parser";
import { matchPositions } from "./lib/lv-matcher";
import { WORK_CATEGORY_LABELS } from "./lib/lv-structure";
import type {
  CatalogEntry,
  CatalogStats,
  ParsedDocument,
  PositionMatch,
  ProcessingJob,
  RecentReference,
  StoredDocument,
  WorkCategory,
} from "./lib/lv-types";

type QueueStatus = "ready" | "reading" | "done" | "warning" | "duplicate" | "error";

type QueuedFile = {
  key: string;
  file: File;
  status: QueueStatus;
  message: string;
};

type LvAssistantProps = {
  displayName: string | null;
};

const EMPTY_STATS: CatalogStats = {
  referenceFiles: 0,
  priceEntries: 0,
  lastImportAt: null,
};

const ACCEPTED_FILE_TYPES =
  ".xlsx,.pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const MAX_REFERENCE_FILES = 500;
const SPARSE_REFERENCE_MESSAGE =
  "Dieses LV ist etwas leerer als die anderen. Es bleibt im Ordner – bitte einmal prüfen.";

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sparseReferenceMessage(positionCount: number, comparisonCounts: number[]): string | null {
  if (positionCount <= 0) return SPARSE_REFERENCE_MESSAGE;
  if (comparisonCounts.length < 2) return null;
  const typicalCount = median(comparisonCounts.filter((count) => count > 0));
  const sparseLimit = Math.max(2, Math.floor(typicalCount * 0.25));
  return typicalCount >= 8 && positionCount <= sparseLimit
    ? SPARSE_REFERENCE_MESSAGE
    : null;
}

function storedDocumentReviewMessage(
  document: StoredDocument,
  comparisonCounts: number[],
): string | null {
  if (document.purpose !== "reference") return null;
  if (["pruefen", "fehler"].includes(document.status)) return SPARSE_REFERENCE_MESSAGE;
  return sparseReferenceMessage(document.positionCount, comparisonCounts);
}

function storedDocumentStatusLabel(document: StoredDocument, needsReview: boolean): string {
  if (needsReview) return document.reviewedAt ? "Geprüft" : "Bitte prüfen";
  if (document.status === "eingelesen") return "Eingelesen";
  if (document.status === "verarbeitet") return "Verarbeitet";
  if (document.status === "gespeichert") return "Gespeichert";
  return "Fehler";
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("de-DE").format(value);
}

function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) return "Noch kein Import";
  const date = new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function formatFileSize(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function fileKind(file: File | null | undefined): "xlsx" | "pdf" | "image" | null {
  if (!file) return null;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xlsx") return "xlsx";
  if (extension === "pdf") return "pdf";
  if (["jpg", "jpeg", "png", "webp"].includes(extension ?? "")) return "image";
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "image";
  return null;
}

function fileKey(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export default function LvAssistant({ displayName }: LvAssistantProps) {
  const router = useRouter();
  const [stats, setStats] = useState<CatalogStats>(EMPTY_STATS);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [recentReferences, setRecentReferences] = useState<RecentReference[]>([]);
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([]);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [archivePurpose, setArchivePurpose] = useState<"all" | "reference" | "new_lv">("all");
  const [archivePreview, setArchivePreview] = useState<StoredDocument | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [reviewUpdatingId, setReviewUpdatingId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [locking, setLocking] = useState(false);

  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  const [newFile, setNewFile] = useState<File | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const pdfPreviewUrlRef = useRef<string | null>(null);
  const selectedNewFileKeyRef = useRef("");
  const newFileFingerprintRef = useRef<{ key: string; value: string } | null>(null);
  const [newFileArchiveCheck, setNewFileArchiveCheck] = useState<{
    status: "idle" | "checking" | "new" | "duplicate";
    document: StoredDocument | null;
  }>({ status: "idle", document: null });
  const [processing, setProcessing] = useState(false);
  const [processedDocument, setProcessedDocument] = useState<ParsedDocument | null>(null);
  const [matches, setMatches] = useState<PositionMatch[]>([]);
  const [resultMessage, setResultMessage] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [parseProgress, setParseProgress] = useState<{ value: number; label: string } | null>(null);
  const [propertyManagement, setPropertyManagement] = useState("");
  const [categoryOverride, setCategoryOverride] = useState<WorkCategory | "auto">("auto");

  const loadData = useCallback(async () => {
    try {
      const [catalogResponse, jobsResponse, filesResponse] = await Promise.all([
        fetch("/api/catalog", { cache: "no-store" }),
        fetch("/api/jobs", { cache: "no-store" }),
        fetch("/api/files", { cache: "no-store" }),
      ]);
      const catalogPayload = (await catalogResponse.json()) as {
        stats?: CatalogStats;
        entries?: CatalogEntry[];
        recentFiles?: RecentReference[];
        error?: string;
      };
      const jobsPayload = (await jobsResponse.json()) as { jobs?: ProcessingJob[] };
      const filesPayload = (await filesResponse.json()) as {
        documents?: StoredDocument[];
        error?: string;
      };
      if (!catalogResponse.ok) throw new Error(catalogPayload.error || "Preisbibliothek nicht erreichbar.");
      setStats(catalogPayload.stats ?? EMPTY_STATS);
      setCatalog(catalogPayload.entries ?? []);
      setRecentReferences(catalogPayload.recentFiles ?? []);
      setJobs(jobsPayload.jobs ?? []);
      setStoredDocuments(filesPayload.documents ?? []);
      setCatalogMessage(
        filesResponse.ok ? "" : filesPayload.error || "Dateiarchiv konnte nicht geladen werden.",
      );
    } catch (error) {
      setCatalogMessage(
        error instanceof Error ? error.message : "Preisbibliothek konnte nicht geladen werden.",
      );
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => () => {
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
  }, []);

  async function lockApplication() {
    if (locking) return;
    setLocking(true);
    try {
      await fetch("/api/access", { method: "DELETE" });
    } finally {
      router.replace("/code");
      router.refresh();
    }
  }

  const previewIsOpen = pdfPreviewOpen || Boolean(archivePreview);

  useEffect(() => {
    if (!previewIsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPdfPreviewOpen(false);
        setArchivePreview(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewIsOpen]);

  const matchedCount = useMemo(
    () => matches.filter((match) => match.status === "matched").length,
    [matches],
  );
  const openCount = useMemo(
    () => matches.filter((match) => match.status === "open").length,
    [matches],
  );
  const existingCount = useMemo(
    () => matches.filter((match) => match.status === "existing").length,
    [matches],
  );
  const categoryCounts = useMemo(() => {
    const counts: Record<WorkCategory, number> = {
      geruest: 0,
      innen: 0,
      aussen: 0,
      sonstiges: 0,
    };
    matches.forEach((match) => {
      counts[match.position.workCategory] += 1;
    });
    return counts;
  }, [matches]);
  const referencePositionCounts = useMemo(
    () =>
      storedDocuments
        .filter(
          (document) =>
            document.purpose === "reference" &&
            document.positionCount > 0 &&
            document.status !== "fehler",
        )
        .map((document) => document.positionCount),
    [storedDocuments],
  );
  const pendingReviewDocumentCount = useMemo(
    () =>
      storedDocuments.filter(
        (document) =>
          storedDocumentReviewMessage(document, referencePositionCounts) &&
          !document.reviewedAt,
      ).length,
    [referencePositionCounts, storedDocuments],
  );
  const filteredDocuments = useMemo(() => {
    const query = archiveSearch.trim().toLocaleLowerCase("de-DE");
    return storedDocuments.filter((document) => {
      if (archivePurpose !== "all" && document.purpose !== archivePurpose) return false;
      if (!query) return true;
      return `${document.fileName} ${document.propertyManagement}`
        .toLocaleLowerCase("de-DE")
        .includes(query);
    });
  }, [archivePurpose, archiveSearch, storedDocuments]);
  const legacyReferences = useMemo(() => {
    if (archivePurpose === "new_lv") return [];
    const archivedFingerprints = new Set(storedDocuments.map((document) => document.fingerprint));
    const query = archiveSearch.trim().toLocaleLowerCase("de-DE");
    return recentReferences.filter((reference) => {
      if (archivedFingerprints.has(reference.fingerprint)) return false;
      if (!query) return true;
      return `${reference.fileName} ${reference.propertyManagement}`
        .toLocaleLowerCase("de-DE")
        .includes(query);
    });
  }, [archivePurpose, archiveSearch, recentReferences, storedDocuments]);

  function addReferenceFiles(files: File[]) {
    const supported = files.filter((file) => fileKind(file));
    const unsupportedCount = files.length - supported.length;
    setQueue((current) => {
      const known = new Set(current.map((item) => item.key));
      const next = supported
        .filter((file) => !known.has(fileKey(file)))
        .map((file) => ({
          key: fileKey(file),
          file,
          status: "ready" as const,
          message: "Bereit zum Einlesen",
        }));
      return [...current, ...next].slice(0, MAX_REFERENCE_FILES);
    });
    if (unsupportedCount) {
      setCatalogMessage(
        "Einige Dateien wurden übersprungen. Erlaubt sind .xlsx, .pdf, .jpg, .png und .webp.",
      );
    }
  }

  function selectNewFile(file: File | null) {
    const selected = fileKind(file) ? file : null;
    if (pdfPreviewUrlRef.current) URL.revokeObjectURL(pdfPreviewUrlRef.current);
    const nextPreviewUrl =
      selected && fileKind(selected) === "pdf" ? URL.createObjectURL(selected) : null;
    pdfPreviewUrlRef.current = nextPreviewUrl;
    selectedNewFileKeyRef.current = selected ? fileKey(selected) : "";
    newFileFingerprintRef.current = null;
    setNewFile(selected);
    setPdfPreviewUrl(nextPreviewUrl);
    setPdfPreviewOpen(false);
    setProcessedDocument(null);
    setMatches([]);
    setResultMessage("");
    setNewFileArchiveCheck({ status: selected ? "checking" : "idle", document: null });
    setParseProgress(null);
    setPropertyManagement("");
    setCategoryOverride("auto");
    if (selected) void checkNewFileInArchive(selected);
  }

  async function checkNewFileInArchive(file: File) {
    const key = fileKey(file);
    try {
      const fingerprint = await fingerprintFile(file);
      if (selectedNewFileKeyRef.current !== key) return;
      newFileFingerprintRef.current = { key, value: fingerprint };
      const response = await fetch(`/api/files?fingerprint=${encodeURIComponent(fingerprint)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        duplicate?: boolean;
        document?: StoredDocument | null;
      };
      if (selectedNewFileKeyRef.current !== key) return;
      setNewFileArchiveCheck({
        status: payload.duplicate ? "duplicate" : "new",
        document: payload.document ?? null,
      });
    } catch {
      if (selectedNewFileKeyRef.current === key) {
        setNewFileArchiveCheck({ status: "new", document: null });
      }
    }
  }

  async function storeOriginalFile(file: File, purpose: "reference" | "new_lv") {
    const fingerprint = await fingerprintFile(file);
    const duplicateResponse = await fetch(
      `/api/files?fingerprint=${encodeURIComponent(fingerprint)}`,
      { cache: "no-store" },
    );
    const duplicatePayload = (await duplicateResponse.json()) as {
      duplicate?: boolean;
      document?: StoredDocument;
      error?: string;
    };
    if (!duplicateResponse.ok) {
      throw new Error(duplicatePayload.error || "Dateiarchiv konnte nicht geprüft werden.");
    }
    if (duplicatePayload.duplicate && duplicatePayload.document) {
      return { duplicate: true, document: duplicatePayload.document };
    }

    const id = crypto.randomUUID();
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "bin";
    await upload(`lv-dokumente/${id}.${extension}`, file, {
      access: "private",
      handleUploadUrl: "/api/files/upload",
      clientPayload: JSON.stringify({
        id,
        fileName: file.name,
        fingerprint,
        purpose,
      }),
      contentType: file.type || "application/octet-stream",
      multipart: file.size > 5 * 1024 * 1024,
    });

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await fetch(
        `/api/files?fingerprint=${encodeURIComponent(fingerprint)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        duplicate?: boolean;
        document?: StoredDocument;
      };
      if (response.ok && payload.document) {
        return { duplicate: Boolean(payload.duplicate), document: payload.document };
      }
      await wait(500);
    }

    throw new Error("Upload abgeschlossen, aber noch nicht im Dateiarchiv bestätigt.");
  }

  async function updateStoredDocument(
    id: string,
    status: StoredDocument["status"],
    propertyManagement: string,
    positionCount: number,
  ) {
    const response = await fetch("/api/files", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status, propertyManagement, positionCount }),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      throw new Error(payload.error || "Dateistatus konnte nicht gespeichert werden.");
    }
  }

  async function toggleDocumentReviewed(document: StoredDocument) {
    if (reviewUpdatingId) return;
    const reviewed = !document.reviewedAt;
    setReviewUpdatingId(document.id);
    setReviewError("");
    try {
      const response = await fetch("/api/files", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: document.id, reviewed }),
      });
      const payload = (await response.json()) as {
        reviewedAt?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Prüfstatus konnte nicht gespeichert werden.");
      }
      const reviewedAt = reviewed
        ? payload.reviewedAt ?? new Date().toISOString()
        : null;
      setStoredDocuments((current) =>
        current.map((entry) =>
          entry.id === document.id ? { ...entry, reviewedAt } : entry,
        ),
      );
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "Prüfstatus konnte nicht gespeichert werden.",
      );
    } finally {
      setReviewUpdatingId(null);
    }
  }

  function updateQueueItem(key: string, patch: Partial<QueuedFile>) {
    setQueue((current) =>
      current.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  async function importReferences() {
    const pending = queue.filter((item) => item.status === "ready" || item.status === "error");
    if (!pending.length || importing) return;
    setImporting(true);
    setCatalogMessage("");
    setImportProgress({ current: 0, total: pending.length });
    const comparisonCounts = recentReferences
      .map((reference) => reference.positionCount)
      .filter((count) => count > 0);

    for (let index = 0; index < pending.length; index += 1) {
      const item = pending[index];
      let storedDocumentId: string | null = null;
      updateQueueItem(item.key, { status: "reading", message: "Original wird archiviert …" });
      setImportProgress({ current: index + 1, total: pending.length });
      try {
        const archiveResult = await storeOriginalFile(item.file, "reference");
        if (archiveResult.duplicate) {
          updateQueueItem(item.key, {
            status: "duplicate",
            message: "Schon im Dateiarchiv – nicht doppelt gespeichert",
          });
          continue;
        }
        storedDocumentId = archiveResult.document.id;
        const fingerprint = archiveResult.document.fingerprint;
        const document = await parseLvFile(item.file, true, (progress, label) => {
          updateQueueItem(item.key, {
            message: `${label} · ${Math.round(progress * 100)} %`,
          });
        });
        if (!document.positions.length) {
          await updateStoredDocument(
            archiveResult.document.id,
            "pruefen",
            document.propertyManagement,
            0,
          );
          updateQueueItem(item.key, {
            status: "warning",
            message: SPARSE_REFERENCE_MESSAGE,
          });
          continue;
        }

        const sparseMessage = sparseReferenceMessage(
          document.positions.length,
          comparisonCounts,
        );

        const response = await fetch("/api/catalog", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fileName: item.file.name,
            fileType: document.kind,
            fingerprint,
            propertyManagement: document.propertyManagement,
            positions: document.positions.map((position) => ({
              positionCode: position.positionCode,
              shortDescription: position.shortDescription,
              longDescription: position.longDescription,
              description: position.description,
              normalizedDescription: position.normalizedDescription,
              workCategory: position.workCategory,
              unit: position.unit,
              unitPrice: position.unitPrice,
              sourceSheet: position.sheetName,
              sourceRow: position.rowNumber,
            })),
          }),
        });
        const payload = (await response.json()) as {
          imported?: number;
          duplicate?: boolean;
          error?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Import fehlgeschlagen.");
        await updateStoredDocument(
          archiveResult.document.id,
          sparseMessage ? "pruefen" : "eingelesen",
          document.propertyManagement,
          document.positions.length,
        );
        updateQueueItem(item.key, {
          status: sparseMessage ? "warning" : payload.duplicate ? "duplicate" : "done",
          message: sparseMessage
            ? `${formatNumber(payload.imported ?? document.positions.length)} Preise übernommen. ${sparseMessage}`
            : payload.duplicate
              ? "Preise waren schon vorhanden – Original jetzt archiviert"
              : `${formatNumber(payload.imported ?? document.positions.length)} Preise übernommen und Original archiviert`,
        });
        comparisonCounts.push(document.positions.length);
      } catch (error) {
        if (storedDocumentId) {
          await updateStoredDocument(storedDocumentId, "fehler", "", 0).catch(() => undefined);
        }
        updateQueueItem(item.key, {
          status: "error",
          message: error instanceof Error ? error.message : "Datei konnte nicht gelesen werden.",
        });
      }
    }

    await loadData();
    setImporting(false);
  }

  async function processNewLv() {
    if (!newFile || processing) return;
    if (!catalog.length) {
      setResultMessage("Lade zuerst mindestens ein ausgefülltes Referenz-LV hoch.");
      return;
    }
    setProcessing(true);
    setResultMessage("");
    setMatches([]);
    setProcessedDocument(null);
    setParseProgress(null);

    try {
      const cachedFingerprint = newFileFingerprintRef.current;
      const [document, fingerprint, archiveResult] = await Promise.all([
        parseLvFile(newFile, false, (value, label) => setParseProgress({ value, label })),
        cachedFingerprint?.key === fileKey(newFile)
          ? Promise.resolve(cachedFingerprint.value)
          : fingerprintFile(newFile),
        storeOriginalFile(newFile, "new_lv"),
      ]);
      if (!document.positions.length) {
        throw new Error(document.warnings[0] || "Keine LV-Positionen erkannt.");
      }
      const assignedManagement = propertyManagement.trim() || document.propertyManagement;
      const structuredDocument: ParsedDocument = {
        ...document,
        propertyManagement: assignedManagement,
        positions: document.positions.map((position) => ({
          ...position,
          propertyManagement: assignedManagement,
          workCategory:
            categoryOverride === "auto" ? position.workCategory : categoryOverride,
        })),
      };
      if (!propertyManagement && document.propertyManagement) {
        setPropertyManagement(document.propertyManagement);
      }
      const result = matchPositions(structuredDocument.positions, catalog);
      setProcessedDocument(structuredDocument);
      setMatches(result);
      const safe = result.filter((match) => match.status === "matched").length;
      const open = result.filter((match) => match.status === "open").length;
      const longTexts = structuredDocument.positions.filter(
        (position) => position.longDescription,
      ).length;
      const structureNote = longTexts
        ? ` ${longTexts} Langtexte wurden ausgelesen und zugeordnet.`
        : document.kind === "pdf"
          ? " In dieser PDF war kein Langtext gespeichert; nur der Kurztext konnte ausgelesen werden."
          : "";
      const archiveNote = archiveResult.duplicate
        ? " Die Originaldatei war bereits im Archiv und wurde nicht doppelt gespeichert."
        : " Die Originaldatei wurde im Dateiarchiv gespeichert.";
      setResultMessage(
        safe
          ? `${safe} sichere Preise wurden eingesetzt. ${open} Positionen bleiben zur Kontrolle offen.${structureNote}${archiveNote}`
          : `Keine Position war eindeutig genug. Alle Preise bleiben unverändert.${structureNote}${archiveNote}`,
      );

      if (!archiveResult.duplicate) {
        await updateStoredDocument(
          archiveResult.document.id,
          "verarbeitet",
          assignedManagement,
          structuredDocument.positions.length,
        );
      }

      const jobResponse = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: newFile.name,
          fileType: document.kind,
          fingerprint,
          totalPositions: result.length,
          matchedCount: safe,
          openCount: open,
        }),
      });
      if (!jobResponse.ok) {
        const payload = (await jobResponse.json()) as { error?: string };
        throw new Error(payload.error || "Verlauf konnte nicht gespeichert werden.");
      }
      await loadData();
    } catch (error) {
      setResultMessage(error instanceof Error ? error.message : "Das LV konnte nicht verarbeitet werden.");
    } finally {
      setProcessing(false);
      setParseProgress(null);
    }
  }

  async function downloadResult() {
    if (!processedDocument || !matches.length || downloading) return;
    setDownloading(true);
    try {
      await downloadMatchedDocument(processedDocument, matches);
    } finally {
      setDownloading(false);
    }
  }

  function updateManagement(value: string) {
    setPropertyManagement(value);
    if (!processedDocument) return;
    const updatedDocument: ParsedDocument = {
      ...processedDocument,
      propertyManagement: value.trim(),
      positions: processedDocument.positions.map((position) => ({
        ...position,
        propertyManagement: value.trim(),
      })),
    };
    setProcessedDocument(updatedDocument);
    setMatches(matchPositions(updatedDocument.positions, catalog));
  }

  function updatePositionCategory(positionId: string, workCategory: WorkCategory) {
    if (!processedDocument) return;
    const updatedDocument: ParsedDocument = {
      ...processedDocument,
      positions: processedDocument.positions.map((position) =>
        position.id === positionId ? { ...position, workCategory } : position,
      ),
    };
    setProcessedDocument(updatedDocument);
    setMatches(matchPositions(updatedDocument.positions, catalog));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#start" aria-label="LV Preisassistent Startseite">
          <span className="brand-mark">LV</span>
          <span>
            <strong>Preisassistent</strong>
            <small>Maler & Lackierer</small>
          </span>
        </a>
        <nav className="topnav" aria-label="Hauptnavigation">
          <a href="#ausfuellen">Neues LV</a>
          <a href="#dateiordner">PDF-Ordner</a>
          <a href="#preisarchiv">Preisarchiv</a>
          <a href="#verlauf">Verlauf</a>
        </nav>
        <button
          className="user-chip user-chip-button"
          type="button"
          onClick={() => void lockApplication()}
          title="App wieder sperren"
          disabled={locking}
        >
          <span className="user-avatar" aria-hidden="true"><LockKeyhole size={14} /></span>
          <span className="user-copy">
            <strong>{displayName?.split("@")[0] || "Fatlind"}</strong>
            <small>Mit Code geöffnet</small>
          </span>
          <LogOut className="user-logout" size={14} aria-hidden="true" />
        </button>
      </header>

      <section className="hero" id="start">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={15} /> Deine Preise. Automatisch eingesetzt.</div>
          <h1>Leistungsverzeichnisse in Minuten bepreisen.</h1>
          <p>
            Die App lernt aus deinen bereits ausgefüllten LVs und übernimmt in neue
            Leistungsverzeichnisse ausschließlich <strong>sichere Einheitspreise</strong> –
            auch aus einem Foto deiner LV-Tabelle.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#ausfuellen">
              Neues LV ausfüllen <ArrowRight size={18} />
            </a>
            <a className="button ghost" href="#preisarchiv">
              Preisarchiv erweitern
            </a>
            <a className="button ghost" href="#dateiordner">
              <FolderOpen size={18} /> PDF-Ordner öffnen
            </a>
          </div>
        </div>
        <div className="flow-card" aria-label="Ablauf">
          <div className="flow-step complete">
            <span><Archive size={18} /></span>
            <div><small>Schritt 1</small><strong>Alte LVs einlesen</strong></div>
            <Check size={18} />
          </div>
          <div className="flow-line" />
          <div className="flow-step active">
            <span><FileSpreadsheet size={18} /></span>
            <div><small>Schritt 2</small><strong>Neues LV hochladen</strong></div>
            <ChevronRight size={18} />
          </div>
          <div className="flow-line muted" />
          <div className="flow-step">
            <span><Download size={18} /></span>
            <div><small>Schritt 3</small><strong>Ausgefüllt herunterladen</strong></div>
          </div>
          <div className="safety-note"><ShieldCheck size={17} /> Unsichere Positionen bleiben leer.</div>
        </div>
      </section>

      <section className="workspace" id="ausfuellen">
        <div className="section-heading">
          <div>
            <span className="step-pill">01</span>
            <h2>Neues LV automatisch ausfüllen</h2>
            <p>Excel, PDF oder Foto auswählen – deine Originaldatei bleibt erhalten.</p>
          </div>
          <div className="confidence-badge"><ShieldCheck size={16} /> Nur sichere Treffer</div>
        </div>

        <div className="process-grid">
          <div className="upload-panel main-upload">
            <input
              id="new-lv-file"
              className="sr-only"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                selectNewFile(file);
                event.currentTarget.value = "";
              }}
            />
            {!newFile ? (
              <label
                className="dropzone"
                htmlFor="new-lv-file"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file && fileKind(file)) {
                    selectNewFile(file);
                  }
                }}
              >
                <span className="drop-icon"><UploadCloud size={30} /></span>
                <strong>Neues Leistungsverzeichnis hier ablegen</strong>
                <span>oder zum Auswählen klicken</span>
                <small><FileSpreadsheet size={14} /> Excel <i /> <FileText size={14} /> PDF <i /> <ImageIcon size={14} /> Foto · max. 25 MB</small>
              </label>
            ) : (
              <div className="selected-file">
                <span className="file-type-icon">
                  {fileKind(newFile) === "pdf" ? (
                    <FileText size={26} />
                  ) : fileKind(newFile) === "image" ? (
                    <ImageIcon size={26} />
                  ) : (
                    <FileSpreadsheet size={26} />
                  )}
                </span>
                <div>
                  <strong>{newFile.name}</strong>
                  <small>
                    {(newFile.size / 1024 / 1024).toFixed(2)} MB · {fileKind(newFile) === "image" ? "bereit zur Texterkennung" : "bereit zum Abgleich"}
                  </small>
                </div>
                <span className="selected-file-actions">
                  {pdfPreviewUrl && (
                    <button
                      className="file-preview-button"
                      type="button"
                      onClick={() => setPdfPreviewOpen(true)}
                    >
                      <Eye size={16} /> PDF ansehen
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Datei entfernen"
                    onClick={() => selectNewFile(null)}
                  ><X size={18} /></button>
                </span>
              </div>
            )}
            {newFileArchiveCheck.status === "checking" && (
              <div className="archive-check checking">
                <LoaderCircle className="spin" size={16} /> Dateiarchiv wird auf Doppelung geprüft …
              </div>
            )}
            {newFileArchiveCheck.status === "duplicate" && (
              <div className="archive-check duplicate">
                <CheckCircle2 size={17} />
                <div>
                  <strong>Schon vorhanden</strong>
                  <span>Diese Datei ist bereits im Archiv und wird nicht doppelt gespeichert.</span>
                </div>
                {newFileArchiveCheck.document && ["pdf", "image"].includes(newFileArchiveCheck.document.fileType) && (
                  <button type="button" onClick={() => setArchivePreview(newFileArchiveCheck.document)}>
                    <Eye size={15} /> Öffnen
                  </button>
                )}
              </div>
            )}
            {newFile && (
              <div className="structure-controls">
                <label>
                  <span><Building2 size={14} /> Hausverwaltung / Kunde</span>
                  <input
                    type="text"
                    value={propertyManagement}
                    onChange={(event) => updateManagement(event.target.value)}
                    placeholder="Leer lassen = automatisch aus Datei erkennen"
                    disabled={processing}
                  />
                </label>
                <label>
                  <span><Layers3 size={14} /> Arbeitsbereich</span>
                  <select
                    value={categoryOverride}
                    onChange={(event) =>
                      setCategoryOverride(event.target.value as WorkCategory | "auto")
                    }
                    disabled={processing}
                  >
                    <option value="auto">Automatisch je Position</option>
                    <option value="geruest">Alles: Gerüst</option>
                    <option value="innen">Alles: Innenarbeit</option>
                    <option value="aussen">Alles: Außenarbeit</option>
                    <option value="sonstiges">Alles: Sonstiges</option>
                  </select>
                </label>
              </div>
            )}
            {newFile && fileKind(newFile) === "pdf" && (
              <div className="pdf-read-note">
                <ScanText size={17} />
                <div>
                  <strong>Kurz- und Langtext werden ausgelesen</strong>
                  <span>Die App prüft normalen PDF-Text sowie eingebettete Kommentare und Formularfelder. Der Langtext muss in der PDF-Datei gespeichert sein.</span>
                </div>
              </div>
            )}
            {newFile && (
              <div className="price-only-note">
                <ShieldCheck size={17} />
                <div>
                  <strong>Nur der E-Preis wird eingesetzt</strong>
                  <span>Für den Abgleich zählen Bezeichnung, Kurz- und Langtext. Die Einheit blockiert keinen Treffer und bleibt im Original unverändert. Vorhandene Gesamtpreis-Formeln rechnen beim Öffnen neu.</span>
                </div>
              </div>
            )}
            <button
              className="button primary wide"
              type="button"
              disabled={!newFile || processing || catalogLoading}
              onClick={() => void processNewLv()}
            >
              {processing ? (
                <><LoaderCircle className="spin" size={18} /> {parseProgress?.label ?? "Preise werden abgeglichen …"}</>
              ) : (
                <><Sparkles size={18} /> Sicher ausfüllen</>
              )}
            </button>
            {processing && parseProgress && (
              <div
                className="ocr-progress"
                role="progressbar"
                aria-label={parseProgress.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(parseProgress.value * 100)}
              >
                <div><ScanText size={14} /><span>{parseProgress.label}</span><strong>{Math.round(parseProgress.value * 100)} %</strong></div>
                <span><i style={{ width: `${Math.round(parseProgress.value * 100)}%` }} /></span>
              </div>
            )}
            <p className="privacy-line"><LockKeyhole size={14} /> Originaldateien werden sicher im gemeinsamen Dateiarchiv gespeichert.</p>
          </div>

          <aside className="library-summary">
            <div className="summary-top">
              <span className="summary-icon"><Archive size={22} /></span>
              <div><small>Deine Preisbibliothek</small><strong>{formatNumber(stats.priceEntries)} Preispositionen</strong></div>
              <span className={stats.priceEntries ? "status-dot online" : "status-dot"} />
            </div>
            <dl className="summary-stats">
              <div><dt>Referenz-LVs</dt><dd>{formatNumber(stats.referenceFiles)}</dd></div>
              <div><dt>Letzter Import</dt><dd>{formatDate(stats.lastImportAt)}</dd></div>
              <div><dt>Abgleichregel</dt><dd>≥ 88 % Text</dd></div>
              <div><dt>Einheit</dt><dd>Kein Ausschluss</dd></div>
            </dl>
            <div className="summary-links">
              <a href="#dateiordner" className="text-link"><FolderOpen size={16} /> PDF-Ordner öffnen</a>
              <a href="#preisarchiv" className="text-link"><FolderUp size={16} /> Weitere alte LVs einlesen</a>
            </div>
            {catalogMessage && <div className="inline-warning"><CircleAlert size={15} /> {catalogMessage}</div>}
          </aside>
        </div>

        {(resultMessage || matches.length > 0) && (
          <div className="result-card" aria-live="polite">
            <div className="result-header">
              <div className="result-title">
                <span className={matchedCount ? "result-check success" : "result-check"}>
                  {matchedCount ? <CheckCircle2 size={26} /> : <CircleAlert size={26} />}
                </span>
                <div><small>Abgleich abgeschlossen</small><h3>{processedDocument?.fileName ?? "Ergebnis"}</h3><p>{resultMessage}</p></div>
              </div>
              {matches.length > 0 && (
                <button className="button primary" type="button" onClick={() => void downloadResult()} disabled={downloading}>
                  {downloading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
                  Ausgefülltes LV herunterladen
                </button>
              )}
            </div>
            {matches.length > 0 && (
              <>
                <div className="result-metrics">
                  <div className="metric good"><strong>{matchedCount}</strong><span>Sicher übernommen</span></div>
                  <div className="metric"><strong>{existingCount}</strong><span>Schon bepreist</span></div>
                  <div className="metric warn"><strong>{openCount}</strong><span>Bleiben offen</span></div>
                </div>
                <div className="structure-summary">
                  <span><Building2 size={15} /><strong>Hausverwaltung:</strong> {processedDocument?.propertyManagement || "Nicht erkannt – bitte zuordnen"}</span>
                  {(Object.keys(WORK_CATEGORY_LABELS) as WorkCategory[]).map((category) =>
                    categoryCounts[category] ? (
                      <span className={`category-chip ${category}`} key={category}>
                        {WORK_CATEGORY_LABELS[category]} · {categoryCounts[category]}
                      </span>
                    ) : null,
                  )}
                </div>
                <div className="results-table-wrap">
                  <table className="results-table">
                    <thead><tr><th>Status</th><th>Pos.</th><th>Bereich</th><th>Kurz- & Langtext</th><th>Einheit</th><th>Preis</th><th>Sicherheit</th></tr></thead>
                    <tbody>
                      {matches.slice(0, 80).map((match) => (
                        <tr key={match.position.id}>
                          <td><span className={`match-tag ${match.status}`}>
                            {match.status === "matched" ? "Übernommen" : match.status === "existing" ? "Vorhanden" : "Offen"}
                          </span></td>
                          <td>{match.position.positionCode || "—"}</td>
                          <td>
                            <select
                              className={`category-select ${match.position.workCategory}`}
                              value={match.position.workCategory}
                              aria-label={`Arbeitsbereich für Position ${match.position.positionCode || match.position.rowNumber}`}
                              onChange={(event) =>
                                updatePositionCategory(
                                  match.position.id,
                                  event.target.value as WorkCategory,
                                )
                              }
                            >
                              {(Object.keys(WORK_CATEGORY_LABELS) as WorkCategory[]).map((category) => (
                                <option value={category} key={category}>{WORK_CATEGORY_LABELS[category]}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {match.position.longDescription ? (
                              <details className="longtext-details">
                                <summary>{match.position.shortDescription}</summary>
                                <p>{match.position.longDescription}</p>
                              </details>
                            ) : (
                              <strong>{match.position.shortDescription || match.position.description}</strong>
                            )}
                            <small>{match.reason}</small>
                          </td>
                          <td>{match.position.unit || "—"}</td>
                          <td className="price-cell">{formatCurrency(match.unitPrice)}</td>
                          <td>{match.status === "open" && match.confidence === 0 ? "—" : `${Math.round(match.confidence * 100)} %`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="archive-section" id="preisarchiv">
        <div className="section-heading">
          <div><span className="step-pill">02</span><h2>Deine alten LVs einlesen</h2><p>Bis zu 500 ausgefüllte Leistungsverzeichnisse auf einmal hinzufügen.</p></div>
          <div className="team-badge"><Users size={16} /> Für dich und dein Team</div>
        </div>
        <div className="archive-grid">
          <div className="upload-panel">
            <input
              id="reference-files"
              className="sr-only"
              type="file"
              accept={ACCEPTED_FILE_TYPES}
              multiple
              onChange={(event) => {
                addReferenceFiles(Array.from(event.target.files ?? []));
                event.currentTarget.value = "";
              }}
            />
            <label
              className="dropzone compact"
              htmlFor="reference-files"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addReferenceFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <span className="drop-icon"><FolderUp size={27} /></span>
              <strong>Ausgefüllte Referenz-LVs auswählen</strong>
              <span>Mehrfachauswahl und Drag & Drop möglich</span>
              <small>Excel, PDF oder Foto (JPG/PNG/WEBP) · höchstens 500 Dateien</small>
            </label>
            {queue.length > 0 && (
              <div className="queue">
                <div className="queue-head"><strong>{queue.length} Datei{queue.length === 1 ? "" : "en"}</strong><button type="button" onClick={() => !importing && setQueue([])} disabled={importing}>Liste leeren</button></div>
                <div className="queue-list">
                  {queue.map((item) => (
                    <div className="queue-item" key={item.key}>
                      <span className={`queue-status ${item.status}`}>
                        {item.status === "reading" ? <LoaderCircle className="spin" size={16} /> : item.status === "done" ? <Check size={16} /> : item.status === "warning" ? <CircleAlert size={16} /> : item.status === "duplicate" ? <Archive size={16} /> : item.status === "error" ? <CircleAlert size={16} /> : fileKind(item.file) === "image" ? <ImageIcon size={16} /> : <FileSpreadsheet size={16} />}
                      </span>
                      <div><strong>{item.file.name}</strong><small>{item.message}</small></div>
                      {!importing && item.status === "ready" && <button className="icon-button small" type="button" aria-label="Datei entfernen" onClick={() => setQueue((current) => current.filter((entry) => entry.key !== item.key))}><X size={15} /></button>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button className="button dark wide" type="button" disabled={!queue.length || importing} onClick={() => void importReferences()}>
              {importing ? <><LoaderCircle className="spin" size={18} /> Datei {importProgress.current} von {importProgress.total}</> : <><Archive size={18} /> Preise in Archiv übernehmen</>}
            </button>
          </div>

          <div className="archive-overview" id="dateiordner">
            <div className="overview-kpis">
              <article><span><Archive size={19} /></span><small>Originaldateien</small><strong>{formatNumber(storedDocuments.length)}</strong></article>
              <article><span><FileCheck2 size={19} /></span><small>Referenz-LVs</small><strong>{formatNumber(stats.referenceFiles)}</strong></article>
              <article><span><Sparkles size={19} /></span><small>Nutzbare Preise</small><strong>{formatNumber(stats.priceEntries)}</strong></article>
            </div>
            <div className="recent-files">
              <div className="card-title"><div><strong><FolderOpen size={16} /> PDF-Ordner</strong><small>Alle alten und neuen Dateien wiederfinden und öffnen</small></div><button className="icon-button" type="button" aria-label="Aktualisieren" onClick={() => void loadData()}><RefreshCw size={16} /></button></div>
              <div className="archive-tools">
                <label>
                  <Search size={14} />
                  <input
                    type="search"
                    value={archiveSearch}
                    onChange={(event) => setArchiveSearch(event.target.value)}
                    placeholder="Dateiname oder Hausverwaltung suchen"
                  />
                </label>
                <select
                  value={archivePurpose}
                  onChange={(event) => setArchivePurpose(event.target.value as typeof archivePurpose)}
                  aria-label="Dateiarchiv filtern"
                >
                  <option value="all">Alle Dateien</option>
                  <option value="reference">Alte Referenz-LVs</option>
                  <option value="new_lv">Neue LVs</option>
                </select>
              </div>
              {legacyReferences.length > 0 && (
                <div className="legacy-files-note">
                  <CircleAlert size={17} />
                  <div>
                    <strong>{legacyReferences.length} ältere Datei{legacyReferences.length === 1 ? "" : "en"}: Original fehlt noch</strong>
                    <span>Diese LVs wurden vor dem PDF-Ordner eingelesen. Lade die Originale links einmal erneut hoch; Preise werden dabei nicht doppelt gespeichert.</span>
                  </div>
                  <label htmlFor="reference-files"><UploadCloud size={15} /> Nachtragen</label>
                </div>
              )}
              {reviewError && (
                <div className="review-files-note error-note">
                  <CircleAlert size={17} />
                  <div><strong>Prüfstatus nicht gespeichert</strong><span>{reviewError}</span></div>
                </div>
              )}
              {pendingReviewDocumentCount > 0 && (
                <div className="review-files-note">
                  <CircleAlert size={17} />
                  <div>
                    <strong>{pendingReviewDocumentCount} LV{pendingReviewDocumentCount === 1 ? "" : "s"} noch nicht geprüft</strong>
                    <span>Auffällig leere Dateien haben einen roten Punkt. Mit dem Haken markierst du sie als geprüft.</span>
                  </div>
                </div>
              )}
              {filteredDocuments.length || legacyReferences.length ? (
                <div className="archive-document-list">
                  {filteredDocuments.map((document) => {
                    const reviewMessage = storedDocumentReviewMessage(
                      document,
                      referencePositionCounts,
                    );
                    const needsReview = Boolean(reviewMessage);
                    const isReviewed = needsReview && Boolean(document.reviewedAt);
                    return (
                      <div className={`archive-document-row${needsReview ? " needs-review" : ""}${isReviewed ? " reviewed" : ""}`} key={document.id}>
                        <span className="archive-file-icon">
                          {document.fileType === "pdf" ? <FileText size={18} /> : document.fileType === "image" ? <ImageIcon size={18} /> : <FileSpreadsheet size={18} />}
                          {needsReview && <i className="sparse-dot" role="img" aria-label="Dieses LV hat weniger Inhalt" title="Dieses LV hat weniger Inhalt" />}
                        </span>
                        <div>
                          <strong>{document.fileName}</strong>
                          <small>
                            {document.purpose === "reference" ? "Referenz-LV" : "Neues LV"} · {formatFileSize(document.fileSize)} · {formatDate(document.createdAt)}
                          </small>
                          <small>{document.propertyManagement || "Ohne Hausverwaltung"} · {formatNumber(document.positionCount)} Preispositionen</small>
                          {reviewMessage && !isReviewed && <small className="document-review-copy">{reviewMessage}</small>}
                        </div>
                        <span className={`document-status ${isReviewed ? "reviewed" : needsReview ? "pruefen" : document.status}`}>
                          {storedDocumentStatusLabel(document, needsReview)}
                        </span>
                        <span className="document-actions">
                          {needsReview && (
                            <button
                              className={`review-toggle${isReviewed ? " checked" : ""}`}
                              type="button"
                              aria-pressed={isReviewed}
                              aria-label={isReviewed ? `Prüfung für ${document.fileName} zurücknehmen` : `${document.fileName} als geprüft markieren`}
                              title={isReviewed ? "Haken wieder entfernen" : "Als geprüft markieren"}
                              disabled={Boolean(reviewUpdatingId)}
                              onClick={() => void toggleDocumentReviewed(document)}
                            >
                              {reviewUpdatingId === document.id ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
                            </button>
                          )}
                          {["pdf", "image"].includes(document.fileType) ? (
                            <button type="button" onClick={() => setArchivePreview(document)} aria-label={`${document.fileName} öffnen`} title="Datei öffnen">
                              <Eye size={16} />
                            </button>
                          ) : (
                            <a href={`/api/files/${document.id}`} target="_blank" rel="noreferrer" aria-label={`${document.fileName} öffnen`} title="Datei öffnen">
                              <ExternalLink size={16} />
                            </a>
                          )}
                        </span>
                      </div>
                    );
                  })}
                  {legacyReferences.map((reference) => (
                    <div className="archive-document-row legacy-missing" key={`legacy-${reference.id}`}>
                      <span>{reference.fileType === "pdf" ? <FileText size={18} /> : reference.fileType === "image" ? <ImageIcon size={18} /> : <FileSpreadsheet size={18} />}</span>
                      <div>
                        <strong>{reference.fileName}</strong>
                        <small>Referenz-LV · {formatDate(reference.createdAt)}</small>
                        <small>{reference.propertyManagement || "Ohne Hausverwaltung"} · Original noch nicht gespeichert</small>
                      </div>
                      <span className="document-status fehlt">Original fehlt</span>
                      <label htmlFor="reference-files" aria-label={`${reference.fileName} erneut hochladen`} title="Original einmal erneut hochladen">
                        <UploadCloud size={16} />
                      </label>
                    </div>
                  ))}
                </div>
              ) : <div className="empty-card"><FolderOpen size={23} /><strong>Der PDF-Ordner ist noch leer</strong><span>Neue Uploads erscheinen hier dauerhaft und lassen sich wieder öffnen.</span></div>}
            </div>
          </div>
        </div>
      </section>

      <section className="history-section" id="verlauf">
        <div className="section-heading small-heading"><div><span className="step-pill">03</span><h2>Letzte Bearbeitungen</h2></div></div>
        <div className="history-card">
          {jobs.length ? jobs.slice(0, 8).map((job) => (
            <div className="history-row" key={job.id}>
              <span className="history-icon"><Clock3 size={18} /></span>
              <div><strong>{job.fileName}</strong><small>{formatDate(job.createdAt)} · {job.processedBy?.split("@")[0] || "Team"}</small></div>
              <div className="history-result"><strong>{job.matchedCount} sicher</strong><small>{job.openCount} offen</small></div>
            </div>
          )) : <div className="empty-history"><Clock3 size={22} /> Noch keine neuen LVs verarbeitet.</div>}
        </div>
      </section>

      {pdfPreviewOpen && pdfPreviewUrl && newFile && (
        <div
          className="pdf-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPdfPreviewOpen(false);
          }}
        >
          <section
            className="pdf-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pdf-preview-title"
          >
            <header>
              <div>
                <small>Hochgeladene Originaldatei</small>
                <strong id="pdf-preview-title">{newFile.name}</strong>
              </div>
              <span>
                <a href={pdfPreviewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> In neuem Tab öffnen
                </a>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="PDF-Vorschau schließen"
                  onClick={() => setPdfPreviewOpen(false)}
                >
                  <X size={18} />
                </button>
              </span>
            </header>
            <iframe
              src={`${pdfPreviewUrl}#toolbar=1&navpanes=0`}
              title={`PDF-Vorschau: ${newFile.name}`}
            />
            <p>Falls dein Browser die Vorschau nicht anzeigt, nutze „In neuem Tab öffnen“.</p>
          </section>
        </div>
      )}

      {archivePreview && (
        <div
          className="pdf-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setArchivePreview(null);
          }}
        >
          <section
            className="pdf-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-preview-title"
          >
            <header>
              <div>
                <small>Dateiarchiv · {archivePreview.purpose === "reference" ? "Referenz-LV" : "Neues LV"}</small>
                <strong id="archive-preview-title">{archivePreview.fileName}</strong>
              </div>
              <span>
                <a href={`/api/files/${archivePreview.id}`} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> In neuem Tab öffnen
                </a>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Archivvorschau schließen"
                  onClick={() => setArchivePreview(null)}
                >
                  <X size={18} />
                </button>
              </span>
            </header>
            {archivePreview.fileType === "image" ? (
              <div className="archive-image-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${archivePreview.id}`} alt={archivePreview.fileName} />
              </div>
            ) : (
              <iframe
                src={`/api/files/${archivePreview.id}#toolbar=1&navpanes=0`}
                title={`Archivvorschau: ${archivePreview.fileName}`}
              />
            )}
            <p>Die Originaldatei bleibt im gemeinsamen Archiv und kann jederzeit erneut geöffnet werden.</p>
          </section>
        </div>
      )}

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">LV</span><span><strong>Preisassistent</strong><small>Sicher kalkulieren</small></span></div>
        <p><ShieldCheck size={15} /> Preise werden nur bei eindeutigen Treffern eingesetzt.</p>
      </footer>
    </main>
  );
}
