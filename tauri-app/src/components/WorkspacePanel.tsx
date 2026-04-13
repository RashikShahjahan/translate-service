import type { ProjectSummary, WorkerScheduleStatus, DocumentRow } from "../types";
import DocumentsTable from "./DocumentsTable";
import WorkerScheduleCard from "./WorkerScheduleCard";
import { StatCard } from "./app-shared";

type WorkspacePanelProps = {
  selectedProjectName: string;
  selectedProject: ProjectSummary | null;
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
    <section className="panel-surface flex h-full min-h-0 flex-col rounded-2xl p-4 sm:p-5">
      <div className="desktop-panel-header flex flex-col gap-4 border-b border-[var(--app-border)] pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
            {props.selectedProjectName ? "Main workspace" : "Workspace overview"}
          </p>
          <h2 className="mt-2 text-xl font-semibold leading-none tracking-tight text-[var(--app-text)] sm:text-2xl">
            {props.selectedProjectName || "Choose or create a project"}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--app-muted)]">
            Monitor queue health, worker schedule, and file progress without leaving the current desk.
          </p>
        </div>

        <div className="desktop-workspace-summary grid gap-3 sm:grid-cols-3">
          <StatCard label="Queued" value={props.selectedProject?.queuedDocuments ?? 0} accent="text-amber-300" />
          <StatCard label="Active" value={props.selectedProject?.processingDocuments ?? 0} accent="text-sky-300" />
          <StatCard label="Ready" value={props.selectedProject?.completedDocuments ?? 0} accent="text-emerald-300" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
        <StatCard label="All documents" value={props.selectedProject?.totalDocuments ?? 0} accent="text-[var(--app-muted)]" />
        <StatCard label="Waiting" value={props.selectedProject?.queuedDocuments ?? 0} accent="text-amber-300" />
        <StatCard label="In progress" value={props.selectedProject?.processingDocuments ?? 0} accent="text-sky-300" />
        <StatCard label="Ready" value={props.selectedProject?.completedDocuments ?? 0} accent="text-emerald-300" />
      </div>

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
