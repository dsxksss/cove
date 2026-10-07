//! Local project storage and exports. Export destinations come only from a native save dialog.
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{self, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_PROJECT_JSON_BYTES: u64 = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES: usize = 10_000;

fn component(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 120 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_') {
        return Err("无效的工程或音频 ID".into());
    }
    Ok(value)
}

fn require_string<'a>(value: Option<&'a Value>, field: &str) -> Result<&'a str, String> {
    value.and_then(Value::as_str).ok_or_else(|| format!("工程缺少有效的 {field}"))
}

fn validate_project(project: &Value) -> Result<(), String> {
    let id = require_string(project.get("id"), "ID")?;
    component(id)?;
    if project.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("不支持的工程版本".into());
    }
    if let Some(instrumental) = project.get("instrumental").filter(|value| !value.is_null()) {
        component(require_string(instrumental.get("id"), "伴奏资产 ID")?)?;
    }
    let tracks = project
        .get("tracks")
        .and_then(Value::as_array)
        .ok_or("工程缺少音轨数据")?;
    for track in tracks {
        component(require_string(track.get("id"), "音轨 ID")?)?;
        let assets = track
            .get("assets")
            .and_then(Value::as_array)
            .ok_or("音轨缺少音频资产列表")?;
        for asset in assets {
            component(require_string(asset.get("id"), "音频资产 ID")?)?;
        }
        let clips = track
            .get("clips")
            .and_then(Value::as_array)
            .ok_or("音轨缺少片段列表")?;
        let asset_ids = assets
            .iter()
            .map(|asset| require_string(asset.get("id"), "音频资产 ID").map(str::to_string))
            .collect::<Result<HashSet<_>, _>>()?;
        for clip in clips {
            component(require_string(clip.get("id"), "片段 ID")?)?;
            let asset_id = require_string(clip.get("assetId"), "片段资产 ID")?;
            component(asset_id)?;
            if !asset_ids.contains(asset_id) {
                return Err(format!("片段引用了未声明的音频资产：{asset_id}"));
            }
        }
    }
    Ok(())
}

fn project_asset_ids(project: &Value) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    for track in project.get("tracks").and_then(Value::as_array).ok_or("工程缺少音轨数据")? {
        for asset in track.get("assets").and_then(Value::as_array).ok_or("音轨缺少音频资产列表")? {
            ids.insert(require_string(asset.get("id"), "音频资产 ID")?.to_string());
        }
    }
    Ok(ids)
}

fn generated_project_id() -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).map(|value| value.as_millis()).unwrap_or_default();
    format!("studio-import-{millis}")
}

fn zip_entry_path(name: &str) -> Result<Vec<String>, String> {
    if name.is_empty() || name.contains('\\') || name.starts_with('/') || name.contains(':') {
        return Err("工程包包含不安全的文件路径".into());
    }
    let parts = name.split('/').filter(|part| !part.is_empty()).map(str::to_string).collect::<Vec<_>>();
    if parts.iter().any(|part| part == "." || part == "..") {
        return Err("工程包包含路径穿越条目".into());
    }
    Ok(parts)
}

fn archive_entry_target(root: &Path, name: &str) -> Result<PathBuf, String> {
    let parts = zip_entry_path(name)?;
    if parts.is_empty() { return Err("工程包包含空文件路径".into()); }
    let mut target = root.to_path_buf();
    for part in parts { target.push(part); }
    Ok(target)
}

fn archive_file_name(name: &str) -> Result<(), String> {
    let parts = zip_entry_path(name)?;
    if parts == ["project.json"] { return Ok(()); }
    if parts.len() == 2 && parts[0] == "assets" && parts[1].ends_with(".audio") {
        let id = parts[1].strip_suffix(".audio").unwrap_or_default();
        component(id)?;
        return Ok(());
    }
    if parts.len() >= 2 && parts[0] == "waveform" { return Ok(()); }
    Err(format!("工程包包含不支持的文件：{name}"))
}

