import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useMemo, useState, type FormEvent, type ReactNode } from "react";

import DocumentDetailPanel from "./components/DocumentDetailPanel";
import ProjectSidebar from "./components/ProjectSidebar";
import WorkspacePanel from "./components/WorkspacePanel";
import WorkerScheduleCard from "./components/WorkerScheduleCard";
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

const STORAGE_KEYS = {
  selectedProjectName: "tauri-app.selected-project-name",
  activePage: "tauri-app.active-page",
};

type AppPage = "workspace" | "review" | "settings";

function messageFromError(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong.";
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

function BackIcon() {
  return (
    <ToolbarIcon>
      <path d="M8 5.5 3.5 10 8 14.5" />
      <path d="M4 10h12.5" />
    </ToolbarIcon>
  );
}

type CommandButtonProps = {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
};

function CommandButton(props: CommandButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`command-button desktop-icon-button ${props.variant === "primary" ? "command-button-primary" : ""}`}
    >
      <span className="command-button-icon">{props.icon}</span>
      <span className="command-button-tooltip" aria-hidden="true">
        {props.label}
      </span>
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
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [activePage, setActivePage] = useState<AppPage>(() => {
    const value = readStoredString(STORAGE_KEYS.activePage, "workspace");
    return value === "review" || value === "settings" ? value : "workspace";
  });

  const selectedProject = projects.find((project) => project.name === selectedProjectName) ?? null;
  const selectedDocumentIndex = documents.findIndex((document) => document.id === selectedDocumentId);
  const previousDocumentId = selectedDocumentIndex > 0 ? documents[selectedDocumentIndex - 1]?.id ?? null : null;
  const nextDocumentId =
    selectedDocumentIndex >= 0 && selectedDocumentIndex < documents.length - 1
      ? documents[selectedDocumentIndex + 1]?.id ?? null
      : null;

  const projectSummary = useMemo(() => {
    if (!selectedProject) {
      return "Create a project to start importing documents.";
    }

    if (selectedProject.totalDocuments === 0) {
      return "This project is empty.";
    }

    if (selectedProject.erroredDocuments > 0) {
      return `${selectedProject.erroredDocuments} need attention.`;
    }

    if (selectedProject.processingDocuments > 0) {
      return `${selectedProject.processingDocuments} processing now.`;
    }

    if (selectedProject.queuedDocuments > 0) {
      return `${selectedProject.queuedDocuments} queued.`;
    }

    return `${selectedProject.completedDocuments} ready.`;
  }, [selectedProject]);

  async function createNamedProject(name: string) {
    const createdProject = await invoke<ProjectSummary>("create_project", { name });
    setProjectNameInput("");
    setDocumentsPage(1);
    setSelectedProjectName(createdProject.name);
    setSelectedDocumentId(null);
    setShowCreatePanel(false);
    setActivePage("workspace");
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
      setSelectedDocumentId(null);
      setShowCreatePanel(false);
      setActivePage("workspace");
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
      setShowCreatePanel(true);
      return;
    }

    setImporting(true);
    setActionError("");
    setActionMessage("");

    try {
      const paths = await selectFilePaths({ directory, multiple: !directory });
      if (!paths.length) {
        return;
      }

      await invoke("add_project_inputs", { projectName: selectedProjectName, paths });
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
      const outputs = await invoke<string[]>("export_project", { projectName: selectedProjectName });
      await refreshProjects(false);
      await refreshDocuments(selectedProjectName, documentsPage, false);
      setActionMessage(
        outputs.length === 0
          ? `Export finished for ${selectedProjectName}.`
          : `Exported ${outputs.length} DOCX file${outputs.length === 1 ? "" : "s"}.`,
      );
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
      if (activePage === "review") {
        setActivePage("workspace");
      }
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
      const nextDetail = await invoke<DocumentDetail | null>("get_document_detail", { documentId });
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
      void refreshWorkerSchedule(true);
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
    window.localStorage.setItem(STORAGE_KEYS.selectedProjectName, selectedProjectName);
  }, [selectedProjectName]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.activePage, activePage);
  }, [activePage]);

  const handleMenuCommand = useEffectEvent((command: string) => {
    switch (command) {
      case "new-project":
        setShowCreatePanel(true);
        setActivePage("workspace");
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
      case "settings":
        setActivePage("settings");
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

  const statusText = actionError || actionMessage || (loadingProjects ? "Refreshing projects..." : "Ready");
  const statusToneClass = actionError ? "status-pill status-pill-error" : "status-pill";
  return (
    <main className="app-shell min-h-screen text-[var(--app-text)]">
      <div className="app-layout mx-auto grid min-h-screen max-w-[1600px] gap-4 p-3 sm:p-4">
        <div className="app-sidebar min-h-0">
          <ProjectSidebar
            projects={projects}
            selectedProjectName={selectedProjectName}
            loadingProjects={loadingProjects}
            onSelectProject={(name) => {
              setDocumentsPage(1);
              setSelectedProjectName(name);
              if (activePage === "review") {
                setActivePage("workspace");
              }
            }}
            onCreateProject={() => {
              setShowCreatePanel(true);
              setActivePage("workspace");
            }}
          />
        </div>

        <div className="app-main min-h-0">
          <section className="panel-surface flex h-full min-h-0 flex-col rounded-[24px] p-4 sm:p-5">
            <header className="flex flex-col gap-4 border-b border-[var(--app-border)] pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
                    Translator Service
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--app-text)]">
                    {activePage === "review"
                      ? "Review document"
                      : activePage === "settings"
                        ? "Settings"
                        : selectedProjectName || "Workspace"}
                  </h1>
                  <p className="mt-2 text-sm text-[var(--app-muted)]">
                    {activePage === "review"
                      ? detail?.sourceName ?? "Open a document from the list to review it."
                      : activePage === "settings"
                        ? "Background worker schedule."
                        : projectSummary}
                  </p>
                </div>

                <div className="desktop-toolbar flex flex-wrap items-center gap-2 lg:justify-end">
                  <CommandButton
                    icon={<PlusIcon />}
                    label="New Project"
                    variant="primary"
                    onClick={() => {
                      setShowCreatePanel((current) => !current);
                      setActivePage("workspace");
                    }}
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
                  <CommandButton icon={<RefreshIcon />} label="Refresh" onClick={() => void refreshWorkspace()} />
                </div>
              </div>

              <div className="flex justify-end">
                <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                  <span className={statusToneClass}>{statusText}</span>
                </div>
              </div>

              {showCreatePanel ? (
                <form className="desktop-create-panel rounded-2xl p-4" onSubmit={handleCreateProject}>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                    <div className="min-w-0 flex-1">
                      <label className="font-mono-ui block text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                        New project
                      </label>
                      <input
                        value={projectNameInput}
                        onChange={(event) => setProjectNameInput(event.currentTarget.value)}
                        placeholder="spring-catalog"
                        className="desktop-input mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={creatingProject || !projectNameInput.trim()}
                        className="command-button command-button-primary"
                      >
                        <span className="command-button-icon">
                          <PlusIcon />
                        </span>
                        <span>{creatingProject ? "Creating..." : "Create"}</span>
                      </button>
                      <button type="button" onClick={() => void createUntitledProject()} disabled={creatingProject} className="command-button">
                        <span className="command-button-icon">
                          <PlusIcon />
                        </span>
                        <span>Untitled</span>
                      </button>
                    </div>
                  </div>
                </form>
              ) : null}

            </header>

            <div className="mt-4 min-h-0 flex-1 overflow-hidden">
              {activePage === "workspace" ? (
                <WorkspacePanel
                  selectedProjectName={selectedProjectName}
                  selectedProject={selectedProject}
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
                    setActivePage("review");
                  }}
                  onPreviousPage={() => setDocumentsPage((current) => Math.max(1, current - 1))}
                  onNextPage={() => setDocumentsPage((current) => Math.min(documentsTotalPages, current + 1))}
                  onImportFiles={() => void importProjectInputs(false)}
                  onImportFolder={() => void importProjectInputs(true)}
                  onCreateProject={() => setShowCreatePanel(true)}
                />
              ) : activePage === "review" ? (
                <DocumentDetailPanel
                  detail={detail}
                  loadingDetail={loadingDetail}
                  onBack={() => setActivePage("workspace")}
                  onSelectPreviousDocument={previousDocumentId ? () => setSelectedDocumentId(previousDocumentId) : null}
                  onSelectNextDocument={nextDocumentId ? () => setSelectedDocumentId(nextDocumentId) : null}
                  selectedPosition={selectedDocumentIndex >= 0 ? selectedDocumentIndex + 1 : 0}
                  totalDocuments={documents.length}
                />
              ) : (
                <div className="settings-page mx-auto max-w-3xl">
                  <div className="mb-4 flex justify-start">
                    <CommandButton icon={<BackIcon />} label="Back to project" onClick={() => setActivePage("workspace")} />
                  </div>
                  <WorkerScheduleCard
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
                  />
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

export default App;
