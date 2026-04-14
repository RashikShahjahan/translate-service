import type { ProjectSummary } from "../types";

type ProjectSidebarProps = {
  projects: ProjectSummary[];
  selectedProjectName: string;
  loadingProjects: boolean;
  onSelectProject: (name: string) => void;
  onCreateProject: () => void;
};

function ProjectSidebar(props: ProjectSidebarProps) {
  const createButtonClass =
    "inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl border border-[var(--app-border)] bg-white/[0.04] px-4 text-sm font-semibold text-[var(--app-text)] shadow-[0_6px_18px_rgba(15,23,42,0.06)] transition hover:border-[var(--app-border-strong)] hover:bg-white/[0.065]";

  const projectItemClass =
    "w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold text-[var(--app-text)] transition";

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-3 shadow-[inset_0_1px_0_#ffffff05] backdrop-blur-[14px]">
      <div>
        <button type="button" onClick={props.onCreateProject} className={createButtonClass}>
          <span aria-hidden="true" className="inline-flex size-5 items-center justify-center text-[var(--app-muted)]">
            <svg className="size-5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M3.75 16.25h3.1l8.18-8.18a1.5 1.5 0 0 0 0-2.12l-.98-.97a1.5 1.5 0 0 0-2.12 0L3.75 13.15v3.1Z" />
              <path d="M10.75 6.25 13.75 9.25" />
            </svg>
          </span>
          <span>New Project</span>
        </button>
      </div>

      <div className="mt-3 flex min-h-5 items-center justify-end">
        {props.loadingProjects ? <span className="text-xs text-[var(--app-muted)]">Updating</span> : null}
      </div>

      <div className="mt-4 min-h-0 space-y-1 overflow-auto pr-1">
        {props.projects.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.035] p-4 text-sm text-[var(--app-muted)]">
            <div>No projects yet. Create one to start a queue and import files.</div>
          </div>
        ) : null}

        {props.projects.map((project) => {
          const selected = project.name === props.selectedProjectName;

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => props.onSelectProject(project.name)}
              className={`${projectItemClass} ${
                selected
                  ? "bg-white/[0.07]"
                  : "bg-transparent hover:bg-white/[0.04]"
               }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate">{project.name}</div>
                  <div className="mt-1 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    {project.sourceLanguage} to {project.targetLanguage}
                  </div>
                </div>
                {project.erroredDocuments > 0 ? (
                  <span className="shrink-0 rounded-full border border-rose-300/20 bg-rose-300/10 px-2.5 py-1 text-[11px] font-semibold text-rose-50">
                    {project.erroredDocuments}
                  </span>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default ProjectSidebar;
