use crate::llm::ChatMessage;
use chrono::Local;
use parking_lot::Mutex;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    pub updated_at: String,
    pub created_at: String,
}

pub struct ChatStore {
    conn: Mutex<Connection>,
}

impl ChatStore {
    pub fn open(path: PathBuf) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建数据库目录失败: {e}"))?;
        }
        let conn = Connection::open(&path).map_err(|e| format!("打开 SQLite 失败: {e}"))?;
        conn.execute_batch(
            r#"
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS sessions (
              id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS messages (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              session_id TEXT NOT NULL,
              role TEXT NOT NULL,
              content TEXT NOT NULL,
              created_at TEXT NOT NULL,
              FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
            "#,
        )
        .map_err(|e| format!("初始化表失败: {e}"))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_sessions(&self) -> Result<Vec<ChatSession>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ChatSession {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn create_session(&self, title: Option<String>) -> Result<ChatSession, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let title = title.unwrap_or_else(|| "新对话".into());
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, title, now, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(ChatSession {
            id,
            title,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let conn = self.conn.lock();
        conn.execute(
            "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, session_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_messages(&self, session_id: &str) -> Result<Vec<ChatMessage>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT role, content FROM messages WHERE session_id = ?1 ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id], |row| {
                Ok(ChatMessage {
                    role: row.get(0)?,
                    content: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    /// Replace all persisted messages for a session (keeps system out).
    /// `touch_updated` should be true only when the user actually sent a turn;
    /// merely switching sessions must not bump `updated_at` or the history list jumps.
    pub fn save_messages(
        &self,
        session_id: &str,
        messages: &[ChatMessage],
        touch_updated: bool,
    ) -> Result<(), String> {
        let now = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let conn = self.conn.lock();
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM messages WHERE session_id = ?1", params![session_id])
            .map_err(|e| e.to_string())?;

        let mut title_from_first_user: Option<String> = None;
        for m in messages {
            if m.role == "system" {
                continue;
            }
            if title_from_first_user.is_none() && m.role == "user" {
                let t: String = m.content.chars().take(24).collect();
                title_from_first_user = Some(t.replace('\n', " "));
            }
            tx.execute(
                "INSERT INTO messages (session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
                params![session_id, m.role, m.content, now],
            )
            .map_err(|e| e.to_string())?;
        }

        if let Some(title) = title_from_first_user {
            // Only overwrite default title
            let current: String = tx
                .query_row(
                    "SELECT title FROM sessions WHERE id = ?1",
                    params![session_id],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "新对话".into());
            if current == "新对话" || current.is_empty() {
                if touch_updated {
                    tx.execute(
                        "UPDATE sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
                        params![title, now, session_id],
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    tx.execute(
                        "UPDATE sessions SET title = ?1 WHERE id = ?2",
                        params![title, session_id],
                    )
                    .map_err(|e| e.to_string())?;
                }
            } else if touch_updated {
                tx.execute(
                    "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                    params![now, session_id],
                )
                .map_err(|e| e.to_string())?;
            }
        } else if touch_updated {
            tx.execute(
                "UPDATE sessions SET updated_at = ?1 WHERE id = ?2",
                params![now, session_id],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn db_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("resuorce")
        .join("aurisai-chat.db")
}
