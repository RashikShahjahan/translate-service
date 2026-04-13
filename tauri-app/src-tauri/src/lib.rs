use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

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
    connection
        .execute(
            "
            INSERT OR IGNORE INTO projects (name, created_at)
            VALUES (?1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
            ",
            params![trimmed],
        )
        .map_err(|error| format!("Failed to create project: {error}"))?;

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
        .map_err(|error| format!("Failed to load created project: {error}"))?;

    statement
        .query_row(params![trimmed], |row| {
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
        .map_err(|error| format!("Failed to read created project: {error}"))
}

#[tauri::command]
fn list_documents(project_name: String) -> Result<Vec<DocumentRow>, String> {
    let connection = open_database()?;
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
            ",
        )
        .map_err(|error| format!("Failed to query documents: {error}"))?;

    let rows = statement
        .query_map(params![project_name], |row| {
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

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read documents: {error}"))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            list_documents,
            get_document_detail,
            add_project_inputs,
            export_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
