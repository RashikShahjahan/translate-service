# Tauri App

This app is the desktop UI for `translate-service`. It works against the repository's shared SQLite database at `../data/translate_service.sqlite3` and wraps the Python CLI plus worker-management workflows in a native Tauri shell.

## Features

- Create named or untitled translation projects
- Import files or folders into a project
- Review document status, OCR text, translated text, retry counts, and errors
- Export completed project documents as `.docx`
- Update per-project source and target language codes
- Update the global translation model used by the worker
- Enable or disable the macOS LaunchAgent worker schedule

## Prerequisites

- `npm` for JavaScript dependencies
- Bun, because `src-tauri/tauri.conf.json` runs `bun run dev` and `bun run build`
- Rust and Cargo
- Tauri system dependencies for your platform
- The backend dependencies from the repo root if you want imports, retries, exports, or worker actions to succeed: `uv sync`

## Install

- From `tauri-app/`: `npm install`

## Run in development

- From `tauri-app/`: `npm run tauri dev`

This starts the Vite dev server and opens the native desktop app.

## Build

- Full production bundle: `npm run tauri build`
- macOS `.app` bundle only: `npm run build:macos-app`

Build artifacts are written under `src-tauri/target/release/bundle/`.

## Notes

- The app and the Python CLI share the same database and output directories.
- Worker scheduling is currently implemented through macOS LaunchAgents, so that part of the UI is macOS-only.
