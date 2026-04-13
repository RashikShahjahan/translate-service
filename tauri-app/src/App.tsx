import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { startTransition, useEffect, useEffectEvent, useState, type FormEvent } from "react";

type ProjectSummary = {
  id: number;
  name: string;
  createdAt: string;
  totalDocuments: number;
  queuedDocuments: number;
  processingDocuments: number;
  completedDocuments: number;
  erroredDocuments: number;
};

type DocumentRow = {
  id: number;
  sourceName: string;
  sourceType: string;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  leasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type DocumentDetail = {
  id: number;
  projectName: string;
  sourceName: string;
  sourceType: string;
  mimeType: string | null;
  sourceText: string | null;
  ocrText: string | null;
  translatedText: string | null;
  status: string;
  errorMessage: string | null;
  retryCount: number;
  nextAttemptAt: string | null;
  leasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const POLL_INTERVAL_MS = 4000;

const STATUS_STYLES: Record<string, string> = {
  pending_ocr: "bg-amber-400/12 text-amber-200 ring-1 ring-inset ring-amber-300/20",
  processing_ocr:
    "bg-sky-400/12 text-sky-200 ring-1 ring-inset ring-sky-300/20",
  pending_translation:
    "bg-violet-400/12 text-violet-200 ring-1 ring-inset ring-violet-300/20",
  processing_translation:
    "bg-cyan-400/12 text-cyan-200 ring-1 ring-inset ring-cyan-300/20",
  completed: "bg-emerald-400/12 text-emerald-200 ring-1 ring-inset ring-emerald-300/20",
};

const STATUS_LABELS: Record<string, string> = {
  pending_ocr: "Queued OCR",
  processing_ocr: "Running OCR",
  pending_translation: "Queued Translation",
  processing_translation: "Translating",
  completed: "Completed",
};

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function getStatusClass(status: string) {
  return STATUS_STYLES[status] ?? "bg-white/8 text-slate-200 ring-1 ring-inset ring-white/10";
}

function messageFromError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

async function selectFilePaths(options: {
  directory?: boolean;
  multiple?: boolean;
}) {
  const selection = await open({
    directory: options.directory,
    multiple: options.multiple,
    title: options.directory ? "Choose a folder to import" : "Choose files to import",
  });

  if (!selection) {
    return [];
  }

  return Array.isArray(selection) ? selection : [selection];
}

function StatCard(props: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/5 p-4 shadow-lg shadow-slate-950/30">
      <div className={`text-xs font-semibold uppercase tracking-[0.28em] ${props.accent}`}>
        {props.label}
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-white">{props.value}</div>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [projectNameInput, setProjectNameInput] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");

  const selectedProject =
    projects.find((project) => project.name === selectedProjectName) ?? null;

  const refreshProjects = useEffectEvent(async (silent = false) => {
    if (!silent) {
      setLoadingProjects(true);
    }

    try {
      const nextProjects = await invoke<ProjectSummary[]>("list_projects");
      setProjects(nextProjects);
      setSelectedProjectName((current) => {
        if (current && nextProjects.some((project) => project.name === current)) {
          return current;
        }
        return nextProjects[0]?.name ?? "";
      });
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingProjects(false);
      }
    }
  });

  const refreshDocuments = useEffectEvent(async (projectName: string, silent = false) => {
    if (!projectName) {
      setDocuments([]);
      setSelectedDocumentId(null);
      setDetail(null);
      return;
    }

    if (!silent) {
      setLoadingDocuments(true);
    }

    try {
      const nextDocuments = await invoke<DocumentRow[]>("list_documents", { projectName });
      setDocuments(nextDocuments);
      setSelectedDocumentId((current) => {
        if (current && nextDocuments.some((document) => document.id === current)) {
          return current;
        }
        return nextDocuments[0]?.id ?? null;
      });
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingDocuments(false);
      }
    }
  });

  const refreshDetail = useEffectEvent(async (documentId: number | null, silent = false) => {
    if (documentId === null) {
      setDetail(null);
      return;
    }

    if (!silent) {
      setLoadingDetail(true);
    }

    try {
      const nextDetail = await invoke<DocumentDetail | null>("get_document_detail", {
        documentId,
      });
      setDetail(nextDetail);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingDetail(false);
      }
    }
  });

  useEffect(() => {
    void refreshProjects(false);

    const interval = window.setInterval(() => {
      void refreshProjects(true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshProjects]);

  useEffect(() => {
    void refreshDocuments(selectedProjectName, false);

    if (!selectedProjectName) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDocuments(selectedProjectName, true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshDocuments, selectedProjectName]);

  useEffect(() => {
    void refreshDetail(selectedDocumentId, false);

    if (selectedDocumentId === null) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDetail(selectedDocumentId, true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [refreshDetail, selectedDocumentId]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingProject(true);
    setActionError("");
    setActionMessage("");

    try {
      const createdProject = await invoke<ProjectSummary>("create_project", {
        name: projectNameInput,
      });
      setProjectNameInput("");
      startTransition(() => {
        setSelectedProjectName(createdProject.name);
      });
      await refreshProjects(false);
      setSelectedProjectName(createdProject.name);
      setActionMessage(`Project ${createdProject.name} is ready.`);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleImport(directory: boolean) {
    if (!selectedProjectName) {
      setActionError("Create or select a project before importing.");
      return;
    }

    setImporting(true);
    setActionError("");
    setActionMessage("");

    try {
      const paths = await selectFilePaths({
        directory,
        multiple: !directory,
      });
      if (!paths.length) {
        return;
      }

      await invoke("add_project_inputs", {
        projectName: selectedProjectName,
        paths,
      });

      await refreshProjects(false);
      await refreshDocuments(selectedProjectName, false);
      setActionMessage(
        directory
          ? `Imported folder into ${selectedProjectName}.`
          : `Imported ${paths.length} item${paths.length === 1 ? "" : "s"} into ${selectedProjectName}.`,
      );
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    if (!selectedProjectName) {
      setActionError("Choose a project before exporting.");
      return;
    }

    setExporting(true);
    setActionError("");
    setActionMessage("");

    try {
      const outputs = await invoke<string[]>("export_project", {
        projectName: selectedProjectName,
      });
      await refreshProjects(false);
      await refreshDocuments(selectedProjectName, false);

      if (outputs.length === 0) {
        setActionMessage(`Export finished for ${selectedProjectName}.`);
      } else {
        setActionMessage(`Exported ${outputs.length} DOCX file${outputs.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setExporting(false);
    }
  }

  async function handleRefresh() {
    setActionError("");
    setActionMessage("");
    await refreshProjects(false);
    await refreshDocuments(selectedProjectName, false);
    await refreshDetail(selectedDocumentId, false);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.18),_transparent_32%),linear-gradient(180deg,_#020617_0%,_#020617_28%,_#030712_100%)] px-4 py-4 text-slate-100 sm:px-6 sm:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1700px] grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <aside className="rounded-[28px] border border-white/8 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
              Translator Service
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Operations Dashboard</h1>
            <p className="text-sm leading-6 text-slate-300">
              Create projects, import source material, watch the queue, and inspect OCR or translation issues without leaving the desktop app.
            </p>
          </div>

          <form className="mt-6 space-y-3" onSubmit={handleCreateProject}>
            <label className="block text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
              New project
            </label>
            <input
              value={projectNameInput}
              onChange={(event) => setProjectNameInput(event.currentTarget.value)}
              placeholder="summer-manuscript"
              className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-400"
            />
            <button
              type="submit"
              disabled={creatingProject}
              className="w-full rounded-2xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingProject ? "Creating..." : "Create project"}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-[0.26em] text-slate-400">
              Projects
            </h2>
            {loadingProjects ? <span className="text-xs text-slate-500">Syncing</span> : null}
          </div>

          <div className="mt-3 space-y-2">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/3 p-4 text-sm text-slate-400">
                No projects yet.
              </div>
            ) : null}

            {projects.map((project) => {
              const selected = project.name === selectedProjectName;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    startTransition(() => {
                      setSelectedProjectName(project.name);
                    });
                  }}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                    selected
                      ? "border-cyan-300/40 bg-cyan-400/12 shadow-lg shadow-cyan-950/20"
                      : "border-white/8 bg-white/4 hover:border-white/14 hover:bg-white/7"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{project.name}</div>
                      <div className="mt-1 text-xs text-slate-400">
                        Created {formatTimestamp(project.createdAt)}
                      </div>
                    </div>
                    {project.erroredDocuments > 0 ? (
                      <span className="rounded-full bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-200 ring-1 ring-inset ring-rose-300/20">
                        {project.erroredDocuments} issue{project.erroredDocuments === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs text-slate-300">
                    <div className="rounded-xl bg-slate-900/70 px-2 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Queued</div>
                      <div className="mt-1 text-sm font-semibold text-white">{project.queuedDocuments}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 px-2 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Active</div>
                      <div className="mt-1 text-sm font-semibold text-white">{project.processingDocuments}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/70 px-2 py-2">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Done</div>
                      <div className="mt-1 text-sm font-semibold text-white">{project.completedDocuments}</div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="rounded-[28px] border border-white/8 bg-slate-950/55 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                {selectedProjectName ? "Selected project" : "Workspace overview"}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">
                {selectedProjectName || "Choose or create a project"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Import files or folders to queue OCR and translation jobs. The dashboard refreshes automatically while work is moving through the service.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleImport(false)}
                disabled={!selectedProjectName || importing}
                className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? "Importing..." : "Add files"}
              </button>
              <button
                type="button"
                onClick={() => void handleImport(true)}
                disabled={!selectedProjectName || importing}
                className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add folder
              </button>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/15"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!selectedProjectName || exporting}
                className="rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting ? "Exporting..." : "Export completed"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <StatCard
              label="Total documents"
              value={selectedProject?.totalDocuments ?? 0}
              accent="text-slate-400"
            />
            <StatCard
              label="Queued"
              value={selectedProject?.queuedDocuments ?? 0}
              accent="text-amber-300"
            />
            <StatCard
              label="Processing"
              value={selectedProject?.processingDocuments ?? 0}
              accent="text-cyan-300"
            />
            <StatCard
              label="Completed"
              value={selectedProject?.completedDocuments ?? 0}
              accent="text-emerald-300"
            />
          </div>

          {actionError ? (
            <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
              {actionError}
            </div>
          ) : null}

          {!actionError && actionMessage ? (
            <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              {actionMessage}
            </div>
          ) : null}

          <div className="mt-5 overflow-hidden rounded-[24px] border border-white/8 bg-slate-950/70">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-[0.26em] text-slate-400">
                  Documents
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedProjectName
                    ? "Queue state, retries, and recent document activity."
                    : "Select a project to browse queued material."}
                </p>
              </div>
              {loadingDocuments ? <span className="text-xs text-slate-500">Refreshing</span> : null}
            </div>

            {!selectedProjectName ? (
              <div className="px-4 py-12 text-center text-sm text-slate-400">
                Create a project to start importing content.
              </div>
            ) : documents.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-slate-400">
                No documents in this project yet.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr className="text-xs uppercase tracking-[0.24em] text-slate-500">
                      <th className="px-4 py-3 font-medium">Document</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Retries</th>
                      <th className="px-4 py-3 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => {
                      const selected = document.id === selectedDocumentId;

                      return (
                        <tr
                          key={document.id}
                          onClick={() => {
                            startTransition(() => {
                              setSelectedDocumentId(document.id);
                            });
                          }}
                          className={`cursor-pointer transition ${
                            selected ? "bg-cyan-400/8" : "hover:bg-white/4"
                          }`}
                        >
                          <td className="border-t border-white/6 px-4 py-4 align-top">
                            <div className="max-w-[420px] truncate text-sm font-medium text-white">
                              {document.sourceName}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                              <span>Created {formatTimestamp(document.createdAt)}</span>
                              {document.errorMessage ? (
                                <span className="rounded-full bg-rose-400/12 px-2 py-1 text-[11px] font-semibold text-rose-200 ring-1 ring-inset ring-rose-300/20">
                                  Issue recorded
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="border-t border-white/6 px-4 py-4 align-top text-sm capitalize text-slate-300">
                            {document.sourceType}
                          </td>
                          <td className="border-t border-white/6 px-4 py-4 align-top">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(document.status)}`}>
                              {getStatusLabel(document.status)}
                            </span>
                            {document.nextAttemptAt ? (
                              <div className="mt-2 text-xs text-slate-500">
                                Retry {formatTimestamp(document.nextAttemptAt)}
                              </div>
                            ) : null}
                          </td>
                          <td className="border-t border-white/6 px-4 py-4 align-top text-sm text-slate-300">
                            {document.retryCount}
                          </td>
                          <td className="border-t border-white/6 px-4 py-4 align-top text-sm text-slate-300">
                            {formatTimestamp(document.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-[28px] border border-white/8 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/8 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                Document detail
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-white">
                {detail?.sourceName ?? "No selection"}
              </h3>
            </div>
            {loadingDetail ? <span className="text-xs text-slate-500">Refreshing</span> : null}
          </div>

          {!detail ? (
            <div className="py-12 text-center text-sm text-slate-400">
              Select a document to inspect OCR, translated output, and queue diagnostics.
            </div>
          ) : (
            <div className="mt-5 space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Source type
                  </div>
                  <div className="mt-2 text-sm font-medium capitalize text-white">{detail.sourceType}</div>
                </div>
                <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Status
                  </div>
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(detail.status)}`}>
                      {getStatusLabel(detail.status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/4 p-4">
                <div className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                  <div>
                    <span className="text-slate-500">Project</span>
                    <div className="mt-1 text-white">{detail.projectName}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">MIME type</span>
                    <div className="mt-1 break-all text-white">{detail.mimeType ?? "-"}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Updated</span>
                    <div className="mt-1 text-white">{formatTimestamp(detail.updatedAt)}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Retry count</span>
                    <div className="mt-1 text-white">{detail.retryCount}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Next attempt</span>
                    <div className="mt-1 text-white">{formatTimestamp(detail.nextAttemptAt)}</div>
                  </div>
                  <div>
                    <span className="text-slate-500">Lease acquired</span>
                    <div className="mt-1 text-white">{formatTimestamp(detail.leasedAt)}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <section className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Source text
                  </div>
                  <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950/80 p-4 text-sm leading-6 text-slate-200">
                    {detail.sourceText?.trim() || "No source text stored for this document."}
                  </pre>
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    OCR text
                  </div>
                  <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950/80 p-4 text-sm leading-6 text-slate-200">
                    {detail.ocrText?.trim() || "OCR has not produced text for this document yet."}
                  </pre>
                </section>

                <section className="rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Translated text
                  </div>
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-slate-950/80 p-4 text-sm leading-6 text-slate-100">
                    {detail.translatedText?.trim() || "Translation has not completed for this document yet."}
                  </pre>
                </section>
              </div>

              <section className="rounded-2xl border border-rose-400/15 bg-rose-400/6 p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-200">
                  Raw debug fields
                </div>
                <div className="mt-3 space-y-3 text-sm text-slate-200">
                  <div>
                    <div className="text-slate-500">Error message</div>
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-slate-950/80 p-4 text-sm leading-6 text-rose-100">
                      {detail.errorMessage?.trim() || "No error recorded."}
                    </pre>
                  </div>
                </div>
              </section>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export default App;
