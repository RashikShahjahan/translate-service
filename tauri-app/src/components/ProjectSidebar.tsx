import type { ProjectSummary } from "../types";

type ProjectSidebarProps = {
  projects: ProjectSummary[];
  selectedProjectName: string;
  loadingProjects: boolean;
  onSelectProject: (name: string) => void;
  onCreateProject: () => void;
};

function ProjectSidebar(props: ProjectSidebarProps) {
  const inlineActionClass =
    "inline-flex min-h-10 items-center justify-center gap-[0.55rem] rounded-full border border-[rgba(103,183,255,0.3)] bg-white/[0.055] px-4 text-sm font-semibold leading-none text-[var(--app-text)] transition hover:border-[var(--app-border-strong)] hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-55";

  return (
    <aside className="flex h-full min-h-0 flex-col rounded-[24px] border border-[var(--app-border)] bg-[var(--app-panel)] p-3 shadow-[inset_0_1px_0_#ffffff05] backdrop-blur-[14px]">
      <div className="border-b border-[var(--app-border)] pb-3">
        <p className="font-[IBM_Plex_Mono] text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">Projects</p>
      </div>

      <div className="mt-3 flex items-center justify-end">
        {props.loadingProjects ? <span className="text-xs text-[var(--app-muted)]">Updating</span> : null}
      </div>

      <div className="mt-3 min-h-0 space-y-2 overflow-auto pr-1">
        {props.projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--app-border-strong)] bg-white/4 p-4 text-sm text-[var(--app-muted)]">
            <div>No projects yet. Create one to start a queue and import files.</div>
            <button type="button" onClick={props.onCreateProject} className={`${inlineActionClass} mt-4`}>
              Create project
            </button>
          </div>
        ) : null}

        {props.projects.map((project) => {
          const selected = project.name === props.selectedProjectName;

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => props.onSelectProject(project.name)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition backdrop-blur-[14px] ${
                selected
                  ? "border-[var(--app-border-strong)] bg-sky-400/8 shadow-[0_10px_30px_rgba(15,23,42,0.22)]"
                  : "border-[var(--app-border)] bg-white/4 hover:border-[var(--app-border-strong)] hover:bg-white/6"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--app-text)]">{project.name}</div>
                </div>
                {project.erroredDocuments > 0 ? (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-200">
                    {project.erroredDocuments} issue{project.erroredDocuments === 1 ? "" : "s"}
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
