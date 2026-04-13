import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useState, type FormEvent, type ReactNode } from "react";

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

const STORAGE_KEYS = {
  showProjects: "tauri-app.show-projects",
  showDocumentDetail: "tauri-app.show-document-detail",
  sidebarWidth: "tauri-app.sidebar-width",
  detailWidth: "tauri-app.detail-width",
  selectedProjectName: "tauri-app.selected-project-name",
};

function messageFromError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.localStorage.getItem(key);
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return fallback;
}

function readStoredNumber(key: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readStoredString(key: string, fallback = "") {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
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

type IconProps = {
  children: ReactNode;
};

function ToolbarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {props.children}
    </svg>
  );
}

function PlusIcon() {
  return (
    <ToolbarIcon>
      <path d="M10 4.5v11" />
      <path d="M4.5 10h11" />
    </ToolbarIcon>
  );
}

function FileIcon() {
  return (
    <ToolbarIcon>
      <path d="M6 3.5h5l3 3V16a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 5 16V5A1.5 1.5 0 0 1 6.5 3.5Z" />
      <path d="M11 3.5V7h3" />
    </ToolbarIcon>
  );
}

function FolderIcon() {
  return (
    <ToolbarIcon>
      <path d="M2.5 6.5A1.5 1.5 0 0 1 4 5h4l1.4 1.5H16A1.5 1.5 0 0 1 17.5 8v6.5A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5Z" />
    </ToolbarIcon>
  );
}

function ExportIcon() {
  return (
    <ToolbarIcon>
      <path d="M10 13V4.5" />
      <path d="M6.5 8 10 4.5 13.5 8" />
      <path d="M4.5 12.5v2A1.5 1.5 0 0 0 6 16h8a1.5 1.5 0 0 0 1.5-1.5v-2" />
    </ToolbarIcon>
  );
}

function RefreshIcon() {
  return (
    <ToolbarIcon>
      <path d="M15.5 8A5.5 5.5 0 1 0 16 12" />
      <path d="M12.5 4.5h3V7.5" />
    </ToolbarIcon>
  );
}

function SidebarIcon() {
  return (
    <ToolbarIcon>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M8 4v12" />
    </ToolbarIcon>
  );
}

function InspectorIcon() {
  return (
    <ToolbarIcon>
      <rect x="3.5" y="4" width="13" height="12" rx="1.5" />
      <path d="M12 4v12" />
    </ToolbarIcon>
  );
}

type CommandButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "utility";
  title?: string;
};

function CommandButton(props: CommandButtonProps) {
  const className =
    props.variant === "primary"
      ? "command-button command-button-primary"
      : props.variant === "utility"
        ? "command-icon-button"
        : "command-button";

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={className}
      title={props.title ?? props.label}
      aria-label={props.label}
    >
      <span className="command-button-icon">{props.icon}</span>
      {props.variant === "utility" ? null : <span>{props.label}</span>}
    </button>
  );
}

