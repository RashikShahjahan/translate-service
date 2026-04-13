use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::menu::{AboutMetadataBuilder, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager, Runtime};

const APP_MENU_COMMAND_EVENT: &str = "app-menu-command";
const MENU_NEW_PROJECT: &str = "file.new-project";
const MENU_IMPORT_FILES: &str = "file.import-files";
const MENU_IMPORT_FOLDER: &str = "file.import-folder";
const MENU_EXPORT_FILES: &str = "file.export-files";
const MENU_REFRESH: &str = "file.refresh";
const UNTITLED_PROJECT_NAME: &str = "Untitled Project";
const WORKER_LABEL: &str = "local.translate-service.worker";
const DEFAULT_WORKER_ACTIVE_START_TIME: &str = "00:00";
const DEFAULT_WORKER_ACTIVE_END_TIME: &str = "08:00";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: i64,
    name: String,
    created_at: String,
    total_documents: i64,
    queued_documents: i64,
    processing_documents: i64,
    completed_documents: i64,
    errored_documents: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentRow {
    id: i64,
    source_name: String,
    source_type: String,
    status: String,
    error_message: Option<String>,
    retry_count: i64,
    next_attempt_at: Option<String>,
    leased_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentListResponse {
    documents: Vec<DocumentRow>,
    page: i64,
    page_size: i64,
    total_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentDetail {
    id: i64,
    project_name: String,
    source_name: String,
    source_type: String,
    mime_type: Option<String>,
    source_text: Option<String>,
    ocr_text: Option<String>,
    translated_text: Option<String>,
    status: String,
    error_message: Option<String>,
    retry_count: i64,
    next_attempt_at: Option<String>,
    leased_at: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerScheduleStatus {
    supported: bool,
    installed: bool,
    loaded: bool,
    start_time: String,
    end_time: String,
    plist_path: String,
}

fn repo_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to locate repository root".to_string())
}

fn database_path() -> Result<PathBuf, String> {
    Ok(repo_root()?.join("data").join("translate_service.sqlite3"))
}

fn open_database() -> Result<Connection, String> {
    let database_path = database_path()?;
    if let Some(parent) = database_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create data directory: {error}"))?;
    }

    let connection = Connection::open(database_path)
        .map_err(|error| format!("Failed to open database: {error}"))?;
    ensure_schema(&connection)?;
    Ok(connection)
}

fn installed_worker_plist_path() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|error| format!("Failed to read HOME: {error}"))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{WORKER_LABEL}.plist")))
}

fn launch_agent_domain() -> Result<String, String> {
    let output = Command::new("id")
        .arg("-u")
        .output()
        .map_err(|error| format!("Failed to read current user id: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            format!("Failed to read current user id: {}", output.status)
        } else {
            stderr
        });
    }

    let user_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if user_id.is_empty() {
        return Err("Current user id was empty".to_string());
    }

    Ok(format!("gui/{user_id}"))
}

fn extract_plist_string(contents: &str, key: &str) -> Option<String> {
    let key_marker = format!("<key>{key}</key>");
    let key_offset = contents.find(&key_marker)? + key_marker.len();
    let contents_after_key = &contents[key_offset..];
    let string_start = contents_after_key.find("<string>")? + "<string>".len();
    let contents_after_string = &contents_after_key[string_start..];
    let string_end = contents_after_string.find("</string>")?;
    Some(contents_after_string[..string_end].trim().to_string())
}

fn validate_worker_time(value: &str, label: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let bytes = trimmed.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' {
        return Err(format!("{label} must use HH:MM in 24-hour time"));
    }

    let hour = trimmed[0..2]
        .parse::<u8>()
        .map_err(|_| format!("{label} must use HH:MM in 24-hour time"))?;
    let minute = trimmed[3..5]
        .parse::<u8>()
        .map_err(|_| format!("{label} must use HH:MM in 24-hour time"))?;

    if hour > 23 || minute > 59 {
        return Err(format!("{label} must use HH:MM in 24-hour time"));
    }

    Ok(trimmed.to_string())
}

