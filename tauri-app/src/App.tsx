import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useState, type FormEvent } from "react";

import DocumentDetailPanel from "./components/DocumentDetailPanel";
import ProjectSidebar from "./components/ProjectSidebar";
import WorkspacePanel from "./components/WorkspacePanel";
import type {
  DocumentDetail,
  DocumentListResponse,
  DocumentRow,
  ProjectSummary,
  WorkerScheduleStatus,
} from "./types";

const POLL_INTERVAL_MS = 4000;
const DOCUMENTS_PAGE_SIZE = 15;
const APP_MENU_COMMAND_EVENT = "app-menu-command";
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_DETAIL_WIDTH = 280;
const MAX_DETAIL_WIDTH = 520;
const DESKTOP_GUTTER_WIDTH = 6;

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

type ViewToggleCardProps = {
  label: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
};

function ViewToggleCard(props: ViewToggleCardProps) {
  return (
    <button
      type="button"
      onClick={props.onToggle}
      aria-pressed={props.enabled}
      className={`flex w-full items-start justify-between gap-4 rounded-lg border px-4 py-3 text-left transition ${
        props.enabled
          ? "border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(103,183,255,0.18),rgba(255,255,255,0.03))] text-[var(--app-text)] shadow-[0_14px_30px_rgba(2,6,23,0.28)]"
          : "border-[var(--app-border)] bg-white/4 text-[var(--app-text)] hover:bg-white/6"
      }`}
    >
      <div>
        <div className="text-sm font-semibold">{props.label}</div>
        <div className={`mt-1 text-sm leading-5 ${props.enabled ? "text-[var(--app-text)]/80" : "text-[var(--app-muted)]"}`}>
          {props.description}
        </div>
      </div>
      <span
        className={`inline-flex min-w-14 justify-center rounded-full px-3 py-1 text-xs font-semibold ${
          props.enabled ? "bg-sky-400/14 text-[var(--app-accent-strong)]" : "bg-white/6 text-[var(--app-muted)]"
        }`}
      >
        {props.enabled ? "On" : "Off"}
      </span>
    </button>
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
  const [workerSchedule, setWorkerSchedule] = useState<WorkerScheduleStatus | null>(null);
  const [scheduleStartTime, setScheduleStartTime] = useState("00:00");
  const [scheduleEndTime, setScheduleEndTime] = useState("08:00");
  const [loadingWorkerSchedule, setLoadingWorkerSchedule] = useState(true);
  const [savingWorkerSchedule, setSavingWorkerSchedule] = useState(false);
  const [removingWorkerSchedule, setRemovingWorkerSchedule] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [showProjects, setShowProjects] = useState(true);
  const [showWorkspace, setShowWorkspace] = useState(true);
  const [showDocumentDetail, setShowDocumentDetail] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [detailWidth, setDetailWidth] = useState(360);

  const selectedProject =
    projects.find((project) => project.name === selectedProjectName) ?? null;

  async function createNamedProject(name: string) {
    const createdProject = await invoke<ProjectSummary>("create_project", { name });
    setProjectNameInput("");
    setDocumentsPage(1);
    setSelectedProjectName(createdProject.name);
    await refreshProjects(false);
    setSelectedProjectName(createdProject.name);
    setActionMessage(`Project ${createdProject.name} is ready.`);
  }

  async function createUntitledProject() {
    setCreatingProject(true);
    setActionError("");
    setActionMessage("");

    try {
      const createdProject = await invoke<ProjectSummary>("create_untitled_project");
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

  async function importProjectInputs(directory: boolean) {
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

  async function exportProjectFiles() {
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

  async function refreshWorkspace() {
    setActionError("");
    setActionMessage("");
    await refreshProjects(false);
    await refreshDocuments(selectedProjectName, documentsPage, false);
    await refreshDetail(selectedDocumentId, false);
    await refreshWorkerSchedule(false);
  }

  async function refreshWorkerSchedule(silent = false) {
    if (!silent) {
      setLoadingWorkerSchedule(true);
    }

    try {
      const nextSchedule = await invoke<WorkerScheduleStatus>("get_worker_schedule_status");
      setWorkerSchedule(nextSchedule);
      setScheduleStartTime(nextSchedule.startTime);
      setScheduleEndTime(nextSchedule.endTime);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingWorkerSchedule(false);
      }
    }
  }

  async function saveWorkerSchedule() {
    setSavingWorkerSchedule(true);
    setActionError("");
    setActionMessage("");

    try {
      const nextSchedule = await invoke<WorkerScheduleStatus>("install_worker_schedule", {
        startTime: scheduleStartTime,
        endTime: scheduleEndTime,
      });
      setWorkerSchedule(nextSchedule);
      setScheduleStartTime(nextSchedule.startTime);
      setScheduleEndTime(nextSchedule.endTime);
      setActionMessage(`Worker schedule saved for ${nextSchedule.startTime} to ${nextSchedule.endTime}.`);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setSavingWorkerSchedule(false);
    }
  }

  async function removeWorkerSchedule() {
    setRemovingWorkerSchedule(true);
    setActionError("");
    setActionMessage("");

    try {
      const nextSchedule = await invoke<WorkerScheduleStatus>("uninstall_worker_schedule");
      setWorkerSchedule(nextSchedule);
      setScheduleStartTime(nextSchedule.startTime);
      setScheduleEndTime(nextSchedule.endTime);
      setActionMessage("Worker schedule disabled.");
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setRemovingWorkerSchedule(false);
    }
  }

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
    void refreshWorkerSchedule(false);

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

  const handleMenuCommand = useEffectEvent((command: string) => {
    switch (command) {
      case "new-project":
        void createUntitledProject();
        break;
      case "import-files":
        void importProjectInputs(false);
        break;
      case "import-folder":
        void importProjectInputs(true);
        break;
      case "export-files":
        void exportProjectFiles();
        break;
      case "refresh":
        void refreshWorkspace();
        break;
      default:
        break;
    }
  });

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>(APP_MENU_COMMAND_EVENT, (event) => {
      handleMenuCommand(event.payload);
    }).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });

    return () => {
      unlisten?.();
    };
  }, [handleMenuCommand]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingProject(true);
    setActionError("");
    setActionMessage("");

    try {
      await createNamedProject(projectNameInput);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setCreatingProject(false);
    }
  }

  const documentsTotalPages = Math.max(1, Math.ceil(documentsTotalCount / DOCUMENTS_PAGE_SIZE));
  const documentsRangeStart = documentsTotalCount === 0 ? 0 : (documentsPage - 1) * DOCUMENTS_PAGE_SIZE + 1;
  const documentsRangeEnd =
    documentsTotalCount === 0 ? 0 : Math.min(documentsTotalCount, documentsPage * DOCUMENTS_PAGE_SIZE);

  const visibleSections = Number(showProjects) + Number(showWorkspace) + Number(showDocumentDetail);

  useEffect(() => {
    function stopDragging() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    return () => stopDragging();
  }, []);

  function beginSidebarResize() {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent) {
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX - 8)));
    }

    function handlePointerUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function beginDetailResize() {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(event: PointerEvent) {
      setDetailWidth(Math.min(MAX_DETAIL_WIDTH, Math.max(MIN_DETAIL_WIDTH, window.innerWidth - event.clientX - 8)));
    }

    function handlePointerUp() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  const shellGridTemplateColumns = [
    showProjects ? `${sidebarWidth}px` : null,
    showProjects ? `${DESKTOP_GUTTER_WIDTH}px` : null,
    "minmax(0,1fr)",
    showDocumentDetail ? `${DESKTOP_GUTTER_WIDTH}px` : null,
    showDocumentDetail ? `${detailWidth}px` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="h-screen overflow-hidden p-2 text-[var(--app-text)]">
      <div
        className="shell-frame topbar-glow mx-auto grid h-[calc(100vh-1rem)] max-w-[1760px] grid-rows-[40px_minmax(0,1fr)] gap-y-3 rounded-[16px] p-3"
        style={{ gridTemplateColumns: shellGridTemplateColumns }}
      >
        <div className="desktop-titlebar col-span-full flex items-center justify-between rounded-[14px] px-3">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
            <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">
            Translate Service
          </div>
          <div className="text-xs text-[var(--app-muted)]">Desktop workspace</div>
        </div>

        {showProjects ? (
          <div className="min-h-0">
            <ProjectSidebar
              projects={projects}
              selectedProjectName={selectedProjectName}
              loadingProjects={loadingProjects}
              onSelectProject={(name) => {
                setDocumentsPage(1);
                setSelectedProjectName(name);
              }}
            />
          </div>
        ) : null}

        {showProjects && showWorkspace ? (
          <div className="pane-resizer min-h-0" onPointerDown={beginSidebarResize} role="separator" aria-orientation="vertical" />
        ) : null}

        <div className="min-h-0 min-w-0 space-y-3 overflow-auto pr-1">
          <section className="panel-surface overflow-hidden rounded-2xl">
            <div className="p-4 sm:p-5">
              <div className="flex flex-col gap-3 border-b border-[var(--app-border)] pb-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
                    Workspace
                  </div>
                  <h1 className="mt-2 text-xl font-semibold tracking-tight text-[var(--app-text)] sm:text-2xl">
                    Translation operations
                  </h1>
                  <p className="mt-2 max-w-3xl text-sm text-[var(--app-muted)]">
                    Create projects, import source material, and inspect output in one desktop workspace.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[520px]">
                  <div className="panel-soft rounded-lg p-4">
                    <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">Selected</div>
                    <div className="mt-2 truncate text-sm font-semibold text-[var(--app-text)]">
                      {selectedProjectName || "No project selected"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">
                      {selectedProject
                        ? `${selectedProject.totalDocuments} document${selectedProject.totalDocuments === 1 ? "" : "s"}`
                        : "Pick a project from the sidebar."}
                    </div>
                  </div>
                  <div className="panel-soft rounded-lg p-4">
                    <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">Visible panels</div>
                    <div className="mt-2 text-2xl font-semibold text-[var(--app-text)]">{visibleSections}/3</div>
                    <div className="mt-1 text-xs text-[var(--app-muted)]">Projects, workspace, and document detail.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createUntitledProject()}
                    disabled={creatingProject}
                    className="rounded-lg border border-[var(--app-border-strong)] bg-[linear-gradient(135deg,rgba(103,183,255,0.16),rgba(70,140,243,0.06))] p-4 text-left transition hover:bg-sky-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-accent-strong)]">Quick create</div>
                    <div className="mt-2 text-sm font-semibold text-[var(--app-text)]">
                      {creatingProject ? "Creating project..." : "Create untitled project"}
                    </div>
                    <div className="mt-1 text-xs text-[var(--app-text)]/70">Fastest way to start a new import queue.</div>
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
                <form className="panel-soft rounded-xl p-4 sm:p-5" onSubmit={handleCreateProject}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <label className="font-mono-ui block text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                        New project
                      </label>
                      <p className="mt-2 text-sm text-[var(--app-muted)]">Use a short descriptive name so imports stay easy to scan.</p>
                    </div>
                    <div className="metal-pill rounded-full px-3 py-1 text-xs font-medium text-[var(--app-accent-strong)]">Create</div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                    <input
                      value={projectNameInput}
                      onChange={(event) => setProjectNameInput(event.currentTarget.value)}
                      placeholder="spring-catalog"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={creatingProject}
                      className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-5 py-3 text-sm font-semibold text-[#04101d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {creatingProject ? "Creating..." : "Create named project"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void createUntitledProject()}
                        disabled={creatingProject}
                        className="rounded-full border border-[var(--app-border)] bg-white/6 px-5 py-3 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Use untitled
                      </button>
                    </div>
                  </div>
                </form>

                <div className="panel-soft rounded-xl p-4 sm:p-5 text-[var(--app-text)]">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-mono-ui text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">Layout</div>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-muted)]">Keep only the panels you want visible.</p>
                    </div>
                    <div className="rounded-full border border-[var(--app-border)] bg-white/6 px-3 py-1 text-xs font-semibold text-[var(--app-text)]">
                      {visibleSections}/3 visible
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <ViewToggleCard
                      label="Projects drawer"
                      description="Browse and switch projects from the left side."
                      enabled={showProjects}
                      onToggle={() => setShowProjects((current) => !current)}
                    />
                    <ViewToggleCard
                      label="Workspace section"
                      description="Keep imports, schedule, status, and documents open."
                      enabled={showWorkspace}
                      onToggle={() => setShowWorkspace((current) => !current)}
                    />
                    <ViewToggleCard
                      label="Document detail"
                      description="Open the selected document in the right rail."
                      enabled={showDocumentDetail}
                      onToggle={() => setShowDocumentDetail((current) => !current)}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowProjects(false);
                        setShowWorkspace(false);
                        setShowDocumentDetail(false);
                      }}
                      className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-2 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10"
                    >
                      Focus create
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProjects(true);
                        setShowWorkspace(true);
                        setShowDocumentDetail(true);
                      }}
                      className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-4 py-2 text-sm font-semibold text-[#04101d] transition hover:brightness-105"
                    >
                      Show all
                    </button>
                  </div>
                </div>
              </div>

              {actionError ? (
                <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                  {actionError}
                </div>
              ) : null}

              {!actionError && actionMessage ? (
                <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  {actionMessage}
                </div>
              ) : null}
            </div>
          </section>

          {showWorkspace ? (
            <WorkspacePanel
              selectedProjectName={selectedProjectName}
              selectedProject={selectedProject}
              importing={importing}
              exporting={exporting}
              actionError=""
              actionMessage=""
              onImportFiles={() => void importProjectInputs(false)}
              onImportFolder={() => void importProjectInputs(true)}
              onRefreshWorkspace={() => void refreshWorkspace()}
              onExportFiles={() => void exportProjectFiles()}
              workerSchedule={workerSchedule}
              scheduleStartTime={scheduleStartTime}
              scheduleEndTime={scheduleEndTime}
              loadingWorkerSchedule={loadingWorkerSchedule}
              savingWorkerSchedule={savingWorkerSchedule}
              removingWorkerSchedule={removingWorkerSchedule}
              onScheduleStartTimeChange={setScheduleStartTime}
              onScheduleEndTimeChange={setScheduleEndTime}
              onSaveWorkerSchedule={() => void saveWorkerSchedule()}
              onRemoveWorkerSchedule={() => void removeWorkerSchedule()}
              documents={documents}
              selectedDocumentId={selectedDocumentId}
              documentsRangeStart={documentsRangeStart}
              documentsRangeEnd={documentsRangeEnd}
              documentsTotalCount={documentsTotalCount}
              documentsPage={documentsPage}
              documentsTotalPages={documentsTotalPages}
              loadingDocuments={loadingDocuments}
              onSelectDocument={(documentId) => {
                setSelectedDocumentId(documentId);
                setShowDocumentDetail(true);
              }}
              onPreviousPage={() => setDocumentsPage((current) => Math.max(1, current - 1))}
              onNextPage={() => setDocumentsPage((current) => Math.min(documentsTotalPages, current + 1))}
            />
          ) : null}
        </div>

        {showWorkspace && showDocumentDetail ? (
          <div className="pane-resizer min-h-0" onPointerDown={beginDetailResize} role="separator" aria-orientation="vertical" />
        ) : null}

        {showDocumentDetail ? (
          <div className="min-h-0">
            <DocumentDetailPanel detail={detail} loadingDetail={loadingDetail} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

export default App;
