import type { ProjectSummary, WorkerScheduleStatus, DocumentRow } from "../types";
import DocumentsTable from "./DocumentsTable";
import WorkerScheduleCard from "./WorkerScheduleCard";
import { StatCard } from "./app-shared";

type WorkspacePanelProps = {
  selectedProjectName: string;
  selectedProject: ProjectSummary | null;
  importing: boolean;
  exporting: boolean;
  actionError: string;
  actionMessage: string;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onRefreshWorkspace: () => void;
  onExportFiles: () => void;
  workerSchedule: WorkerScheduleStatus | null;
  scheduleStartTime: string;
  scheduleEndTime: string;
  loadingWorkerSchedule: boolean;
  savingWorkerSchedule: boolean;
  removingWorkerSchedule: boolean;
  onScheduleStartTimeChange: (value: string) => void;
  onScheduleEndTimeChange: (value: string) => void;
  onSaveWorkerSchedule: () => void;
  onRemoveWorkerSchedule: () => void;
  documents: DocumentRow[];
  selectedDocumentId: number | null;
  documentsRangeStart: number;
  documentsRangeEnd: number;
  documentsTotalCount: number;
  documentsPage: number;
  documentsTotalPages: number;
  loadingDocuments: boolean;
  onSelectDocument: (documentId: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
};

function WorkspacePanel(props: WorkspacePanelProps) {
  return (
    <section className="panel-surface flex h-full min-h-0 flex-col rounded-2xl p-4">
      <div className="flex flex-col gap-4 border-b border-[var(--app-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
            {props.selectedProjectName ? "Project workspace" : "Workspace overview"}
          </p>
          <h2 className="mt-2 text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] sm:text-3xl">
            {props.selectedProjectName || "Choose or create a project"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">
            Import source material, monitor throughput, and keep the worker cadence tuned without leaving the main desk.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={props.onImportFiles}
            disabled={!props.selectedProjectName || props.importing}
            className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-2 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.importing ? "Importing..." : "Import files"}
          </button>
          <button
            type="button"
            onClick={props.onImportFolder}
            disabled={!props.selectedProjectName || props.importing}
            className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-2 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import folder
          </button>
          <button
            type="button"
            onClick={props.onRefreshWorkspace}
            className="metal-pill rounded-full px-4 py-2 text-sm font-medium text-[var(--app-accent-strong)] transition hover:bg-sky-400/16"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={props.onExportFiles}
            disabled={!props.selectedProjectName || props.exporting}
            className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-4 py-2 text-sm font-semibold text-[#04101d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.exporting ? "Exporting..." : "Export files"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="All documents" value={props.selectedProject?.totalDocuments ?? 0} accent="text-[var(--app-muted)]" />
        <StatCard label="Waiting" value={props.selectedProject?.queuedDocuments ?? 0} accent="text-amber-300" />
        <StatCard label="In progress" value={props.selectedProject?.processingDocuments ?? 0} accent="text-sky-300" />
        <StatCard label="Ready" value={props.selectedProject?.completedDocuments ?? 0} accent="text-emerald-300" />
      </div>

      {props.actionError ? (
        <div className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {props.actionError}
        </div>
      ) : null}

      {!props.actionError && props.actionMessage ? (
        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          {props.actionMessage}
        </div>
      ) : null}

      <WorkerScheduleCard
        workerSchedule={props.workerSchedule}
        scheduleStartTime={props.scheduleStartTime}
        scheduleEndTime={props.scheduleEndTime}
        loadingWorkerSchedule={props.loadingWorkerSchedule}
        savingWorkerSchedule={props.savingWorkerSchedule}
        removingWorkerSchedule={props.removingWorkerSchedule}
        onScheduleStartTimeChange={props.onScheduleStartTimeChange}
        onScheduleEndTimeChange={props.onScheduleEndTimeChange}
        onSaveWorkerSchedule={props.onSaveWorkerSchedule}
        onRemoveWorkerSchedule={props.onRemoveWorkerSchedule}
      />

      <DocumentsTable
        selectedProjectName={props.selectedProjectName}
        documents={props.documents}
        selectedDocumentId={props.selectedDocumentId}
        documentsRangeStart={props.documentsRangeStart}
        documentsRangeEnd={props.documentsRangeEnd}
        documentsTotalCount={props.documentsTotalCount}
        documentsPage={props.documentsPage}
        documentsTotalPages={props.documentsTotalPages}
        loadingDocuments={props.loadingDocuments}
        onSelectDocument={props.onSelectDocument}
        onPreviousPage={props.onPreviousPage}
        onNextPage={props.onNextPage}
      />
    </section>
  );
}

export default WorkspacePanel;