fn worker_schedule_status() -> Result<WorkerScheduleStatus, String> {
    let plist_path = installed_worker_plist_path()?;
    let plist_path_string = plist_path.display().to_string();

    if !cfg!(target_os = "macos") {
        return Ok(WorkerScheduleStatus {
            supported: false,
            installed: false,
            loaded: false,
            start_time: DEFAULT_WORKER_ACTIVE_START_TIME.to_string(),
            end_time: DEFAULT_WORKER_ACTIVE_END_TIME.to_string(),
            plist_path: plist_path_string,
        });
    }

    if !plist_path.exists() {
        return Ok(WorkerScheduleStatus {
            supported: true,
            installed: false,
            loaded: false,
            start_time: DEFAULT_WORKER_ACTIVE_START_TIME.to_string(),
            end_time: DEFAULT_WORKER_ACTIVE_END_TIME.to_string(),
            plist_path: plist_path_string,
        });
    }

    let contents = fs::read_to_string(&plist_path)
        .map_err(|error| format!("Failed to read installed LaunchAgent: {error}"))?;
    let domain = launch_agent_domain()?;
    let target = format!("{domain}/{WORKER_LABEL}");
    let loaded = Command::new("launchctl")
        .args(["print", target.as_str()])
        .output()
        .map(|output| output.status.success())
        .map_err(|error| format!("Failed to inspect LaunchAgent status: {error}"))?;

    Ok(WorkerScheduleStatus {
        supported: true,
        installed: true,
        loaded,
        start_time: extract_plist_string(&contents, "WORKER_ACTIVE_START_TIME")
            .unwrap_or_else(|| DEFAULT_WORKER_ACTIVE_START_TIME.to_string()),
        end_time: extract_plist_string(&contents, "WORKER_ACTIVE_END_TIME")
            .unwrap_or_else(|| DEFAULT_WORKER_ACTIVE_END_TIME.to_string()),
        plist_path: plist_path_string,
    })
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                source_name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                source_bytes BLOB NOT NULL,
                source_text TEXT,
                mime_type TEXT,
                ocr_text TEXT,
                translated_text TEXT,
                status TEXT NOT NULL,
                error_message TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                next_attempt_at TEXT,
                leased_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(project_id, source_name)
            );
            ",
        )
        .map_err(|error| format!("Failed to ensure schema: {error}"))
}

fn run_python_cli<I, S>(args: I) -> Result<String, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let repo_root = repo_root()?;
    let output = Command::new("uv")
        .args(args)
        .current_dir(&repo_root)
        .output()
        .map_err(|error| format!("Failed to run service command: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("Service command failed with status {}", output.status))
        } else {
            Err(stderr)
        }
    }
}

fn project_summary_by_name(connection: &Connection, name: &str) -> Result<ProjectSummary, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
                projects.id,
                projects.name,
                projects.created_at,
                COUNT(documents.id) AS total_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status IN ('pending_ocr', 'pending_translation') THEN 1
                    ELSE 0
                END), 0) AS queued_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status IN ('processing_ocr', 'processing_translation') THEN 1
                    ELSE 0
                END), 0) AS processing_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status = 'completed' THEN 1
                    ELSE 0
                END), 0) AS completed_documents,
                COALESCE(SUM(CASE
                    WHEN documents.error_message IS NOT NULL AND documents.status != 'completed' THEN 1
                    ELSE 0
                END), 0) AS errored_documents
            FROM projects
            LEFT JOIN documents ON documents.project_id = projects.id
            WHERE projects.name = ?1
            GROUP BY projects.id, projects.name, projects.created_at
            LIMIT 1
            ",
        )
        .map_err(|error| format!("Failed to load project: {error}"))?;

    statement
        .query_row(params![name], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                total_documents: row.get(3)?,
                queued_documents: row.get(4)?,
                processing_documents: row.get(5)?,
                completed_documents: row.get(6)?,
                errored_documents: row.get(7)?,
            })
        })
        .map_err(|error| format!("Failed to read project: {error}"))
}

