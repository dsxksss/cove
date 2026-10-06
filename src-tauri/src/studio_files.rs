//! Local project storage and exports. Export destinations come only from a native save dialog.
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}, process::Command};

fn component(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 120 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("无效的工程或音频 ID".into());
    }
    Ok(value)
}
fn root(id: &str) -> Result<PathBuf, String> {
    Ok(super::app_data_dir().join("StudioProjects").join(component(id)?))
}
fn instrumental_cache_root(id: &str) -> Result<PathBuf, String> {
    Ok(super::app_data_dir().join("StudioCache").join("Instrumentals").join(component(id)?))
}
fn asset_path(project_id: &str, asset_id: &str) -> Result<PathBuf, String> {
    Ok(root(project_id)?.join("assets").join(format!("{}.audio", component(asset_id)?)))
}
pub(crate) fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0] as usize;
        let b = *chunk.get(1).unwrap_or(&0) as usize;
        let c = *chunk.get(2).unwrap_or(&0) as usize;
        output.push(TABLE[a >> 2] as char);
        output.push(TABLE[((a & 3) << 4) | (b >> 4)] as char);
        output.push(if chunk.len() > 1 { TABLE[((b & 15) << 2) | (c >> 6)] as char } else { '=' });
        output.push(if chunk.len() > 2 { TABLE[c & 63] as char } else { '=' });
    }
    output
}

