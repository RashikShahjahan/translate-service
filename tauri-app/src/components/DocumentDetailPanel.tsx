import { useState, type ReactNode } from "react";

import { StatusBadge, TextPreviewSection, formatTimestamp } from "./app-shared";
import type { DocumentDetail } from "../types";

function DetailActionIcon(props: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {props.children}
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <DetailActionIcon>
      <path d="M8 5.5 3.5 10 8 14.5" />
      <path d="M4 10h12.5" />
    </DetailActionIcon>
  );
}

function ChevronLeftIcon() {
  return (
    <DetailActionIcon>
      <path d="M11.5 4.5 6 10l5.5 5.5" />
    </DetailActionIcon>
  );
}

function ChevronRightIcon() {
  return (
    <DetailActionIcon>
      <path d="M8.5 4.5 14 10l-5.5 5.5" />
    </DetailActionIcon>
  );
}

function EyeIcon() {
  return (
    <DetailActionIcon>
      <path d="M2.5 10s2.6-4.5 7.5-4.5 7.5 4.5 7.5 4.5-2.6 4.5-7.5 4.5S2.5 10 2.5 10Z" />
      <circle cx="10" cy="10" r="2.1" />
    </DetailActionIcon>
  );
}

type DetailActionButtonProps = {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
};

function DetailActionButton(props: DetailActionButtonProps) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props.label}
      title={props.label}
      className={`page-chip detail-action-button ${props.active ? "page-chip-active" : ""}`}
    >
      <span className="command-button-icon">{props.icon}</span>
      <span className="command-button-tooltip" aria-hidden="true">
        {props.label}
      </span>
    </button>
  );
}

type DocumentDetailPanelProps = {
  detail: DocumentDetail | null;
  loadingDetail: boolean;
  onBack: () => void;
  onSelectPreviousDocument: (() => void) | null;
  onSelectNextDocument: (() => void) | null;
  selectedPosition: number;
  totalDocuments: number;
};

function DetailMeta(props: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-white/4 p-4">
      <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">{props.label}</div>
      <div className="mt-2 text-sm text-[var(--app-text)]">{props.value}</div>
    </div>
  );
}

function DocumentDetailPanel(props: DocumentDetailPanelProps) {
  const [showMetadata, setShowMetadata] = useState(false);

  if (!props.detail) {
    return (
      <section className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--app-border)] bg-white/3 p-6">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border)] pb-4">
          <div>
            <div className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">
              Review
            </div>
            <h2 className="mt-2 text-xl font-semibold text-[var(--app-text)]">No document selected</h2>
          </div>
          <DetailActionButton icon={<ArrowLeftIcon />} label="Back to workspace" onClick={props.onBack} />
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--app-muted)]">
          Open a document from the list to review it here.
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-white/3 p-6">
      <div className="flex flex-col gap-4 border-b border-[var(--app-border)] pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="font-mono-ui text-[11px] font-semibold uppercase tracking-[0.28em] text-[var(--app-accent)]">Review</div>
          <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight text-[var(--app-text)]">
            {props.detail.sourceName}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={props.detail.status} />
            <span className="status-pill">
              {props.totalDocuments > 0 && props.selectedPosition > 0
                ? `${props.selectedPosition} of ${props.totalDocuments}`
                : "Current page"}
            </span>
            {props.loadingDetail ? <span className="status-pill">Refreshing</span> : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <DetailActionButton
            icon={<EyeIcon />}
            label={showMetadata ? "Hide details" : "Show details"}
            onClick={() => setShowMetadata((current) => !current)}
            active={showMetadata}
          />
          <DetailActionButton icon={<ArrowLeftIcon />} label="Back to workspace" onClick={props.onBack} />
          <DetailActionButton
            icon={<ChevronLeftIcon />}
            label="Previous document"
            onClick={props.onSelectPreviousDocument ?? undefined}
            disabled={!props.onSelectPreviousDocument}
          />
          <DetailActionButton
            icon={<ChevronRightIcon />}
            label="Next document"
            onClick={props.onSelectNextDocument ?? undefined}
            disabled={!props.onSelectNextDocument}
          />
        </div>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-auto pr-1">
        {props.detail.errorMessage ? (
          <section className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4">
            <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-rose-200">Error</div>
            <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-rose-100">
              {props.detail.errorMessage.trim()}
            </pre>
          </section>
        ) : null}

        <div className="mt-4 space-y-4">
          <TextPreviewSection
            label="Original text"
            value={props.detail.sourceText?.trim() || "No source text stored for this document."}
          />
          <TextPreviewSection
            label="OCR text"
            value={props.detail.ocrText?.trim() || "OCR has not produced text for this document yet."}
          />
          <TextPreviewSection
            label="Translation"
            value={props.detail.translatedText?.trim() || "Translation has not completed for this document yet."}
          />
        </div>

        {showMetadata ? (
          <section className="mt-4 rounded-2xl border border-[var(--app-border)] bg-white/3 p-4">
            <div className="font-mono-ui text-[11px] uppercase tracking-[0.22em] text-[var(--app-muted)]">Metadata</div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <DetailMeta label="Project" value={props.detail.projectName} />
              <DetailMeta label="Source type" value={props.detail.sourceType} />
              <DetailMeta label="MIME type" value={props.detail.mimeType ?? "-"} />
              <DetailMeta label="Created" value={formatTimestamp(props.detail.createdAt)} />
              <DetailMeta label="Updated" value={formatTimestamp(props.detail.updatedAt)} />
              <DetailMeta label="Next attempt" value={formatTimestamp(props.detail.nextAttemptAt)} />
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export default DocumentDetailPanel;