fn create_project_with_name(connection: &Connection, name: &str) -> Result<ProjectSummary, String> {
    connection
        .execute(
            "
            INSERT OR IGNORE INTO projects (name, created_at)
            VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ",
            params![name],
        )
        .map_err(|error| format!("Failed to create project: {error}"))?;

    project_summary_by_name(connection, name)
}

fn next_untitled_project_name(connection: &Connection) -> Result<String, String> {
    let mut suffix = 1;

    loop {
        let candidate = if suffix == 1 {
            UNTITLED_PROJECT_NAME.to_string()
        } else {
            format!("{UNTITLED_PROJECT_NAME} {suffix}")
        };

        let existing = connection
            .query_row(
                "SELECT 1 FROM projects WHERE name = ?1 LIMIT 1",
                params![candidate.as_str()],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to check untitled project names: {error}"))?;

        if existing.is_none() {
            return Ok(candidate);
        }

        suffix += 1;
    }
}

fn emit_menu_command<R: Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(APP_MENU_COMMAND_EVENT, command);
    }
}

fn build_app_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Translator Service"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .website(Some("https://github.com"))
        .build();

    let new_project = MenuItemBuilder::with_id(MENU_NEW_PROJECT, "New Project")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let import_files = MenuItemBuilder::with_id(MENU_IMPORT_FILES, "Import Files...")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let import_folder = MenuItemBuilder::with_id(MENU_IMPORT_FOLDER, "Import Folder...")
        .accelerator("Shift+CmdOrCtrl+O")
        .build(app)?;
    let export_files = MenuItemBuilder::with_id(MENU_EXPORT_FILES, "Export Files...")
        .accelerator("Shift+CmdOrCtrl+E")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id(MENU_REFRESH, "Refresh")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Translator Service")
        .about(Some(about_metadata))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_project)
        .separator()
        .item(&import_files)
        .item(&import_folder)
        .separator()
        .item(&export_files)
        .separator()
        .item(&refresh)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let view_submenu = SubmenuBuilder::new(app, "View")
        .fullscreen_with_text("Toggle Full Screen")
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize_with_text("Zoom")
        .separator()
        .show_all_with_text("Bring All to Front")
        .build()?;

    let help_submenu = SubmenuBuilder::new(app, "Help")
        .about_with_text("About Translator Service", None)
        .build()?;

    Menu::with_items(
        app,
        &[
            &app_submenu,
            &file_submenu,
            &edit_submenu,
            &view_submenu,
            &window_submenu,
            &help_submenu,
        ],
    )
}

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectSummary>, String> {
    let connection = open_database()?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                projects.id,
                projects.name,
                projects.created_at,
                COUNT(documents.id) AS total_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status IN ('pending_ocr', 'pending_translation') THEN 1
                    ELSE 0
                END), 0) AS queued_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status IN ('processing_ocr', 'processing_translation') THEN 1
                    ELSE 0
                END), 0) AS processing_documents,
                COALESCE(SUM(CASE
                    WHEN documents.status = 'completed' THEN 1
                    ELSE 0
                END), 0) AS completed_documents,
                COALESCE(SUM(CASE
                    WHEN documents.error_message IS NOT NULL AND documents.status != 'completed' THEN 1
                    ELSE 0
                END), 0) AS errored_documents
            FROM projects
            LEFT JOIN documents ON documents.project_id = projects.id
            GROUP BY projects.id, projects.name, projects.created_at
            ORDER BY projects.created_at DESC, projects.id DESC
            ",
        )
        .map_err(|error| format!("Failed to query projects: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                total_documents: row.get(3)?,
                queued_documents: row.get(4)?,
                processing_documents: row.get(5)?,
                completed_documents: row.get(6)?,
                errored_documents: row.get(7)?,
            })
        })
        .map_err(|error| format!("Failed to map projects: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read projects: {error}"))
}

