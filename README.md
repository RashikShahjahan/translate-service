# Environment

- `OCR_MODEL`: OCR model name. Default: `gemini-3.1-flash-lite-preview`
- `TRANSLATION_MODEL`: Translation model name. Default: `mlx-community/translategemma-12b-it-4bit`
- `SOURCE_LANG_CODE`: Source language code for translation. Default: `bn`
- `TARGET_LANG_CODE`: Target language code for translation. Default: `en`
- `TRANSLATION_BATCH_SIZE`: Number of queued text files to translate per run. Default: `4`
- `TRANSLATION_MIN_AVAILABLE_MEMORY_MB`: Only start translation when current available memory is above this threshold. Default: `8192`
- `IDLE_SLEEP_SECONDS`: How long the worker sleeps when there is nothing to process. Default: `2`

# Commands

Use `uv run ...` if you are working from the project environment.

## Install dependencies

- `uv sync`: Create or update the local environment from `pyproject.toml` and `uv.lock`.

## Queue work

- `uv run python src/main.py add-tasks <project_name> <input...>`: Add one or more files or directories to a project and queue supported files for OCR/translation.
- Example: `uv run python src/main.py add-tasks book scans/page-001.jpg chapters/`

## Inspect queued and stored data

- `uv run python src/main.py get-tasks`: Print the currently queued OCR and translation tasks.
- `uv run python src/main.py list-projects`: Print all stored project names.
- `uv run python src/main.py list-documents <project_name>`: Print stored documents for a project, including status and timestamps.

## Run the worker

- `uv run python src/worker.py`: Start the long-running worker that performs OCR and translation until stopped.

## Publish output

- `uv run python src/main.py publish <project_name> [output.docx]`: Build a DOCX from completed translated documents for a project. If `output.docx` is omitted, output goes to `output/<project_name>.docx`.
- Example: `uv run python src/main.py publish book output/book-en.docx`

## Stress test translation batches

- `uv run python scripts/stress_test_batch_translate.py`: Benchmark batch translation throughput and memory usage, then save a plot to `artifacts/stress_test_batch_translate.png`.

# Todo
- Failure detection
- Logging
- Running in background
- Run on entire book
- Blog post
