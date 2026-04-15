type TranslationSettingsCardProps = {
  translationModel: string;
  translationBatchSize: string;
  loadingTranslationModel: boolean;
  savingTranslationModel: boolean;
  onTranslationModelChange: (value: string) => void;
  onTranslationBatchSizeChange: (value: string) => void;
  onSaveTranslationModel: () => void;
  onSaveTranslationBatchSize: () => void;
};

const RECOMMENDED_TRANSLATION_MODELS = [
  "mlx-community/translategemma-12b-it-4bit",
  "mlx-community/translategemma-4b-it-4bit",
  "mlx-community/translategemma-27b-it-4bit",
];

function TranslationSettingsCard(props: TranslationSettingsCardProps) {
  const disabled = props.loadingTranslationModel || props.savingTranslationModel;
  const normalizedBatchSize = props.translationBatchSize.trim();
  const parsedBatchSize = Number.parseInt(normalizedBatchSize, 10);
  const batchSizeInvalid = !normalizedBatchSize || !Number.isInteger(parsedBatchSize) || parsedBatchSize <= 0;

  return (
    <section className="rounded-2xl border border-[#8497b01a] bg-[var(--app-panel-soft)] p-4 backdrop-blur-[10px] sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--app-text)]">Translation model</h3>
          <p className="mt-1 max-w-2xl text-sm text-[var(--app-muted)]">
            Choose the MLX model the worker should load for translation jobs.
          </p>
          <div className="mt-3 inline-flex max-w-full items-center rounded-full border border-sky-400/20 bg-sky-400/10 px-3 py-1 text-xs text-sky-100">
            Current model: <span className="ml-2 font-[IBM_Plex_Mono] text-[11px]">{props.translationModel || "-"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium">
          <span className="rounded-full border border-[var(--app-border)] bg-white/6 px-3 py-1 text-[var(--app-muted)]">
            {props.loadingTranslationModel ? "Loading" : "Global setting"}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-4">
        <div>
          <label className="block font-[IBM_Plex_Mono] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
            Model name
          </label>
          <select
            value={props.translationModel}
            disabled={disabled}
            onChange={(event) => props.onTranslationModelChange(event.currentTarget.value)}
            className="mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {RECOMMENDED_TRANSLATION_MODELS.map((modelName) => (
              <option key={modelName} value={modelName}>
                {modelName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            type="button"
            onClick={props.onSaveTranslationModel}
            disabled={disabled || !props.translationModel.trim()}
            className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-4 py-2 text-sm font-semibold text-[#04101d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.savingTranslationModel ? "Saving..." : "Save model"}
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_auto] lg:items-end">
          <div>
            <label className="block font-[IBM_Plex_Mono] text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--app-muted)]">
              Batch size
            </label>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={props.translationBatchSize}
              disabled={disabled}
              onChange={(event) => props.onTranslationBatchSizeChange(event.currentTarget.value)}
              className="mt-2 min-w-0 w-full rounded-xl border border-[var(--app-border)] bg-white/6 px-4 py-3 text-base text-[var(--app-text)] outline-none transition placeholder:text-[var(--app-muted)] focus:border-[var(--app-border-strong)] focus:ring-4 focus:ring-sky-300/10 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <p className="mt-2 text-sm text-[var(--app-muted)]">
              Number of queued documents the worker translates in one batch.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              onClick={props.onSaveTranslationBatchSize}
              disabled={disabled || batchSizeInvalid}
              className="rounded-full bg-[linear-gradient(135deg,#67b7ff,#468cf3)] px-4 py-2 text-sm font-semibold text-[#04101d] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {props.savingTranslationModel ? "Saving..." : "Save batch size"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default TranslationSettingsCard;