#[tauri::command]
fn create_project(name: String) -> Result<ProjectSummary, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Project name is required".to_string());
    }

    let connection = open_database()?;
    create_project_with_name(&connection, trimmed)
}

#[tauri::command]
fn create_untitled_project() -> Result<ProjectSummary, String> {
    let connection = open_database()?;
    let project_name = next_untitled_project_name(&connection)?;
    create_project_with_name(&connection, &project_name)
}

#[tauri::command]
fn list_documents(
    project_name: String,
    page: Option<i64>,
    page_size: Option<i64>,
) -> Result<DocumentListResponse, String> {
    let connection = open_database()?;
    let requested_page_size = page_size.unwrap_or(15).max(1);
    let requested_page = page.unwrap_or(1).max(1);

    let total_count: i64 = connection
        .query_row(
            "
            SELECT COUNT(*)
            FROM documents
            JOIN projects ON projects.id = documents.project_id
            WHERE projects.name = ?1
            ",
            params![project_name],
            |row| row.get(0),
        )
        .map_err(|error| format!("Failed to count documents: {error}"))?;

    let total_pages = if total_count == 0 {
        1
    } else {
        (total_count + requested_page_size - 1) / requested_page_size
    };
    let normalized_page = requested_page.min(total_pages);
    let offset = (normalized_page - 1) * requested_page_size;

    let mut statement = connection
        .prepare(
            "
            SELECT
                documents.id,
                documents.source_name,
                documents.source_type,
                documents.status,
                documents.error_message,
                documents.retry_count,
                documents.next_attempt_at,
                documents.leased_at,
                documents.created_at,
                documents.updated_at
            FROM documents
            JOIN projects ON projects.id = documents.project_id
            WHERE projects.name = ?1
            ORDER BY documents.updated_at DESC, documents.id DESC
            LIMIT ?2 OFFSET ?3
            ",
        )
        .map_err(|error| format!("Failed to query documents: {error}"))?;

    let rows = statement
        .query_map(params![project_name, requested_page_size, offset], |row| {
            Ok(DocumentRow {
                id: row.get(0)?,
                source_name: row.get(1)?,
                source_type: row.get(2)?,
                status: row.get(3)?,
                error_message: row.get(4)?,
                retry_count: row.get(5)?,
                next_attempt_at: row.get(6)?,
                leased_at: row.get(7)?,
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
            })
        })
        .map_err(|error| format!("Failed to map documents: {error}"))?;

    let documents = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read documents: {error}"))?;

    Ok(DocumentListResponse {
        documents,
        page: normalized_page,
        page_size: requested_page_size,
        total_count,
    })
}

