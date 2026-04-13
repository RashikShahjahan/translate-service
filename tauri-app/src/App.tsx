import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState, type FormEvent } from "react";

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

type DocumentListResponse = {
  documents: DocumentRow[];
  page: number;
  pageSize: number;
  totalCount: number;
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
const DOCUMENTS_PAGE_SIZE = 15;

const STATUS_STYLES: Record<string, string> = {
  pending_ocr: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-200",
  processing_ocr:
    "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200",
  pending_translation:
    "bg-fuchsia-100 text-fuchsia-900 ring-1 ring-inset ring-fuchsia-200",
  processing_translation:
    "bg-sky-100 text-sky-900 ring-1 ring-inset ring-sky-200",
  completed: "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-200",
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
  return STATUS_STYLES[status] ?? "bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-200";
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
    <div className="rounded-[28px] border border-stone-200/80 bg-white/90 p-5 shadow-sm shadow-stone-200/70">
      <div className={`text-xs font-medium ${props.accent}`}>
        {props.label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">{props.value}</div>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentsPage, setDocumentsPage] = useState(1);
  const [documentsTotalCount, setDocumentsTotalCount] = useState(0);
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

  async function refreshProjects(silent = false) {
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
        setDocumentsPage(1);
        return nextProjects[0]?.name ?? "";
      });
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingProjects(false);
      }
    }
  }

  async function refreshDocuments(projectName: string, page: number, silent = false) {
    if (!projectName) {
      setDocuments([]);
      setDocumentsTotalCount(0);
      setDocumentsPage(1);
      setSelectedDocumentId(null);
      setDetail(null);
      return;
    }

    if (!silent) {
      setLoadingDocuments(true);
    }

    try {
      const nextDocuments = await invoke<DocumentListResponse>("list_documents", {
        projectName,
        page,
        pageSize: DOCUMENTS_PAGE_SIZE,
      });
      setDocuments(nextDocuments.documents);
      setDocumentsTotalCount(nextDocuments.totalCount);
      setDocumentsPage(nextDocuments.page);
      setSelectedDocumentId((current) => {
        if (current && nextDocuments.documents.some((document) => document.id === current)) {
          return current;
        }
        return nextDocuments.documents[0]?.id ?? null;
      });
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingDocuments(false);
      }
    }
  }

  async function refreshDetail(documentId: number | null, silent = false) {
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
  }

  useEffect(() => {
    void refreshProjects(false);

    const interval = window.setInterval(() => {
      void refreshProjects(true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void refreshDocuments(selectedProjectName, documentsPage, false);

    if (!selectedProjectName) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDocuments(selectedProjectName, documentsPage, true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [selectedProjectName, documentsPage]);

  useEffect(() => {
    void refreshDetail(selectedDocumentId, false);

    if (selectedDocumentId === null) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshDetail(selectedDocumentId, true);
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [selectedDocumentId]);

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
      setDocumentsPage(1);
      setSelectedProjectName(createdProject.name);
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
      await refreshDocuments(selectedProjectName, documentsPage, false);
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
      await refreshDocuments(selectedProjectName, documentsPage, false);

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
    await refreshDocuments(selectedProjectName, documentsPage, false);
    await refreshDetail(selectedDocumentId, false);
  }

  const documentsTotalPages = Math.max(1, Math.ceil(documentsTotalCount / DOCUMENTS_PAGE_SIZE));
  const documentsRangeStart = documentsTotalCount === 0 ? 0 : (documentsPage - 1) * DOCUMENTS_PAGE_SIZE + 1;
  const documentsRangeEnd = documentsTotalCount === 0 ? 0 : Math.min(documentsTotalCount, documentsPage * DOCUMENTS_PAGE_SIZE);

  return (
    <main className="min-h-screen px-4 py-5 text-stone-800 sm:px-6 sm:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1600px] grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1.2fr)_minmax(340px,0.9fr)]">
        <aside className="rounded-[32px] border border-white/70 bg-white/78 p-6 shadow-xl shadow-amber-100/40 backdrop-blur">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
              Translation Workspace
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Projects</h1>
            <p className="text-sm leading-6 text-stone-600">
              Keep each translation job in one place, bring in your files, and check progress without digging through logs.
            </p>
          </div>

          <form className="mt-6 space-y-3" onSubmit={handleCreateProject}>
            <label className="block text-xs font-medium text-stone-500">
              New project
            </label>
            <input
              value={projectNameInput}
              onChange={(event) => setProjectNameInput(event.currentTarget.value)}
              placeholder="Spring catalog"
              className="w-full rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
            />
            <button
              type="submit"
              disabled={creatingProject}
              className="w-full rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creatingProject ? "Creating..." : "Create project"}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-between">
            <h2 className="text-sm font-medium text-stone-500">
              Projects
            </h2>
            {loadingProjects ? <span className="text-xs text-stone-400">Updating</span> : null}
          </div>

          <div className="mt-3 space-y-2">
            {projects.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 p-4 text-sm text-stone-500">
                No projects yet. Create one to get started.
              </div>
            ) : null}

            {projects.map((project) => {
              const selected = project.name === selectedProjectName;

              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    setDocumentsPage(1);
                    setSelectedProjectName(project.name);
                  }}
                    className={`w-full rounded-[24px] border px-4 py-3.5 text-left transition ${
                      selected
                        ? "border-amber-300 bg-amber-50 shadow-sm shadow-amber-100"
                        : "border-stone-200 bg-white/85 hover:border-stone-300 hover:bg-white"
                    }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-stone-900">{project.name}</div>
                      <div className="mt-1 text-xs text-stone-500">
                        Created {formatTimestamp(project.createdAt)}
                      </div>
                    </div>
                    {project.erroredDocuments > 0 ? (
                      <span className="rounded-full bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                        {project.erroredDocuments} issue{project.erroredDocuments === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
                    <span>
                      Waiting <span className="font-semibold text-stone-900">{project.queuedDocuments}</span>
                    </span>
                    <span>
                      In progress <span className="font-semibold text-stone-900">{project.processingDocuments}</span>
                    </span>
                    <span>
                      Ready <span className="font-semibold text-stone-900">{project.completedDocuments}</span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="rounded-[32px] border border-white/70 bg-white/78 p-6 shadow-xl shadow-amber-100/40 backdrop-blur">
          <div className="flex flex-col gap-4 border-b border-stone-200/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                {selectedProjectName ? "Current project" : "Workspace overview"}
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900">
                {selectedProjectName || "Choose or create a project"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                Bring in files or a whole folder, then follow the translation progress here. The page keeps itself up to date automatically.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleImport(false)}
                disabled={!selectedProjectName || importing}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? "Importing..." : "Import files"}
              </button>
              <button
                type="button"
                onClick={() => void handleImport(true)}
                disabled={!selectedProjectName || importing}
                className="rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import folder
              </button>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={!selectedProjectName || exporting}
                className="rounded-xl bg-stone-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {exporting ? "Exporting..." : "Export files"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
            <StatCard
              label="All documents"
              value={selectedProject?.totalDocuments ?? 0}
              accent="text-stone-500"
            />
            <StatCard
              label="Waiting"
              value={selectedProject?.queuedDocuments ?? 0}
              accent="text-amber-700"
            />
            <StatCard
              label="In progress"
              value={selectedProject?.processingDocuments ?? 0}
              accent="text-orange-700"
            />
            <StatCard
              label="Ready"
              value={selectedProject?.completedDocuments ?? 0}
              accent="text-emerald-700"
            />
          </div>

          {actionError ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {actionError}
            </div>
          ) : null}

          {!actionError && actionMessage ? (
            <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              {actionMessage}
            </div>
          ) : null}

          <div className="mt-5 overflow-hidden rounded-[28px] border border-stone-200/80 bg-stone-50/70">
            <div className="flex items-center justify-between border-b border-stone-200/80 px-4 py-3">
              <div>
                <h3 className="text-sm font-medium text-stone-700">
                  Documents
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  {selectedProjectName
                    ? "See where each file is in the workflow and open one for more detail."
                    : "Select a project to browse its files."}
                </p>
              </div>
              <div className="text-right">
                {selectedProjectName ? (
                  <div className="text-xs text-stone-500">
                    Showing {documentsRangeStart}-{documentsRangeEnd} of {documentsTotalCount}
                  </div>
                ) : null}
                {loadingDocuments ? <span className="text-xs text-stone-400">Refreshing</span> : null}
              </div>
            </div>

            {!selectedProjectName ? (
              <div className="px-4 py-12 text-center text-sm text-stone-500">
                Create a project to start adding files.
              </div>
            ) : documents.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-stone-500">
                No files in this project yet.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full border-separate border-spacing-0 text-left">
                  <thead>
                    <tr className="text-xs text-stone-500">
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
                            setSelectedDocumentId(document.id);
                          }}
                          className={`cursor-pointer transition ${
                            selected ? "bg-amber-100/80" : "hover:bg-white/70"
                          }`}
                        >
                          <td className="border-t border-stone-200/80 px-4 py-3.5 align-top">
                            <div className="max-w-[420px] truncate text-sm font-medium text-stone-900">
                              {document.sourceName}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                              <span>Created {formatTimestamp(document.createdAt)}</span>
                              {document.errorMessage ? (
                                <span className="rounded-full bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
                                  Needs attention
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="border-t border-stone-200/80 px-4 py-3.5 align-top text-sm capitalize text-stone-600">
                            {document.sourceType}
                          </td>
                          <td className="border-t border-stone-200/80 px-4 py-3.5 align-top">
                            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(document.status)}`}>
                              {getStatusLabel(document.status)}
                            </span>
                            {document.nextAttemptAt ? (
                              <div className="mt-2 text-xs text-stone-500">
                                Retry {formatTimestamp(document.nextAttemptAt)}
                              </div>
                            ) : null}
                          </td>
                          <td className="border-t border-stone-200/80 px-4 py-3.5 align-top text-sm text-stone-600">
                            {document.retryCount}
                          </td>
                          <td className="border-t border-stone-200/80 px-4 py-3.5 align-top text-sm text-stone-600">
                            {formatTimestamp(document.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="flex flex-col gap-3 border-t border-stone-200/80 bg-white/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-stone-500">
                    Page {documentsPage} of {documentsTotalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDocumentsPage((current) => Math.max(1, current - 1))}
                      disabled={documentsPage <= 1 || loadingDocuments}
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocumentsPage((current) => Math.min(documentsTotalPages, current + 1))}
                      disabled={documentsPage >= documentsTotalPages || loadingDocuments}
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside className="rounded-[32px] border border-white/70 bg-white/78 p-6 shadow-xl shadow-amber-100/40 backdrop-blur">
          <div className="flex items-center justify-between border-b border-stone-200/80 pb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
                Document detail
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight text-stone-900">
                {detail?.sourceName ?? "No selection"}
              </h3>
            </div>
            {loadingDetail ? <span className="text-xs text-stone-400">Refreshing</span> : null}
          </div>

          {!detail ? (
            <div className="py-12 text-center text-sm text-stone-500">
              Select a file to read its original text, OCR result, translation, and any issues.
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                  <div className="text-[11px] font-medium text-stone-500">
                    Source type
                  </div>
                  <div className="mt-2 text-sm font-medium capitalize text-stone-900">{detail.sourceType}</div>
                </div>
                <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                  <div className="text-[11px] font-medium text-stone-500">
                    Status
                  </div>
                  <div className="mt-2">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getStatusClass(detail.status)}`}>
                      {getStatusLabel(detail.status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                <div className="grid gap-3 text-sm text-stone-600 sm:grid-cols-2">
                  <div>
                    <span className="text-stone-500">Project</span>
                    <div className="mt-1 text-stone-900">{detail.projectName}</div>
                  </div>
                  <div>
                    <span className="text-stone-500">MIME type</span>
                    <div className="mt-1 break-all text-stone-900">{detail.mimeType ?? "-"}</div>
                  </div>
                  <div>
                    <span className="text-stone-500">Updated</span>
                    <div className="mt-1 text-stone-900">{formatTimestamp(detail.updatedAt)}</div>
                  </div>
                  <div>
                    <span className="text-stone-500">Retry count</span>
                    <div className="mt-1 text-stone-900">{detail.retryCount}</div>
                  </div>
                  <div>
                    <span className="text-stone-500">Next attempt</span>
                    <div className="mt-1 text-stone-900">{formatTimestamp(detail.nextAttemptAt)}</div>
                  </div>
                  <div>
                    <span className="text-stone-500">Lease acquired</span>
                    <div className="mt-1 text-stone-900">{formatTimestamp(detail.leasedAt)}</div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <section className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                  <div className="text-xs font-medium text-stone-500">
                    Original text
                  </div>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-stone-700">
                    {detail.sourceText?.trim() || "No source text stored for this document."}
                  </pre>
                </section>

                <section className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                  <div className="text-xs font-medium text-stone-500">
                    OCR text
                  </div>
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-stone-700">
                    {detail.ocrText?.trim() || "OCR has not produced text for this document yet."}
                  </pre>
                </section>

                <section className="rounded-2xl border border-stone-200 bg-stone-50/80 p-4">
                  <div className="text-xs font-medium text-stone-500">
                    Translation preview
                  </div>
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-stone-800">
                    {detail.translatedText?.trim() || "Translation has not completed for this document yet."}
                  </pre>
                </section>
              </div>

              {detail.errorMessage ? (
                <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <div className="text-xs font-medium text-rose-700">Needs attention</div>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-white p-4 text-sm leading-6 text-rose-800">
                    {detail.errorMessage.trim()}
                  </pre>
                </section>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

export default App;
