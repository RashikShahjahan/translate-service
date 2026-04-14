# Translate Service

Translate Service stores source documents in SQLite, runs OCR for image inputs, translates queued text with MLX models, and can export completed documents as `.docx`. The repo also includes a Tauri desktop app for managing projects, imports, exports, translation settings, and the macOS worker schedule.

## Project layout

- `src/`: Python CLI, worker, and translation/OCR utilities
- `data/translate_service.sqlite3`: local SQLite database created on first use
- `output/`: default export location for generated `.docx` files
- `tauri-app/`: desktop app built with Tauri, React, and Vite
- `scripts/`: macOS worker scheduling helpers

## Backend setup

- Python `>=3.14`
- `uv` for environment and command execution
- Apple Silicon / macOS is implied for the MLX translation path

Install dependencies:

- `uv sync`

## Environment

- `GEMINI_API_KEY`: Required for OCR against the Gemini API.
- `OCR_MODEL`: OCR model name. Default: `gemini-3.1-flash-lite-preview` (Currently only supports Gemini models.)
- `TRANSLATION_MODEL`: Translation model name. Default: `mlx-community/translategemma-12b-it-4bit`
- `DRAFT_TRANSLATION_MODEL`: Optional draft model used for speculative decoding helpers. Default: `mlx-community/translategemma-4b-it-4bit`
- `SOURCE_LANG_CODE`: Source language code for translation. Default: `bn`
- `TARGET_LANG_CODE`: Target language code for translation. Default: `en`
- `TRANSLATION_BATCH_SIZE`: Number of queued documents to translate per worker batch. Default: `4`
- `TRANSLATION_IDLE_UNLOAD_SECONDS`: Unload the translation model after this many seconds without translation work. Set to `0` to disable unloading. Default: `15`
- `LEASE_TIMEOUT_SECONDS`: How long a document may stay in `processing_ocr` or `processing_translation` before the worker requeues it. Default: `900`
- `RETRY_BACKOFF_BASE_SECONDS`: Base delay for failed OCR/translation retries. Each failure doubles the delay from this base. Default: `30`
- `RETRY_BACKOFF_MAX_SECONDS`: Maximum delay for failed OCR/translation retries. Default: `300`
- OCR or translation exceptions are also requeued automatically; the most recent error is kept on the task record in `error_message`.
- `IDLE_SLEEP_SECONDS`: How long the worker sleeps when there is nothing to process. Default: `60`
- `LOG_LEVEL`: Logging verbosity for CLI and worker runs. Default: `INFO`

Notes:

- `GEMINI_API_KEY` is required only when you want OCR for image inputs.
- Text inputs do not require OCR and are queued directly for translation.
- New projects default to `SOURCE_LANG_CODE` and `TARGET_LANG_CODE`, but each project can be updated later from the Tauri app.

# Commands

Use `uv run ...` if you are working from the project environment.

## Queue work

- `uv run python src/main.py add-tasks <project_name> <input...>`: Add one or more files or directories to a project and queue supported files for OCR/translation.
- Supported inputs are files whose MIME type resolves to `image/*` or `text/*`. Directory inputs are scanned recursively.
- Example: `uv run python src/main.py add-tasks book scans/page-001.jpg chapters/`

## Inspect queued and stored data

- `uv run python src/main.py get-tasks`: Print the currently queued OCR and translation tasks, including `retry_count` and `next_attempt_at`.
- `uv run python src/main.py retry-task <document_id>`: Clear the error/backoff for a failed task and make it eligible for immediate retry.
- `uv run python src/main.py list-projects`: Print all stored project names.
- `uv run python src/main.py list-documents <project_name>`: Print stored documents for a project, including status and timestamps.
- `uv run python src/main.py export <project_name> [output_dir]`: Write one `.docx` file per completed translated document. Defaults to `output/<project_name>/`.

## Run the worker

- `uv run python src/worker.py`: Start the long-running worker that performs OCR and translation until stopped.

## Run the profiler

Use the profiler to measure translation runtime and peak Metal memory across chunk sizes, batch sizes, and speculative decoding settings.

- Prerequisite: `artifacts/profiler_passages.json` must exist. The profiler reads four fixed passages from that file and validates their chunk layout before running.
- Default output location: `artifacts/profiler/<run_name>/`
- Each run writes `results.json` plus one or more `.png` plots for the selected profile modes.

Run all profile modes with default settings:

- `uv run python src/profiler.py`

Run a single profile mode:

- `uv run python src/profiler.py --profile chunk`
- `uv run python src/profiler.py --profile batch`
- `uv run python src/profiler.py --profile speculative`
- `uv run python src/profiler.py --profile compare`

