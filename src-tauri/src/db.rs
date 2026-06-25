//! SQLite persistence (rusqlite, bundled) at `~/.yumi/yumi.db` with WAL.

use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

// ---- DTOs (camelCase to match types.ts) ----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    #[serde(rename = "claudeSessionId", skip_serializing_if = "Option::is_none")]
    pub claude_session_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub model: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub meta: SessionMeta,
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByModel {
    pub model: String,
    pub cost_usd: f64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ByDate {
    pub date: String,
    pub cost_usd: f64,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Analytics {
    pub total_cost_usd: f64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub sessions_count: i64,
    pub by_model: Vec<ByModel>,
    pub by_date: Vec<ByDate>,
}

/// Wraps the SQLite connection behind a Mutex for use as Tauri managed state.
pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    /// Open (creating dir + tables if missing) the database at `~/.yumi/yumi.db`.
    pub fn open() -> anyhow::Result<Self> {
        let path = db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// In-memory database for unit tests (schema only, no `~/.yumi` file).
    #[cfg(test)]
    pub fn open_in_memory() -> anyhow::Result<Self> {
        let conn = Connection::open_in_memory()?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    // ---- sessions ----

    pub fn list_sessions(&self) -> anyhow::Result<Vec<SessionMeta>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, claude_session_id, title, cwd, model, created_at, updated_at
             FROM sessions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SessionMeta {
                id: r.get(0)?,
                claude_session_id: r.get(1)?,
                title: r.get(2)?,
                cwd: r.get(3)?,
                model: r.get(4)?,
                created_at: r.get(5)?,
                updated_at: r.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn get_session(&self, id: &str) -> anyhow::Result<SessionDetail> {
        let conn = self.conn.lock().unwrap();
        let meta = conn.query_row(
            "SELECT id, claude_session_id, title, cwd, model, created_at, updated_at
             FROM sessions WHERE id = ?1",
            params![id],
            |r| {
                Ok(SessionMeta {
                    id: r.get(0)?,
                    claude_session_id: r.get(1)?,
                    title: r.get(2)?,
                    cwd: r.get(3)?,
                    model: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            },
        )?;

        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, created_at
             FROM messages WHERE session_id = ?1 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![id], |r| {
            Ok(StoredMessage {
                id: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        let messages = rows.collect::<Result<Vec<_>, _>>()?;

        Ok(SessionDetail { meta, messages })
    }

    /// Upsert a session and replace its messages.
    pub fn save_session(&self, detail: &SessionDetail) -> anyhow::Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let m = &detail.meta;
        tx.execute(
            "INSERT INTO sessions (id, claude_session_id, title, cwd, model, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(id) DO UPDATE SET
               claude_session_id=excluded.claude_session_id,
               title=excluded.title,
               cwd=excluded.cwd,
               model=excluded.model,
               updated_at=excluded.updated_at",
            params![
                m.id,
                m.claude_session_id,
                m.title,
                m.cwd,
                m.model,
                m.created_at,
                m.updated_at
            ],
        )?;

        // Replace messages wholesale (the frontend owns the canonical message list).
        tx.execute("DELETE FROM messages WHERE session_id = ?1", params![m.id])?;
        for msg in &detail.messages {
            tx.execute(
                "INSERT INTO messages (session_id, role, content, created_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![msg.session_id, msg.role, msg.content, msg.created_at],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn delete_session(&self, id: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM messages WHERE session_id = ?1", params![id])?;
        conn.execute("DELETE FROM analytics WHERE session_id = ?1", params![id])?;
        conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ---- analytics ----

    /// Record a usage row. Called from the spawner when a turn's `result` line is
    /// parsed (during the silent post-finalize drain), so analytics capture the
    /// real cost/tokens without the UI waiting on the hook-delayed `result`.
    pub fn record_analytics(
        &self,
        session_id: &str,
        model: &str,
        input_tokens: i64,
        output_tokens: i64,
        cost_usd: f64,
        created_at: i64,
    ) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO analytics (session_id, model, input_tokens, output_tokens, cost_usd, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, model, input_tokens, output_tokens, cost_usd, created_at],
        )?;
        Ok(())
    }

    pub fn get_analytics(&self) -> anyhow::Result<Analytics> {
        let conn = self.conn.lock().unwrap();

        let (total_cost, total_in, total_out): (f64, i64, i64) = conn.query_row(
            "SELECT COALESCE(SUM(cost_usd),0), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)
             FROM analytics",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;

        let sessions_count: i64 =
            conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))?;

        let mut by_model = Vec::new();
        {
            let mut stmt = conn.prepare(
                "SELECT model, COALESCE(SUM(cost_usd),0), COALESCE(SUM(input_tokens),0),
                        COALESCE(SUM(output_tokens),0), COUNT(*)
                 FROM analytics GROUP BY model ORDER BY SUM(cost_usd) DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(ByModel {
                    model: r.get(0)?,
                    cost_usd: r.get(1)?,
                    input_tokens: r.get(2)?,
                    output_tokens: r.get(3)?,
                    count: r.get(4)?,
                })
            })?;
            for row in rows {
                by_model.push(row?);
            }
        }

        let mut by_date = Vec::new();
        {
            // created_at stored as epoch millis → group by UTC date.
            let mut stmt = conn.prepare(
                "SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') AS d,
                        COALESCE(SUM(cost_usd),0), COUNT(*)
                 FROM analytics GROUP BY d ORDER BY d DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(ByDate {
                    date: r.get(0)?,
                    cost_usd: r.get(1)?,
                    count: r.get(2)?,
                })
            })?;
            for row in rows {
                by_date.push(row?);
            }
        }

        Ok(Analytics {
            total_cost_usd: total_cost,
            total_input_tokens: total_in,
            total_output_tokens: total_out,
            sessions_count,
            by_model,
            by_date,
        })
    }

    // ---- settings (key/value) ----

    pub fn get_setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let val = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |r| r.get::<_, String>(0),
            )
            .ok();
        Ok(val)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }
}

fn db_path() -> anyhow::Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("could not resolve home dir"))?;
    Ok(home.join(".yumi").join("yumi.db"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_and_aggregate_analytics() {
        let db = Db::open_in_memory().unwrap();
        // Two opus rows + one sonnet row, across two UTC dates.
        db.record_analytics("s1", "claude-opus-4-8", 100, 50, 0.25, 1_700_000_000_000)
            .unwrap();
        db.record_analytics("s1", "claude-opus-4-8", 10, 5, 0.05, 1_700_000_100_000)
            .unwrap();
        db.record_analytics("s2", "claude-sonnet-4-6", 200, 20, 0.10, 1_700_086_400_000)
            .unwrap();

        let a = db.get_analytics().unwrap();
        assert!((a.total_cost_usd - 0.40).abs() < 1e-9, "cost {}", a.total_cost_usd);
        assert_eq!(a.total_input_tokens, 310);
        assert_eq!(a.total_output_tokens, 75);

        // by_model ordered by SUM(cost) DESC → opus (0.30, 2 rows) before sonnet (0.10).
        assert_eq!(a.by_model.len(), 2);
        assert_eq!(a.by_model[0].model, "claude-opus-4-8");
        assert!((a.by_model[0].cost_usd - 0.30).abs() < 1e-9);
        assert_eq!(a.by_model[0].count, 2);
        assert_eq!(a.by_model[0].input_tokens, 110);
        assert_eq!(a.by_model[1].model, "claude-sonnet-4-6");

        // by_date groups by UTC day → the two timestamps span two days.
        assert_eq!(a.by_date.len(), 2);
    }

    #[test]
    fn empty_analytics_is_zeroed() {
        let db = Db::open_in_memory().unwrap();
        let a = db.get_analytics().unwrap();
        assert_eq!(a.total_cost_usd, 0.0);
        assert_eq!(a.total_input_tokens, 0);
        assert_eq!(a.sessions_count, 0);
        assert!(a.by_model.is_empty());
        assert!(a.by_date.is_empty());
    }
}

fn init_schema(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            claude_session_id TEXT,
            title TEXT NOT NULL DEFAULT '',
            cwd TEXT NOT NULL DEFAULT '',
            model TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE TABLE IF NOT EXISTS analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            model TEXT NOT NULL DEFAULT '',
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cost_usd REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    Ok(())
}