#[tauri::command]
pub fn studio_write_asset(project_id: String, asset_id: String, input_base64: String) -> Result<(), String> {
    // Check encoded length before allocating the decoded payload.
    if input_base64.len() > 720 * 1024 * 1024 { return Err("音频超过 512 MiB 限制".into()); }
    let bytes = super::decode_base64(&input_base64).ok_or("音频数据无效")?;
    let path = asset_path(&project_id, &asset_id)?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn studio_read_asset(project_id: String, asset_id: String) -> Result<String, String> {
    let bytes = fs::read(asset_path(&project_id, &asset_id)?).map_err(|e| e.to_string())?;
    Ok(encode_base64(&bytes))
}

/// Read a song-level instrumental cache entry. The cache is separate from a
/// project so opening a fresh project for the same song does not trigger stem
/// separation again.
#[tauri::command]
pub fn studio_cache_read(cache_id: String) -> Result<Option<Value>, String> {
    let dir = instrumental_cache_root(&cache_id)?;
    let meta_path = dir.join("meta.json");
    let audio_path = dir.join("instrumental.audio");
    if !meta_path.is_file() || !audio_path.is_file() { return Ok(None); }
    let meta: Value = serde_json::from_slice(&fs::read(meta_path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("伴奏缓存元数据无效：{e}"))?;
    let name = meta.get("name").and_then(Value::as_str).unwrap_or("instrumental.wav");
    let mime_type = meta.get("mimeType").and_then(Value::as_str).unwrap_or("audio/wav");
    Ok(Some(json!({
        "name": name,
        "mimeType": mime_type,
        "base64": encode_base64(&fs::read(audio_path).map_err(|e| e.to_string())?),
    })))
}

#[tauri::command]
pub fn studio_cache_write(cache_id: String, name: String, mime_type: String, input_base64: String) -> Result<(), String> {
    if input_base64.len() > 720 * 1024 * 1024 { return Err("伴奏缓存超过 512 MiB 限制".into()); }
    let bytes = super::decode_base64(&input_base64).ok_or("伴奏缓存数据无效")?;
    let dir = instrumental_cache_root(&cache_id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("instrumental.audio"), bytes).map_err(|e| e.to_string())?;
    fs::write(dir.join("meta.json"), serde_json::to_vec(&json!({
        "name": safe_cache_name(&name),
        "mimeType": if mime_type.is_empty() { "audio/wav" } else { &mime_type },
        "version": 1,
    })).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn studio_cache_remove(cache_id: String) -> Result<(), String> {
    let dir = instrumental_cache_root(&cache_id)?;
    if dir.exists() { fs::remove_dir_all(dir).map_err(|e| e.to_string())?; }
    Ok(())
}

fn safe_cache_name(name: &str) -> String {
    let candidate = Path::new(name).file_name().and_then(|value| value.to_str()).unwrap_or("instrumental.wav");
    let clean = candidate.chars().map(|ch| if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ' | '(' | ')') { ch } else { '_' }).collect::<String>();
    if clean.is_empty() { "instrumental.wav".into() } else { clean }
}
#[tauri::command]
pub fn studio_save_project(project: Value) -> Result<(), String> {
    let id = project.get("id").and_then(Value::as_str).ok_or("工程缺少 ID")?;
    if project.get("version").and_then(Value::as_u64) != Some(1) { return Err("不支持的工程版本".into()); }
    let dir = root(id)?;
    fs::create_dir_all(dir.join("assets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("waveform")).map_err(|e| e.to_string())?;
    let path = dir.join("project.json");
    let pending = dir.join("project.pending.json");
    fs::write(&pending, serde_json::to_vec_pretty(&project).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if path.exists() { fs::copy(&path, dir.join("project.backup.json")).map_err(|e| e.to_string())?; }
    fs::copy(&pending, &path).map_err(|e| e.to_string())?;
    fs::remove_file(pending).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn studio_load_project(project_id: String) -> Result<Value, String> {
    let dir = root(&project_id)?;
    let read = |file: &str| -> Result<Value, String> {
        serde_json::from_slice(&fs::read(dir.join(file)).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    };
    read("project.json").or_else(|_| read("project.backup.json"))
}
#[tauri::command]
pub fn studio_list_projects() -> Result<Vec<Value>, String> {
    let path = super::app_data_dir().join("StudioProjects");
    if !path.exists() { return Ok(vec![]); }
    let mut result = Vec::new();
    for entry in fs::read_dir(path).map_err(|e| e.to_string())?.flatten() {
        if let Ok(bytes) = fs::read(entry.path().join("project.json")) {
            if let Ok(project) = serde_json::from_slice::<Value>(&bytes) {
                result.push(json!({"id": project["id"], "title": project["title"], "artist": project["artist"], "updatedAt": project["updatedAt"]}));
            }
        }
    }
    result.sort_by(|a, b| b["updatedAt"].as_str().cmp(&a["updatedAt"].as_str()));
    Ok(result)
}
#[tauri::command]
pub fn studio_delete_project(project_id: String) -> Result<(), String> {
    let path = root(&project_id)?;
    // Validated ID guarantees this remains inside StudioProjects.
    if path.exists() { fs::remove_dir_all(path).map_err(|e| e.to_string())?; }
    Ok(())
}
#[tauri::command]
pub fn studio_export_package(project_id: String) -> Result<String, String> {
    let dir = root(&project_id)?;
    if !dir.join("project.json").exists() { return Err("工程尚未保存".into()); }
    // Compress-Archive requires a .zip destination. The saved file can later
    // use the .cove-studio extension without changing the archive contents.
    let archive = dir.with_extension("zip");
    let script = dir.with_extension("package.ps1");
    fs::write(&script, "$ErrorActionPreference = 'Stop'\nGet-ChildItem -LiteralPath $args[0] | Where-Object { $_.Name -in @('project.json', 'assets', 'waveform') } | Compress-Archive -DestinationPath $args[1] -Force\n").map_err(|e| e.to_string())?;
    let mut command = Command::new("powershell.exe");
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let result = command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script).arg(&dir).arg(&archive).output();
    let _ = fs::remove_file(&script);
    let output = result.map_err(|e| format!("创建工程包失败：{e}"))?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().take(2000).collect()); }
    let bytes = fs::read(&archive).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(archive);
    Ok(encode_base64(&bytes))
}

/// The frontend supplies data and a suggested name, never an arbitrary path.
/// The native dialog handles directory selection and overwrite confirmation.
#[tauri::command]
pub async fn studio_save_export(
    window: tauri::WebviewWindow,
    file_name: String,
    extension: String,
    input_base64: String,
) -> Result<Option<String>, String> {
    let label = match extension.as_str() {
        "wav" => "WAV 音频",
        "mp3" => "MP3 音频",
        "cove-studio" => "Cove 工作室工程",
        _ => return Err("不支持的导出格式".into()),
    };
    if input_base64.len() > 720 * 1024 * 1024 {
        return Err("导出文件超过 512 MiB 限制".into());
    }
    let bytes = super::decode_base64(&input_base64).ok_or("导出数据无效")?;
    let name: String = file_name.chars().map(|c| {
        if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }
    }).collect();
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("导出到…")
        .set_file_name(name)
        .add_filter(label, &[extension])
        .save_file().await else { return Ok(None); };
    file.write(&bytes).await.map_err(|e| format!("保存导出文件失败：{e}"))?;
    Ok(Some(file.path().to_string_lossy().into_owned()))
}
#[tauri::command]
pub fn studio_encode_mp3(project_id: String, input_base64: String) -> Result<String, String> {
    let dir = root(&project_id)?.join("export");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let bytes = super::decode_base64(&input_base64).ok_or("WAV 数据无效")?;
    let input = dir.join("mix.wav");
    let output = dir.join("mix.mp3");
    fs::write(&input, bytes).map_err(|e| e.to_string())?;
    let bundled = std::env::current_exe().map_err(|e| e.to_string())?.parent().unwrap().join("resources/ncm2acc/ffmpeg.exe");
    let mut command = Command::new(if bundled.exists() { bundled } else { PathBuf::from("ffmpeg.exe") });
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let status = command.args(["-y", "-i"]).arg(&input).args(["-codec:a", "libmp3lame", "-b:a", "320k"]).arg(&output).output().map_err(|e| format!("需要 FFmpeg 才能导出 MP3：{e}"))?;
    if !status.status.success() { return Err(String::from_utf8_lossy(&status.stderr).chars().take(2000).collect()); }
    Ok(encode_base64(&fs::read(output).map_err(|e| e.to_string())?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_traversal() { for id in ["../outside", "a/b", "a\\b", "", "."] { assert!(component(id).is_err()); } }
    #[test] fn base64_round_trip() { for data in [b"".as_slice(), b"a", b"ab", b"abc", &[0, 255, 128, 1]] { assert_eq!(super::super::decode_base64(&encode_base64(data)).unwrap(), data); } }
}
