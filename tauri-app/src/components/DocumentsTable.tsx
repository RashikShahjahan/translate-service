import { StatusBadge, formatTimestamp } from "./app-shared";
import type { DocumentRow } from "../types";

type DocumentsTableProps = {
  selectedProjectName: string;
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

function DocumentsTable(props: DocumentsTableProps) {
  return (
    <div className="panel-soft mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
      <div className="flex items-center justify-between border-b border-[var(--app-border)] px-4 py-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--app-text)]">Documents</h3>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            {props.selectedProjectName
              ? "Open any row to move into the review page."
              : "Select a project to browse its files."}
          </p>
        </div>
        <div className="text-right">
          {props.selectedProjectName ? (
            <div className="font-mono-ui text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
              Showing {props.documentsRangeStart}-{props.documentsRangeEnd} of {props.documentsTotalCount}
            </div>
          ) : null}
          {props.loadingDocuments ? <span className="text-xs text-[var(--app-muted)]">Refreshing</span> : null}
        </div>
      </div>

      {!props.selectedProjectName ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--app-muted)]">
          <div>Create a project to start adding files.</div>
          <button type="button" onClick={props.onCreateProject} className="panel-inline-action mt-4">
            Create project
          </button>
        </div>
      ) : props.documents.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--app-muted)]">
          <div>No files in this project yet.</div>
          <div className="mt-2">Import files or a folder to start the queue.</div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button type="button" onClick={props.onImportFiles} className="panel-inline-action">
              Import files
            </button>
            <button type="button" onClick={props.onImportFolder} className="panel-inline-action panel-inline-action-secondary">
              Import folder
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 overflow-auto">
          <table className="desktop-documents-table min-w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr className="font-mono-ui text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                <th className="px-4 py-3 font-medium">Document</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Retries</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {props.documents.map((document) => {
                const selected = document.id === props.selectedDocumentId;

                return (
                  <tr
                    key={document.id}
                    onClick={() => props.onSelectDocument(document.id)}
                    className={`cursor-pointer transition ${selected ? "desktop-document-row-selected" : "hover:bg-white/4"}`}
                  >
                    <td className="border-t border-[var(--app-border)] px-4 py-3.5 align-top">
                      <div className="max-w-[420px] truncate text-sm font-medium text-[var(--app-text)]">
                        {document.sourceName}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--app-muted)]">
                        <span>Created {formatTimestamp(document.createdAt)}</span>
                        {document.errorMessage ? (
                          <span className="rounded-full border border-rose-400/20 bg-rose-400/12 px-2 py-1 text-[11px] font-semibold text-rose-200">
                            Needs attention
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-t border-[var(--app-border)] px-4 py-3.5 align-top text-sm capitalize text-[var(--app-muted)]">
                      {document.sourceType}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-4 py-3.5 align-top">
                      <StatusBadge status={document.status} />
                      {document.nextAttemptAt ? (
                        <div className="mt-2 text-xs text-[var(--app-muted)]">
                          Retry {formatTimestamp(document.nextAttemptAt)}
                        </div>
                      ) : null}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-4 py-3.5 align-top text-sm text-[var(--app-muted)]">
                      {document.retryCount}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-4 py-3.5 align-top text-sm text-[var(--app-muted)]">
                      {formatTimestamp(document.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-col gap-3 border-t border-[var(--app-border)] bg-white/4 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-[var(--app-muted)]">
              Page {props.documentsPage} of {props.documentsTotalPages}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={props.onPreviousPage}
                disabled={props.documentsPage <= 1 || props.loadingDocuments}
                className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-1.5 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={props.onNextPage}
                disabled={props.documentsPage >= props.documentsTotalPages || props.loadingDocuments}
                className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-1.5 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DocumentsTable;
