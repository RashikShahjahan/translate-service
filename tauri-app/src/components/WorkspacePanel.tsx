import type { DocumentRow, ProjectSummary } from "../types";
import DocumentsTable from "./DocumentsTable";

type WorkspacePanelProps = {
  selectedProjectName: string;
  selectedProject: ProjectSummary | null;
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
  onImportFiles: () => void;
  onImportFolder: () => void;
  onCreateProject: () => void;
};

function WorkspacePanel(props: WorkspacePanelProps) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.totalDocuments ?? 0} documents</span>
        <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.queuedDocuments ?? 0} queued</span>
        <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.processingDocuments ?? 0} processing</span>
        <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.completedDocuments ?? 0} completed</span>
        {props.selectedProject?.erroredDocuments ? (
          <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-rose-400/30 bg-rose-400/12 px-3 py-[0.35rem] text-[0.8125rem] text-rose-100">{props.selectedProject.erroredDocuments} issues</span>
        ) : null}
      </div>

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
        onImportFiles={props.onImportFiles}
        onImportFolder={props.onImportFolder}
        onCreateProject={props.onCreateProject}
      />
    </section>
  );
}

export default WorkspacePanel;
