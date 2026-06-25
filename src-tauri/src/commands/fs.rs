//! Filesystem commands: list directory, read text file, pick directory.

use std::process::Command;

use serde::{Deserialize, Serialize};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Matches `DirEntry` in types.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let read = std::fs::read_dir(&path).map_err(|e| format!("read_dir {path}: {e}"))?;
    let mut entries = Vec::new();
    for item in read {
        let item = match item {
            Ok(i) => i,
            Err(_) => continue,
        };
        let file_type = item.file_type();
        let is_dir = file_type.map(|t| t.is_dir()).unwrap_or(false);
        let name = item.file_name().to_string_lossy().to_string();
        let full = item.path().to_string_lossy().to_string();
        entries.push(DirEntry {
            name,
            path: full,
            is_dir,
        });
    }
    // Dirs first, then alphabetical.
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(entries)
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("read {path}: {e}"))
}

/// Open a native folder picker via PowerShell. Returns the selected path, or
/// `None` if the user cancelled or the dialog is unavailable. Non-fatal.
#[tauri::command]
pub fn pick_directory() -> Result<Option<String>, String> {
    if !cfg!(windows) {
        return Ok(None);
    }

    let script = r#"
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a project folder'
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
"#;

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-STA",
        "-NonInteractive",
        "-Command",
        script,
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    match cmd.output() {
        Ok(out) => {
            let selected = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if selected.is_empty() {
                Ok(None)
            } else {
                Ok(Some(selected))
            }
        }
        Err(_) => Ok(None),
    }
}
