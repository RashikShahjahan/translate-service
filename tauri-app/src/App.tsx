import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useEffectEvent, useMemo, useState, type FormEvent, type ReactNode } from "react";

import DocumentDetailPanel from "./components/DocumentDetailPanel";
import ProjectSidebar from "./components/ProjectSidebar";
import TranslationSettingsCard from "./components/TranslationSettingsCard";
import WorkspacePanel from "./components/WorkspacePanel";
import WorkerScheduleCard from "./components/WorkerScheduleCard";
import type {
  AppSettings,
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
  sidebarVisible: "tauri-app.sidebar-visible",
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

function canRetryDocument(document: Pick<DocumentRow, "errorMessage" | "status"> | Pick<DocumentDetail, "errorMessage" | "status">) {
  return Boolean(document.errorMessage) && !document.status.startsWith("processing_");
}

function readStoredString(key: string, fallback = "") {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") {
    return fallback;
  }

  const value = window.localStorage.getItem(key);

  if (value === null) {
    return fallback;
  }

  return value === "true";
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
    <svg className="size-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
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

function SidebarIcon() {
  return (
    <ToolbarIcon>
      <rect x="3.5" y="4" width="13" height="12" rx="1.75" />
      <path d="M8 4v12" />
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

const iconButtonBaseClass =
  "group relative inline-flex min-h-10 min-w-10 items-center justify-center rounded-[0.9rem] border border-[var(--app-border)] bg-white/[0.045] text-[var(--app-text)] transition hover:border-[var(--app-border-strong)] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55";
const iconButtonPrimaryClass =
  "border-[rgba(142,182,219,0.28)] bg-[linear-gradient(135deg,#8eb6db,#789fc4)] text-[#15202b] shadow-[0_8px_24px_rgba(120,159,196,0.2)] hover:bg-[linear-gradient(135deg,#99bddf,#82a8cb)]";
const iconClass = "inline-flex h-4 w-4 items-center justify-center";
const tooltipClass =
  "pointer-events-none absolute bottom-[calc(100%+0.55rem)] left-1/2 z-20 hidden -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-[0.65rem] border border-white/8 bg-[rgba(7,17,31,0.96)] px-[0.65rem] py-[0.45rem] text-xs font-semibold leading-none text-[#f5fbff] opacity-0 transition duration-150 group-hover:block group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:block group-focus-visible:translate-y-0 group-focus-visible:opacity-100";
const tooltipArrowClass =
  "absolute left-1/2 top-full h-[0.55rem] w-[0.55rem] -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b border-white/8 bg-[rgba(7,17,31,0.96)]";
const pillClass =
  "inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.04] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]";
const pillErrorClass = "border-rose-300/25 bg-rose-300/10 text-rose-50";
const actionButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-[0.55rem] rounded-full border border-[rgba(142,182,219,0.28)] bg-[linear-gradient(135deg,#8eb6db,#789fc4)] px-4 text-sm font-semibold leading-none text-[#15202b] transition hover:bg-[linear-gradient(135deg,#99bddf,#82a8cb)] disabled:cursor-not-allowed disabled:opacity-55";
const secondaryActionButtonClass =
  "inline-flex min-h-10 items-center justify-center gap-[0.55rem] rounded-full border border-[var(--app-border)] bg-white/[0.045] px-4 text-sm font-semibold leading-none text-[var(--app-text)] transition hover:border-[var(--app-border-strong)] hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-55";

function CommandButton(props: CommandButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`${iconButtonBaseClass} ${props.variant === "primary" ? iconButtonPrimaryClass : ""}`}
    >
      <span className={iconClass}>{props.icon}</span>
      <span className={tooltipClass} aria-hidden="true">
        {props.label}
        <span className={tooltipArrowClass} />
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
  const [projectSourceLanguageInput, setProjectSourceLanguageInput] = useState("");
  const [projectTargetLanguageInput, setProjectTargetLanguageInput] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingProjectLanguages, setSavingProjectLanguages] = useState(false);
  const [retryingDocumentId, setRetryingDocumentId] = useState<number | null>(null);
  const [workerSchedule, setWorkerSchedule] = useState<WorkerScheduleStatus | null>(null);
  const [translationModelInput, setTranslationModelInput] = useState("");
  const [scheduleStartTime, setScheduleStartTime] = useState("00:00");
  const [scheduleEndTime, setScheduleEndTime] = useState("08:00");
  const [loadingTranslationModel, setLoadingTranslationModel] = useState(true);
  const [savingTranslationModel, setSavingTranslationModel] = useState(false);
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
  const [sidebarVisible, setSidebarVisible] = useState(() => readStoredBoolean(STORAGE_KEYS.sidebarVisible, true));

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

  async function saveProjectLanguages() {
    if (!selectedProjectName) {
      setActionError("Choose a project before updating languages.");
      return;
    }

    setSavingProjectLanguages(true);
    setActionError("");
    setActionMessage("");

    try {
      const updatedProject = await invoke<ProjectSummary>("update_project_languages", {
        projectName: selectedProjectName,
        sourceLanguage: projectSourceLanguageInput,
        targetLanguage: projectTargetLanguageInput,
      });
      await refreshProjects(false);
      setSelectedProjectName(updatedProject.name);
      setProjectSourceLanguageInput(updatedProject.sourceLanguage);
      setProjectTargetLanguageInput(updatedProject.targetLanguage);
      setActionMessage(
        `Updated ${updatedProject.name} to ${updatedProject.sourceLanguage} -> ${updatedProject.targetLanguage}.`,
      );
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setSavingProjectLanguages(false);
    }
  }

  async function retryFailedDocument(documentId: number) {
    setRetryingDocumentId(documentId);
    setActionError("");
    setActionMessage("");

    try {
      const retried = await invoke<DocumentDetail>("retry_document", { documentId });
      await refreshProjects(false);
      await refreshDocuments(retried.projectName, documentsPage, false);
      await refreshDetail(documentId, false);
      setSelectedProjectName(retried.projectName);
      setSelectedDocumentId(documentId);
      setActionMessage(`Retried ${retried.sourceName}.`);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setRetryingDocumentId(null);
    }
  }

  async function refreshWorkspace() {
    setActionError("");
    setActionMessage("");
    await refreshProjects(false);
    await refreshDocuments(selectedProjectName, documentsPage, false);
    await refreshDetail(selectedDocumentId, false);
    await refreshAppSettings(false);
    await refreshWorkerSchedule(false);
    setActionMessage("Workspace refreshed.");
  }

  async function refreshAppSettings(silent = false) {
    if (!silent) {
      setLoadingTranslationModel(true);
    }

    try {
      const nextSettings = await invoke<AppSettings>("get_app_settings");
      setTranslationModelInput(nextSettings.translationModel);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      if (!silent) {
        setLoadingTranslationModel(false);
      }
    }
  }

  async function saveTranslationModel() {
    setSavingTranslationModel(true);
    setActionError("");
    setActionMessage("");

    try {
      const nextSettings = await invoke<AppSettings>("update_translation_model", {
        translationModel: translationModelInput,
      });
      setTranslationModelInput(nextSettings.translationModel);
      setActionMessage(`Translation model set to ${nextSettings.translationModel}.`);
    } catch (error) {
      setActionError(messageFromError(error));
    } finally {
      setSavingTranslationModel(false);
    }
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
    void refreshAppSettings(false);
    void refreshWorkerSchedule(false);

    const interval = window.setInterval(() => {
      void refreshProjects(true);
      void refreshAppSettings(true);
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
    setProjectSourceLanguageInput(selectedProject?.sourceLanguage ?? "");
    setProjectTargetLanguageInput(selectedProject?.targetLanguage ?? "");
  }, [selectedProject?.name, selectedProject?.sourceLanguage, selectedProject?.targetLanguage]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.selectedProjectName, selectedProjectName);
  }, [selectedProjectName]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.activePage, activePage);
  }, [activePage]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.sidebarVisible, String(sidebarVisible));
  }, [sidebarVisible]);

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
  const statusToneClass = `${pillClass} ${actionError ? pillErrorClass : ""}`;
  const showSidebar = sidebarVisible && activePage !== "settings";
  const shellClass = showSidebar
    ? "mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 gap-4 p-3 sm:p-4 lg:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]"
    : "mx-auto grid min-h-screen max-w-[1600px] grid-cols-1 gap-4 p-3 sm:p-4";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(142,182,219,0.12),transparent_28%),linear-gradient(180deg,#151b23_0%,#11161d_100%)] text-[var(--app-text)]">
      <div className={shellClass}>
        {showSidebar ? (
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
        ) : null}

        <div className="app-main min-h-0">
          <section className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4 shadow-[inset_0_1px_0_#ffffff05] backdrop-blur-[14px] sm:p-5">
            <header className="flex flex-col gap-4 border-b border-[var(--app-border)] pb-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3">
                  {activePage === "review" ? (
                    <CommandButton icon={<BackIcon />} label="Back to workspace" onClick={() => setActivePage("workspace")} />
                  ) : null}

                  <div>
                    <div className="font-[IBM_Plex_Mono] text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
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
                          ? "Translation runtime and background worker settings."
                          : projectSummary}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-stretch lg:justify-end lg:self-start">
                  {activePage === "settings" ? null : (
                    <CommandButton
                      icon={<SidebarIcon />}
                      label={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
                      onClick={() => setSidebarVisible((current) => !current)}
                    />
                  )}
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
                <form className="rounded-2xl border border-[var(--app-border)] bg-white/4 p-4" onSubmit={handleCreateProject}>
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
                    <div className="min-w-0 flex-1">
                      <label className="block font-[IBM_Plex_Mono] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                        New project
                      </label>
                      <input
                        value={projectNameInput}
                        onChange={(event) => setProjectNameInput(event.currentTarget.value)}
                        placeholder="spring-catalog"
                        className="mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={creatingProject || !projectNameInput.trim()}
                        className={actionButtonClass}
                      >
                        <span className={iconClass}>
                          <PlusIcon />
                        </span>
                        <span>{creatingProject ? "Creating..." : "Create"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void createUntitledProject()}
                        disabled={creatingProject}
                        className={secondaryActionButtonClass}
                      >
                        <span className={iconClass}>
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
                  projectSourceLanguageInput={projectSourceLanguageInput}
                  projectTargetLanguageInput={projectTargetLanguageInput}
                  documents={documents}
                  selectedDocumentId={selectedDocumentId}
                  documentsRangeStart={documentsRangeStart}
                  documentsRangeEnd={documentsRangeEnd}
                  documentsTotalCount={documentsTotalCount}
                  documentsPage={documentsPage}
                  documentsTotalPages={documentsTotalPages}
                  loadingDocuments={loadingDocuments}
                  importing={importing}
                  savingProjectLanguages={savingProjectLanguages}
                  onSelectDocument={(documentId) => {
                    setSelectedDocumentId(documentId);
                    setActivePage("review");
                  }}
                  onPreviousPage={() => setDocumentsPage((current) => Math.max(1, current - 1))}
                  onNextPage={() => setDocumentsPage((current) => Math.min(documentsTotalPages, current + 1))}
                  onImportFiles={() => void importProjectInputs(false)}
                  onImportFolder={() => void importProjectInputs(true)}
                  onCreateProject={() => setShowCreatePanel(true)}
                  onProjectSourceLanguageChange={setProjectSourceLanguageInput}
                  onProjectTargetLanguageChange={setProjectTargetLanguageInput}
                  onSaveProjectLanguages={() => void saveProjectLanguages()}
                  onRetryDocument={(documentId) => void retryFailedDocument(documentId)}
                  retryingDocumentId={retryingDocumentId}
                />
              ) : activePage === "review" ? (
                <DocumentDetailPanel
                  detail={detail}
                  loadingDetail={loadingDetail}
                  onSelectPreviousDocument={previousDocumentId ? () => setSelectedDocumentId(previousDocumentId) : null}
                  onSelectNextDocument={nextDocumentId ? () => setSelectedDocumentId(nextDocumentId) : null}
                  selectedPosition={selectedDocumentIndex >= 0 ? selectedDocumentIndex + 1 : 0}
                  totalDocuments={documents.length}
                  onRetryDocument={detail && canRetryDocument(detail) ? () => void retryFailedDocument(detail.id) : null}
                  retrying={detail?.id === retryingDocumentId}
                />
              ) : (
                <div className="settings-page mx-auto max-w-3xl">
                  <div className="mb-4 flex justify-start">
                    <CommandButton icon={<BackIcon />} label="Back to project" onClick={() => setActivePage("workspace")} />
                  </div>
                  <div className="space-y-4">
                    <TranslationSettingsCard
                      translationModel={translationModelInput}
                      loadingTranslationModel={loadingTranslationModel}
                      savingTranslationModel={savingTranslationModel}
                      onTranslationModelChange={setTranslationModelInput}
                      onSaveTranslationModel={() => void saveTranslationModel()}
                    />
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