#[tauri::command]
fn get_document_detail(document_id: i64) -> Result<Option<DocumentDetail>, String> {
    let connection = open_database()?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                documents.id,
                projects.name,
                documents.source_name,
                documents.source_type,
                documents.mime_type,
                documents.source_text,
                documents.ocr_text,
                documents.translated_text,
                documents.status,
                documents.error_message,
                documents.retry_count,
                documents.next_attempt_at,
                documents.leased_at,
                documents.created_at,
                documents.updated_at
            FROM documents
            JOIN projects ON projects.id = documents.project_id
            WHERE documents.id = ?1
            LIMIT 1
            ",
        )
        .map_err(|error| format!("Failed to query document detail: {error}"))?;

    statement
        .query_row(params![document_id], |row| {
            Ok(DocumentDetail {
                id: row.get(0)?,
                project_name: row.get(1)?,
                source_name: row.get(2)?,
                source_type: row.get(3)?,
                mime_type: row.get(4)?,
                source_text: row.get(5)?,
                ocr_text: row.get(6)?,
                translated_text: row.get(7)?,
                status: row.get(8)?,
                error_message: row.get(9)?,
                retry_count: row.get(10)?,
                next_attempt_at: row.get(11)?,
                leased_at: row.get(12)?,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        })
        .optional()
        .map_err(|error| format!("Failed to read document detail: {error}"))
}

#[tauri::command]
fn add_project_inputs(project_name: String, paths: Vec<String>) -> Result<String, String> {
    let trimmed = project_name.trim();
    if trimmed.is_empty() {
        return Err("Project name is required before importing files".to_string());
    }
    if paths.is_empty() {
        return Err("Select at least one file or folder to import".to_string());
    }

    let mut args = vec![
        "run".to_string(),
        "python".to_string(),
        "src/main.py".to_string(),
        "add-tasks".to_string(),
        trimmed.to_string(),
    ];
    args.extend(paths);
    run_python_cli(args)
}

#[tauri::command]
fn export_project(project_name: String, output_dir: Option<String>) -> Result<Vec<String>, String> {
    let trimmed = project_name.trim();
    if trimmed.is_empty() {
        return Err("Choose a project before exporting".to_string());
    }

    let mut args = vec![
        "run".to_string(),
        "python".to_string(),
        "src/main.py".to_string(),
        "export".to_string(),
        trimmed.to_string(),
    ];
    if let Some(output_dir) = output_dir.filter(|value| !value.trim().is_empty()) {
        args.push(output_dir);
    }

    let stdout = run_python_cli(args)?;
    let outputs = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    Ok(outputs)
}

#[tauri::command]
fn get_worker_schedule_status() -> Result<WorkerScheduleStatus, String> {
    worker_schedule_status()
}

#[tauri::command]
fn install_worker_schedule(
    start_time: String,
    end_time: String,
) -> Result<WorkerScheduleStatus, String> {
    if !cfg!(target_os = "macos") {
        return Err("Worker scheduling is only supported on macOS".to_string());
    }

    let start_time = validate_worker_time(&start_time, "Start time")?;
    let end_time = validate_worker_time(&end_time, "End time")?;
    let repo_root = repo_root()?;
    let install_script = repo_root.join("scripts").join("install_launch_agent.sh");
    let output = Command::new("bash")
        .arg(&install_script)
        .current_dir(&repo_root)
        .env("WORKER_ACTIVE_START_TIME", &start_time)
        .env("WORKER_ACTIVE_END_TIME", &end_time)
        .output()
        .map_err(|error| format!("Failed to install worker schedule: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Failed to install worker schedule: {}", output.status)
        });
    }

    worker_schedule_status()
}

#[tauri::command]
fn uninstall_worker_schedule() -> Result<WorkerScheduleStatus, String> {
    if !cfg!(target_os = "macos") {
        return Err("Worker scheduling is only supported on macOS".to_string());
    }

    let plist_path = installed_worker_plist_path()?;
    let domain = launch_agent_domain()?;
    let target = format!("{domain}/{WORKER_LABEL}");

    let _ = Command::new("launchctl")
        .args(["bootout", target.as_str()])
        .output();

    if plist_path.exists() {
        fs::remove_file(&plist_path)
            .map_err(|error| format!("Failed to remove installed LaunchAgent: {error}"))?;
    }

    worker_schedule_status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .menu(build_app_menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_NEW_PROJECT => emit_menu_command(app, "new-project"),
            MENU_IMPORT_FILES => emit_menu_command(app, "import-files"),
            MENU_IMPORT_FOLDER => emit_menu_command(app, "import-folder"),
            MENU_EXPORT_FILES => emit_menu_command(app, "export-files"),
            MENU_REFRESH => emit_menu_command(app, "refresh"),
            _ => {}
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            create_untitled_project,
            list_documents,
            get_document_detail,
            add_project_inputs,
            export_project,
            get_worker_schedule_status,
            install_worker_schedule,
            uninstall_worker_schedule
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
