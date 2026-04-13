import { formatTimestamp } from "./app-shared";
import type { ProjectSummary } from "../types";

type ProjectSidebarProps = {
  projects: ProjectSummary[];
  selectedProjectName: string;
  loadingProjects: boolean;
  onSelectProject: (name: string) => void;
};

function ProjectSidebar(props: ProjectSidebarProps) {
  return (
    <aside className="panel-surface flex h-full min-h-0 flex-col rounded-2xl p-3">
      <div className="space-y-1 border-b border-[var(--app-border)] pb-3">
        <p className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">Projects</p>
        <h2 className="text-lg font-semibold tracking-tight text-[var(--app-text)]">Workspace index</h2>
        <p className="text-sm text-[var(--app-muted)]">Recent runs, queue counts, and document health.</p>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <h2 className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">All projects</h2>
        {props.loadingProjects ? <span className="text-xs text-[var(--app-muted)]">Updating</span> : null}
      </div>

      <div className="mt-3 min-h-0 space-y-2 overflow-auto pr-1">
        {props.projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--app-border-strong)] bg-white/4 p-4 text-sm text-[var(--app-muted)]">
            No projects yet. Create one to get started.
          </div>
        ) : null}

        {props.projects.map((project) => {
          const selected = project.name === props.selectedProjectName;

          return (
            <button
              key={project.id}
              type="button"
              onClick={() => props.onSelectProject(project.name)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition ${
                selected
                  ? "border-[var(--app-border-strong)] bg-sky-400/8"
                  : "border-[var(--app-border)] bg-white/4 hover:border-[var(--app-border-strong)] hover:bg-white/6"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--app-text)]">{project.name}</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">
                    Created {formatTimestamp(project.createdAt)}
                  </div>
                </div>
                {project.erroredDocuments > 0 ? (
                  <span className="rounded-full border border-rose-400/20 bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-200">
                    {project.erroredDocuments} issue{project.erroredDocuments === 1 ? "" : "s"}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-[var(--app-muted)]">
                <span>
                  Waiting <span className="mt-1 block text-sm font-semibold text-[var(--app-text)]">{project.queuedDocuments}</span>
                </span>
                <span>
                  Running <span className="mt-1 block text-sm font-semibold text-[var(--app-text)]">{project.processingDocuments}</span>
                </span>
                <span>
                  Ready <span className="mt-1 block text-sm font-semibold text-[var(--app-text)]">{project.completedDocuments}</span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export default ProjectSidebar;
