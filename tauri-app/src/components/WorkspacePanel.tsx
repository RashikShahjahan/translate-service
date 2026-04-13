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
      <div className="workspace-summary mb-4 flex flex-wrap items-center gap-2">
        <span className="status-pill">{props.selectedProject?.totalDocuments ?? 0} documents</span>
        <span className="status-pill">{props.selectedProject?.queuedDocuments ?? 0} queued</span>
        <span className="status-pill">{props.selectedProject?.processingDocuments ?? 0} processing</span>
        <span className="status-pill">{props.selectedProject?.completedDocuments ?? 0} completed</span>
        {props.selectedProject?.erroredDocuments ? (
          <span className="status-pill status-pill-error">{props.selectedProject.erroredDocuments} issues</span>
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
