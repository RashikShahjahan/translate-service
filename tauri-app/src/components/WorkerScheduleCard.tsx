import type { WorkerScheduleStatus } from "../types";

type WorkerScheduleCardProps = {
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
};

function WorkerScheduleCard(props: WorkerScheduleCardProps) {
  const disabled =
    props.loadingWorkerSchedule || props.savingWorkerSchedule || props.removingWorkerSchedule;

  return (
    <section className="panel-soft rounded-2xl p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--app-text)]">Worker schedule</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--app-muted)]">
            Run the background worker on a daily macOS schedule without leaving a terminal open.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
          {props.loadingWorkerSchedule ? (
            <span className="rounded-full border border-[var(--app-border)] bg-white/6 px-3 py-1 text-[var(--app-muted)]">
              Checking schedule
            </span>
          ) : props.workerSchedule?.supported ? (
            <>
              <span
                className={`rounded-full px-3 py-1 ${
                  props.workerSchedule.installed
                    ? "border border-emerald-400/20 bg-emerald-400/12 text-emerald-200"
                    : "border border-[var(--app-border)] bg-white/6 text-[var(--app-muted)]"
                }`}
              >
                {props.workerSchedule.installed ? "Enabled" : "Disabled"}
              </span>
              <span
                className={`rounded-full px-3 py-1 ${
                  props.workerSchedule.loaded
                    ? "border border-sky-400/20 bg-sky-400/12 text-sky-200"
                    : "border border-[var(--app-border)] bg-white/6 text-[var(--app-muted)]"
                }`}
              >
                {props.workerSchedule.loaded ? "Loaded in launchd" : "Not loaded"}
              </span>
            </>
          ) : (
            <span className="rounded-full border border-[var(--app-border)] bg-white/6 px-3 py-1 text-[var(--app-muted)]">
              macOS only
            </span>
          )}
        </div>
      </div>

      {props.workerSchedule?.supported ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--app-muted)]">
              Start time
              <input
                type="time"
                value={props.scheduleStartTime}
                onChange={(event) => props.onScheduleStartTimeChange(event.currentTarget.value)}
                className="mt-1.5 w-full rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-sm text-[var(--app-text)] outline-none transition focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
              />
            </label>
            <label className="block text-xs font-medium text-[var(--app-muted)]">
              End time
              <input
                type="time"
                value={props.scheduleEndTime}
                onChange={(event) => props.onScheduleEndTimeChange(event.currentTarget.value)}
                className="mt-1.5 w-full rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-sm text-[var(--app-text)] outline-none transition focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              onClick={props.onSaveWorkerSchedule}
              disabled={disabled}
              className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-4 py-2 text-sm font-semibold text-[#04101d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.savingWorkerSchedule
                ? "Saving..."
                : props.workerSchedule.installed
                  ? "Update schedule"
                  : "Enable schedule"}
            </button>
            <button
              type="button"
              onClick={props.onRemoveWorkerSchedule}
              disabled={!props.workerSchedule.installed || props.savingWorkerSchedule || props.removingWorkerSchedule}
              className="rounded-full border border-[var(--app-border)] bg-white/6 px-4 py-2 text-sm font-medium text-[var(--app-text)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.removingWorkerSchedule ? "Disabling..." : "Disable schedule"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--app-border)] bg-white/4 px-4 py-3 text-sm text-[var(--app-muted)]">
          This app currently manages worker schedules through macOS LaunchAgents.
        </div>
      )}

      {props.workerSchedule?.supported ? (
        <div className="mt-4 text-xs text-[var(--app-muted)]">
          LaunchAgent path: <span className="font-mono-ui text-[11px] text-[var(--app-text)]">{props.workerSchedule.plistPath}</span>
        </div>
      ) : null}
    </section>
  );
}

export default WorkerScheduleCard;