function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentsPage, setDocumentsPage] = useState(1);
  const [documentsTotalCount, setDocumentsTotalCount] = useState(0);
  const [selectedProjectName, setSelectedProjectName] = useState(() =>
    readStoredString(STORAGE_KEYS.selectedProjectName),
  );
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
  const [showProjects, setShowProjects] = useState(() => readStoredBoolean(STORAGE_KEYS.showProjects, true));
  const [showDocumentDetail, setShowDocumentDetail] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.showDocumentDetail, true),
  );
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredNumber(STORAGE_KEYS.sidebarWidth, 272));
  const [detailWidth, setDetailWidth] = useState(() => readStoredNumber(STORAGE_KEYS.detailWidth, 360));
  const [showCreatePanel, setShowCreatePanel] = useState(false);

  const selectedProject =
    projects.find((project) => project.name === selectedProjectName) ?? null;

  async function createNamedProject(name: string) {
    const createdProject = await invoke<ProjectSummary>("create_project", { name });
    setProjectNameInput("");
    setDocumentsPage(1);
    setSelectedProjectName(createdProject.name);
    setShowCreatePanel(false);
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
      setShowCreatePanel(false);
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
    setActionMessage("Workspace refreshed.");
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

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.showProjects, String(showProjects));
  }, [showProjects]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.showDocumentDetail, String(showDocumentDetail));
  }, [showDocumentDetail]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.detailWidth, String(detailWidth));
  }, [detailWidth]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.selectedProjectName, selectedProjectName);
  }, [selectedProjectName]);

  const handleMenuCommand = useEffectEvent((command: string) => {
    switch (command) {
      case "new-project":
        setShowCreatePanel(true);
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

  const contentGridTemplateColumns = [
    showProjects ? `${sidebarWidth}px` : null,
    showProjects ? `${DESKTOP_GUTTER_WIDTH}px` : null,
    "minmax(0,1fr)",
    showDocumentDetail ? `${DESKTOP_GUTTER_WIDTH}px` : null,
    showDocumentDetail ? `${detailWidth}px` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const scheduleSummary = loadingWorkerSchedule
    ? "Checking worker schedule"
    : workerSchedule?.supported
      ? workerSchedule.installed
        ? `Worker schedule ${workerSchedule.startTime}-${workerSchedule.endTime}`
        : "Worker schedule disabled"
      : "Scheduling available on macOS";

  const statusText = actionError || actionMessage || (loadingProjects ? "Refreshing projects..." : "Ready");
  const statusToneClass = actionError ? "status-pill status-pill-error" : "status-pill";

  return (
    <main className="h-screen overflow-hidden p-2 text-[var(--app-text)]">
      <div className="shell-frame mx-auto flex h-[calc(100vh-1rem)] max-w-[1760px] flex-col gap-3 rounded-[16px] p-3">
        <header className="desktop-command-surface rounded-2xl px-4 py-3 sm:px-5">
          <div className="desktop-command-row flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
                Translator Service
              </div>
              <div className="mt-1 text-sm text-[var(--app-muted)]">
                Desktop translation workspace for projects, queues, and document review.
              </div>
            </div>

            <div className="desktop-command-groups flex flex-wrap items-center justify-end gap-2">
              <CommandButton
                icon={<PlusIcon />}
                label="New Project"
                variant="primary"
                onClick={() => setShowCreatePanel((current) => !current)}
                title={showCreatePanel ? "Hide project creation" : "Create a new project"}
              />
              <CommandButton
                icon={<FileIcon />}
                label={importing ? "Importing..." : "Import Files"}
                onClick={() => void importProjectInputs(false)}
                disabled={!selectedProjectName || importing}
              />
              <CommandButton
                icon={<FolderIcon />}
                label="Import Folder"
                onClick={() => void importProjectInputs(true)}
                disabled={!selectedProjectName || importing}
              />
              <CommandButton
                icon={<ExportIcon />}
                label={exporting ? "Exporting..." : "Export"}
                onClick={() => void exportProjectFiles()}
                disabled={!selectedProjectName || exporting}
              />
              <CommandButton
                icon={<RefreshIcon />}
                label="Refresh"
                variant="utility"
                onClick={() => void refreshWorkspace()}
              />
              <CommandButton
                icon={<SidebarIcon />}
                label="Toggle projects"
                variant="utility"
                onClick={() => setShowProjects((current) => !current)}
                title={showProjects ? "Hide projects sidebar" : "Show projects sidebar"}
              />
              <CommandButton
                icon={<InspectorIcon />}
                label="Toggle detail"
                variant="utility"
                onClick={() => setShowDocumentDetail((current) => !current)}
                title={showDocumentDetail ? "Hide document detail" : "Show document detail"}
              />
            </div>
          </div>

          {showCreatePanel ? (
            <form className="desktop-create-panel mt-3 rounded-xl p-3 sm:p-4" onSubmit={handleCreateProject}>
              <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                <div className="min-w-0 flex-1">
                  <label className="font-mono-ui block text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                    New project
                  </label>
                  <div className="mt-2 flex flex-col gap-3 lg:flex-row">
                    <input
                      value={projectNameInput}
                      onChange={(event) => setProjectNameInput(event.currentTarget.value)}
                      placeholder="spring-catalog"
                      className="desktop-input min-w-0 flex-1 rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={creatingProject || !projectNameInput.trim()}
                        className="command-button command-button-primary"
                      >
                        <span className="command-button-icon">
                          <PlusIcon />
                        </span>
                        <span>{creatingProject ? "Creating..." : "Create Named Project"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void createUntitledProject()}
                        disabled={creatingProject}
                        className="command-button"
                      >
                        <span className="command-button-icon">
                          <PlusIcon />
                        </span>
                        <span>Use Untitled</span>
                      </button>
                    </div>
                  </div>
                </div>
                <div className="desktop-create-help text-sm text-[var(--app-muted)]">
                  Create a named project for a durable queue, or use an untitled one to start importing immediately.
                </div>
              </div>
            </form>
          ) : null}

          <div className="desktop-status-row mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2.5">
            <span className="status-pill">
              {selectedProjectName ? `Project: ${selectedProjectName}` : "No project selected"}
            </span>
            <span className="status-pill">
              {selectedProject
                ? `${selectedProject.totalDocuments} document${selectedProject.totalDocuments === 1 ? "" : "s"}`
                : "Create or select a project to begin"}
            </span>
            <span className="status-pill">{scheduleSummary}</span>
            <span className={statusToneClass}>{statusText}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 grid" style={{ gridTemplateColumns: contentGridTemplateColumns, gap: "12px" }}>
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

          {showProjects ? (
            <div className="pane-resizer min-h-0" onPointerDown={beginSidebarResize} role="separator" aria-orientation="vertical" />
          ) : null}

          <div className="min-h-0 min-w-0">
            <WorkspacePanel
              selectedProjectName={selectedProjectName}
              selectedProject={selectedProject}
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
          </div>

          {showDocumentDetail ? (
            <div className="pane-resizer min-h-0" onPointerDown={beginDetailResize} role="separator" aria-orientation="vertical" />
          ) : null}

          {showDocumentDetail ? (
            <div className="min-h-0">
              <DocumentDetailPanel detail={detail} loadingDetail={loadingDetail} />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default App;
