import type { DocumentRow, ProjectSummary } from "../types";
import { SUPPORTED_LANGUAGE_OPTIONS } from "../languageOptions";
import DocumentsTable from "./DocumentsTable";
import ImportMenuButton from "./ImportMenuButton";

type WorkspacePanelProps = {
  selectedProjectName: string;
  selectedProject: ProjectSummary | null;
  projectSourceLanguageInput: string;
  projectTargetLanguageInput: string;
  documents: DocumentRow[];
  selectedDocumentId: number | null;
  documentsRangeStart: number;
  documentsRangeEnd: number;
  documentsTotalCount: number;
  documentsPage: number;
  documentsTotalPages: number;
  loadingDocuments: boolean;
  importing: boolean;
  savingProjectLanguages: boolean;
  onSelectDocument: (documentId: number) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onImportFiles: () => void;
  onImportFolder: () => void;
  onCreateProject: () => void;
  onProjectSourceLanguageChange: (value: string) => void;
  onProjectTargetLanguageChange: (value: string) => void;
  onSaveProjectLanguages: () => void;
  onRetryDocument: (documentId: number) => void;
  retryingDocumentId: number | null;
};

function WorkspacePanel(props: WorkspacePanelProps) {
  const inlineActionClass =
    "inline-flex min-h-10 items-center justify-center gap-[0.55rem] rounded-full border border-[rgba(103,183,255,0.3)] bg-white/[0.055] px-4 text-sm font-semibold leading-none text-[var(--app-text)] transition hover:border-[var(--app-border-strong)] hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-55";
  const normalizedSourceLanguage = props.projectSourceLanguageInput.trim();
  const normalizedTargetLanguage = props.projectTargetLanguageInput.trim();
  const languageChanged = Boolean(
    props.selectedProject &&
      (normalizedSourceLanguage !== props.selectedProject.sourceLanguage ||
        normalizedTargetLanguage !== props.selectedProject.targetLanguage),
  );
  const canSaveLanguages = Boolean(
    props.selectedProject && normalizedSourceLanguage && normalizedTargetLanguage && languageChanged && !props.savingProjectLanguages,
  );

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.totalDocuments ?? 0} documents</span>
          <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.queuedDocuments ?? 0} queued</span>
          <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.processingDocuments ?? 0} processing</span>
          <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-white/8 bg-white/[0.045] px-3 py-[0.35rem] text-[0.8125rem] text-[var(--app-text)]">{props.selectedProject?.completedDocuments ?? 0} completed</span>
          {props.selectedProject ? (
            <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-[0.35rem] text-[0.8125rem] text-sky-100">
              {props.selectedProject.sourceLanguage} to {props.selectedProject.targetLanguage}
            </span>
          ) : null}
          {props.selectedProject?.erroredDocuments ? (
            <span className="inline-flex min-h-8 max-w-full items-center rounded-full border border-rose-400/30 bg-rose-400/12 px-3 py-[0.35rem] text-[0.8125rem] text-rose-100">{props.selectedProject.erroredDocuments} issues</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <ImportMenuButton
            disabled={!props.selectedProjectName}
            importing={props.importing}
            onImportFiles={props.onImportFiles}
            onImportFolder={props.onImportFolder}
            className={inlineActionClass}
          />
        </div>
      </div>

      {props.selectedProject ? (
        <div className="mb-4 rounded-2xl border border-[var(--app-border)] bg-white/4 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2">
              <div>
                <label className="block font-[IBM_Plex_Mono] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                  Source language
                </label>
                <input
                  list="project-language-options"
                  value={props.projectSourceLanguageInput}
                  onChange={(event) => props.onProjectSourceLanguageChange(event.currentTarget.value)}
                  placeholder="bn"
                  className="mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                />
              </div>
              <div>
                <label className="block font-[IBM_Plex_Mono] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
                  Target language
                </label>
                <input
                  list="project-language-options"
                  value={props.projectTargetLanguageInput}
                  onChange={(event) => props.onProjectTargetLanguageChange(event.currentTarget.value)}
                  placeholder="en"
                  className="mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm text-[var(--app-muted)]">Uses language codes like `bn`, `en`, or `fr`.</div>
              <button type="button" onClick={props.onSaveProjectLanguages} disabled={!canSaveLanguages} className={inlineActionClass}>
                {props.savingProjectLanguages ? "Saving..." : "Save languages"}
              </button>
            </div>
          </div>
          <datalist id="project-language-options">
            {SUPPORTED_LANGUAGE_OPTIONS.map(([code, label]) => (
              <option key={code} value={code} label={label} />
            ))}
          </datalist>
        </div>
      ) : null}

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
        importing={props.importing}
        onSelectDocument={props.onSelectDocument}
        onPreviousPage={props.onPreviousPage}
        onNextPage={props.onNextPage}
        onImportFiles={props.onImportFiles}
        onImportFolder={props.onImportFolder}
        onCreateProject={props.onCreateProject}
        onRetryDocument={props.onRetryDocument}
        retryingDocumentId={props.retryingDocumentId}
      />
    </section>
  );
}

export default WorkspacePanel;
