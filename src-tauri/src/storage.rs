use rusqlite::{params, Connection};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};
fn database(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join("app.sqlite")).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_storage(key TEXT PRIMARY KEY,value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}
fn valid(key: &str) -> bool {
    matches!(
        key,
        "inkscope-model" | "inkscope-reader-v1" | "inkscope-speech-v1" | "inkscope-writer-v1"
    ) || key.starts_with("inkscope-creation-draft-")
        || key.starts_with("inkscope-creation-conflict-")
}
fn migrate(
    conn: &mut Connection,
    legacy: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (key, value) in legacy {
        if valid(&key) {
            tx.execute(
                "INSERT OR IGNORE INTO app_storage VALUES(?,?)",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT key,value FROM app_storage")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<BTreeMap<_, _>, _>>()
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn initialize_storage(
    app: AppHandle,
    legacy: BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    migrate(&mut database(&app)?, legacy)
}
#[tauri::command]
pub fn write_storage(app: AppHandle, key: String, value: Option<String>) -> Result<(), String> {
    if !valid(&key) {
        return Err("未知存储项".into());
    }
    let conn = database(&app)?;
    match value {
        Some(value) => conn.execute(
            "INSERT OR REPLACE INTO app_storage VALUES(?,?)",
            params![key, value],
        ),
        None => conn.execute("DELETE FROM app_storage WHERE key=?", [key]),
    }
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_is_idempotent_and_preserves_database_and_conflicts() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE app_storage(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            .unwrap();
        let data = BTreeMap::from([
            ("inkscope-model".into(), "original".into()),
            ("inkscope-creation-conflict-a".into(), "full draft".into()),
            ("unrelated".into(), "ignore".into()),
        ]);
        let result = migrate(&mut conn, data).unwrap();
        assert_eq!(result.len(), 2);
        let result = migrate(
            &mut conn,
            BTreeMap::from([("inkscope-model".into(), "stale".into())]),
        )
        .unwrap();
        assert_eq!(result["inkscope-model"], "original");
        assert_eq!(result["inkscope-creation-conflict-a"], "full draft");
    }
}
