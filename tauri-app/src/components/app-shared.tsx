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
  pending_ocr: "border border-amber-400/20 bg-amber-400/12 text-amber-200",
  processing_ocr: "border border-orange-400/20 bg-orange-400/12 text-orange-200",
  pending_translation: "border border-fuchsia-400/20 bg-fuchsia-400/12 text-fuchsia-200",
  processing_translation: "border border-sky-400/20 bg-sky-400/12 text-sky-200",
  completed: "border border-emerald-400/20 bg-emerald-400/12 text-emerald-200",
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
    <div className="panel-soft rounded-lg p-4">
      <div className={`font-mono-ui text-[11px] uppercase tracking-[0.24em] ${props.accent}`}>{props.label}</div>
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
    <section className="panel-soft rounded-lg p-4">
      <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">{props.label}</div>
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--app-border)] bg-black/20 p-4 text-sm leading-6 text-[var(--app-text)]">
        {props.value}
      </pre>
    </section>
  );
}

export { StatCard, StatusBadge, TextPreviewSection, formatTimestamp };
