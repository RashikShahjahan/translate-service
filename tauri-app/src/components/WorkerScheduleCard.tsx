import type { WorkerScheduleStatus } from "../types";

const HOURS = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, "0"));

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

function TimeSelect(props: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [rawHour = "00", rawMinute = "00"] = props.value.split(":");
  const hour = HOURS.includes(rawHour) ? rawHour : "00";
  const minute = MINUTES.includes(rawMinute) ? rawMinute : "00";

  function updateTime(nextHour: string, nextMinute: string) {
    props.onChange(`${nextHour}:${nextMinute}`);
  }

  return (
    <label className="block text-xs font-medium text-[var(--app-muted)]">
      {props.label}
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <select
          aria-label={`${props.label} hour`}
          value={hour}
          disabled={props.disabled}
          onChange={(event) => updateTime(event.currentTarget.value, minute)}
          className="w-full appearance-none rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-sm text-[var(--app-text)] outline-none transition focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {HOURS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="text-sm text-[var(--app-muted)]">:</span>
        <select
          aria-label={`${props.label} minute`}
          value={minute}
          disabled={props.disabled}
          onChange={(event) => updateTime(hour, event.currentTarget.value)}
          className="w-full appearance-none rounded-lg border border-[var(--app-border)] bg-white/6 px-4 py-3 text-sm text-[var(--app-text)] outline-none transition focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {MINUTES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

function WorkerScheduleCard(props: WorkerScheduleCardProps) {
  const disabled =
    props.loadingWorkerSchedule || props.savingWorkerSchedule || props.removingWorkerSchedule;

  return (
    <section className="rounded-2xl border border-[#8497b01a] bg-[var(--app-panel-soft)] p-4 backdrop-blur-[10px] sm:p-5">
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
                    ? "border border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                    : "border border-[var(--app-border)] bg-white/6 text-[var(--app-muted)]"
                }`}
              >
                {props.workerSchedule.installed ? "Enabled" : "Disabled"}
              </span>
              <span
                className={`rounded-full px-3 py-1 ${
                  props.workerSchedule.loaded
                    ? "border border-sky-300/20 bg-sky-300/10 text-sky-100"
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
            <TimeSelect
              label="Start time"
              value={props.scheduleStartTime}
              disabled={disabled}
              onChange={props.onScheduleStartTimeChange}
            />
            <TimeSelect
              label="End time"
              value={props.scheduleEndTime}
              disabled={disabled}
              onChange={props.onScheduleEndTimeChange}
            />
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              onClick={props.onSaveWorkerSchedule}
              disabled={disabled}
               className="rounded-full border border-[rgba(142,182,219,0.28)] bg-[linear-gradient(135deg,#8eb6db,#789fc4)] px-4 py-2 text-sm font-semibold text-[#15202b] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
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
          LaunchAgent path: <span className="font-[IBM_Plex_Mono] text-[11px] text-[var(--app-text)]">{props.workerSchedule.plistPath}</span>
        </div>
      ) : null}
    </section>
  );
}

export default WorkerScheduleCard;
