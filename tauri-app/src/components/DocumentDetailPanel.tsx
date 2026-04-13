import { StatusBadge, TextPreviewSection, formatTimestamp } from "./app-shared";
import type { DocumentDetail } from "../types";

type DocumentDetailPanelProps = {
  detail: DocumentDetail | null;
  loadingDetail: boolean;
};

function DocumentDetailPanel(props: DocumentDetailPanelProps) {
  return (
    <aside className="panel-surface flex h-full min-h-0 flex-col rounded-2xl p-3">
      <div className="flex items-center justify-between border-b border-[var(--app-border)] pb-4">
        <div>
          <p className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">Document</p>
          <h3 className="mt-2 text-base font-semibold tracking-tight text-[var(--app-text)]">
            {props.detail?.sourceName ?? "No selection"}
          </h3>
        </div>
        {props.loadingDetail ? <span className="text-xs text-[var(--app-muted)]">Refreshing</span> : null}
      </div>

      {!props.detail ? (
        <div className="py-12 text-center text-sm text-[var(--app-muted)]">
          Select a file to read its original text, OCR result, translation, and any issues.
        </div>
      ) : (
        <div className="mt-4 min-h-0 space-y-4 overflow-auto pr-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="panel-soft rounded-xl p-4">
              <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">Source type</div>
              <div className="mt-2 text-sm font-medium capitalize text-[var(--app-text)]">{props.detail.sourceType}</div>
            </div>
            <div className="panel-soft rounded-xl p-4">
              <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">Status</div>
              <div className="mt-2">
                <StatusBadge status={props.detail.status} />
              </div>
            </div>
          </div>

          <div className="panel-soft rounded-xl p-4">
            <div className="grid gap-3 text-sm text-[var(--app-muted)] sm:grid-cols-2">
              <div>
                <span>Project</span>
                <div className="mt-1 text-[var(--app-text)]">{props.detail.projectName}</div>
              </div>
              <div>
                <span>MIME type</span>
                <div className="mt-1 break-all text-[var(--app-text)]">{props.detail.mimeType ?? "-"}</div>
              </div>
              <div>
                <span>Updated</span>
                <div className="mt-1 text-[var(--app-text)]">{formatTimestamp(props.detail.updatedAt)}</div>
              </div>
              <div>
                <span>Retry count</span>
                <div className="mt-1 text-[var(--app-text)]">{props.detail.retryCount}</div>
              </div>
              <div>
                <span>Next attempt</span>
                <div className="mt-1 text-[var(--app-text)]">{formatTimestamp(props.detail.nextAttemptAt)}</div>
              </div>
              <div>
                <span>Lease acquired</span>
                <div className="mt-1 text-[var(--app-text)]">{formatTimestamp(props.detail.leasedAt)}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <TextPreviewSection
              label="Original text"
              value={props.detail.sourceText?.trim() || "No source text stored for this document."}
            />
            <TextPreviewSection
              label="OCR text"
              value={props.detail.ocrText?.trim() || "OCR has not produced text for this document yet."}
            />
            <TextPreviewSection
              label="Translation preview"
              value={props.detail.translatedText?.trim() || "Translation has not completed for this document yet."}
            />
          </div>

          {props.detail.errorMessage ? (
            <section className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-4">
              <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-rose-200">Needs attention</div>
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-xl border border-rose-400/14 bg-black/20 p-4 text-sm leading-6 text-rose-100">
                {props.detail.errorMessage.trim()}
              </pre>
            </section>
          ) : null}
        </div>
      )}
    </aside>
  );
}

export default DocumentDetailPanel;
