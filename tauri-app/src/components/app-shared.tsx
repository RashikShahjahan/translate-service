function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const STATUS_STYLES: Record<string, string> = {
  pending_ocr: "border border-amber-300/20 bg-amber-300/10 text-amber-100",
  processing_ocr: "border border-orange-300/20 bg-orange-300/10 text-orange-100",
  pending_translation: "border border-violet-300/20 bg-violet-300/10 text-violet-100",
  processing_translation: "border border-sky-300/20 bg-sky-300/10 text-sky-100",
  completed: "border border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
};

const STATUS_LABELS: Record<string, string> = {
  pending_ocr: "Queued OCR",
  processing_ocr: "Running OCR",
  pending_translation: "Queued Translation",
  processing_translation: "Translating",
  completed: "Completed",
};

function getStatusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function getStatusClass(status: string) {
  return (
    STATUS_STYLES[status] ??
    "border border-white/10 bg-white/6 text-[var(--app-muted)]"
  );
}

function StatCard(props: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-[#8497b01a] bg-[var(--app-panel-soft)] p-4 backdrop-blur-[10px]">
      <div className={`font-[IBM_Plex_Mono] text-[11px] uppercase tracking-[0.24em] ${props.accent}`}>{props.label}</div>
      <div className="mt-2 text-3xl font-semibold leading-none text-[var(--app-text)]">{props.value}</div>
    </div>
  );
}

function StatusBadge(props: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${getStatusClass(props.status)}`}
    >
      {getStatusLabel(props.status)}
    </span>
  );
}

function TextPreviewSection(props: { label: string; value: string }) {
  return (
    <section className="rounded-xl border border-[#8497b01a] bg-[var(--app-panel-soft)] p-4 backdrop-blur-[10px]">
      <div className="font-[IBM_Plex_Mono] text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">{props.label}</div>
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--app-border)] bg-black/10 p-4 text-sm leading-6 text-[var(--app-text)]">
        {props.value}
      </pre>
    </section>
  );
}

export { StatCard, StatusBadge, TextPreviewSection, formatTimestamp };