fn zip_entry_is_symlink(entry: &zip::read::ZipFile<'_>) -> bool {
    entry.unix_mode().map(|mode| mode & 0o170000 == 0o120000).unwrap_or(false)
}

fn copy_limited<R: Read, W: Write>(reader: &mut R, writer: &mut W, copied: &mut u64) -> Result<(), String> {
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { break; }
        *copied = copied.saturating_add(count as u64);
        if *copied > MAX_PACKAGE_BYTES { return Err("工程包解压后超过 4 GiB 限制".into()); }
        writer.write_all(&buffer[..count]).map_err(|e| e.to_string())?;
    }
    Ok(())
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
    validate_project(&project)?;
    let id = project.get("id").and_then(Value::as_str).ok_or("工程缺少 ID")?;
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
        let dir = entry.path();
        let bytes = fs::read(dir.join("project.json")).or_else(|_| fs::read(dir.join("project.backup.json")));
        if let Ok(bytes) = bytes {
            if let Ok(project) = serde_json::from_slice::<Value>(&bytes) {
                if validate_project(&project).is_ok() {
                    result.push(json!({"id": project["id"], "title": project["title"], "artist": project["artist"], "updatedAt": project["updatedAt"]}));
                }
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
fn append_directory_to_zip<W: Write + io::Seek>(writer: &mut ZipWriter<W>, dir: &Path, prefix: &str) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() { return Err(format!("工程包含不支持的符号链接：{}", path.display())); }
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        if metadata.is_dir() {
            append_directory_to_zip(writer, &path, &relative)?;
        } else if metadata.is_file() {
            let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            writer.start_file(&relative, options).map_err(|e| e.to_string())?;
            let mut input = fs::File::open(&path).map_err(|e| e.to_string())?;
            io::copy(&mut input, writer).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn write_project_zip(project_dir: &Path, output: &Path) -> Result<(), String> {
    let project_path = project_dir.join("project.json");
    let bytes = fs::read(&project_path).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_PROJECT_JSON_BYTES { return Err("工程描述文件过大".into()); }
    let project: Value = serde_json::from_slice(&bytes).map_err(|e| format!("工程描述文件无效：{e}"))?;
    validate_project(&project)?;
    let asset_ids = project_asset_ids(&project)?;
    for asset_id in &asset_ids {
        let path = project_dir.join("assets").join(format!("{asset_id}.audio"));
        let metadata = fs::symlink_metadata(&path).map_err(|_| format!("工程缺少音频资产：{asset_id}，请先等待保存完成"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(format!("工程缺少音频资产：{asset_id}，请先等待保存完成"));
        }
    }
    let file = fs::File::create(output).map_err(|e| e.to_string())?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    writer.start_file("project.json", options).map_err(|e| e.to_string())?;
    writer.write_all(&bytes).map_err(|e| e.to_string())?;
    // Replacing a take or accompaniment leaves recoverable files on disk. The
    // package must include only assets declared by its own project manifest.
    for asset_id in &asset_ids {
        let name = format!("assets/{asset_id}.audio");
        writer.start_file(&name, options).map_err(|e| e.to_string())?;
        let mut input = fs::File::open(project_dir.join(&name)).map_err(|e| e.to_string())?;
        io::copy(&mut input, &mut writer).map_err(|e| e.to_string())?;
    }
    let waveform = project_dir.join("waveform");
    if waveform.is_dir() { append_directory_to_zip(&mut writer, &waveform, "waveform")?; }
    writer.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Export a project package directly to the user-selected destination. The
/// archive is streamed to disk so large vocal takes do not need a base64 copy.
#[tauri::command]
pub async fn studio_export_package_to_file(
    window: tauri::WebviewWindow,
    project_id: String,
    file_name: String,
) -> Result<Option<String>, String> {
    let dir = root(&project_id)?;
    if !dir.join("project.json").is_file() { return Err("工程尚未保存".into()); }
    let name = sanitize_file_name(&file_name, "project.cove-studio");
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("导出工程包到…")
        .set_file_name(name)
        .add_filter("Cove 工作室工程", &["cove-studio"])
        .save_file().await else { return Ok(None); };
    let mut path = file.path().to_path_buf();
    if path.extension().and_then(|value| value.to_str()).map(|value| !value.eq_ignore_ascii_case("cove-studio")).unwrap_or(true) {
        path.set_extension("cove-studio");
    }
    let result = write_project_zip(&dir, &path);
    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        return Err(format!("创建工程包失败：{error}"));
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

fn sanitize_file_name(file_name: &str, fallback: &str) -> String {
    let clean = file_name.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>();
    if clean.trim().is_empty() { fallback.to_string() } else { clean }
}

fn validate_imported_archive_entry(name: &str, project_asset_ids: Option<&HashSet<String>>) -> Result<(), String> {
    archive_file_name(name)?;
    let parts = zip_entry_path(name)?;
    if parts.len() == 2 && parts[0] == "assets" {
        let id = parts[1].strip_suffix(".audio").unwrap_or_default();
        if let Some(ids) = project_asset_ids {
            if !ids.contains(id) { return Err(format!("工程包包含未声明的音频资产：{id}")); }
        }
    }
    Ok(())
}

/// Import a `.cove-studio` package into a fresh local project directory.
/// Entries are validated before extraction and never allowed to escape the
/// app-data directory.
#[tauri::command]
pub async fn studio_import_package(window: tauri::WebviewWindow) -> Result<Option<Value>, String> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_parent(&window)
        .set_title("打开 Cove 工作室工程包")
        .add_filter("Cove 工作室工程", &["cove-studio", "zip"])
        .pick_file().await else { return Ok(None); };
    let input = fs::File::open(file.path()).map_err(|e| format!("无法打开工程包：{e}"))?;
    let mut archive = ZipArchive::new(input).map_err(|e| format!("工程包不是有效的 ZIP：{e}"))?;
    if archive.len() > MAX_PACKAGE_ENTRIES { return Err("工程包文件数量过多".into()); }
    let mut project_bytes = None;
    let mut total_uncompressed = 0u64;
    let mut names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(|e| format!("读取工程包失败：{e}"))?;
        let name = entry.name().to_string();
        let _ = zip_entry_path(&name)?;
        if !names.insert(name.clone()) { return Err(format!("工程包包含重复条目：{name}")); }
        if zip_entry_is_symlink(&entry) { return Err(format!("工程包包含符号链接：{name}")); }
        if entry.is_dir() { continue; }
        if entry.size() > MAX_PACKAGE_BYTES || total_uncompressed.saturating_add(entry.size()) > MAX_PACKAGE_BYTES {
            return Err("工程包解压后超过 4 GiB 限制".into());
        }
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if name == "project.json" {
            if entry.size() > MAX_PROJECT_JSON_BYTES { return Err("工程描述文件过大".into()); }
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry.take(MAX_PROJECT_JSON_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_PROJECT_JSON_BYTES { return Err("工程描述文件过大".into()); }
            project_bytes = Some(bytes);
        }
    }
    let original_bytes = project_bytes.ok_or("工程包缺少 project.json")?;
    let mut project: Value = serde_json::from_slice(&original_bytes).map_err(|e| format!("工程描述文件无效：{e}"))?;
    validate_project(&project)?;
    let asset_ids = project_asset_ids(&project)?;
    for asset_id in &asset_ids {
        let expected = format!("assets/{asset_id}.audio");
        if !names.contains(&expected) { return Err(format!("工程包缺少音频资产：{asset_id}")); }
    }
    for name in names.iter().filter(|name| !name.ends_with('/')) { validate_imported_archive_entry(name, Some(&asset_ids))?; }
    let projects_dir = super::app_data_dir().join("StudioProjects");
    fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    let imported_id = generated_project_id();
    let destination = projects_dir.join(&imported_id);
    if destination.exists() { return Err("无法创建新的工程目录，请稍后重试".into()); }
    fs::create_dir_all(destination.join("assets")).map_err(|e| e.to_string())?;
    fs::create_dir_all(destination.join("waveform")).map_err(|e| e.to_string())?;
    let extraction = (|| -> Result<(), String> {
        let input = fs::File::open(file.path()).map_err(|e| e.to_string())?;
        let mut archive = ZipArchive::new(input).map_err(|e| e.to_string())?;
        let mut extracted = 0u64;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if entry.is_dir() { continue; }
            let target = archive_entry_target(&destination, &name)?;
            if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            let mut output = fs::File::create(&target).map_err(|e| e.to_string())?;
            copy_limited(&mut entry, &mut output, &mut extracted)?;
        }
        project["id"] = Value::String(imported_id.clone());
        let bytes = serde_json::to_vec_pretty(&project).map_err(|e| e.to_string())?;
        fs::write(destination.join("project.json"), bytes).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if let Err(error) = extraction {
        let _ = fs::remove_dir_all(&destination);
        return Err(format!("导入工程包失败：{error}"));
    }
    Ok(Some(project))
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
    #[test]
    fn exports_only_declared_assets_after_replacement() {
        let dir = std::env::temp_dir().join(format!("cove-zip-test-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(dir.join("assets")).unwrap();
        let project = json!({"id": "test", "version": 1, "tracks": [{"id": "instrumental", "assets": [{"id": "current"}], "clips": [{"id": "clip", "assetId": "current"}]}]});
        fs::write(dir.join("project.json"), serde_json::to_vec(&project).unwrap()).unwrap();
        fs::write(dir.join("assets/old.audio"), b"old accompaniment").unwrap();
        fs::write(dir.join("assets/current.audio"), b"current accompaniment").unwrap();
        let output = dir.join("test.cove-studio");
        write_project_zip(&dir, &output).unwrap();
        let mut archive = ZipArchive::new(fs::File::open(&output).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let ids = project_asset_ids(&project).unwrap();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).unwrap();
            validate_imported_archive_entry(entry.name(), Some(&ids)).unwrap();
            if entry.name() == "assets/current.audio" {
                let mut bytes = Vec::new(); entry.read_to_end(&mut bytes).unwrap();
                assert_eq!(bytes, b"current accompaniment");
            }
        }
        assert!(archive.by_name("assets/old.audio").is_err());
        assert!(dir.join("assets/old.audio").is_file());
        drop(archive);
        // This unique test-created directory is the only cleanup target.
        assert!(dir.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn rejects_traversal() { for id in ["../outside", "a/b", "a\\b", "", "."] { assert!(component(id).is_err()); } }
    #[test] fn base64_round_trip() { for data in [b"".as_slice(), b"a", b"ab", b"abc", &[0, 255, 128, 1]] { assert_eq!(super::super::decode_base64(&encode_base64(data)).unwrap(), data); } }
    #[test]
    fn validates_project_ids_and_version() {
        let project = json!({
            "id": "studio-test",
            "version": 1,
            "tracks": [{
                "id": "instrumental",
                "assets": [{"id": "asset-1"}],
                "clips": [{"id": "clip-1", "assetId": "asset-1"}]
            }]
        });
        assert!(validate_project(&project).is_ok());
        assert!(validate_project(&json!({"id": "studio-test", "version": 2, "tracks": []})).is_err());
        assert!(validate_project(&json!({"id": "bad/id", "version": 1, "tracks": []})).is_err());
    }
    #[test]
    fn rejects_unsafe_archive_names_and_unknown_assets() {
        assert!(zip_entry_path("../project.json").is_err());
        assert!(zip_entry_path("C:/project.json").is_err());
        assert!(archive_file_name("assets/asset-1.audio").is_ok());
        assert!(archive_file_name("assets/asset-1.txt").is_err());
        let ids = HashSet::from(["asset-1".to_string()]);
        assert!(validate_imported_archive_entry("assets/asset-1.audio", Some(&ids)).is_ok());
        assert!(validate_imported_archive_entry("assets/asset-2.audio", Some(&ids)).is_err());
    }
}
