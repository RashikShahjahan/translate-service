# Environment

- `OCR_MODEL`: OCR model name. Default: `gemini-3.1-flash-lite-preview`
- `TRANSLATION_MODEL`: Translation model name. Default: `mlx-community/translategemma-12b-it-4bit`
- `SOURCE_LANG_CODE`: Source language code for translation. Default: `bn`
- `TARGET_LANG_CODE`: Target language code for translation. Default: `en`
- `TRANSLATION_BATCH_SIZE`: Number of queued text files to translate per run. Default: `4`
- `TRANSLATION_MIN_AVAILABLE_MEMORY_MB`: Only start translation when current available memory is above this threshold. Default: `8192`
- `TRANSLATION_IDLE_UNLOAD_SECONDS`: Unload the translation model after this many seconds without translation work. Set to `0` to disable unloading. Default: `15`
- `LEASE_TIMEOUT_SECONDS`: How long a document may stay in `processing_ocr` or `processing_translation` before the worker requeues it. Default: `900`
- `RETRY_BACKOFF_BASE_SECONDS`: Base delay for failed OCR/translation retries. Each failure doubles the delay from this base. Default: `5`
- `RETRY_BACKOFF_MAX_SECONDS`: Maximum delay for failed OCR/translation retries. Default: `300`
- OCR or translation exceptions are also requeued automatically; the most recent error is kept on the task record in `error_message`.
- `IDLE_SLEEP_SECONDS`: How long the worker sleeps when there is nothing to process. Default: `2`
- `LOG_LEVEL`: Logging verbosity for CLI and worker runs. Default: `INFO`

# Commands

Use `uv run ...` if you are working from the project environment.

## Install dependencies

- `uv sync`: Create or update the local environment from `pyproject.toml` and `uv.lock`.

## Queue work

- `uv run python src/main.py add-tasks <project_name> <input...>`: Add one or more files or directories to a project and queue supported files for OCR/translation.
- Example: `uv run python src/main.py add-tasks book scans/page-001.jpg chapters/`

## Inspect queued and stored data

- `uv run python src/main.py get-tasks`: Print the currently queued OCR and translation tasks, including `retry_count` and `next_attempt_at`.
- `uv run python src/main.py list-projects`: Print all stored project names.
- `uv run python src/main.py list-documents <project_name>`: Print stored documents for a project, including status and timestamps.

## Run the worker

- `uv run python src/worker.py`: Start the long-running worker that performs OCR and translation until stopped.

## Run the worker in the background on macOS

For a quick temporary background run from the repo root:

- `nohup uv run python src/worker.py >/dev/null 2>&1 &`

This keeps the worker running after you close the terminal, but it will not restart automatically after a reboot or crash.

For a persistent macOS background service, use `launchd`:

1. Run the installer from the repo root:
   - `bash scripts/install_launch_agent.sh`
2. The installer writes `~/Library/LaunchAgents/com.rashik.translate-service.worker.plist` using the current repo path and your absolute `uv` binary path, then bootstraps and starts it.
3. Check status or logs:
   - `launchctl list | grep translate-service`
   - `launchctl print gui/$(id -u)/com.rashik.translate-service.worker`
   - `tail -f logs/translate_service.log`
   - `tail -f logs/worker.stderr.log`
4. Stop or unload it later:
   - `launchctl bootout gui/$(id -u)/com.rashik.translate-service.worker`
5. After changing worker code or environment variables, restart the LaunchAgent so it picks up the new code:
   - `launchctl bootout gui/$(id -u)/com.rashik.translate-service.worker`
   - `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rashik.translate-service.worker.plist`

The LaunchAgent template lives at `launchd/com.rashik.translate-service.worker.plist` and uses `__WORKDIR__` and `__UV_BIN__` placeholders. The installer replaces those with your current checkout path and resolved `uv` binary. The worker's application logs are written to `logs/translate_service.log`. The LaunchAgent's stdout and stderr streams are written to `logs/worker.stdout.log` and `logs/worker.stderr.log`.

## Publish output

- `uv run python src/main.py publish <project_name> [output_dir]`: Build one DOCX per completed translated document for a project. If `output_dir` is omitted, files are written under `output/<project_name>/`.
- The output path mirrors each stored `source_name`, replacing its original suffix with `.docx`.
- Example: `uv run python src/main.py publish book output/book-en`

## Stress test translation batches

- `uv run python scripts/stress_test_batch_translate.py`: Benchmark batch translation throughput and memory usage, then save a plot to `artifacts/stress_test_batch_translate.png`.