Common examples:

- `uv run python src/profiler.py --profile chunk --chunk-sizes 100 200 500 1000`
- `uv run python src/profiler.py --profile batch --batch-sizes 1 2 4 --batch-chunk-size 500`
- `uv run python src/profiler.py --profile speculative --num-draft-tokens 1 2 3 4 --speculative-chunk-size 500`
- `uv run python src/profiler.py --profile compare --compare-chunk-size 500 --compare-batch-size 4 --compare-num-draft-tokens 2`
- `uv run python src/profiler.py --run-name baseline-apr08`
- `uv run python src/profiler.py --output-dir artifacts/benchmarks`

What each profile measures:

- `chunk`: Runs `translate` across the requested `--chunk-sizes`.
- `batch`: Runs `translate_batch` across the requested `--batch-sizes` at one `--batch-chunk-size`.
- `speculative`: Runs `translate_speculative_decoding` across the requested `--num-draft-tokens` values at one `--speculative-chunk-size`.
- `compare`: Compares `translate`, `translate_batch`, and `translate_speculative_decoding` on the same inputs using the `--compare-*` settings.

Profiler notes:

- Chunk sizes must be positive integers, multiples of the profiler passage base chunk size, and no larger than the stored passage size.
- Batch sizes and draft token counts must be positive integers.
- The profiler prints per-sample timing and memory summaries to stdout while running, then prints the saved result paths at the end.

## Run the worker in the background on macOS

For a quick temporary background run from the repo root:

- `nohup uv run python src/worker.py >/dev/null 2>&1 &`

This keeps the worker running after you close the terminal, but it will not restart automatically after a reboot or crash.

For a persistent macOS background service, use `launchd`:

1. Run the installer from the repo root:
   - `bash scripts/install_launch_agent.sh`
2. The installer writes `~/Library/LaunchAgents/local.translate-service.worker.plist` using the current repo path and your absolute `uv` binary path.
3. That LaunchAgent runs a small wrapper script on load and every day at `00:00`. The wrapper starts the worker only if the current local time is inside the active window and stops it at the end of the window. Defaults: `00:00` to `08:00`.
4. Check status or logs:
    - `launchctl list | grep translate-service`
    - `launchctl print gui/$(id -u)/local.translate-service.worker`
    - `tail -f logs/translate_service.log`
    - `tail -f logs/worker.stderr.log`
5. Stop or unload it later:
    - `launchctl bootout gui/$(id -u)/local.translate-service.worker`
6. After changing worker code or environment variables, restart the LaunchAgent so it picks up the new code:
    - `launchctl bootout gui/$(id -u)/local.translate-service.worker`
    - `bash scripts/install_launch_agent.sh`

The LaunchAgent template lives under `launchd/` and uses `__WORKDIR__` and `__UV_BIN__` placeholders. It also sets default `WORKER_ACTIVE_START_TIME=00:00` and `WORKER_ACTIVE_END_TIME=08:00` in the LaunchAgent environment. Scheduling is managed by `launchd` plus [`run_scheduled_worker.sh`](/Users/rashik/translate-service/scripts/run_scheduled_worker.sh). The worker's application logs are written to `logs/translate_service.log`. The LaunchAgent stdout and stderr streams are written to `logs/worker.stdout.log` and `logs/worker.stderr.log`.

## Build and run the Tauri app

The desktop app lives in `tauri-app/` and uses Vite for the frontend plus Rust/Tauri for the native shell.

Prerequisites:

- Install JavaScript dependencies from `tauri-app/`: `npm install`
- Install Bun, because the Tauri config runs `bun run dev` and `bun run build`
- Install the Rust toolchain and Tauri system dependencies for your platform
- The desktop app reads and updates the same `data/translate_service.sqlite3` database as the Python CLI and worker

Run the app in development:

1. Start from the app directory: `cd tauri-app`
2. Launch the desktop app with hot reload: `npm run tauri dev`

Build a production app bundle:

- From `tauri-app/`, run `npm run tauri build`
- On macOS, to build only the `.app` bundle, run `npm run build:macos-app`
- Build artifacts are written under `tauri-app/src-tauri/target/release/bundle/`

Current app capabilities:

- Create named or untitled projects
- Import files or folders into a project
- Browse document status, retry failed items, and inspect OCR/translation output
- Export completed project documents as `.docx`
- Update project source and target languages
- Update the global translation model
- Install or remove the macOS LaunchAgent worker schedule from the app

There is no separate app README. Use this root README for both the backend and the Tauri app.
