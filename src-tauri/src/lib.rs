// Backend entry point.
//
// The frontend still owns the UI and audio element. The backend handles native
// window plumbing plus NetEase web API requests so packaged builds work without
// a separately running local API service.

use aes::Aes128;
use ecb::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyInit};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, ORIGIN, REFERER, SET_COOKIE, USER_AGENT},
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State, WindowEvent,
};

const NETEASE_BASE: &str = "https://music.163.com";
const NETEASE_EAPI_BASE: &str = "https://interface.music.163.com";
const EAPI_KEY: &[u8; 16] = b"e82ckenh8dichen8";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const NETEASE_APP_UA: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

type Aes128EcbEnc = ecb::Encryptor<Aes128>;

struct NeteaseState {
    client: Client,
    cookie_file: PathBuf,
    device_file: PathBuf,
}

#[derive(Serialize)]
struct QrKey {
    unikey: String,
    url: String,
}

#[derive(Serialize)]
struct QrStatus {
    code: i64,
    status: String,
    saved: bool,
}

#[derive(Serialize)]
struct LoginStatus {
    logged_in: bool,
    nickname: Option<String>,
    vip_type: Option<i64>,
    uid: Option<i64>,
}

#[derive(Deserialize)]
struct SearchArgs {
    keyword: String,
    limit: Option<u32>,
}

#[derive(Deserialize)]
struct SongUrlArgs {
    id: i64,
    level: Option<String>,
}

#[derive(Deserialize)]
struct PlaylistPageArgs {
    id: i64,
    limit: u32,
    offset: u32,
}

#[derive(Deserialize)]
struct UserPlaylistsArgs {
    uid: i64,
    limit: u32,
    offset: u32,
}

struct FallbackLyric {
    lyric: String,
    source: &'static str,
}

#[derive(Debug)]
struct KugouCandidate {
    id: i64,
    name: String,
    artist: String,
    duration_ms: i64,
    hash: String,
}

fn app_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    // User-facing product name is Cove; keep legacy folder so existing logins survive rename.
    base.join("Netease Music Player")
}

fn cookie_file_path() -> PathBuf {
    app_data_dir().join("cookie.txt")
}

fn qq_cookie_file_path() -> PathBuf {
    app_data_dir().join("qq_cookie.txt")
}

fn kugou_session_file_path() -> PathBuf {
    app_data_dir().join("kugou_session.json")
}

fn ensure_parent(path: &PathBuf) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_text_file(path: &PathBuf) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn write_text_file(path: &PathBuf, content: &str) -> Result<(), String> {
    ensure_parent(path)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn cookie_field(cookie: &str, key: &str) -> Option<String> {
    for part in cookie.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((k, v)) = part.split_once('=') {
            if k.trim().eq_ignore_ascii_case(key) {
                let val = v.trim();
                if !val.is_empty() {
                    return Some(val.to_string());
                }
            }
        }
    }
    None
}

/// Normalize pasted cookie header into `k=v; k2=v2` form.
fn normalize_cookie_header(raw: &str) -> String {
    let mut jar: BTreeMap<String, String> = BTreeMap::new();
    for part in raw.split([';', '\n', '\r']) {
        let part = part.trim().trim_start_matches("Cookie:").trim();
        if part.is_empty() {
            continue;
        }
        // allow full "Cookie: a=1; b=2" lines or single pairs
        for pair in part.split(';') {
            let pair = pair.trim();
            if let Some((k, v)) = pair.split_once('=') {
                let k = k.trim();
                let v = v.trim();
                if !k.is_empty() && !v.is_empty() {
                    jar.insert(k.to_string(), v.to_string());
                }
            }
        }
    }
    jar.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn qq_uin_from_cookie(cookie: &str) -> String {
    cookie_field(cookie, "uin")
        .or_else(|| cookie_field(cookie, "wxuin"))
        .map(|u| u.trim_start_matches('o').to_string())
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| "0".into())
}

#[derive(Serialize, Clone)]
struct PlatformAuth {
    platform: String,
    logged_in: bool,
    nickname: Option<String>,
    uid: Option<String>,
    vip: Option<bool>,
}

#[derive(Serialize)]
struct MultiAuthStatus {
    any_logged_in: bool,
    netease: PlatformAuth,
    qq: PlatformAuth,
    kugou: PlatformAuth,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct KugouSession {
    token: String,
    userid: String,
    #[serde(default)]
    cookie: String,
    #[serde(default)]
    nickname: String,
}

fn load_qq_cookie() -> Option<String> {
    read_text_file(&qq_cookie_file_path())
}

fn save_qq_cookie(cookie: &str) -> Result<(), String> {
    let normalized = normalize_cookie_header(cookie);
    if normalized.is_empty() {
        return Err("cookie 为空".into());
    }
    // Accept any session cookie from ptlogin / y.qq.com redirect chain
    if cookie_field(&normalized, "qm_keyst").is_none()
        && cookie_field(&normalized, "qqmusic_key").is_none()
        && cookie_field(&normalized, "uin").is_none()
        && cookie_field(&normalized, "wxuin").is_none()
        && cookie_field(&normalized, "p_uin").is_none()
        && cookie_field(&normalized, "skey").is_none()
        && cookie_field(&normalized, "p_skey").is_none()
    {
        return Err("未识别到 QQ 登录字段".into());
    }
    write_text_file(&qq_cookie_file_path(), &normalized)
}

fn clear_qq_cookie() {
    let path = qq_cookie_file_path();
    // Best-effort wipe: delete, then overwrite empty so residual cannot linger.
    let _ = fs::remove_file(&path);
    if path.exists() {
        let _ = fs::write(&path, "");
        let _ = fs::remove_file(&path);
    }
}

/// True when cookie represents a real QQ session (not leftover junk).
fn qq_cookie_is_logged_in(cookie: &str) -> bool {
    let uin = qq_uin_from_cookie(cookie);
    if uin == "0" || uin.is_empty() {
        return false;
    }
    // Need at least one auth secret — bare uin alone is NOT logged in
    // (was the residual-after-logout bug: uin-only file kept showing 已登录).
    cookie_field(cookie, "skey").is_some()
        || cookie_field(cookie, "p_skey").is_some()
        || cookie_field(cookie, "qm_keyst").is_some()
        || cookie_field(cookie, "qqmusic_key").is_some()
        || cookie_field(cookie, "superkey").is_some()
}

fn qq_platform_auth() -> PlatformAuth {
    match load_qq_cookie() {
        Some(c) => {
            let uin = qq_uin_from_cookie(&c);
            let logged = qq_cookie_is_logged_in(&c);
            // Stale/empty residual file — auto-clean so next boot is clean.
            if !logged {
                clear_qq_cookie();
                return PlatformAuth {
                    platform: "qq".into(),
                    logged_in: false,
                    nickname: None,
                    uid: None,
                    vip: None,
                };
            }
            PlatformAuth {
                platform: "qq".into(),
                logged_in: true,
                nickname: cookie_field(&c, "psrf_qqopenid")
                    .or_else(|| cookie_field(&c, "euin"))
                    .or(if uin != "0" {
                        Some(format!("QQ {uin}"))
                    } else {
                        None
                    }),
                uid: if uin != "0" { Some(uin) } else { None },
                vip: None,
            }
        }
        None => PlatformAuth {
            platform: "qq".into(),
            logged_in: false,
            nickname: None,
            uid: None,
            vip: None,
        },
    }
}

fn load_kugou_session() -> Option<KugouSession> {
    let raw = read_text_file(&kugou_session_file_path())?;
    serde_json::from_str(&raw).ok()
}

fn save_kugou_session(session: &KugouSession) -> Result<(), String> {
    if session.token.trim().is_empty() && session.cookie.trim().is_empty() {
        return Err("token 与 cookie 不能同时为空".into());
    }
    let path = kugou_session_file_path();
    ensure_parent(&path)?;
    let text = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn clear_kugou_session() {
    let _ = fs::remove_file(kugou_session_file_path());
}

fn kugou_platform_auth() -> PlatformAuth {
    match load_kugou_session() {
        Some(s) if !s.token.is_empty() || !s.cookie.is_empty() => PlatformAuth {
            platform: "kugou".into(),
            logged_in: true,
            nickname: if s.nickname.is_empty() {
                if s.userid.is_empty() {
                    Some("酷狗用户".into())
                } else {
                    Some(format!("酷狗 {}", s.userid))
                }
            } else {
                Some(s.nickname)
            },
            uid: if s.userid.is_empty() {
                None
            } else {
                Some(s.userid)
            },
            vip: None,
        },
        _ => PlatformAuth {
            platform: "kugou".into(),
            logged_in: false,
            nickname: None,
            uid: None,
            vip: None,
        },
    }
}

/// Hash33 used by QQ Music (`g_tk` / ptqrtoken). Seed 5381 matches L-1124/web.
fn qq_hash33_seeded(s: &str, seed: i32) -> u32 {
    let mut h: i32 = seed;
    for b in s.bytes() {
        h = h.wrapping_add(h.wrapping_shl(5).wrapping_add(b as i32));
    }
    (h & 0x7fff_ffff) as u32
}

/// g_tk for musicu / CGI.
/// Prefer musickey (qm_keyst) — L-1124 uses hash33(musickey). skey is only a fallback
/// for older ptlogin-only sessions; wrong g_tk with authst yields empty purl / 104009.
fn qq_gtk_from_cookie(cookie: &str) -> u32 {
    let key = cookie_field(cookie, "qqmusic_key")
        .or_else(|| cookie_field(cookie, "qm_keyst"))
        .or_else(|| cookie_field(cookie, "p_skey"))
        .or_else(|| cookie_field(cookie, "skey"))
        .unwrap_or_default();
    if key.is_empty() {
        return 5381;
    }
    qq_hash33_seeded(&key, 5381)
}

/// QQConnect / WeChat login type for tmeLoginType (1=WX, 2=QQ).
fn qq_tme_login_type(cookie: &str) -> i64 {
    if let Some(lt) = cookie_field(cookie, "login_type")
        .or_else(|| cookie_field(cookie, "tmeLoginType"))
    {
        if let Ok(n) = lt.parse::<i64>() {
            if n > 0 {
                return n;
            }
        }
    }
    let key = cookie_field(cookie, "qm_keyst")
        .or_else(|| cookie_field(cookie, "qqmusic_key"))
        .unwrap_or_default();
    // L-1124: musickey starting with W_X → WeChat, else QQ
    if key.starts_with("W_X") {
        1
    } else {
        2
    }
}

fn qq_uin_digits(cookie: &str) -> String {
    qq_uin_from_cookie(cookie)
        .trim_start_matches('o')
        .to_string()
}

fn qq_has_music_session(cookie: &str) -> bool {
    cookie_field(cookie, "qm_keyst").is_some()
        || cookie_field(cookie, "qqmusic_key").is_some()
        || cookie_field(cookie, "skey").is_some()
        || cookie_field(cookie, "login_type").is_some()
}

fn default_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(UA));
    headers.insert(REFERER, HeaderValue::from_static("https://music.163.com/"));
    headers.insert(ORIGIN, HeaderValue::from_static("https://music.163.com"));
    headers.insert(ACCEPT, HeaderValue::from_static("application/json, text/plain, */*"));
    headers
}

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn load_cookie(state: &NeteaseState) -> Option<String> {
    fs::read_to_string(&state.cookie_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn save_cookie(state: &NeteaseState, cookie: &str) -> Result<(), String> {
    write_text_file(&state.cookie_file, cookie)
}

fn clear_cookie(state: &NeteaseState) {
    let _ = fs::remove_file(&state.cookie_file);
}

fn load_or_create_device_id(state: &NeteaseState) -> String {
    if let Ok(device_id) = fs::read_to_string(&state.device_file) {
        let device_id = device_id.trim().to_string();
        if !device_id.is_empty() {
            return device_id;
        }
    }
    let device_id = format!("nmp{}", timestamp_ms());
    if let Some(parent) = state.device_file.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(&state.device_file, &device_id);
    device_id
}

fn merge_response_cookies(existing: Option<String>, headers: &HeaderMap) -> Option<String> {
    let mut jar: BTreeMap<String, String> = BTreeMap::new();

    if let Some(existing) = existing {
        for part in existing.split(';') {
            let pair = part.trim();
            if let Some((name, value)) = pair.split_once('=') {
                if !name.trim().is_empty() {
                    jar.insert(name.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }

    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(raw) = value.to_str() else { continue };
        let Some(pair) = raw.split(';').next() else { continue };
        let Some((name, val)) = pair.split_once('=') else { continue };
        if !name.trim().is_empty() {
            jar.insert(name.trim().to_string(), val.trim().to_string());
        }
    }

    if jar.is_empty() {
        None
    } else {
        Some(
            jar.into_iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

fn merge_cookie_string(existing: Option<String>, next: &str) -> Option<String> {
    let mut jar: BTreeMap<String, String> = BTreeMap::new();

    if let Some(existing) = existing {
        for part in existing.split(';') {
            let pair = part.trim();
            if let Some((name, value)) = pair.split_once('=') {
                if !name.trim().is_empty() {
                    jar.insert(name.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }

    for part in next.split(';') {
        let pair = part.trim();
        let Some((name, value)) = pair.split_once('=') else { continue };
        let name = name.trim();
        let value = value.trim();
        if name.is_empty() || value.is_empty() {
            continue;
        }
        jar.insert(name.to_string(), value.to_string());
    }

    if jar.is_empty() {
        None
    } else {
        Some(
            jar.into_iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; "),
        )
    }
}

fn cookie_map(cookie: Option<String>) -> BTreeMap<String, String> {
    let mut jar = BTreeMap::new();
    if let Some(cookie) = cookie {
        for part in cookie.split(';') {
            let pair = part.trim();
            if let Some((name, value)) = pair.split_once('=') {
                if !name.trim().is_empty() {
                    jar.insert(name.trim().to_string(), value.trim().to_string());
                }
            }
        }
    }
    jar
}

fn cookie_string(jar: &BTreeMap<String, String>) -> String {
    jar.iter()
        .map(|(name, value)| format!("{name}={value}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn eapi_header(
    existing_cookie: Option<String>,
    api_path: &str,
    device_id: String,
) -> BTreeMap<String, String> {
    let mut header = cookie_map(existing_cookie);
    let now = timestamp_ms().to_string();
    let buildver = now.chars().take(10).collect::<String>();
    let request_id = format!("{}_0001", timestamp_ms());

    header.entry("__remember_me".to_string()).or_insert_with(|| "true".to_string());
    header.entry("ntes_kaola_ad".to_string()).or_insert_with(|| "1".to_string());
    header.entry("osver".to_string()).or_insert_with(|| "Microsoft-Windows-10-Professional-build-19045-64bit".to_string());
    header.entry("deviceId".to_string()).or_insert(device_id);
    header.entry("os".to_string()).or_insert_with(|| "pc".to_string());
    header.entry("appver".to_string()).or_insert_with(|| "3.1.17.204416".to_string());
    header.entry("versioncode".to_string()).or_insert_with(|| "140".to_string());
    header.entry("mobilename".to_string()).or_insert_with(String::new);
    header.entry("buildver".to_string()).or_insert(buildver);
    header.entry("resolution".to_string()).or_insert_with(|| "1920x1080".to_string());
    header.entry("__csrf".to_string()).or_insert_with(String::new);
    header.entry("channel".to_string()).or_insert_with(|| "netease".to_string());
    header.insert("requestId".to_string(), request_id);

    if !api_path.contains("login") {
        header.entry("NMTID".to_string()).or_insert_with(|| timestamp_ms().to_string());
    }
    header
}

fn eapi_params(api_path: &str, payload: Value) -> Result<String, String> {
    let text = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let message = format!("nobody{api_path}use{text}md5forencrypt");
    let digest = format!("{:x}", md5::compute(message.as_bytes()));
    let data = format!("{api_path}-36cd479b6b5-{text}-36cd479b6b5-{digest}");
    let encrypted = Aes128EcbEnc::new(EAPI_KEY.into())
        .encrypt_padded_vec_mut::<Pkcs7>(data.as_bytes());
    Ok(encrypted.iter().map(|byte| format!("{byte:02X}")).collect())
}

async fn post_eapi_json(
    state: &NeteaseState,
    api_path: &str,
    mut payload: Value,
) -> Result<(Value, HeaderMap), String> {
    let header = eapi_header(load_cookie(state), api_path, load_or_create_device_id(state));
    payload["e_r"] = Value::Bool(false);
    payload["header"] = json!(header);
    let params = eapi_params(api_path, payload)?;
    let response = state
        .client
        .post(format!("{NETEASE_EAPI_BASE}/eapi/{}", api_path.trim_start_matches("/api/")))
        .headers(default_headers())
        .header(USER_AGENT, NETEASE_APP_UA)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header("Cookie", cookie_string(&header))
        .form(&[("params", params)])
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let headers = response.headers().clone();
    let env = response.json::<Value>().await.map_err(|e| e.to_string())?;
    Ok((env, headers))
}

async fn get_json(state: &NeteaseState, path: &str, with_cookie: bool) -> Result<Value, String> {
    let url = format!("{NETEASE_BASE}{path}");
    let mut req = state.client.get(url).headers(default_headers());
    if with_cookie {
        if let Some(cookie) = load_cookie(state) {
            req = req.header("Cookie", cookie);
        }
    }
    req.send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

async fn post_form_json(
    state: &NeteaseState,
    path: &str,
    form: &[(&str, String)],
    with_cookie: bool,
) -> Result<Value, String> {
    let url = format!("{NETEASE_BASE}{path}");
    let mut req = state
        .client
        .post(url)
        .headers(default_headers())
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .form(form);
    if with_cookie {
        if let Some(cookie) = load_cookie(state) {
            req = req.header("Cookie", cookie);
        }
    }
    req.send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

fn artist_name(value: &Value) -> String {
    value
        .as_array()
        .map(|artists| {
            artists
                .iter()
                .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(", ")
        })
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "未知歌手".to_string())
}

fn map_song(raw: &Value) -> Value {
    let album = raw.get("album").or_else(|| raw.get("al")).unwrap_or(&Value::Null);
    let artists = raw.get("artists").or_else(|| raw.get("ar")).unwrap_or(&Value::Null);
    json!({
        "id": raw.get("id").and_then(Value::as_i64).unwrap_or_default(),
        "name": raw.get("name").and_then(Value::as_str).unwrap_or("未知歌曲"),
        "artist": artist_name(artists),
        "album": album.get("name").and_then(Value::as_str).unwrap_or(""),
        "pic": album
            .get("picUrl")
            .or_else(|| album.get("picUrl_str"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "duration": raw
            .get("duration")
            .or_else(|| raw.get("dt"))
            .and_then(Value::as_i64)
            .unwrap_or_default(),
    })
}

fn map_playlist(raw: &Value, owner_uid: i64) -> Value {
    let creator = raw.get("creator").unwrap_or(&Value::Null);
    let creator_uid = creator.get("userId").and_then(Value::as_i64).unwrap_or_default();
    json!({
        "id": raw.get("id").and_then(Value::as_i64).unwrap_or_default(),
        "name": raw.get("name").and_then(Value::as_str).unwrap_or("未命名歌单"),
        "coverImgUrl": raw.get("coverImgUrl").and_then(Value::as_str).unwrap_or(""),
        "trackCount": raw.get("trackCount").and_then(Value::as_i64).unwrap_or_default(),
        "playCount": raw.get("playCount").and_then(Value::as_i64).unwrap_or_default(),
        "createTime": raw.get("createTime").and_then(Value::as_i64).unwrap_or_default(),
        "updateTime": raw.get("updateTime").and_then(Value::as_i64).unwrap_or_default(),
        "subscribed": raw.get("subscribed").and_then(Value::as_bool).unwrap_or(false),
        "creatorUid": creator_uid,
        "creatorName": creator.get("nickname").and_then(Value::as_str).unwrap_or(""),
        "createdByAccount": creator_uid == owner_uid,
    })
}

fn lyric_text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(|v| v.get("lyric"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn value_i64(value: Option<&Value>) -> i64 {
    value
        .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok())))
        .unwrap_or_default()
}

fn has_timed_lyric(raw: &str) -> bool {
    raw.lines().any(|line| {
        let Some(end) = line.find(']') else {
            return false;
        };
        line.starts_with('[') && line[..end].contains(':') && !line[end + 1..].trim().is_empty()
    })
}

fn normalize_match_text(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(c))
        .collect()
}

fn strip_html_tags(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for ch in value.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => output.push(ch),
            _ => {}
        }
    }
    decode_xml_entities(&output)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn decode_xml_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn attr_value(tag: &str, key: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let needle = format!("{key}={quote}");
        if let Some(start) = tag.find(&needle) {
            let rest = &tag[start + needle.len()..];
            if let Some(end) = rest.find(quote) {
                return Some(rest[..end].to_string());
            }
        }
    }
    None
}

fn parse_timed_text_seconds(value: &str) -> Option<f64> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(ms) = trimmed.strip_suffix("ms") {
        return ms.trim().parse::<f64>().ok().map(|v| v / 1000.0);
    }
    if let Some(seconds) = trimmed.strip_suffix('s') {
        return seconds.trim().parse::<f64>().ok();
    }
    let parts = trimmed.split(':').collect::<Vec<_>>();
    match parts.as_slice() {
        [minutes, seconds] => Some(minutes.parse::<f64>().ok()? * 60.0 + seconds.parse::<f64>().ok()?),
        [hours, minutes, seconds] => Some(
            hours.parse::<f64>().ok()? * 3600.0
                + minutes.parse::<f64>().ok()? * 60.0
                + seconds.parse::<f64>().ok()?,
        ),
        [seconds] => seconds.parse::<f64>().ok(),
        _ => None,
    }
}

fn format_lrc_time(seconds: f64) -> String {
    let centiseconds = (seconds.max(0.0) * 100.0).round() as u64;
    let minutes = centiseconds / 6000;
    let secs = (centiseconds / 100) % 60;
    let cs = centiseconds % 100;
    format!("{minutes:02}:{secs:02}.{cs:02}")
}

fn ttml_to_lrc(ttml: &str) -> Option<String> {
    let mut cursor = 0;
    let mut lines = Vec::new();
    while let Some(open_rel) = ttml[cursor..].find("<p") {
        let open = cursor + open_rel;
        let Some(tag_end_rel) = ttml[open..].find('>') else {
            break;
        };
        let tag_end = open + tag_end_rel;
        let tag = &ttml[open..=tag_end];
        let Some(close_rel) = ttml[tag_end + 1..].find("</p>") else {
            break;
        };
        let close = tag_end + 1 + close_rel;
        let body = &ttml[tag_end + 1..close];
        cursor = close + "</p>".len();

        let Some(begin) = attr_value(tag, "begin")
            .or_else(|| attr_value(tag, "start"))
            .and_then(|value| parse_timed_text_seconds(&value))
        else {
            continue;
        };
        let text = strip_html_tags(body);
        if text.is_empty() {
            continue;
        }
        lines.push((begin, text));
    }

    if lines.is_empty() {
        return None;
    }
    lines.sort_by(|left, right| left.0.total_cmp(&right.0));
    Some(
        lines
            .into_iter()
            .map(|(time, text)| format!("[{}]{}", format_lrc_time(time), text))
            .collect::<Vec<_>>()
            .join("\n"),
    )
}

fn percent_decode_base64_char(ch: char) -> Option<u8> {
    match ch {
        'A'..='Z' => Some(ch as u8 - b'A'),
        'a'..='z' => Some(ch as u8 - b'a' + 26),
        '0'..='9' => Some(ch as u8 - b'0' + 52),
        '+' => Some(62),
        '/' => Some(63),
        _ => None,
    }
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
    let mut buffer = 0u32;
    let mut bits = 0u8;
    let mut output = Vec::new();
    for ch in value.chars().filter(|ch| !ch.is_whitespace()) {
        if ch == '=' {
            break;
        }
        let sextet = percent_decode_base64_char(ch)? as u32;
        buffer = (buffer << 6) | sextet;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(output)
}

fn signed_kugou_params(mut params: BTreeMap<String, String>, module: &str) -> BTreeMap<String, String> {
    if module != "Lyric" {
        let now = timestamp_ms();
        params.insert("userid".to_string(), "0".to_string());
        params.insert("appid".to_string(), "3116".to_string());
        params.insert("token".to_string(), "".to_string());
        params.insert("clienttime".to_string(), (now / 1000).to_string());
        params.insert("iscorrection".to_string(), "1".to_string());
        params.insert("uuid".to_string(), "-".to_string());
        params.insert("mid".to_string(), format!("{:x}", md5::compute(now.to_string())));
        params.insert("dfid".to_string(), "-".to_string());
        params.insert("clientver".to_string(), "11070".to_string());
        params.insert("platform".to_string(), "AndroidFilter".to_string());
    } else {
        params.insert("appid".to_string(), "3116".to_string());
        params.insert("clientver".to_string(), "11070".to_string());
    }

    let mut sign_input = "LnT6xpN3khm36zse0QzvmgTZ3waWdRSA".to_string();
    for (key, value) in &params {
        sign_input.push_str(key);
        sign_input.push('=');
        sign_input.push_str(value);
    }
    sign_input.push_str("LnT6xpN3khm36zse0QzvmgTZ3waWdRSA");
    params.insert(
        "signature".to_string(),
        format!("{:x}", md5::compute(sign_input)),
    );
    params
}

async fn get_kugou_json(
    client: &Client,
    base_url: &str,
    params: BTreeMap<String, String>,
    module: &str,
    extra_headers: &[(&str, &str)],
) -> Result<Value, String> {
    let final_params = signed_kugou_params(params, module);
    let url = reqwest::Url::parse_with_params(base_url, final_params.iter())
        .map_err(|e| e.to_string())?;
    let mut req = client
        .get(url)
        .header(USER_AGENT, format!("Android14-1070-11070-201-0-{module}-wifi"))
        .header("KG-Rec", "1")
        .header("KG-RC", "1");
    for (key, value) in extra_headers {
        req = req.header(*key, *value);
    }
    req.send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

async fn search_kugou_candidates(
    client: &Client,
    title: &str,
    artist: &str,
) -> Result<Vec<KugouCandidate>, String> {
    let mut params = BTreeMap::new();
    params.insert("sorttype".to_string(), "0".to_string());
    params.insert("keyword".to_string(), format!("{artist} {title}"));
    params.insert("pagesize".to_string(), "8".to_string());
    params.insert("page".to_string(), "1".to_string());
    let data = get_kugou_json(
        client,
        "http://complexsearch.kugou.com/v2/search/song",
        params,
        "SearchSong",
        &[("x-router", "complexsearch.kugou.com")],
    )
    .await?;
    let Some(items) = data
        .get("data")
        .and_then(|v| v.get("lists"))
        .and_then(Value::as_array)
    else {
        return Ok(Vec::new());
    };

    Ok(items
        .iter()
        .filter_map(|item| {
            let hash = item.get("FileHash").and_then(Value::as_str)?.to_string();
            let singers = item
                .get("Singers")
                .and_then(Value::as_array)
                .map(|artists| {
                    artists
                        .iter()
                        .filter_map(|artist| artist.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_else(|| item.get("SingerName").and_then(Value::as_str).unwrap_or("").to_string());
            Some(KugouCandidate {
                id: value_i64(item.get("ID").or_else(|| item.get("AlbumAudioID"))),
                name: item
                    .get("SongName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                artist: singers,
                duration_ms: value_i64(item.get("Duration")) * 1000,
                hash,
            })
        })
        .collect())
}

fn kugou_candidate_matches(candidate: &KugouCandidate, title: &str, artist: &str, duration_ms: i64) -> bool {
    let target_title = normalize_match_text(title);
    let candidate_title = normalize_match_text(&candidate.name);
    if target_title.is_empty()
        || candidate_title.is_empty()
        || !(candidate_title.contains(&target_title) || target_title.contains(&candidate_title))
    {
        return false;
    }

    let target_artist = normalize_match_text(artist.split(',').next().unwrap_or(artist));
    let candidate_artist = normalize_match_text(&candidate.artist);
    if !target_artist.is_empty() && !candidate_artist.contains(&target_artist) {
        return false;
    }

    duration_ms <= 0
        || candidate.duration_ms <= 0
        || (candidate.duration_ms - duration_ms).abs() <= 10_000
}

async fn fetch_kugou_lrc(client: &Client, candidate: &KugouCandidate) -> Option<String> {
    let mut search_params = BTreeMap::new();
    search_params.insert("album_audio_id".to_string(), candidate.id.to_string());
    search_params.insert("duration".to_string(), candidate.duration_ms.to_string());
    search_params.insert("hash".to_string(), candidate.hash.clone());
    search_params.insert(
        "keyword".to_string(),
        format!("{} - {}", candidate.artist, candidate.name),
    );
    search_params.insert("lrctxt".to_string(), "1".to_string());
    search_params.insert("man".to_string(), "no".to_string());
    let search = get_kugou_json(
        client,
        "https://lyrics.kugou.com/v1/search",
        search_params,
        "Lyric",
        &[],
    )
    .await
    .ok()?;
    let best = search
        .get("candidates")
        .and_then(Value::as_array)
        .and_then(|items| items.first())?;
    let id = value_i64(best.get("id"));
    if id <= 0 {
        return None;
    }
    let accesskey = best.get("accesskey").and_then(Value::as_str)?;

    let mut download_params = BTreeMap::new();
    download_params.insert("accesskey".to_string(), accesskey.to_string());
    download_params.insert("charset".to_string(), "utf8".to_string());
    download_params.insert("client".to_string(), "mobi".to_string());
    download_params.insert("fmt".to_string(), "lrc".to_string());
    download_params.insert("id".to_string(), id.to_string());
    download_params.insert("ver".to_string(), "1".to_string());
    let download = get_kugou_json(
        client,
        "http://lyrics.kugou.com/download",
        download_params,
        "Lyric",
        &[],
    )
    .await
    .ok()?;
    let encoded = download.get("content").and_then(Value::as_str)?;
    let bytes = decode_base64(encoded)?;
    let lyric = String::from_utf8(bytes).ok()?;
    if has_timed_lyric(&lyric) {
        Some(lyric)
    } else {
        None
    }
}

async fn fetch_amll_ncm_lrc(client: &Client, id: i64) -> Option<String> {
    let url = format!("https://amll-ttml-db.stevexmh.net/ncm/{id}?format=ttml");
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().await.ok()?;
    if !text.contains("<tt") {
        return None;
    }
    ttml_to_lrc(&text).filter(|lyric| has_timed_lyric(lyric))
}

#[derive(Debug)]
struct QqCandidate {
    #[allow(dead_code)]
    id: i64,
    mid: String,
    name: String,
    artist: String,
    duration_ms: i64,
}

async fn search_qq_candidates(
    client: &Client,
    title: &str,
    artist: &str,
) -> Result<Vec<QqCandidate>, String> {
    let keyword = format!("{artist} {title}");
    let url = reqwest::Url::parse_with_params(
        "https://c.y.qq.com/soso/fcgi-bin/client_search_cp",
        &[
            ("w", keyword.as_str()),
            ("p", "1"),
            ("n", "8"),
            ("format", "json"),
            ("inCharset", "utf8"),
            ("outCharset", "utf-8"),
            ("notice", "0"),
            ("platform", "yqq.json"),
            ("needNewCode", "0"),
        ],
    )
    .map_err(|e| e.to_string())?;
    let data = client
        .get(url)
        .header(REFERER, "https://y.qq.com/")
        .header(ORIGIN, "https://y.qq.com")
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let items = data
        .pointer("/data/song/list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(items
        .iter()
        .filter_map(|item| {
            let mid = item.get("songmid").and_then(Value::as_str)?.to_string();
            let singers = item
                .get("singer")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            Some(QqCandidate {
                id: value_i64(item.get("songid")),
                mid,
                name: item
                    .get("songname")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                artist: singers,
                duration_ms: value_i64(item.get("interval")) * 1000,
            })
        })
        .collect())
}

fn qq_candidate_matches(candidate: &QqCandidate, title: &str, artist: &str, duration_ms: i64) -> bool {
    let target_title = normalize_match_text(title);
    let candidate_title = normalize_match_text(&candidate.name);
    if target_title.is_empty()
        || candidate_title.is_empty()
        || !(candidate_title.contains(&target_title) || target_title.contains(&candidate_title))
    {
        return false;
    }
    let target_artist = normalize_match_text(artist.split(',').next().unwrap_or(artist));
    let candidate_artist = normalize_match_text(&candidate.artist);
    if !target_artist.is_empty() && !candidate_artist.contains(&target_artist) {
        return false;
    }
    duration_ms <= 0
        || candidate.duration_ms <= 0
        || (candidate.duration_ms - duration_ms).abs() <= 10_000
}

/// Plain LRC via QQ public lyric endpoint (no QRC decrypt needed).
async fn fetch_qq_lrc(client: &Client, candidate: &QqCandidate) -> Option<String> {
    let url = reqwest::Url::parse_with_params(
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
        &[
            ("songmid", candidate.mid.as_str()),
            ("format", "json"),
            ("nobase64", "1"),
            ("g_tk", "5381"),
            ("loginUin", "0"),
            ("hostUin", "0"),
            ("inCharset", "utf8"),
            ("outCharset", "utf-8"),
            ("notice", "0"),
            ("platform", "yqq.json"),
            ("needNewCode", "0"),
        ],
    )
    .ok()?;
    let text = client
        .get(url)
        .header(REFERER, "https://y.qq.com/")
        .header(ORIGIN, "https://y.qq.com")
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;
    // Sometimes wrapped as MusicJsonCallback(...)
    let json_text = text
        .trim()
        .trim_start_matches("MusicJsonCallback(")
        .trim_end_matches(')')
        .trim()
        .to_string();
    let data: Value = serde_json::from_str(&json_text).ok()?;
    let lyric = data.get("lyric").and_then(Value::as_str)?;
    // May still be HTML-entity encoded
    let decoded = lyric
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">");
    if has_timed_lyric(&decoded) {
        Some(decoded)
    } else {
        None
    }
}

async fn fetch_fallback_lyric(
    client: &Client,
    id: i64,
    title: &str,
    artist: &str,
    duration_ms: i64,
) -> Option<FallbackLyric> {
    // 1) AMLL NetEase TTML
    if let Some(lyric) = fetch_amll_ncm_lrc(client, id).await {
        return Some(FallbackLyric {
            lyric,
            source: "amll:ncm",
        });
    }

    // 2) QQ Music plain LRC
    if let Ok(candidates) = search_qq_candidates(client, title, artist).await {
        for candidate in candidates {
            if !qq_candidate_matches(&candidate, title, artist, duration_ms) {
                continue;
            }
            if let Some(lyric) = fetch_qq_lrc(client, &candidate).await {
                return Some(FallbackLyric {
                    lyric,
                    source: "qq",
                });
            }
        }
    }

    // 3) Kugou
    if let Ok(candidates) = search_kugou_candidates(client, title, artist).await {
        for candidate in candidates {
            if !kugou_candidate_matches(&candidate, title, artist, duration_ms) {
                continue;
            }
            if let Some(lyric) = fetch_kugou_lrc(client, &candidate).await {
                return Some(FallbackLyric {
                    lyric,
                    source: "kugou",
                });
            }
        }
    }
    None
}

async fn song_detail(state: &NeteaseState, id: i64) -> Result<Value, String> {
    let detail = get_json(
        state,
        &format!("/api/song/detail?ids=%5B{id}%5D"),
        true,
    )
    .await?;
    Ok(detail
        .get("songs")
        .and_then(Value::as_array)
        .and_then(|songs| songs.first())
        .cloned()
        .unwrap_or(Value::Null))
}

async fn song_url_value(state: &NeteaseState, id: i64, br: i64) -> Result<Value, String> {
    let env = get_json(
        state,
        &format!("/api/song/enhance/player/url?id={id}&ids=%5B{id}%5D&br={br}"),
        true,
    )
    .await?;
    Ok(env
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .cloned()
        .unwrap_or_else(|| json!({ "id": id, "url": null })))
}

#[tauri::command]
async fn netease_qr_key(state: State<'_, NeteaseState>) -> Result<QrKey, String> {
    let (env, headers) = post_eapi_json(
        &state,
        "/api/login/qrcode/unikey",
        json!({ "type": 3 }),
    )
    .await?;
    if let Some(cookie) = merge_response_cookies(load_cookie(&state), &headers) {
        save_cookie(&state, &cookie)?;
    }
    let unikey = env
        .get("unikey")
        .and_then(Value::as_str)
        .ok_or_else(|| "网易云没有返回二维码 key".to_string())?
        .to_string();
    Ok(QrKey {
        url: format!("https://music.163.com/login?codekey={unikey}"),
        unikey,
    })
}

#[tauri::command]
async fn netease_qr_check(
    state: State<'_, NeteaseState>,
    unikey: String,
) -> Result<QrStatus, String> {
    let (env, headers) = post_eapi_json(
        &state,
        "/api/login/qrcode/client/login",
        json!({ "key": unikey, "type": 3 }),
    )
    .await?;
    let code = env.get("code").and_then(Value::as_i64).unwrap_or(0);
    let status = match code {
        800 => "expired",
        801 => "waiting",
        802 => "scanned",
        803 => "success",
        _ => "unknown",
    }
    .to_string();
    let mut saved = false;
    let header_cookie = merge_response_cookies(load_cookie(&state), &headers);
    if code == 803 {
        let body_cookie = env.get("cookie").and_then(Value::as_str);
        let cookie = body_cookie
            .and_then(|cookie| merge_cookie_string(header_cookie.clone(), cookie))
            .or(header_cookie);
        if let Some(cookie) = cookie {
            save_cookie(&state, &cookie)?;
            saved = cookie.contains("MUSIC_U=");
        }
    } else if let Some(cookie) = header_cookie {
        save_cookie(&state, &cookie)?;
    }
    Ok(QrStatus { code, status, saved })
}

async fn netease_login_status_inner(state: &NeteaseState) -> Result<LoginStatus, String> {
    let Some(cookie) = load_cookie(state) else {
        return Ok(LoginStatus {
            logged_in: false,
            nickname: None,
            vip_type: None,
            uid: None,
        });
    };
    if !cookie.contains("MUSIC_U=") {
        return Ok(LoginStatus {
            logged_in: false,
            nickname: None,
            vip_type: None,
            uid: None,
        });
    }
    let req = state
        .client
        .get(format!("{NETEASE_BASE}/api/nuser/account/get"))
        .headers(default_headers())
        .header("Cookie", cookie);
    let env = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let profile = env.get("profile").unwrap_or(&Value::Null);
    Ok(LoginStatus {
        logged_in: env.get("code").and_then(Value::as_i64) == Some(200) && !profile.is_null(),
        nickname: profile
            .get("nickname")
            .and_then(Value::as_str)
            .map(str::to_string),
        vip_type: profile.get("vipType").and_then(Value::as_i64),
        uid: profile.get("userId").and_then(Value::as_i64),
    })
}

#[tauri::command]
async fn netease_login_status(state: State<'_, NeteaseState>) -> Result<LoginStatus, String> {
    netease_login_status_inner(&state).await
}

#[tauri::command]
async fn netease_logout(state: State<'_, NeteaseState>) -> Result<(), String> {
    // Local only — remote /api/logout used to hang with no client timeout and freeze UI.
    clear_cookie(&state);
    Ok(())
}

fn netease_to_platform(st: LoginStatus) -> PlatformAuth {
    PlatformAuth {
        platform: "netease".into(),
        logged_in: st.logged_in,
        nickname: st.nickname,
        uid: st.uid.map(|u| u.to_string()),
        vip: st.vip_type.map(|v| v > 0),
    }
}

#[tauri::command]
async fn auth_status(state: State<'_, NeteaseState>) -> Result<MultiAuthStatus, String> {
    let netease = match netease_login_status_inner(&state).await {
        Ok(s) => netease_to_platform(s),
        Err(_) => PlatformAuth {
            platform: "netease".into(),
            logged_in: false,
            nickname: None,
            uid: None,
            vip: None,
        },
    };
    let qq = qq_platform_auth();
    let kugou = kugou_platform_auth();
    let any_logged_in = netease.logged_in || qq.logged_in || kugou.logged_in;
    Ok(MultiAuthStatus {
        any_logged_in,
        netease,
        qq,
        kugou,
    })
}

#[tauri::command]
async fn qq_auth_status() -> Result<PlatformAuth, String> {
    Ok(qq_platform_auth())
}

#[tauri::command]
async fn qq_logout(state: State<'_, QqLoginState>) -> Result<(), String> {
    // Drop in-flight QR session so a re-scan cannot resume the old pending jar.
    if let Ok(mut g) = state.pending.lock() {
        *g = None;
    }
    clear_qq_cookie();
    // Double-check: never leave a half-wiped file that still parses as logged-in.
    if load_qq_cookie().is_some() {
        clear_qq_cookie();
    }
    Ok(())
}

#[tauri::command]
async fn kugou_auth_status() -> Result<PlatformAuth, String> {
    Ok(kugou_platform_auth())
}

#[tauri::command]
async fn kugou_logout() -> Result<(), String> {
    clear_kugou_session();
    Ok(())
}

#[tauri::command]
async fn auth_logout_all(
    state: State<'_, NeteaseState>,
    qq_state: State<'_, QqLoginState>,
) -> Result<(), String> {
    // Local only — never block on remote revoke (was the main logout freeze).
    clear_cookie(&state);
    if let Ok(mut g) = qq_state.pending.lock() {
        *g = None;
    }
    clear_qq_cookie();
    clear_kugou_session();
    Ok(())
}

// ─── Shared QR login types ──────────────────────────────────────────────────

#[derive(Serialize)]
struct PlatformQrKey {
    /// opaque key for polling (qrsig / kugou qrcode / netease unikey)
    unikey: String,
    /// optional URL to encode as QR (kugou H5); empty when image_base64 is used
    url: String,
    /// data:image/png;base64,... when server returns the QR image (QQ / kugou)
    image_base64: Option<String>,
}

#[derive(Serialize)]
struct PlatformQrStatus {
    /// netease-compatible codes: 800 expired, 801 waiting, 802 scanned, 803 success
    code: i64,
    status: String,
    saved: bool,
    nickname: Option<String>,
}

#[derive(Deserialize)]
struct PlatformQrCheckArgs {
    unikey: String,
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// QQ Music login via ptlogin (graph OAuth session — reliable poll on many networks).
/// 1) xlogin (graph s_url + pt_3rd_aid) → pt_login_sig
/// 2) ptqrshow → qrsig + PNG
/// 3) ptqrlogin with same session (graph u1) — status: 66 wait / 67 scan / 0 ok
/// 4) follow check_sig, then best-effort y.qq.com cookie bootstrap
///
/// Note: poll with u1=y.qq.com often returns HTTP 403; graph u1 works and still
/// yields uin/p_skey/superkey after confirm. Playlist APIs need music cookies when available.

const QQ_APPID: &str = "716027609";
const QQ_DAID: &str = "383";
const QQ_PT_3RD_AID: &str = "100497308";
const QQ_GRAPH_URL: &str = "https://graph.qq.com/oauth2.0/login_jump";
const QQ_YQQ_URL: &str = "https://y.qq.com/";

#[derive(Clone, Default)]
struct QqLoginPending {
    cookies: BTreeMap<String, String>,
    qrsig: String,
    pt_login_sig: String,
}

struct QqLoginState {
    pending: Mutex<Option<QqLoginPending>>,
}

/// QQ ptlogin hash33 (JS int32 wrap) for ptqrtoken.
fn qq_hash33(qrsig: &str) -> u32 {
    // Match JS: hash += (hash << 5) + charCodeAt(i); return hash & 2147483647
    let mut e: i32 = 0;
    for b in qrsig.bytes() {
        e = e.wrapping_add(e.wrapping_shl(5).wrapping_add(b as i32));
    }
    (e & 0x7fff_ffff) as u32
}

fn extract_set_cookie_pairs(headers: &HeaderMap) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for val in headers.get_all(SET_COOKIE) {
        let Ok(s) = val.to_str() else { continue };
        let first = s.split(';').next().unwrap_or("").trim();
        if let Some((k, v)) = first.split_once('=') {
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() && !v.is_empty() {
                out.push((k.to_string(), v.to_string()));
            }
        }
    }
    out
}

fn merge_cookies_into(jar: &mut BTreeMap<String, String>, headers: &HeaderMap) {
    for (k, v) in extract_set_cookie_pairs(headers) {
        jar.insert(k, v);
    }
}

fn cookie_header(jar: &BTreeMap<String, String>) -> String {
    jar.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn parse_ptui_code(text: &str) -> Option<i64> {
    let start = text.find("ptuiCB(")?;
    let rest = &text[start + 7..];
    let rest = rest.trim_start_matches(['\'', '"']);
    let end = rest.find(['\'', '"'])?;
    rest[..end].parse().ok()
}

fn parse_ptui_url(text: &str) -> Option<String> {
    // third quoted field is jump URL on success
    let start = text.find("ptuiCB(")?;
    let mut rest = &text[start + 7..];
    for _ in 0..2 {
        let q = rest.find(['\'', '"'])?;
        rest = &rest[q + 1..];
        let q2 = rest.find(['\'', '"'])?;
        rest = &rest[q2 + 1..];
        if let Some(c) = rest.find(',') {
            rest = &rest[c + 1..];
        }
    }
    let rest = rest.trim_start();
    let quote = rest.chars().next()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let rest = &rest[1..];
    let end = rest.find(quote)?;
    let url = rest[..end].to_string();
    if url.starts_with("http") {
        Some(url)
    } else {
        None
    }
}

fn parse_ptui_nick(text: &str) -> Option<String> {
    // last quoted string is often nickname on success
    let re_parts: Vec<&str> = text.split('\'').collect();
    // ptuiCB('0','0','url','0','msg','nick')
    if re_parts.len() >= 12 {
        let nick = re_parts[re_parts.len() - 2].trim();
        if !nick.is_empty() && !nick.starts_with("http") && nick != "0" {
            return Some(nick.to_string());
        }
    }
    None
}

/// Extract `ptsigx` from ptlogin success jump URL (L-1124/QQMusicApi).
fn parse_ptsigx(jump_url: &str) -> Option<String> {
    for part in jump_url.split(['?', '&']) {
        if let Some(v) = part.strip_prefix("ptsigx=") {
            let v = v.split('&').next().unwrap_or(v).trim();
            if !v.is_empty() {
                return Some(urlencoding_decode(v));
            }
        }
    }
    None
}

/// Extract numeric uin from jump URL (`&uin=12345&` or `uin=o12345`).
fn parse_uin_from_url(jump_url: &str) -> Option<String> {
    for part in jump_url.split(['?', '&']) {
        if let Some(v) = part.strip_prefix("uin=") {
            let digits: String = v
                .trim_start_matches('o')
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if !digits.is_empty() {
                return Some(digits);
            }
        }
    }
    None
}

/// Complete QQ QR → music credential flow (ported from L-1124/QQMusicApi `_authorize_qq_qr`).
///
/// 1) check_sig with ptsigx → p_skey  
/// 2) graph oauth authorize (code)  
/// 3) QQConnectLogin.LoginServer/QQLogin(code) → musickey
async fn qq_authorize_from_ptsigx(uin: &str, ptsigx: &str) -> Result<BTreeMap<String, String>, String> {
    let client = Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    // 1) check_sig (empty cookie jar, as in upstream)
    let check_url = reqwest::Url::parse_with_params(
        "https://ssl.ptlogin2.graph.qq.com/check_sig",
        &[
            ("uin", uin),
            ("pttype", "1"),
            ("service", "ptqrlogin"),
            ("nodirect", "0"),
            ("ptsigx", ptsigx),
            ("s_url", QQ_GRAPH_URL),
            ("ptlang", "2052"),
            ("ptredirect", "100"),
            ("aid", QQ_APPID),
            ("daid", QQ_DAID),
            ("j_later", "0"),
            ("low_login_hour", "0"),
            ("regmaster", "0"),
            ("pt_login_type", "3"),
            ("pt_aid", "0"),
            ("pt_aaid", "16"),
            ("pt_light", "0"),
            ("pt_3rd_aid", QQ_PT_3RD_AID),
        ],
    )
    .map_err(|e| e.to_string())?;

    let resp = client
        .get(check_url)
        .header(USER_AGENT, UA)
        .header(REFERER, "https://xui.ptlogin2.qq.com/")
        .send()
        .await
        .map_err(|e| format!("QQ check_sig 失败: {e}"))?;
    let mut jar: BTreeMap<String, String> = BTreeMap::new();
    merge_cookies_into(&mut jar, resp.headers());
    let _ = resp.bytes().await;
    let p_skey = jar
        .get("p_skey")
        .cloned()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "QQ check_sig 未返回 p_skey".to_string())?;
    let gtk = {
        let mut h: i32 = 5381;
        for b in p_skey.bytes() {
            h = h.wrapping_add(h.wrapping_shl(5).wrapping_add(b as i32));
        }
        (h & 0x7fff_ffff) as u32
    };

    // 2) graph OAuth authorize → code in Location
    let form = [
        ("response_type", "code"),
        ("client_id", QQ_PT_3RD_AID),
        (
            "redirect_uri",
            "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
        ),
        ("scope", "get_user_info,get_app_friends"),
        ("state", "state"),
        ("switch", ""),
        ("from_ptlogin", "1"),
        ("src", "1"),
        ("update_auth", "1"),
        ("openapi", "1010_1030"),
        ("g_tk", &gtk.to_string()),
        ("auth_time", &timestamp_ms().to_string()),
        ("ui", &format!("{:x}", timestamp_ms())),
    ];
    let resp = client
        .post("https://graph.qq.com/oauth2.0/authorize")
        .header(USER_AGENT, UA)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(REFERER, "https://graph.qq.com/")
        .header("Cookie", cookie_header(&jar))
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("QQ authorize 失败: {e}"))?;
    merge_cookies_into(&mut jar, resp.headers());
    let loc = resp
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let _ = resp.bytes().await;
    let code = {
        let tokens = qq_parse_tokens_from_url(&loc);
        tokens
            .get("code")
            .cloned()
            .or_else(|| {
                loc.split("code=")
                    .nth(1)
                    .map(|s| s.split('&').next().unwrap_or("").to_string())
                    .filter(|s| !s.is_empty())
            })
            .ok_or_else(|| format!("QQ authorize 未拿到 code (loc={loc})"))?
    };

    // 3) Exchange code → musickey (tmeLoginType=2 for QQ)
    let body = json!({
        "comm": {
            "ct": 24,
            "cv": 4747474,
            "format": "json",
            "platform": "yqq.json",
            "needNewCode": 1,
            "tmeLoginType": 2
        },
        "req_0": {
            "module": "QQConnectLogin.LoginServer",
            "method": "QQLogin",
            "param": { "code": code }
        }
    });
    let client2 = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client2
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(CONTENT_TYPE, "application/json")
        .header(REFERER, QQ_YQQ_URL)
        .header(ORIGIN, "https://y.qq.com")
        .header("Cookie", cookie_header(&jar))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("QQLogin 失败: {e}"))?;
    merge_cookies_into(&mut jar, resp.headers());
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let data = v.pointer("/req_0/data").cloned().unwrap_or(Value::Null);
    let musickey = data
        .get("musickey")
        .or_else(|| data.get("musicKey"))
        .and_then(Value::as_str)
        .filter(|s| s.len() >= 8)
        .ok_or_else(|| {
            format!(
                "QQLogin 未返回 musickey: {}",
                v.to_string().chars().take(200).collect::<String>()
            )
        })?
        .to_string();
    let musicid = data
        .get("musicid")
        .and_then(|x| {
            x.as_i64()
                .map(|n| n.to_string())
                .or_else(|| x.as_str().map(|s| s.to_string()))
        })
        .or_else(|| data.get("str_musicid").and_then(Value::as_str).map(|s| s.to_string()))
        .unwrap_or_else(|| uin.to_string());

    jar.insert("qm_keyst".into(), musickey.clone());
    jar.insert("qqmusic_key".into(), musickey);
    jar.insert("uin".into(), format!("o{musicid}"));
    jar.insert("p_uin".into(), format!("o{musicid}"));
    jar.insert("login_type".into(), "2".into());
    if let Some(at) = data.get("access_token").and_then(Value::as_str) {
        if !at.is_empty() {
            jar.insert("psrf_qqaccess_token".into(), at.to_string());
        }
    }
    if let Some(oid) = data.get("openid").and_then(Value::as_str) {
        if !oid.is_empty() {
            jar.insert("psrf_qqopenid".into(), oid.to_string());
        }
    }
    eprintln!("[qq] authorize OK musicid={musicid} musickey_len={}", jar.get("qm_keyst").map(|s| s.len()).unwrap_or(0));
    Ok(jar)
}

fn classify_ptui(text: &str) -> (&'static str, i64) {
    // Prefer Chinese messages — code numbers have shifted across versions.
    if text.contains("登录成功") || parse_ptui_code(text) == Some(0) {
        if text.contains("ptuiCB('0'") || text.contains("ptuiCB(\"0\"") || text.contains("登录成功")
        {
            // ensure it's really success (has jump url or code 0)
            if parse_ptui_code(text) == Some(0) || text.contains("check_sig") {
                return ("success", 803);
            }
        }
    }
    if text.contains("已经失效") || text.contains("二维码已失效") || text.contains("已失效") {
        return ("expired", 800);
    }
    if text.contains("认证中") || text.contains("扫描成功") || text.contains("正在验证") {
        return ("scanned", 802);
    }
    if text.contains("未失效") || text.contains("尚未被扫描") {
        return ("waiting", 801);
    }
    match parse_ptui_code(text) {
        // Canonical: 65 expired, 66 waiting, 67 scanned, 0 success
        Some(0) => ("success", 803),
        Some(65) => ("expired", 800),
        Some(66) => ("waiting", 801),
        Some(67) => ("scanned", 802),
        Some(68) => ("expired", 800),
        _ => ("expired", 800),
    }
}

async fn follow_and_collect_cookies(
    start_url: &str,
    initial: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let client = Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;
    let mut url = start_url.to_string();
    let mut jar = initial.clone();
    for _ in 0..16 {
        let resp = client
            .get(&url)
            .header(USER_AGENT, UA)
            .header(REFERER, "https://xui.ptlogin2.qq.com/")
            .header("Cookie", cookie_header(&jar))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        merge_cookies_into(&mut jar, resp.headers());
        let status = resp.status();
        if status.is_redirection() {
            if let Some(loc) = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
            {
                // OAuth redirects may carry access_token in query/fragment
                for (k, v) in qq_parse_tokens_from_url(loc) {
                    if k == "access_token" {
                        jar.insert("access_token".into(), v.clone());
                        jar.insert("psrf_qqaccess_token".into(), v);
                    } else if k == "code" {
                        jar.insert("oauth_code".into(), v);
                    } else if k == "openid" {
                        jar.insert("openid".into(), v.clone());
                        jar.insert("psrf_qqopenid".into(), v);
                    }
                }
                if loc.starts_with("http") {
                    url = loc.to_string();
                } else if let Ok(base) = reqwest::Url::parse(&url) {
                    url = base
                        .join(loc)
                        .map(|u| u.to_string())
                        .unwrap_or_else(|_| loc.to_string());
                } else {
                    url = loc.to_string();
                }
                continue;
            }
        }
        let _ = resp.bytes().await;
        break;
    }
    Ok(jar)
}


/// Pull musickey-like fields from a musicu JSON body into the cookie jar.
fn qq_absorb_music_keys_from_json(jar: &mut BTreeMap<String, String>, v: &Value) {
    for path in [
        "/req_0/data/musickey",
        "/req_0/data/musicKey",
        "/req_0/data/key",
        "/req_0/data/sessionKey",
        "/req_1/data/musickey",
        "/req_1/data/musicKey",
        "/req_1/data/key",
        "/req_1/data/sessionKey",
    ] {
        if let Some(key) = v.pointer(path).and_then(Value::as_str) {
            let key = key.trim();
            if key.len() >= 8 {
                jar.insert("qqmusic_key".into(), key.to_string());
                jar.insert("qm_keyst".into(), key.to_string());
                return;
            }
        }
    }
    if let Some(at) = v
        .pointer("/req_0/data/access_token")
        .and_then(Value::as_str)
        .filter(|s| s.len() >= 8)
    {
        jar.insert("psrf_qqaccess_token".into(), at.to_string());
        jar.insert("access_token".into(), at.to_string());
    }
    if let Some(oid) = v
        .pointer("/req_0/data/openid")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
    {
        jar.insert("psrf_qqopenid".into(), oid.to_string());
        jar.insert("openid".into(), oid.to_string());
    }
}

fn qq_parse_tokens_from_url(url: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    let fragment = url.split('#').nth(1).unwrap_or("");
    let query = if fragment.is_empty() {
        url.split('?').nth(1).unwrap_or("")
    } else {
        fragment
    };
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            let k = k.trim();
            let v = urlencoding_decode(v.trim());
            if !k.is_empty() && !v.is_empty() {
                out.insert(k.to_string(), v);
            }
        }
    }
    out
}

fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hex = |c: u8| -> Option<u8> {
                    match c {
                        b'0'..=b'9' => Some(c - b'0'),
                        b'a'..=b'f' => Some(c - b'a' + 10),
                        b'A'..=b'F' => Some(c - b'A' + 10),
                        _ => None,
                    }
                };
                if let (Some(a), Some(b)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    out.push((a << 4) | b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn qq_normalize_music_aliases(jar: &mut BTreeMap<String, String>) {
    if !jar.contains_key("skey") {
        if let Some(ps) = jar.get("p_skey").cloned() {
            jar.insert("skey".into(), ps);
        }
    }
    if !jar.contains_key("uin") {
        if let Some(p) = jar.get("p_uin").cloned() {
            jar.insert("uin".into(), p);
        }
    }
    if !jar.contains_key("qqmusic_key") {
        if let Some(k) = jar.get("qm_keyst").cloned() {
            jar.insert("qqmusic_key".into(), k);
        }
    }
    if !jar.contains_key("qm_keyst") {
        if let Some(k) = jar.get("qqmusic_key").cloned() {
            jar.insert("qm_keyst".into(), k);
        }
    }
}

/// After QQ OAuth cookies, best-effort bootstrap y.qq.com music cookies (qm_keyst).
/// Without qm_keyst / qqmusic_key, GetVkey returns empty purl for nearly all tracks.
async fn enrich_qq_music_cookies(jar: &mut BTreeMap<String, String>) {
    let client = Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::none())
        .build();
    let Ok(client) = client else { return };

    let uin = jar
        .get("uin")
        .cloned()
        .or_else(|| jar.get("p_uin").cloned())
        .unwrap_or_default()
        .trim_start_matches('o')
        .to_string();
    let superkey = jar.get("superkey").cloned().unwrap_or_default();

    // 1) superkey jump → y.qq.com
    if !uin.is_empty() && !superkey.is_empty() {
        for keyindex in ["19", "9", "23"] {
            if let Ok(url) = reqwest::Url::parse_with_params(
                "https://ssl.ptlogin2.qq.com/jump",
                &[
                    ("clientuin", uin.as_str()),
                    ("clientkey", superkey.as_str()),
                    ("keyindex", keyindex),
                    ("pt_aid", QQ_APPID),
                    ("daid", QQ_DAID),
                    ("u1", QQ_YQQ_URL),
                    ("pt_3rd_aid", QQ_PT_3RD_AID),
                    ("ptopt", "1"),
                    ("style", "40"),
                ],
            ) {
                if let Ok(resp) = client
                    .get(url)
                    .header(USER_AGENT, UA)
                    .header(REFERER, "https://xui.ptlogin2.qq.com/")
                    .header("Cookie", cookie_header(jar))
                    .send()
                    .await
                {
                    merge_cookies_into(jar, resp.headers());
                    if let Some(loc) = resp
                        .headers()
                        .get(reqwest::header::LOCATION)
                        .and_then(|v| v.to_str().ok())
                        .map(|s| s.to_string())
                    {
                        for (k, v) in qq_parse_tokens_from_url(&loc) {
                            if k == "access_token" {
                                jar.insert("access_token".into(), v.clone());
                                jar.insert("psrf_qqaccess_token".into(), v);
                            } else if k == "code" {
                                jar.insert("oauth_code".into(), v);
                            } else if k == "openid" {
                                jar.insert("openid".into(), v.clone());
                                jar.insert("psrf_qqopenid".into(), v);
                            }
                        }
                        if let Ok(extra) = follow_and_collect_cookies(&loc, jar).await {
                            *jar = extra;
                        }
                    }
                }
            }
        }
    }

    // 2) Graph authorize (implicit token) with official redirect_uri
    let redirect =
        "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/";
    if let Ok(auth_url) = reqwest::Url::parse_with_params(
        "https://graph.qq.com/oauth2.0/authorize",
        &[
            ("response_type", "token"),
            ("client_id", QQ_PT_3RD_AID),
            ("redirect_uri", redirect),
            ("state", "state"),
            ("display", "pc"),
            ("scope", "get_user_info"),
        ],
    ) {
        let mut url = auth_url.to_string();
        for _ in 0..12 {
            let Ok(resp) = client
                .get(&url)
                .header(USER_AGENT, UA)
                .header(REFERER, QQ_YQQ_URL)
                .header("Cookie", cookie_header(jar))
                .send()
                .await
            else {
                break;
            };
            merge_cookies_into(jar, resp.headers());
            let status = resp.status();
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());
            let _ = resp.bytes().await;
            let Some(loc) = loc else {
                let _ = status;
                break;
            };
            let tokens = qq_parse_tokens_from_url(&loc);
            if let Some(at) = tokens.get("access_token").cloned() {
                jar.insert("access_token".into(), at.clone());
                jar.insert("psrf_qqaccess_token".into(), at);
            }
            if let Some(code) = tokens.get("code").cloned() {
                jar.insert("oauth_code".into(), code);
            }
            if let Some(oid) = tokens.get("openid").cloned() {
                jar.insert("openid".into(), oid.clone());
                jar.insert("psrf_qqopenid".into(), oid);
            }
            if tokens.contains_key("access_token") || tokens.contains_key("code") {
                break;
            }
            if loc.starts_with("http") {
                url = loc;
            } else if let Ok(base) = reqwest::Url::parse(&url) {
                url = base.join(&loc).map(|u| u.to_string()).unwrap_or(loc);
            } else {
                break;
            }
        }
    }

    // 3) Site pages that may Set-Cookie music session
    let client2 = Client::builder()
        .user_agent(UA)
        .redirect(reqwest::redirect::Policy::limited(8))
        .build();
    let Ok(client2) = client2 else {
        qq_normalize_music_aliases(jar);
        return;
    };
    for page in [
        QQ_YQQ_URL,
        "https://i.y.qq.com/n2/m/index.html",
        "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
        "https://y.qq.com/n/ryqq/profile",
    ] {
        if let Ok(resp) = client2
            .get(page)
            .header("Cookie", cookie_header(jar))
            .header(REFERER, QQ_YQQ_URL)
            .send()
            .await
        {
            merge_cookies_into(jar, resp.headers());
        }
    }

    if uin.is_empty() {
        qq_normalize_music_aliases(jar);
        return;
    }

    let gtk = qq_gtk_from_cookie(&cookie_header(jar));
    let access = jar
        .get("access_token")
        .cloned()
        .or_else(|| jar.get("psrf_qqaccess_token").cloned())
        .unwrap_or_default();
    let oauth_code = jar.get("oauth_code").cloned().unwrap_or_default();

    let mut login_param = json!({
        "expired_in": 7776000,
        "forceRefreshToken": 0,
        "onlyNeedAccessToken": 0,
    });
    if !access.is_empty() {
        login_param["access_token"] = json!(access);
    }
    if !oauth_code.is_empty() {
        login_param["code"] = json!(oauth_code);
    }
    if let Some(oid) = jar.get("openid").or_else(|| jar.get("psrf_qqopenid")) {
        login_param["openid"] = json!(oid);
    }

    let bodies = [
        json!({
            "comm": { "uin": uin, "format": "json", "ct": 24, "cv": 0, "g_tk": gtk, "platform": "yqq.json", "needNewCode": 1 },
            "req_0": { "module": "QQConnectLogin.LoginServer", "method": "QQLogin", "param": login_param }
        }),
        json!({
            "comm": { "uin": uin, "format": "json", "ct": 24, "cv": 0, "g_tk": gtk, "platform": "yqq.json", "needNewCode": 1 },
            "req_0": { "module": "QQConnectLogin.LoginServer", "method": "QQLogin", "param": {} }
        }),
        json!({
            "comm": { "uin": uin, "format": "json", "ct": 24, "cv": 0, "g_tk": gtk, "platform": "yqq.json", "needNewCode": 1 },
            "req_0": { "module": "music.login.LoginServer", "method": "Login", "param": { "strAppid": QQ_PT_3RD_AID } }
        }),
    ];

    for body in bodies {
        if qq_authst_from_cookie(&cookie_header(jar)).is_some() {
            break;
        }
        if let Ok(resp) = client2
            .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header(CONTENT_TYPE, "application/json")
            .header(REFERER, QQ_YQQ_URL)
            .header(ORIGIN, "https://y.qq.com")
            .header("Cookie", cookie_header(jar))
            .json(&body)
            .send()
            .await
        {
            merge_cookies_into(jar, resp.headers());
            if let Ok(v) = resp.json::<Value>().await {
                qq_absorb_music_keys_from_json(jar, &v);
            }
        }
    }

    let body2 = json!({
        "comm": { "uin": uin, "format": "json", "ct": 24, "cv": 0, "g_tk": gtk, "platform": "yqq.json", "needNewCode": 1 },
        "req_0": {
            "module": "userInfo.BaseUserInfoServer",
            "method": "get_user_baseinfo_v2",
            "param": { "vec_uin": [uin] }
        }
    });
    if let Ok(resp) = client2
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(CONTENT_TYPE, "application/json")
        .header(REFERER, QQ_YQQ_URL)
        .header(ORIGIN, "https://y.qq.com")
        .header("Cookie", cookie_header(jar))
        .json(&body2)
        .send()
        .await
    {
        merge_cookies_into(jar, resp.headers());
    }

    qq_normalize_music_aliases(jar);
    if qq_authst_from_cookie(&cookie_header(jar)).is_none() {
        eprintln!("[qq] enrich: still missing qm_keyst/qqmusic_key after bootstrap");
    } else {
        eprintln!("[qq] enrich: music key ready");
    }
}

#[tauri::command]
async fn qq_qr_key(state: State<'_, QqLoginState>) -> Result<PlatformQrKey, String> {
    // New QR always starts clean — drop any previous pending poll jar.
    if let Ok(mut g) = state.pending.lock() {
        *g = None;
    }
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let mut jar: BTreeMap<String, String> = BTreeMap::new();

    // 1) xlogin — graph OAuth style (poll is reliable with this session)
    let xlogin = format!(
        "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid={QQ_APPID}&daid={QQ_DAID}&style=33&login_text={}&hide_title_bar=1&hide_border=1&target=self&s_url={}&pt_3rd_aid={QQ_PT_3RD_AID}&pt_feedback_link={}",
        urlencoding_encode("授权并登录"),
        urlencoding_encode(QQ_GRAPH_URL),
        urlencoding_encode("https://support.qq.com/products/77942?customInfo=.appid100497308"),
    );
    let resp = client
        .get(&xlogin)
        .header(USER_AGENT, UA)
        .header(REFERER, "https://y.qq.com/")
        .send()
        .await
        .map_err(|e| format!("QQ xlogin 失败: {e}"))?;
    merge_cookies_into(&mut jar, resp.headers());
    let _ = resp.bytes().await;
    let pt_login_sig = jar
        .get("pt_login_sig")
        .cloned()
        .ok_or_else(|| "QQ xlogin 未返回 pt_login_sig".to_string())?;

    // 2) ptqrshow — never append u1= (403 on many networks)
    let t = format!("{}", (timestamp_ms() % 1_000_000) as f64 / 1_000_000.0);
    let show = format!(
        "https://ssl.ptlogin2.qq.com/ptqrshow?appid={QQ_APPID}&e=2&l=M&s=3&d=72&v=4&t={t}&daid={QQ_DAID}&pt_3rd_aid={QQ_PT_3RD_AID}"
    );
    let resp = client
        .get(&show)
        .header(USER_AGENT, UA)
        .header(REFERER, "https://xui.ptlogin2.qq.com/")
        .header("Cookie", cookie_header(&jar))
        .send()
        .await
        .map_err(|e| format!("QQ 二维码请求失败: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("QQ 二维码 HTTP {}", resp.status()));
    }
    merge_cookies_into(&mut jar, resp.headers());
    let qrsig = jar
        .get("qrsig")
        .cloned()
        .ok_or_else(|| "QQ 二维码未返回 qrsig".to_string())?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() < 100 {
        return Err("QQ 二维码图片为空".into());
    }

    // Persist pending session for poll
    {
        let mut guard = state
            .pending
            .lock()
            .map_err(|_| "QQ 登录状态锁失败".to_string())?;
        *guard = Some(QqLoginPending {
            cookies: jar,
            qrsig: qrsig.clone(),
            pt_login_sig,
        });
    }

    Ok(PlatformQrKey {
        unikey: qrsig,
        url: String::new(),
        image_base64: Some(format!("data:image/png;base64,{}", base64_encode(&bytes))),
    })
}

#[tauri::command]
async fn qq_qr_check(
    state: State<'_, QqLoginState>,
    args: PlatformQrCheckArgs,
) -> Result<PlatformQrStatus, String> {
    let unikey = args.unikey.trim().to_string();
    if unikey.is_empty() {
        return Err("missing qrsig".into());
    }

    let pending = {
        let guard = state
            .pending
            .lock()
            .map_err(|_| "QQ 登录状态锁失败".to_string())?;
        guard.clone()
    };
    let mut pending = pending.ok_or_else(|| "请先刷新 QQ 二维码".to_string())?;
    // Allow poll with returned unikey even if refresh race
    if pending.qrsig != unikey {
        pending.qrsig = unikey.clone();
        pending.cookies.insert("qrsig".into(), unikey.clone());
    }

    let ptqrtoken = qq_hash33(&pending.qrsig);
    let action_ts = timestamp_ms();
    // Graph u1 is the reliable poll target (y.qq.com u1 often HTTP 403).
    // Use query builder so login_sig special chars are encoded correctly.
    let poll_url = reqwest::Url::parse_with_params(
        "https://ssl.ptlogin2.qq.com/ptqrlogin",
        &[
            ("u1", QQ_GRAPH_URL),
            ("ptqrtoken", &ptqrtoken.to_string()),
            ("ptredirect", "0"),
            ("h", "1"),
            ("t", "1"),
            ("g", "1"),
            ("from_ui", "1"),
            ("ptlang", "2052"),
            ("action", &format!("0-0-{action_ts}")),
            ("js_ver", "25040111"),
            ("js_type", "1"),
            ("login_sig", &pending.pt_login_sig),
            ("pt_uistyle", "40"),
            ("aid", QQ_APPID),
            ("daid", QQ_DAID),
            ("pt_3rd_aid", QQ_PT_3RD_AID),
            ("has_onekey", "1"),
        ],
    )
    .map_err(|e| e.to_string())?;

    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(poll_url)
        .header(USER_AGENT, UA)
        .header(REFERER, "https://xui.ptlogin2.qq.com/")
        .header(ACCEPT, "*/*")
        .header("Cookie", cookie_header(&pending.cookies))
        .send()
        .await
        .map_err(|e| format!("QQ 扫码轮询失败: {e}"))?;
    if !resp.status().is_success() {
        // Keep pending so next tick can retry; don't clear session
        if let Ok(mut g) = state.pending.lock() {
            *g = Some(pending);
        }
        return Err(format!(
            "QQ 扫码轮询 HTTP {}（将自动重试）",
            resp.status()
        ));
    }
    merge_cookies_into(&mut pending.cookies, resp.headers());
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if text.is_empty() {
        if let Ok(mut g) = state.pending.lock() {
            *g = Some(pending);
        }
        return Err("QQ 扫码轮询返回空（将自动重试）".into());
    }

    let (status, code) = classify_ptui(&text);
    match status {
        "waiting" => {
            // keep pending
            if let Ok(mut g) = state.pending.lock() {
                *g = Some(pending);
            }
            Ok(PlatformQrStatus {
                code,
                status: "waiting".into(),
                saved: false,
                nickname: None,
            })
        }
        "scanned" => {
            if let Ok(mut g) = state.pending.lock() {
                *g = Some(pending);
            }
            Ok(PlatformQrStatus {
                code,
                status: "scanned".into(),
                saved: false,
                nickname: None,
            })
        }
        "expired" => {
            if let Ok(mut g) = state.pending.lock() {
                *g = None;
            }
            Ok(PlatformQrStatus {
                code,
                status: "expired".into(),
                saved: false,
                nickname: None,
            })
        }
        "success" => {
            let jump = parse_ptui_url(&text).unwrap_or_default();
            let nick = parse_ptui_nick(&text);
            // Wipe previous QQ session first so re-scan never merges with residue.
            clear_qq_cookie();

            // Official path (L-1124/QQMusicApi): ptsigx → check_sig → OAuth code → musickey
            let mut jar = pending.cookies;
            let mut got_music_key = false;
            if let (Some(sigx), Some(uin)) = (parse_ptsigx(&jump), parse_uin_from_url(&jump).or_else(|| {
                jar.get("uin")
                    .or_else(|| jar.get("p_uin"))
                    .map(|u| u.trim_start_matches('o').to_string())
                    .filter(|u| !u.is_empty() && u != "0")
            })) {
                match qq_authorize_from_ptsigx(&uin, &sigx).await {
                    Ok(auth_jar) => {
                        jar = auth_jar;
                        got_music_key = jar.contains_key("qm_keyst") || jar.contains_key("qqmusic_key");
                    }
                    Err(e) => {
                        eprintln!("[qq] authorize_from_ptsigx failed: {e}");
                        // Fallback: follow jump + enrich (may still lack musickey)
                        if !jump.is_empty() {
                            if let Ok(extra) = follow_and_collect_cookies(&jump, &jar).await {
                                jar = extra;
                            }
                        }
                        enrich_qq_music_cookies(&mut jar).await;
                        got_music_key =
                            jar.contains_key("qm_keyst") || jar.contains_key("qqmusic_key");
                    }
                }
            } else {
                eprintln!("[qq] success jump missing ptsigx/uin, jump={}", &jump[..jump.len().min(120)]);
                if !jump.is_empty() {
                    if let Ok(extra) = follow_and_collect_cookies(&jump, &jar).await {
                        jar = extra;
                    }
                }
                enrich_qq_music_cookies(&mut jar).await;
                got_music_key = jar.contains_key("qm_keyst") || jar.contains_key("qqmusic_key");
            }

            // Alias / normalize
            if !jar.contains_key("skey") {
                if let Some(ps) = jar.get("p_skey").cloned() {
                    jar.insert("skey".into(), ps);
                }
            }
            if !jar.contains_key("uin") {
                if let Some(p) = jar.get("p_uin").cloned() {
                    jar.insert("uin".into(), p);
                }
            }
            if !jar.contains_key("uin") && !jar.contains_key("p_uin") {
                if let Some(cap) = text.split("&uin=").nth(1) {
                    let u: String = cap.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if !u.is_empty() {
                        jar.insert("uin".into(), format!("o{u}"));
                        jar.insert("p_uin".into(), format!("o{u}"));
                    }
                }
            }
            qq_normalize_music_aliases(&mut jar);

            let cookie_str = cookie_header(&jar);
            let saved = if !cookie_str.is_empty() {
                match save_qq_cookie(&cookie_str) {
                    Ok(()) => {
                        eprintln!(
                            "[qq] scan saved cookie music_key={} len={}",
                            got_music_key,
                            cookie_str.len()
                        );
                        true
                    }
                    Err(e) => {
                        eprintln!("[qq] save cookie after scan failed: {e}");
                        false
                    }
                }
            } else {
                false
            };
            if let Ok(mut g) = state.pending.lock() {
                *g = None;
            }
            Ok(PlatformQrStatus {
                code: 803,
                status: "success".into(),
                saved,
                nickname: nick.or_else(|| qq_platform_auth().nickname),
            })
        }
        _ => Ok(PlatformQrStatus {
            code: 800,
            status: "expired".into(),
            saved: false,
            nickname: None,
        }),
    }
}

// ─── Kugou QR login ─────────────────────────────────────────────────────────

const KUGOU_WEB_SALT: &str = "NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt";
const KUGOU_APPID: &str = "1005";
const KUGOU_SRCAPPID: &str = "2919";
const KUGOU_CLIENTVER: &str = "20489";

fn kugou_signature_web(params: &BTreeMap<String, String>) -> String {
    let mut parts: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    parts.sort();
    let joined = parts.join("");
    format!(
        "{:x}",
        md5::compute(format!("{KUGOU_WEB_SALT}{joined}{KUGOU_WEB_SALT}"))
    )
}

fn kugou_web_params(extra: BTreeMap<String, String>) -> BTreeMap<String, String> {
    let clienttime = (timestamp_ms() / 1000).to_string();
    let mut params = BTreeMap::new();
    params.insert("dfid".into(), "-".into());
    params.insert("mid".into(), format!("{:x}", md5::compute(clienttime.as_bytes())));
    params.insert("uuid".into(), "-".into());
    params.insert("appid".into(), KUGOU_APPID.into());
    params.insert("clientver".into(), KUGOU_CLIENTVER.into());
    params.insert("clienttime".into(), clienttime);
    params.insert("srcappid".into(), KUGOU_SRCAPPID.into());
    for (k, v) in extra {
        params.insert(k, v);
    }
    let sig = kugou_signature_web(&params);
    params.insert("signature".into(), sig);
    params
}

fn map_to_query(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", urlencoding_encode(k), urlencoding_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

#[tauri::command]
async fn kugou_qr_key() -> Result<PlatformQrKey, String> {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let mut extra = BTreeMap::new();
    extra.insert("type".into(), "1".into());
    extra.insert("plat".into(), "4".into());
    extra.insert(
        "qrcode_txt".into(),
        format!("https://h5.kugou.com/apps/loginQRCode/html/index.html?appid={KUGOU_APPID}&"),
    );
    let params = kugou_web_params(extra);
    let url = format!(
        "https://login-user.kugou.com/v2/qrcode?{}",
        map_to_query(&params)
    );
    let data = client
        .get(url)
        .header(USER_AGENT, UA)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    if data.get("status").and_then(Value::as_i64) != Some(1)
        && data.get("error_code").and_then(Value::as_i64).unwrap_or(0) != 0
    {
        return Err(format!("酷狗二维码失败: {data}"));
    }
    let qrcode = data
        .pointer("/data/qrcode")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if qrcode.is_empty() {
        return Err("酷狗未返回 qrcode".into());
    }
    let image_base64 = data
        .pointer("/data/qrcode_img")
        .and_then(Value::as_str)
        .map(|s| s.to_string());
    let h5 = format!("https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode={qrcode}");
    Ok(PlatformQrKey {
        unikey: qrcode,
        url: h5,
        image_base64,
    })
}

#[tauri::command]
async fn kugou_qr_check(args: PlatformQrCheckArgs) -> Result<PlatformQrStatus, String> {
    let key = args.unikey.trim();
    if key.is_empty() {
        return Err("missing qrcode".into());
    }
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let mut extra = BTreeMap::new();
    extra.insert("plat".into(), "4".into());
    extra.insert("qrcode".into(), key.to_string());
    let params = kugou_web_params(extra);
    let url = format!(
        "https://login-user.kugou.com/v2/get_userinfo_qrcode?{}",
        map_to_query(&params)
    );
    let data = client
        .get(url)
        .header(USER_AGENT, UA)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let status = data
        .pointer("/data/status")
        .and_then(Value::as_i64)
        .or_else(|| data.get("status").and_then(Value::as_i64))
        .unwrap_or(0);
    // 0 expired, 1 waiting, 2 scanned, 4 success
    match status {
        4 => {
            let token = data
                .pointer("/data/token")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let userid = data
                .pointer("/data/userid")
                .map(|v| match v {
                    Value::String(s) => s.clone(),
                    Value::Number(n) => n.to_string(),
                    _ => String::new(),
                })
                .unwrap_or_default();
            let nickname = data
                .pointer("/data/nickname")
                .or_else(|| data.pointer("/data/user_name"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if token.is_empty() {
                return Err("扫码成功但未返回 token".into());
            }
            let cookie = format!("token={token}; userid={userid}");
            save_kugou_session(&KugouSession {
                token,
                userid,
                cookie,
                nickname: nickname.clone(),
            })?;
            Ok(PlatformQrStatus {
                code: 803,
                status: "success".into(),
                saved: true,
                nickname: if nickname.is_empty() {
                    None
                } else {
                    Some(nickname)
                },
            })
        }
        2 => Ok(PlatformQrStatus {
            code: 802,
            status: "scanned".into(),
            saved: false,
            nickname: None,
        }),
        1 => Ok(PlatformQrStatus {
            code: 801,
            status: "waiting".into(),
            saved: false,
            nickname: None,
        }),
        _ => Ok(PlatformQrStatus {
            code: 800,
            status: "expired".into(),
            saved: false,
            nickname: None,
        }),
    }
}

// ─── QQ Music playlists ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct QqPlaylistPageArgs {
    /// diss tid / disstid
    disstid: i64,
    page: Option<u32>,
    pagesize: Option<u32>,
}

fn map_qq_song_item(item: &Value) -> Option<Value> {
    let mid = item
        .get("mid")
        .or_else(|| item.get("songmid"))
        .and_then(Value::as_str)?
        .to_string();
    let id = value_i64(item.get("id").or_else(|| item.get("songid")));
    let name = item
        .get("title")
        .or_else(|| item.get("name"))
        .or_else(|| item.get("songname"))
        .and_then(Value::as_str)
        .unwrap_or("未知歌曲");
    let artists = item
        .get("singer")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    s.get("title")
                        .or_else(|| s.get("name"))
                        .and_then(Value::as_str)
                })
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .or_else(|| {
            item.get("singername")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "未知歌手".into());
    let album = item
        .pointer("/album/title")
        .or_else(|| item.pointer("/album/name"))
        .or_else(|| item.get("albumname"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let albummid = item
        .pointer("/album/mid")
        .or_else(|| item.pointer("/album/pmid"))
        .or_else(|| item.get("albummid"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let pic = if albummid.is_empty() {
        Value::Null
    } else {
        // pmid sometimes ends with _2 — strip for cover URL
        let mid_clean = albummid.split('_').next().unwrap_or(albummid);
        Value::String(format!(
            "https://y.gtimg.cn/music/photo_new/T002R300x300M000{mid_clean}.jpg"
        ))
    };
    let interval = value_i64(item.get("interval").or_else(|| item.get("duration")));
    let duration_ms = if interval > 10_000 {
        interval
    } else {
        interval * 1000
    };
    let media = item
        .pointer("/file/media_mid")
        .or_else(|| item.get("strMediaMid"))
        .or_else(|| item.get("media_mid"))
        .and_then(Value::as_str)
        .unwrap_or(&mid);
    Some(json!({
        "id": if id > 0 { id } else { mid.chars().take(8).fold(0u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32)) as i64 },
        "name": name,
        "artist": artists,
        "album": album,
        "pic": pic,
        "duration": duration_ms,
        "source": "qq",
        "qqMid": mid,
        "qqMediaMid": media,
        "albumId": albummid,
    }))
}

#[tauri::command]
async fn qq_user_playlists() -> Result<Value, String> {
    let cookie = load_qq_cookie().ok_or_else(|| "请先扫码登录 QQ 音乐".to_string())?;
    let uin = qq_uin_digits(&cookie);
    if uin == "0" || uin.is_empty() {
        return Err("QQ Cookie 缺少 uin，请重新扫码登录".into());
    }
    let gtk = qq_gtk_from_cookie(&cookie);
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;

    // Verified working API (with skey/p_skey + g_tk):
    // music.musicasset.PlaylistBaseRead / GetPlaylistByUin → data.v_playlist
    let body = json!({
        "comm": {
            "g_tk": gtk,
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "platform": "yqq.json"
        },
        "req_1": {
            "module": "music.musicasset.PlaylistBaseRead",
            "method": "GetPlaylistByUin",
            "param": {
                "uin": uin,
                "offset": 0,
                "limit": 100
            }
        }
    });
    let data = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, UA)
        .header(REFERER, "https://y.qq.com/")
        .header(ORIGIN, "https://y.qq.com")
        .header("Cookie", &cookie)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;

    let req_code = data
        .pointer("/req_1/code")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if req_code != 0 {
        return Err(format!(
            "QQ 歌单接口失败 code={req_code}（请重新扫码登录） raw={}",
            data.to_string().chars().take(200).collect::<String>()
        ));
    }

    let items = data
        .pointer("/req_1/data/v_playlist")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let playlists: Vec<Value> = items
        .iter()
        .filter_map(|item| {
            // tid is the diss id used by song-list APIs; dirId is local folder id
            let tid = value_i64(item.get("tid").or_else(|| item.get("disstid")));
            if tid <= 0 {
                return None;
            }
            let name = item
                .get("dirName")
                .or_else(|| item.get("diss_name"))
                .or_else(|| item.get("title"))
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("未命名歌单");
            let count = value_i64(
                item.get("songNum")
                    .or_else(|| item.get("song_cnt"))
                    .or_else(|| item.get("songnum")),
            );
            let pic = item
                .get("picUrl")
                .or_else(|| item.get("bigpic"))
                .or_else(|| item.get("logo"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .replace("http://", "https://");
            Some(json!({
                "id": tid,
                "name": name,
                "coverImgUrl": if pic.is_empty() { Value::Null } else { Value::String(pic) },
                "trackCount": count,
                "playCount": 0,
                "createTime": value_i64(item.get("createTime")),
                "updateTime": value_i64(item.get("updateTime")),
                "subscribed": false,
                "creatorUid": uin.parse::<i64>().unwrap_or(0),
                "creatorName": format!("QQ {uin}"),
                "createdByAccount": true,
                "source": "qq",
                "qqDissTid": tid,
            }))
        })
        .collect();

    if playlists.is_empty() {
        return Err(format!(
            "QQ 歌单为空（共 0 个）。请确认账号下有自建/喜欢歌单。debug={}",
            data.to_string().chars().take(180).collect::<String>()
        ));
    }

    Ok(json!({ "data": { "playlists": playlists } }))
}

#[tauri::command]
async fn qq_playlist_page(args: QqPlaylistPageArgs) -> Result<Value, String> {
    let cookie = load_qq_cookie().ok_or_else(|| "请先扫码登录 QQ 音乐".to_string())?;
    let uin = qq_uin_digits(&cookie);
    let gtk = qq_gtk_from_cookie(&cookie);
    let page = args.page.unwrap_or(1).max(1);
    let pagesize = args.pagesize.unwrap_or(50).clamp(1, 100);
    let disstid = args.disstid;
    if disstid <= 0 {
        return Err("无效的 QQ 歌单 ID".into());
    }
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;

    let song_begin = (page - 1) * pagesize;

    // Primary: musicu DissInfo (works with skey + g_tk)
    let body = json!({
        "comm": {
            "g_tk": gtk,
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "platform": "yqq.json"
        },
        "req_1": {
            "module": "music.srfDissInfo.aiDissInfo",
            "method": "uniform_get_Dissinfo",
            "param": {
                "disstid": disstid,
                "userinfo": 1,
                "tag": 1,
                "orderlist": 1,
                "song_begin": song_begin,
                "song_num": pagesize
            }
        }
    });
    let data = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(CONTENT_TYPE, "application/json")
        .header(USER_AGENT, UA)
        .header(REFERER, "https://y.qq.com/")
        .header(ORIGIN, "https://y.qq.com")
        .header("Cookie", &cookie)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;

    let mut songs: Vec<Value> = data
        .pointer("/req_1/data/songlist")
        .or_else(|| data.pointer("/req_1/data/songList"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(map_qq_song_item).collect())
        .unwrap_or_default();

    let mut total = data
        .pointer("/req_1/data/total_song_num")
        .or_else(|| data.pointer("/req_1/data/songnum"))
        .and_then(Value::as_i64)
        .unwrap_or(songs.len() as i64);

    // Fallback classic CGI
    if songs.is_empty() {
        let url = format!(
            "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid={disstid}&g_tk={gtk}&loginUin={uin}&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&song_begin={song_begin}&song_num={pagesize}"
        );
        let cgi = client
            .get(&url)
            .header(USER_AGENT, UA)
            .header(REFERER, "https://y.qq.com/")
            .header("Cookie", &cookie)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json::<Value>()
            .await
            .map_err(|e| e.to_string())?;
        songs = cgi
            .pointer("/cdlist/0/songlist")
            .or_else(|| cgi.pointer("/cdlist/0/songList"))
            .and_then(Value::as_array)
            .map(|arr| arr.iter().filter_map(map_qq_song_item).collect())
            .unwrap_or_default();
        total = cgi
            .pointer("/cdlist/0/songnum")
            .or_else(|| cgi.pointer("/cdlist/0/total_song_num"))
            .and_then(Value::as_i64)
            .unwrap_or(songs.len() as i64);
    }

    if songs.is_empty() {
        return Err(format!(
            "QQ 歌单歌曲为空（tid={disstid}）。请重试或换一个歌单。debug={}",
            data.to_string().chars().take(200).collect::<String>()
        ));
    }

    Ok(json!({
        "data": {
            "playlist": {
                "tracks": songs,
                "trackTotal": total.max(songs.len() as i64),
                "trackOffset": song_begin,
                "trackLimit": pagesize
            }
        }
    }))
}

// ─── Kugou playlists (android-signed gateway) ───────────────────────────────

const KUGOU_ANDROID_SALT: &str = "OIlwieks28dk2k092lksi2UIkp";

fn kugou_signature_android(params: &BTreeMap<String, String>, body: &str) -> String {
    let mut parts: Vec<String> = params
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect();
    parts.sort();
    let joined = parts.join("");
    format!(
        "{:x}",
        md5::compute(format!("{KUGOU_ANDROID_SALT}{joined}{body}{KUGOU_ANDROID_SALT}"))
    )
}

fn kugou_android_base_params(session: &KugouSession) -> BTreeMap<String, String> {
    let clienttime = (timestamp_ms() / 1000).to_string();
    let mut params = BTreeMap::new();
    params.insert("dfid".into(), "-".into());
    params.insert(
        "mid".into(),
        format!("{:x}", md5::compute(clienttime.as_bytes())),
    );
    params.insert("uuid".into(), "-".into());
    params.insert("appid".into(), KUGOU_APPID.into());
    params.insert("clientver".into(), KUGOU_CLIENTVER.into());
    params.insert("clienttime".into(), clienttime);
    if !session.token.is_empty() {
        params.insert("token".into(), session.token.clone());
    }
    if !session.userid.is_empty() {
        params.insert("userid".into(), session.userid.clone());
    }
    params
}

async fn kugou_gateway_json(
    method: &str,
    path: &str,
    x_router: &str,
    mut params: BTreeMap<String, String>,
    body: Option<Value>,
    session: &KugouSession,
) -> Result<Value, String> {
    let client = Client::builder()
        .user_agent("Android14-1070-11070-201-0-Play-wifi")
        .build()
        .map_err(|e| e.to_string())?;
    let body_str = body
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_default();
    let sig = kugou_signature_android(&params, &body_str);
    params.insert("signature".into(), sig);
    let url = format!(
        "https://gateway.kugou.com{path}?{}",
        map_to_query(&params)
    );
    let mut req = match method {
        "POST" | "post" => client.post(&url),
        _ => client.get(&url),
    };
    req = req
        .header(USER_AGENT, "Android14-1070-11070-201-0-Play-wifi")
        .header("kg-rc", "1")
        .header("x-router", x_router)
        .header("mid", params.get("mid").cloned().unwrap_or_default())
        .header("dfid", "-")
        .header(
            "clienttime",
            params.get("clienttime").cloned().unwrap_or_default(),
        );
    if !session.cookie.is_empty() {
        req = req.header("Cookie", session.cookie.as_str());
    } else if !session.token.is_empty() {
        req = req.header(
            "Cookie",
            format!("token={}; userid={}", session.token, session.userid),
        );
    }
    if let Some(b) = body {
        req = req
            .header(CONTENT_TYPE, "application/json")
            .body(b.to_string());
    }
    let data = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    Ok(data)
}

#[derive(Deserialize)]
struct KugouPlaylistPageArgs {
    listid: i64,
    global_collection_id: Option<String>,
    page: Option<u32>,
    pagesize: Option<u32>,
}

#[tauri::command]
async fn kugou_user_playlists() -> Result<Value, String> {
    let session = load_kugou_session().ok_or_else(|| "请先扫码登录酷狗".to_string())?;
    if session.token.is_empty() || session.userid.is_empty() {
        return Err("酷狗会话不完整，请重新扫码登录".into());
    }
    let params = kugou_android_base_params(&session);
    let mut params = params;
    params.insert("plat".into(), "1".into());
    let body = json!({
        "userid": session.userid.parse::<i64>().unwrap_or(0),
        "token": session.token,
        "total_ver": 979,
        "type": 2,
        "page": 1,
        "pagesize": 100,
    });
    let data = kugou_gateway_json(
        "POST",
        "/v7/get_all_list",
        "cloudlist.service.kugou.com",
        params,
        Some(body),
        &session,
    )
    .await?;
    // Response shapes vary: data.info / data.lists / data.list_info
    let items = data
        .pointer("/data/info")
        .or_else(|| data.pointer("/data/lists"))
        .or_else(|| data.pointer("/data/list_info"))
        .or_else(|| data.pointer("/data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let playlists: Vec<Value> = items
        .iter()
        .filter_map(|item| {
            let listid = value_i64(
                item.get("listid")
                    .or_else(|| item.get("listId"))
                    .or_else(|| item.get("id")),
            );
            let global = item
                .get("global_collection_id")
                .or_else(|| item.get("globalCollectionId"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if listid <= 0 && global.is_empty() {
                return None;
            }
            let name = item
                .get("name")
                .or_else(|| item.get("list_name"))
                .and_then(Value::as_str)
                .unwrap_or("未命名歌单");
            let count = value_i64(
                item.get("count")
                    .or_else(|| item.get("song_count"))
                    .or_else(|| item.get("songCount")),
            );
            let pic = item
                .get("pic")
                .or_else(|| item.get("list_pic"))
                .or_else(|| item.get("cover"))
                .or_else(|| item.get("flexible_cover"))
                .and_then(Value::as_str)
                .map(|s| s.replace("{size}", "400"))
                .unwrap_or_default();
            let id = if listid > 0 {
                listid
            } else {
                // stable synthetic id from global collection id
                (global.chars().take(12).fold(0u32, |a, c| {
                    a.wrapping_mul(31).wrapping_add(c as u32)
                })) as i64
            };
            Some(json!({
                "id": id,
                "name": name,
                "coverImgUrl": if pic.is_empty() { Value::Null } else { Value::String(pic) },
                "trackCount": count,
                "playCount": 0,
                "createTime": 0,
                "updateTime": 0,
                "subscribed": false,
                "creatorUid": session.userid.parse::<i64>().unwrap_or(0),
                "creatorName": session.nickname.clone(),
                "createdByAccount": true,
                "source": "kugou",
                "kgListId": listid,
                "kgGlobalId": global,
            }))
        })
        .collect();
    Ok(json!({ "data": { "playlists": playlists } }))
}

fn kugou_api_ok(data: &Value) -> bool {
    // status==1 is success; error_code==0 also ok; missing status treat as try-parse
    if let Some(s) = data.get("status").and_then(Value::as_i64) {
        return s == 1;
    }
    if let Some(c) = data.get("error_code").and_then(Value::as_i64) {
        return c == 0;
    }
    true
}

fn kugou_song_array<'a>(data: &'a Value) -> Option<&'a Vec<Value>> {
    const PATHS: &[&str] = &[
        "/data/info",
        "/data/songs",
        "/data/list",
        "/data/song_list",
        "/data/files",
        "/data/data",
        "/info",
        "/songs",
    ];
    for p in PATHS {
        if let Some(arr) = data.pointer(p).and_then(Value::as_array) {
            if !arr.is_empty() {
                return Some(arr);
            }
        }
    }
    // last resort: data itself is array
    data.get("data").and_then(Value::as_array).filter(|a| !a.is_empty())
}

fn kugou_pick_hash(item: &Value) -> Option<String> {
    const KEYS: &[&str] = &[
        "hash",
        "FileHash",
        "hash_128",
        "hash_320",
        "hqhash",
        "HQFileHash",
        "sqhash",
        "SQFileHash",
        "filehash",
    ];
    for k in KEYS {
        if let Some(h) = item.get(*k).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
            return Some(h.to_string());
        }
    }
    if let Some(h) = item
        .pointer("/audio_info/hash")
        .or_else(|| item.pointer("/relate_goods/0/hash"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return Some(h.to_string());
    }
    None
}

fn map_kugou_playlist_songs(data: &Value) -> Vec<Value> {
    let Some(items) = kugou_song_array(data) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            // skip non-object rows
            if !item.is_object() {
                return None;
            }
            let hash = kugou_pick_hash(item)?;
            let raw_name = item
                .get("name")
                .or_else(|| item.get("songname"))
                .or_else(|| item.get("song_name"))
                .or_else(|| item.get("filename"))
                .or_else(|| item.get("fileName"))
                .and_then(Value::as_str)
                .unwrap_or("未知歌曲");
            let (artist, title) = if let Some((a, t)) = raw_name.split_once(" - ") {
                (a.trim().to_string(), t.trim().to_string())
            } else if let Some((a, t)) = raw_name.split_once('-') {
                // some use "artist-song" without spaces
                if a.len() < 40 && t.len() > 0 {
                    (a.trim().to_string(), t.trim().to_string())
                } else {
                    let ar = item
                        .get("author_name")
                        .or_else(|| item.get("singername"))
                        .or_else(|| item.get("singer_name"))
                        .or_else(|| item.get("authors"))
                        .and_then(|v| {
                            if let Some(s) = v.as_str() {
                                Some(s.to_string())
                            } else if let Some(arr) = v.as_array() {
                                Some(
                                    arr.iter()
                                        .filter_map(|x| x.get("author_name").or_else(|| x.get("name")).and_then(Value::as_str))
                                        .collect::<Vec<_>>()
                                        .join(" / "),
                                )
                            } else {
                                None
                            }
                        })
                        .unwrap_or_else(|| "未知歌手".into());
                    (ar, raw_name.to_string())
                }
            } else {
                let ar = item
                    .get("author_name")
                    .or_else(|| item.get("singername"))
                    .or_else(|| item.get("singer_name"))
                    .and_then(Value::as_str)
                    .unwrap_or("未知歌手")
                    .to_string();
                (ar, raw_name.to_string())
            };
            let album = item
                .get("album_name")
                .or_else(|| item.get("albumname"))
                .or_else(|| item.get("remark"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let duration = value_i64(
                item.get("duration")
                    .or_else(|| item.get("time_length"))
                    .or_else(|| item.get("timelen"))
                    .or_else(|| item.get("timeLength")),
            );
            let duration_ms = if duration > 10_000 {
                duration
            } else {
                duration * 1000
            };
            let pic = item
                .get("cover")
                .or_else(|| item.get("album_sizable_cover"))
                .or_else(|| item.get("imgUrl"))
                .or_else(|| item.get("trans_param").and_then(|t| t.get("union_cover")))
                .and_then(Value::as_str)
                .map(|s| s.replace("{size}", "400"))
                .unwrap_or_default();
            let hq = item
                .get("hqhash")
                .or_else(|| item.get("HQFileHash"))
                .or_else(|| item.get("hash_320"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            let sq = item
                .get("sqhash")
                .or_else(|| item.get("SQFileHash"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty());
            let id = value_i64(
                item.get("album_audio_id")
                    .or_else(|| item.get("audio_id"))
                    .or_else(|| item.get("mixId"))
                    .or_else(|| item.get("id")),
            );
            let album_id = item
                .get("album_id")
                .or_else(|| item.get("albumid"))
                .or_else(|| item.get("AlbumID"))
                .map(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                        .unwrap_or_default()
                })
                .filter(|s| !s.is_empty());
            Some(json!({
                "id": if id > 0 { id } else { (hash.chars().take(8).fold(0u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32))) as i64 },
                "name": title,
                "artist": artist,
                "album": album,
                "pic": if pic.is_empty() { Value::Null } else { Value::String(pic) },
                "duration": duration_ms,
                "source": "kugou",
                "kgHash": hash,
                "kgHqHash": hq,
                "kgSqHash": sq,
                "albumId": album_id,
            }))
        })
        .collect()
}

fn playlist_page_payload(songs: Vec<Value>, total: i64, page: u32, pagesize: u32) -> Value {
    json!({
        "data": {
            "playlist": {
                "tracks": songs,
                "trackTotal": total,
                "trackOffset": (page - 1) * pagesize,
                "trackLimit": pagesize
            }
        }
    })
}

async fn kugou_fetch_listid_songs(
    session: &KugouSession,
    listid: i64,
    page: u32,
    pagesize: u32,
) -> Result<(Vec<Value>, i64, Value), String> {
    let userid_num = session.userid.parse::<i64>().unwrap_or(0);
    // Try type=0 (owned) then type=1 (collected) — both appear in real clients.
    let mut last_data = Value::Null;
    for list_type in [0, 1, 2] {
        let mut params = kugou_android_base_params(session);
        params.insert("plat".into(), "1".into());
        let body = json!({
            "listid": listid,
            "userid": userid_num,
            "area_code": 1,
            "show_relate_goods": 0,
            "pagesize": pagesize,
            "allplatform": 1,
            "show_cover": 1,
            "type": list_type,
            "token": session.token,
            "page": page,
        });
        let data = kugou_gateway_json(
            "POST",
            "/v4/get_list_all_file",
            "cloudlist.service.kugou.com",
            params,
            Some(body),
            session,
        )
        .await?;
        last_data = data.clone();
        let songs = map_kugou_playlist_songs(&data);
        if !songs.is_empty() {
            let total = data
                .pointer("/data/count")
                .or_else(|| data.pointer("/data/list_count"))
                .or_else(|| data.pointer("/data/total"))
                .and_then(Value::as_i64)
                .unwrap_or(songs.len() as i64);
            return Ok((songs, total, data));
        }
    }
    let songs = map_kugou_playlist_songs(&last_data);
    let total = last_data
        .pointer("/data/count")
        .or_else(|| last_data.pointer("/data/list_count"))
        .or_else(|| last_data.pointer("/data/total"))
        .and_then(Value::as_i64)
        .unwrap_or(songs.len() as i64);
    Ok((songs, total, last_data))
}

async fn kugou_fetch_global_songs(
    session: &KugouSession,
    gid: &str,
    page: u32,
    pagesize: u32,
) -> Result<(Vec<Value>, i64, Value), String> {
    let mut params = kugou_android_base_params(session);
    params.insert("area_code".into(), "1".into());
    params.insert("begin_idx".into(), ((page - 1) * pagesize).to_string());
    params.insert("plat".into(), "1".into());
    params.insert("type".into(), "1".into());
    params.insert("mode".into(), "1".into());
    params.insert("pagesize".into(), pagesize.to_string());
    params.insert("global_collection_id".into(), gid.to_string());
    let data = kugou_gateway_json(
        "GET",
        "/pubsongs/v2/get_other_list_file_nofilt",
        "pubsongscdn.kugou.com",
        params,
        None,
        session,
    )
    .await?;
    let songs = map_kugou_playlist_songs(&data);
    let total = data
        .pointer("/data/count")
        .or_else(|| data.pointer("/data/total"))
        .and_then(Value::as_i64)
        .unwrap_or(songs.len() as i64);
    Ok((songs, total, data))
}

#[tauri::command]
async fn kugou_playlist_page(args: KugouPlaylistPageArgs) -> Result<Value, String> {
    let session = load_kugou_session().ok_or_else(|| "请先扫码登录酷狗".to_string())?;
    let page = args.page.unwrap_or(1).max(1);
    let pagesize = args.pagesize.unwrap_or(50).clamp(1, 100);
    let gid = args
        .global_collection_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let mut last_err = String::new();
    let mut last_raw = Value::Null;

    // 1) Owned playlist via listid (most reliable when logged in)
    if args.listid > 0 {
        match kugou_fetch_listid_songs(&session, args.listid, page, pagesize).await {
            Ok((songs, total, raw)) if !songs.is_empty() || kugou_api_ok(&raw) => {
                if !songs.is_empty() {
                    return Ok(playlist_page_payload(songs, total.max(0), page, pagesize));
                }
                last_raw = raw;
                last_err = "listid 接口返回空歌曲".into();
            }
            Ok((_, _, raw)) => {
                last_raw = raw.clone();
                last_err = format!("listid 接口异常: {}", raw.get("error_msg").or_else(|| raw.get("errmsg")).and_then(Value::as_str).unwrap_or("unknown"));
            }
            Err(e) => last_err = e,
        }
    }

    // 2) Public/global collection id
    if let Some(ref g) = gid {
        match kugou_fetch_global_songs(&session, g, page, pagesize).await {
            Ok((songs, total, _raw)) if !songs.is_empty() => {
                return Ok(playlist_page_payload(songs, total.max(0), page, pagesize));
            }
            Ok((_, _, raw)) => {
                last_raw = raw;
                last_err = "global_collection 接口返回空歌曲".into();
            }
            Err(e) => last_err = e,
        }
    }

    // 3) Alternate mobile endpoint for collection id
    if let Some(ref g) = gid {
        let client = Client::builder()
            .user_agent(UA)
            .build()
            .map_err(|e| e.to_string())?;
        let url = reqwest::Url::parse_with_params(
            "https://mobileservice.kugou.com/api/v5/special/song",
            &[
                ("specialid", "0"),
                ("global_specialid", g.as_str()),
                ("page", &page.to_string()),
                ("pagesize", &pagesize.to_string()),
                ("area_code", "1"),
            ],
        )
        .map_err(|e| e.to_string())?;
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(data) = resp.json::<Value>().await {
                let songs = map_kugou_playlist_songs(&data);
                if !songs.is_empty() {
                    let total = data
                        .pointer("/data/total")
                        .or_else(|| data.pointer("/data/count"))
                        .and_then(Value::as_i64)
                        .unwrap_or(songs.len() as i64);
                    return Ok(playlist_page_payload(songs, total, page, pagesize));
                }
                last_raw = data;
            }
        }
    }

    Err(format!(
        "无法加载酷狗歌单歌曲（listid={} gid={:?}）：{last_err} raw={}",
        args.listid,
        gid,
        last_raw.to_string().chars().take(280).collect::<String>()
    ))
}

#[tauri::command]
async fn netease_search(state: State<'_, NeteaseState>, args: SearchArgs) -> Result<Value, String> {
    let limit = args.limit.unwrap_or(30).to_string();
    let env = post_form_json(
        &state,
        "/api/search/get/web",
        &[
            ("s", args.keyword),
            ("type", "1".to_string()),
            ("limit", limit),
            ("offset", "0".to_string()),
        ],
        true,
    )
    .await?;
    let songs = env
        .get("result")
        .and_then(|v| v.get("songs"))
        .and_then(Value::as_array)
        .map(|songs| songs.iter().map(map_song).collect::<Vec<_>>())
        .unwrap_or_default();
    Ok(json!({ "data": songs }))
}

#[tauri::command]
async fn netease_song_url(
    state: State<'_, NeteaseState>,
    args: SongUrlArgs,
) -> Result<Value, String> {
    let br = match args.level.as_deref() {
        Some("standard") => 128000,
        Some("higher") => 192000,
        Some("exhigh") => 320000,
        Some("lossless") => 999000,
        _ => 320000,
    };
    let data = song_url_value(&state, args.id, br).await?;
    Ok(json!({
        "data": {
            "id": args.id,
            "url": data.get("url").cloned().unwrap_or(Value::Null),
            "level": data.get("level").and_then(Value::as_str).unwrap_or("standard"),
            "quality_name": data.get("level").and_then(Value::as_str).unwrap_or("standard"),
            "size": data.get("size").and_then(Value::as_i64).unwrap_or_default(),
            "size_formatted": "",
            "type": data.get("type").and_then(Value::as_str).unwrap_or(""),
            "bitrate": data.get("br").and_then(Value::as_i64).unwrap_or_default()
        }
    }))
}

#[tauri::command]
async fn netease_song_json(state: State<'_, NeteaseState>, id: i64) -> Result<Value, String> {
    let detail = song_detail(&state, id).await?;
    let lyrics = get_json(
        &state,
        &format!("/api/song/lyric?id={id}&lv=-1&kv=-1&tv=-1"),
        true,
    )
    .await
    .unwrap_or_else(|_| json!({}));
    let url_data = song_url_value(&state, id, 320000)
        .await
        .unwrap_or_else(|_| json!({ "url": null }));
    let album = detail.get("album").or_else(|| detail.get("al")).unwrap_or(&Value::Null);
    let artists = detail.get("artists").or_else(|| detail.get("ar")).unwrap_or(&Value::Null);
    let name = detail.get("name").and_then(Value::as_str).unwrap_or("未知歌曲");
    let artist = artist_name(artists);
    let mut lyric = lyric_text(&lyrics, "lrc");
    let mut lyric_source = "netease";
    if !has_timed_lyric(&lyric) {
        let duration_ms = detail
            .get("duration")
            .or_else(|| detail.get("dt"))
            .and_then(Value::as_i64)
            .unwrap_or_default();
        if let Some(fallback) = fetch_fallback_lyric(&state.client, id, name, &artist, duration_ms).await {
            lyric = fallback.lyric;
            lyric_source = fallback.source;
        }
    }
    Ok(json!({
        "data": {
            "name": name,
            "ar_name": artist,
            "al_name": album.get("name").and_then(Value::as_str).unwrap_or(""),
            "pic": album.get("picUrl").and_then(Value::as_str).unwrap_or(""),
            "lyric": lyric,
            "tlyric": lyric_text(&lyrics, "tlyric"),
            "lyric_source": lyric_source,
            "url": url_data.get("url").cloned().unwrap_or(Value::Null),
            "level": url_data.get("level").and_then(Value::as_str).unwrap_or("standard"),
            "quality_name": url_data.get("level").and_then(Value::as_str).unwrap_or("standard"),
            "size": url_data.get("size").and_then(Value::as_i64).unwrap_or_default(),
            "type": url_data.get("type").and_then(Value::as_str).unwrap_or("")
        }
    }))
}

#[tauri::command]
async fn netease_playlist_page(
    state: State<'_, NeteaseState>,
    args: PlaylistPageArgs,
) -> Result<Value, String> {
    let env = get_json(
        &state,
        &format!("/api/v6/playlist/detail?id={}&n={}&s=8", args.id, args.limit + args.offset),
        true,
    )
    .await?;
    let playlist = env.get("playlist").unwrap_or(&Value::Null);
    let total = playlist
        .get("trackCount")
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let tracks = playlist
        .get("tracks")
        .and_then(Value::as_array)
        .map(|tracks| {
            tracks
                .iter()
                .skip(args.offset as usize)
                .take(args.limit as usize)
                .map(map_song)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(json!({
        "data": {
            "playlist": {
                "tracks": tracks,
                "trackTotal": total,
                "trackOffset": args.offset,
                "trackLimit": args.limit
            }
        }
    }))
}

// ─── QQ Music streaming ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct QqSearchArgs {
    keyword: String,
    limit: Option<u32>,
}

#[derive(Deserialize)]
struct QqPlayArgs {
    songmid: String,
    /// optional media mid for higher quality (flac filename)
    media_mid: Option<String>,
    /// netease-style quality: standard / higher / exhigh / lossless / hires …
    level: Option<String>,
}

/// QQ GetVkey filename candidates — **exact L-1124/QQMusicApi rules only**.
///
/// ```text
/// media_mid known → `{prefix}{media_mid}{ext}`
/// otherwise       → `{prefix}{songmid}{songmid}{ext}`
/// ```
/// Extra legacy shapes waste tries and can surface noise codes like 104009.
fn qq_filename_candidates(level: &str, songmid: &str, media_mid: &str) -> Vec<(String, &'static str)> {
    let media = media_mid.trim();
    let mid = songmid.trim();
    let mut files: Vec<(String, &'static str)> = Vec::new();
    let push = |out: &mut Vec<(String, &'static str)>, prefix: &str, ext: &str, label: &'static str| {
        let name = if !media.is_empty() && media != mid {
            format!("{prefix}{media}{ext}")
        } else {
            format!("{prefix}{mid}{mid}{ext}")
        };
        out.push((name, label));
    };

    match level {
        "hires" | "lossless" | "jyeffect" | "sky" | "jymaster" => {
            push(&mut files, "F000", ".flac", "lossless");
            push(&mut files, "M800", ".mp3", "exhigh");
            push(&mut files, "M500", ".mp3", "standard");
            push(&mut files, "C400", ".m4a", "standard");
            // free trial clip when full quality is locked
            push(&mut files, "RS02", ".mp3", "preview");
        }
        "exhigh" | "higher" => {
            push(&mut files, "M800", ".mp3", "exhigh");
            push(&mut files, "M500", ".mp3", "standard");
            push(&mut files, "C400", ".m4a", "standard");
            push(&mut files, "RS02", ".mp3", "preview");
        }
        _ => {
            push(&mut files, "M500", ".mp3", "standard");
            push(&mut files, "C400", ".m4a", "standard");
            push(&mut files, "M800", ".mp3", "exhigh");
            push(&mut files, "RS02", ".mp3", "preview");
        }
    }

    let mut seen = std::collections::HashSet::new();
    files
        .into_iter()
        .filter(|(f, _)| seen.insert(f.clone()))
        .collect()
}

fn qq_authst_from_cookie(cookie: &str) -> Option<String> {
    cookie_field(cookie, "qqmusic_key")
        .or_else(|| cookie_field(cookie, "qm_keyst"))
        .filter(|s| !s.is_empty())
}

/// Generate the 32-character GUID expected by the current QQ Music API.
///
/// Reusing the old public sample value (`7332953645`) now makes GetVkey return
/// `104009 invalidq`, even when the musickey is fresh and otherwise valid.
fn qq_guid_from_cookie(_cookie: Option<&str>) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = COUNTER.fetch_add(1, Ordering::Relaxed);
    let seed = format!("{now}:{}:{sequence}", std::process::id());
    format!("{:x}", md5::compute(seed.as_bytes()))
}

/// Resolve accurate media_mid / file mids via song detail (playlist rows sometimes omit them).
async fn qq_resolve_media_mid(
    client: &Client,
    songmid: &str,
    cookie: Option<&str>,
) -> Option<String> {
    let uin = cookie.map(qq_uin_from_cookie).unwrap_or_else(|| "0".into());
    let gtk = cookie.map(qq_gtk_from_cookie).unwrap_or(5381);
    // Web profile only — song detail does not need authst (and authst without
    // tmeLoginType used to poison the session for subsequent GetVkey).
    let mut comm = json!({
        "format": "json",
        "ct": 24,
        "cv": 4747474,
        "g_tk": gtk,
        "g_tk_new_20200303": gtk,
        "platform": "yqq.json",
        "needNewCode": 1,
        "chid": "0",
    });
    if uin != "0" {
        if let Ok(n) = uin.parse::<i64>() {
            comm["uin"] = json!(n);
        } else {
            comm["uin"] = json!(uin);
        }
    }
    let body = json!({
        "comm": comm,
        "songinfo": {
            "module": "music.pf_song_detail_svr",
            "method": "get_song_detail_yqq",
            "param": { "song_mid": songmid }
        }
    });
    let data = qq_post_musicu(client, body, cookie).await.ok()?;
    // track_info.file.media_mid  /  track_info.mid
    data.pointer("/songinfo/data/track_info/file/media_mid")
        .or_else(|| data.pointer("/songinfo/data/track_info/file/mediaMid"))
        .or_else(|| data.pointer("/songinfo/data/track_info/ksong/mid"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .or_else(|| {
            data.pointer("/songinfo/data/track_info/mid")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
        })
}

fn qq_extract_purl(data: &Value) -> String {
    let purl = data
        .pointer("/req_0/data/midurlinfo/0/purl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if !purl.is_empty() {
        return purl;
    }
    data.pointer("/req_0/data/midurlinfo/0/wifiurl")
        .or_else(|| data.pointer("/req_0/data/midurlinfo/0/xcdnurl"))
        .or_else(|| data.pointer("/req_0/data/midurlinfo/0/flowurl"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// Build GetVkey param block (L-1124 `get_song_urls`).
fn qq_vkey_param(mid: &str, filename: Option<&str>, uin: &str, guid: &str, songtype: i64) -> Value {
    let mut param = json!({
        "uin": uin,
        "guid": guid,
        "songmid": [mid],
        "songtype": [songtype],
        "ctx": 0,
    });
    if let Some(f) = filename {
        param["filename"] = json!([f]);
    }
    param
}

/// GetVkey — L-1124 strategies (Android authst → Web cookie → legacy CgiGetVkey).
///
/// Critical: when `authst`/`musickey` is present it MUST go with `tmeLoginType`
/// (Android profile). Putting bare `authst` on a Web (`ct=24`) body is what
/// produced mass `code=104009` + empty purl.
async fn qq_try_vkey(
    client: &Client,
    mid: &str,
    filename: Option<&str>,
    cookie: Option<&str>,
    guid: &str,
    songtype: i64,
) -> Result<(String, Value), String> {
    let uin = cookie.map(qq_uin_from_cookie).unwrap_or_else(|| "0".into());
    let authst = cookie.and_then(qq_authst_from_cookie).unwrap_or_default();
    let gtk = cookie.map(qq_gtk_from_cookie).unwrap_or(5381);
    let loginflag = if uin != "0" { 1 } else { 0 };
    let tme_login = cookie.map(qq_tme_login_type).unwrap_or(2);
    let param = qq_vkey_param(mid, filename, &uin, guid, songtype);

    let mut last_data = Value::Null;

    // 1) Android profile — primary when we have musickey from QQConnectLogin
    if !authst.is_empty() {
        let android_comm = json!({
            "ct": 11,
            "cv": 14090008,
            "v": 14090008,
            "chid": "10003505",
            "qq": uin,
            "authst": authst,
            "tmeAppID": "qqmusic",
            "tmeLoginType": tme_login,
            "OpenUDID": guid,
            "udid": guid,
            "OpenUDID2": guid,
            "format": "json",
        });
        let body = json!({
            "comm": android_comm,
            "req_0": {
                "module": "music.vkey.GetVkey",
                "method": "UrlGetVkey",
                "param": param
            }
        });
        if let Ok(data) = qq_post_musicu(client, body, cookie).await {
            last_data = data.clone();
            let purl = qq_extract_purl(&data);
            if !purl.is_empty() {
                return Ok((purl, data));
            }
        }
    }

    // 2) Web profile — cookies carry qm_keyst; do NOT put authst here (104009)
    {
        let mut web_comm = json!({
            "ct": 24,
            "cv": 4747474,
            "format": "json",
            "platform": "yqq.json",
            "inCharset": "utf-8",
            "outCharset": "utf-8",
            "notice": 0,
            "needNewCode": 1,
            "need_new_code": 1,
            "chid": "0",
            "g_tk": gtk,
            "g_tk_new_20200303": gtk,
        });
        if uin != "0" {
            if let Ok(n) = uin.parse::<i64>() {
                web_comm["uin"] = json!(n);
            } else {
                web_comm["uin"] = json!(uin);
            }
        }
        let body = json!({
            "comm": web_comm,
            "req_0": {
                "module": "music.vkey.GetVkey",
                "method": "UrlGetVkey",
                "param": param
            }
        });
        if let Ok(data) = qq_post_musicu(client, body, cookie).await {
            last_data = data.clone();
            let purl = qq_extract_purl(&data);
            if !purl.is_empty() {
                return Ok((purl, data));
            }
        }
    }

    // 3) Legacy CgiGetVkey
    let legacy = qq_try_vkey_legacy(
        client,
        mid,
        filename,
        cookie,
        guid,
        songtype,
        &uin,
        gtk,
        loginflag,
    )
    .await;
    if let Ok((p, d)) = legacy {
        if !p.is_empty() {
            return Ok((p, d));
        }
        last_data = d;
    }

    Ok((String::new(), last_data))
}

async fn qq_try_vkey_legacy(
    client: &Client,
    mid: &str,
    filename: Option<&str>,
    cookie: Option<&str>,
    guid: &str,
    songtype: i64,
    uin: &str,
    gtk: u32,
    loginflag: i32,
) -> Result<(String, Value), String> {
    let mut param = json!({
        "guid": guid,
        "songmid": [mid],
        "songtype": [songtype],
        "uin": uin,
        "loginflag": loginflag,
        "platform": "20",
    });
    if let Some(f) = filename {
        param["filename"] = json!([f]);
    }
    // Desktop-ish legacy — cookies only, no authst (same 104009 trap)
    let comm = json!({
        "uin": uin,
        "format": "json",
        "ct": 19,
        "cv": 2201,
        "g_tk": gtk,
        "platform": "yqq.json",
        "needNewCode": 1,
        "chid": "0",
    });
    let body = json!({
        "comm": comm,
        "req_0": {
            "module": "vkey.GetVkeyServer",
            "method": "CgiGetVkey",
            "param": param
        }
    });
    let data = qq_post_musicu(client, body, cookie).await?;
    Ok((qq_extract_purl(&data), data))
}

fn qq_pick_sip(data: &Value) -> String {
    let empty = Vec::new();
    let sips = data
        .pointer("/req_0/data/sip")
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    // Prefer https and non-ws hosts (ws often blocked / flaky).
    let preferred = sips.iter().find_map(|v| {
        let s = v.as_str()?;
        if s.starts_with("https://") && !s.contains("ws.") {
            Some(s.to_string())
        } else {
            None
        }
    });
    preferred
        .or_else(|| {
            sips.iter()
                .find_map(|v| v.as_str().map(|s| s.to_string()))
        })
        .unwrap_or_else(|| "https://ws.stream.qqmusic.qq.com/".into())
}

async fn qq_post_musicu(
    client: &Client,
    body: Value,
    cookie: Option<&str>,
) -> Result<Value, String> {
    let mut req = client
        .post("https://u.y.qq.com/cgi-bin/musicu.fcg")
        .header(CONTENT_TYPE, "application/json")
        .header(REFERER, "https://y.qq.com/")
        .header(ORIGIN, "https://y.qq.com");
    if let Some(c) = cookie.filter(|s| !s.is_empty()) {
        req = req.header("Cookie", c);
    }
    req.json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn qq_search(args: QqSearchArgs) -> Result<Value, String> {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let limit = args.limit.unwrap_or(30).clamp(1, 50);
    let keyword = args.keyword.trim();
    if keyword.is_empty() {
        return Ok(json!({ "data": [] }));
    }
    // The legacy client_search_cp endpoint now commonly returns a non-JSON
    // challenge page. Use the current Android musicu search service instead.
    let cookie = load_qq_cookie();
    let guid = qq_guid_from_cookie(cookie.as_deref());
    let uin = cookie
        .as_deref()
        .map(qq_uin_from_cookie)
        .unwrap_or_else(|| "0".into());
    let mut comm = json!({
        "ct": 11,
        "cv": 14090008,
        "v": 14090008,
        "chid": "10003505",
        "qq": uin,
        "tmeAppID": "qqmusic",
        "OpenUDID": guid,
        "udid": guid,
        "OpenUDID2": guid,
        "QIMEI": "6c9d3cd110abca9b16311cee10001e717614",
        "QIMEI36": "6c9d3cd110abca9b16311cee10001e717614",
        "format": "json"
    });
    if let Some(raw) = cookie.as_deref() {
        if let Some(authst) = qq_authst_from_cookie(raw) {
            comm["authst"] = json!(authst);
            comm["tmeLoginType"] = json!(qq_tme_login_type(raw));
        }
    }
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let entropy = u64::from_str_radix(&guid[..16], 16).unwrap_or(now_ms);
    let search_id = (entropy % 20 + 1) * 18_014_398_509_481_984_u64
        + ((entropy >> 5) % 4_194_305) * 4_294_967_296_u64
        + now_ms % 86_400_000;
    let body = json!({
        "comm": comm,
        "req_0": {
            "module": "music.search.SearchCgiService",
            "method": "DoSearchForQQMusicMobile",
            "param": {
                "searchid": search_id.to_string(),
                "query": keyword,
                "search_type": 0,
                "num_per_page": limit,
                "page_num": 1,
                "highlight": 0,
                "grp": 1
            }
        }
    });
    let data = qq_post_musicu(&client, body, cookie.as_deref()).await?;
    let req_code = data
        .pointer("/req_0/code")
        .and_then(Value::as_i64)
        .unwrap_or(-1);
    if req_code != 0 {
        return Err(format!("QQ 搜索接口失败 code={req_code}"));
    }
    let items = data
        .pointer("/req_0/data/body/item_song")
        .or_else(|| data.pointer("/req_0/data/song/list"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let songs: Vec<Value> = items.iter().filter_map(map_qq_song_item).collect();
    Ok(json!({ "data": songs }))
}

fn qq_cookie_to_jar(raw: &str) -> BTreeMap<String, String> {
    let mut jar = BTreeMap::new();
    for part in raw.split(';') {
        if let Some((k, v)) = part.trim().split_once('=') {
            let k = k.trim();
            let v = v.trim();
            if !k.is_empty() && !v.is_empty() {
                jar.insert(k.to_string(), v.to_string());
            }
        }
    }
    jar
}

#[tauri::command]
async fn qq_song_play(args: QqPlayArgs) -> Result<Value, String> {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let mid = args.songmid.trim();
    if mid.is_empty() {
        return Err("missing songmid".into());
    }
    let level = args
        .level
        .as_deref()
        .unwrap_or("exhigh")
        .trim()
        .to_ascii_lowercase();
    let mut media = args
        .media_mid
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(mid)
        .to_string();

    // Music stream requires qm_keyst/qqmusic_key — re-bootstrap when missing.
    let mut qq_cookie = load_qq_cookie();
    if let Some(ref raw) = qq_cookie {
        let mut jar = qq_cookie_to_jar(raw);
        let missing = qq_authst_from_cookie(raw).is_none();
        if missing {
            eprintln!("[qq_song_play] missing music key — running enrich…");
            enrich_qq_music_cookies(&mut jar).await;
            let refreshed = cookie_header(&jar);
            if !refreshed.is_empty() {
                let _ = save_qq_cookie(&refreshed);
                qq_cookie = Some(refreshed);
            }
        }
    }
    let cookie_ref = qq_cookie.as_deref();
    let guid = qq_guid_from_cookie(cookie_ref);
    let has_auth_early = cookie_ref.and_then(qq_authst_from_cookie).is_some();
    if !has_auth_early {
        eprintln!("[qq_song_play] still no qm_keyst — GetVkey purl will likely be empty");
    }

    // Always resolve real media_mid (playlist/search often only give songmid).
    if let Some(resolved) = qq_resolve_media_mid(&client, mid, cookie_ref).await {
        if !resolved.is_empty() && resolved != media {
            eprintln!("[qq_song_play] resolved media_mid {media} -> {resolved}");
            media = resolved;
        }
    }

    let candidates = qq_filename_candidates(&level, mid, &media);
    let mut got: Option<(String, Value, &'static str)> = None;
    let mut last_data: Option<Value> = None;
    let mut tried = Vec::new();

    // Prefer songtype 0; only fall back to 1 if nothing works.
    for songtype in [0_i64, 1_i64] {
        // bare vkey first (server picks default free/trial file) — fewer false 104009s
        if songtype == 0 {
            if let Ok((purl, data)) =
                qq_try_vkey(&client, mid, None, cookie_ref, &guid, songtype).await
            {
                last_data = Some(data.clone());
                if !purl.is_empty() {
                    eprintln!("[qq_song_play] hit mid={mid} file=<auto> type={songtype}");
                    got = Some((purl, data, "standard"));
                }
            }
        }
        if got.is_some() {
            break;
        }
        for (filename, qlabel) in &candidates {
            tried.push(filename.clone());
            match qq_try_vkey(
                &client,
                mid,
                Some(filename.as_str()),
                cookie_ref,
                &guid,
                songtype,
            )
            .await
            {
                Ok((purl, data)) => {
                    last_data = Some(data.clone());
                    if !purl.is_empty() {
                        eprintln!(
                            "[qq_song_play] hit mid={mid} file={filename} type={songtype} q={qlabel}"
                        );
                        got = Some((purl, data, *qlabel));
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[qq_song_play] vkey err mid={mid} file={filename}: {e}");
                }
            }
        }
        if got.is_some() {
            break;
        }
    }

    let Some((purl, data, qlabel)) = got else {
        let has_auth = cookie_ref.and_then(qq_authst_from_cookie).is_some();
        let uin = cookie_ref.map(qq_uin_from_cookie).unwrap_or_else(|| "0".into());
        let code = last_data
            .as_ref()
            .and_then(|d| d.pointer("/req_0/code").and_then(Value::as_i64))
            .unwrap_or(-1);
        let info_code = last_data
            .as_ref()
            .and_then(|d| d.pointer("/req_0/data/midurlinfo/0/subcode").or_else(|| d.pointer("/req_0/data/midurlinfo/0/code")))
            .and_then(Value::as_i64)
            .unwrap_or(-1);
        let errmsg = last_data
            .as_ref()
            .and_then(|d| {
                d.pointer("/req_0/data/midurlinfo/0/msg")
                    .or_else(|| d.pointer("/req_0/data/msg"))
                    .or_else(|| d.pointer("/req_0/msg"))
            })
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let msg = if cookie_ref.is_none() || uin == "0" {
            "未登录 QQ 音乐，请先扫码登录后再播放".to_string()
        } else if !has_auth {
            // Root cause we diagnosed: ptlogin only left skey/uin, no qm_keyst.
            "QQ 登录缺少播放凭证(qm_keyst)。请退出后重新用手机 QQ 扫码登录，确认授权完成".to_string()
        } else if code == 1000 || code == 104401 || code == 104009 {
            // 104009: login/param mismatch (was triggered by authst on Web profile)
            "QQ 登录态失效或鉴权参数错误，请退出后重新扫码登录".to_string()
        } else if !errmsg.is_empty() {
            format!("该歌曲无可用音源：{errmsg}")
        } else {
            "该歌曲无可用音源（版权或音质受限）".to_string()
        };
        eprintln!(
            "[qq_song_play] FAIL mid={mid} media={media} uin={uin} auth={} code={code} info={info_code} tried={} msg={errmsg}",
            has_auth,
            tried.len()
        );
        return Ok(json!({
            "data": {
                "url": null,
                "source": "qq",
                "level": level,
                "quality_name": level,
                "error": msg,
                "debug": {
                    "code": code,
                    "info_code": info_code,
                    "media_mid": media,
                    "tried": tried.len(),
                    "has_authst": has_auth,
                    "uin": uin,
                    "errmsg": errmsg,
                }
            }
        }));
    };

    let sip = qq_pick_sip(&data);
    let base = if sip.ends_with('/') {
        sip
    } else {
        format!("{sip}/")
    };
    let mut url = if purl.starts_with("http") {
        purl
    } else {
        format!("{base}{purl}")
    };
    // Prefer https for WebView media element
    if url.starts_with("http://") {
        url = url.replacen("http://", "https://", 1);
    }
    eprintln!("[qq_song_play] OK mid={mid} q={qlabel} url={}", &url[..url.len().min(96)]);
    Ok(json!({
        "data": {
            "url": url,
            "source": "qq",
            "qqMid": mid,
            "qqMediaMid": media,
            "level": qlabel,
            "quality_name": qlabel
        }
    }))
}

// ─── Kugou streaming ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct KugouSearchArgs {
    keyword: String,
    limit: Option<u32>,
}

#[derive(Deserialize)]
struct KugouPlayArgs {
    hash: String,
    album_audio_id: Option<i64>,
    album_id: Option<String>,
    /// netease-style quality level
    level: Option<String>,
    hash_std: Option<String>,
    hash_hq: Option<String>,
    hash_sq: Option<String>,
    hash_res: Option<String>,
}

fn kugou_hash_ladder(args: &KugouPlayArgs) -> Vec<(String, &'static str)> {
    let level = args
        .level
        .as_deref()
        .unwrap_or("exhigh")
        .trim()
        .to_ascii_lowercase();
    let primary = args.hash.trim().to_lowercase();
    let hash_std = args
        .hash_std
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| primary.clone());
    let hq = args
        .hash_hq
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hash_std.clone());
    let sq = args
        .hash_sq
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| hq.clone());
    let res = args
        .hash_res
        .as_deref()
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sq.clone());

    let mut ordered: Vec<(String, &'static str)> = match level.as_str() {
        "hires" | "jyeffect" | "sky" | "jymaster" => vec![
            (res, "hires"),
            (sq, "lossless"),
            (hq, "exhigh"),
            (hash_std, "standard"),
        ],
        "lossless" => vec![(sq, "lossless"), (hq, "exhigh"), (hash_std, "standard")],
        "exhigh" | "higher" => vec![(hq, "exhigh"), (hash_std, "standard")],
        _ => vec![(hash_std, "standard")],
    };
    // Always put the explicitly requested hash first if not already
    if !primary.is_empty() {
        ordered.insert(0, (primary, ordered.first().map(|x| x.1).unwrap_or("standard")));
    }
    // de-dupe while preserving order
    let mut seen = std::collections::HashSet::new();
    ordered
        .into_iter()
        .filter(|(h, _)| !h.is_empty() && seen.insert(h.clone()))
        .collect()
}

/// Tracker CDN key — modern free/preview streams use salt `kgcloud` (not kgcloudv2).
fn kugou_tracker_key(hash: &str) -> String {
    format!("{:x}", md5::compute(format!("{}kgcloud", hash.to_ascii_lowercase())))
}

fn kugou_pick_url_field(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    v.as_array()
        .and_then(|a| a.first())
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// Resolve a playable CDN URL for a hash via trackercdn (key = md5(hash + "kgcloud")).
async fn kugou_tracker_url(
    client: &Client,
    hash: &str,
    session: Option<&KugouSession>,
) -> Result<(Option<String>, Value), String> {
    let hash = hash.trim().to_ascii_lowercase();
    if hash.is_empty() {
        return Ok((None, json!({})));
    }
    let key = kugou_tracker_key(&hash);
    let mut pairs: Vec<(&str, String)> = vec![
        ("cmd", "4".into()),
        ("hash", hash.clone()),
        ("key", key),
        ("pid", "1".into()),
        ("behavior", "play".into()),
        ("acceptMp3", "1".into()),
        ("appid", KUGOU_APPID.into()),
        ("clientver", KUGOU_CLIENTVER.into()),
    ];
    if let Some(s) = session {
        if !s.userid.is_empty() {
            pairs.push(("userid", s.userid.clone()));
        }
        if !s.token.is_empty() {
            pairs.push(("token", s.token.clone()));
        }
    }
    let pairs_ref: Vec<(&str, &str)> = pairs.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let tracker = reqwest::Url::parse_with_params("https://trackercdn.kugou.com/i/", &pairs_ref)
        .map_err(|e| e.to_string())?;
    let mut req = client
        .get(tracker)
        .header(USER_AGENT, "Android14-1070-11070-201-0-Play-wifi");
    if let Some(s) = session {
        if !s.cookie.is_empty() {
            req = req.header("Cookie", s.cookie.as_str());
        } else if !s.token.is_empty() {
            req = req.header(
                "Cookie",
                format!("token={}; userid={}", s.token, s.userid),
            );
        }
    }
    let data = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let mut url = data.get("url").and_then(kugou_pick_url_field);
    if let Some(ref u) = url {
        if u.starts_with("http://") {
            url = Some(u.replacen("http://", "https://", 1));
        }
    }
    Ok((url, data))
}

/// Privilege + free-preview metadata (clip_hash / offset_hash) via media.store gateway.
async fn kugou_get_res_privilege(
    session: &KugouSession,
    hash: &str,
    album_audio_id: i64,
    album_id: &str,
) -> Result<Value, String> {
    let params = kugou_android_base_params(session);
    let body = json!({
        "appid": KUGOU_APPID.parse::<i64>().unwrap_or(1005),
        "clientver": KUGOU_CLIENTVER.parse::<i64>().unwrap_or(20489),
        "clienttime": params.get("clienttime").and_then(|s| s.parse::<i64>().ok()).unwrap_or(0),
        "mid": params.get("mid").cloned().unwrap_or_default(),
        "uuid": params.get("mid").cloned().unwrap_or_default(),
        "dfid": "-",
        "userid": session.userid.parse::<i64>().unwrap_or(0),
        "token": session.token,
        "relate": 1,
        "vip": 0,
        "behavior": "play",
        "resource": [{
            "type": "audio",
            "id": 0,
            "hash": hash.to_ascii_lowercase(),
            "name": "",
            "album_audio_id": album_audio_id,
            "album_id": album_id,
        }]
    });
    kugou_gateway_json(
        "POST",
        "/v1/get_res_privilege",
        "media.store.kugou.com",
        params,
        Some(body),
        session,
    )
    .await
}

/// Resolve playable URL: full track when free/VIP, else 60s free preview via clip_hash.
async fn kugou_fetch_play_url(
    client: &Client,
    hash: &str,
    album_audio_id: i64,
    album_id: &str,
    session: Option<&KugouSession>,
) -> Result<(Option<String>, Value, bool), String> {
    // 1) Modern privilege API (needs login) — preferred
    if let Some(sess) = session {
        if !sess.token.is_empty() {
            match kugou_get_res_privilege(sess, hash, album_audio_id, album_id).await {
                Ok(priv_data) => {
                    let item = priv_data
                        .pointer("/data/0")
                        .cloned()
                        .unwrap_or(Value::Null);
                    // Free / owned full track
                    let privilege = item
                        .get("privilege")
                        .and_then(Value::as_i64)
                        .unwrap_or(-1);
                    let status = item.get("status").and_then(Value::as_i64).unwrap_or(0);
                    let full_hash = item
                        .get("hash")
                        .and_then(Value::as_str)
                        .unwrap_or(hash)
                        .to_string();

                    // privilege 0 (or status==1) usually means free to play full song
                    if privilege == 0 || status == 1 {
                        let (url, data) =
                            kugou_tracker_url(client, &full_hash, Some(sess)).await?;
                        if url.is_some() {
                            return Ok((url, data, false));
                        }
                    }

                    // 60s free preview
                    let clip = item
                        .pointer("/trans_param/hash_offset/clip_hash")
                        .or_else(|| item.pointer("/trans_param/hash_offset/offset_hash"))
                        .and_then(Value::as_str)
                        .map(|s| s.to_string());
                    if let Some(clip_hash) = clip {
                        let (url, data) =
                            kugou_tracker_url(client, &clip_hash, Some(sess)).await?;
                        if url.is_some() {
                            eprintln!(
                                "[kugou] preview clip hash={} for full={}",
                                &clip_hash[..clip_hash.len().min(12)],
                                &full_hash[..full_hash.len().min(12)]
                            );
                            return Ok((url, data, true));
                        }
                    }

                    // Fall through with privilege payload for error message
                    let (url, data) = kugou_tracker_url(client, hash, Some(sess)).await?;
                    if url.is_some() {
                        return Ok((url, data, false));
                    }
                    return Ok((None, priv_data, false));
                }
                Err(e) => {
                    eprintln!("[kugou] get_res_privilege failed: {e}");
                }
            }
        }
    }

    // 2) Legacy playInfo (rarely works for paid catalog)
    let url = reqwest::Url::parse_with_params(
        "https://m.kugou.com/app/i/getSongInfo.php",
        &[("cmd", "playInfo"), ("hash", hash)],
    )
    .map_err(|e| e.to_string())?;
    let mut req = client
        .get(url)
        .header(USER_AGENT, "Android14-1070-11070-201-0-Play-wifi");
    if let Some(s) = session {
        if !s.cookie.is_empty() {
            req = req.header("Cookie", s.cookie.as_str());
        } else if !s.token.is_empty() {
            req = req.header(
                "Cookie",
                format!("token={}; userid={}", s.token, s.userid),
            );
        }
    }
    let data = req
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json::<Value>()
        .await
        .map_err(|e| e.to_string())?;
    let play_url = data
        .get("url")
        .or_else(|| data.get("backup_url"))
        .and_then(kugou_pick_url_field);
    if play_url.is_some() {
        return Ok((play_url, data, false));
    }

    // 3) Direct tracker on requested hash
    let (url, data2) = kugou_tracker_url(client, hash, session).await?;
    if url.is_some() {
        Ok((url, data2, false))
    } else {
        Ok((None, data, false))
    }
}

#[tauri::command]
async fn kugou_search(args: KugouSearchArgs) -> Result<Value, String> {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    let limit = args.limit.unwrap_or(30).clamp(1, 50);
    let keyword = args.keyword.trim();
    if keyword.is_empty() {
        return Ok(json!({ "data": [] }));
    }
    let mut params = BTreeMap::new();
    params.insert("sorttype".to_string(), "0".to_string());
    params.insert("keyword".to_string(), keyword.to_string());
    params.insert("pagesize".to_string(), limit.to_string());
    params.insert("page".to_string(), "1".to_string());
    let data = match get_kugou_json(
        &client,
        "http://complexsearch.kugou.com/v2/search/song",
        params,
        "SearchSong",
        &[("x-router", "complexsearch.kugou.com")],
    )
    .await
    {
        Ok(d) => d,
        Err(_) => {
            // fallback mobile search
            let url = reqwest::Url::parse_with_params(
                "http://mobiles.kugou.com/api/v3/search/song",
                &[
                    ("keyword", keyword),
                    ("page", "1"),
                    ("pagesize", &limit.to_string()),
                    ("showtype", "14"),
                    ("version", "9108"),
                ],
            )
            .map_err(|e| e.to_string())?;
            client
                .get(url)
                .send()
                .await
                .map_err(|e| e.to_string())?
                .json::<Value>()
                .await
                .map_err(|e| e.to_string())?
        }
    };

    let items = data
        .pointer("/data/lists")
        .or_else(|| data.pointer("/data/info"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let songs: Vec<Value> = items
        .iter()
        .filter_map(|item| {
            let hash = item
                .get("FileHash")
                .or_else(|| item.get("hash"))
                .and_then(Value::as_str)?
                .to_string();
            let hq = item
                .get("HQFileHash")
                .or_else(|| item.get("hqhash"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let sq = item
                .get("SQFileHash")
                .or_else(|| item.get("sqhash"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let res = item
                .get("ResFileHash")
                .or_else(|| item.get("resHash"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let id = value_i64(
                item.get("ID")
                    .or_else(|| item.get("AlbumAudioID"))
                    .or_else(|| item.get("album_audio_id")),
            );
            let name = item
                .get("SongName")
                .or_else(|| item.get("songname"))
                .and_then(Value::as_str)
                .unwrap_or("未知歌曲");
            let artists = item
                .get("Singers")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|s| s.get("name").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join(" / ")
                })
                .or_else(|| {
                    item.get("singername")
                        .and_then(Value::as_str)
                        .map(|s| s.replace('、', " / "))
                })
                .unwrap_or_default();
            let album = item
                .get("AlbumName")
                .or_else(|| item.get("album_name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let duration = value_i64(item.get("Duration").or_else(|| item.get("duration"))) * 1000;
            let pic = item
                .get("Image")
                .or_else(|| item.get("imgUrl"))
                .or_else(|| item.get("album_sizable_cover"))
                .and_then(Value::as_str)
                .map(|s| s.replace("{size}", "400"))
                .unwrap_or_default();
            let album_id = item
                .get("AlbumID")
                .or_else(|| item.get("album_id"))
                .or_else(|| item.get("albumid"))
                .map(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                        .unwrap_or_default()
                })
                .filter(|s| !s.is_empty());
            Some(json!({
                "id": if id > 0 { id } else { (hash.chars().take(8).fold(0u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32))) as i64 },
                "name": name,
                "artist": artists,
                "album": album,
                "pic": if pic.is_empty() { Value::Null } else { Value::String(pic) },
                "duration": duration,
                "source": "kugou",
                "kgHash": hash,
                "kgHqHash": hq,
                "kgSqHash": sq,
                "kgResHash": res,
                "albumId": album_id,
            }))
        })
        .collect();
    Ok(json!({ "data": songs }))
}

#[tauri::command]
async fn kugou_song_play(args: KugouPlayArgs) -> Result<Value, String> {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;
    if args.hash.trim().is_empty() {
        return Err("missing hash".into());
    }

    let session = load_kugou_session();
    let session_ref = session.as_ref();
    if session_ref.is_none() {
        return Ok(json!({
            "data": {
                "url": null,
                "source": "kugou",
                "error": "请先扫码登录酷狗音乐后再播放",
            }
        }));
    }

    let album_audio_id = args.album_audio_id.unwrap_or(0);
    let album_id = args
        .album_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("0")
        .to_string();

    let ladder = kugou_hash_ladder(&args);
    let mut last_hash = args.hash.trim().to_lowercase();
    let mut last_data = Value::Null;
    let mut saw_preview = false;
    for (hash, qlabel) in ladder {
        let (play_url, data, is_preview) =
            kugou_fetch_play_url(&client, &hash, album_audio_id, &album_id, session_ref).await?;
        last_hash = hash.clone();
        last_data = data.clone();
        if is_preview {
            saw_preview = true;
        }
        if let Some(u) = play_url {
            let pic = data
                .get("imgUrl")
                .or_else(|| data.pointer("/data/0/info/image"))
                .and_then(Value::as_str)
                .map(|s| s.replace("{size}", "400"));
            let name = data
                .get("songName")
                .or_else(|| data.pointer("/data/0/name"))
                .and_then(Value::as_str);
            let artist = data
                .get("choricSinger")
                .or_else(|| data.pointer("/data/0/singername"))
                .and_then(Value::as_str);
            let quality_name = if is_preview {
                format!("{qlabel}·试听")
            } else {
                qlabel.to_string()
            };
            eprintln!(
                "[kugou_song_play] OK hash={} preview={} q={}",
                &hash[..hash.len().min(12)],
                is_preview,
                quality_name
            );
            return Ok(json!({
                "data": {
                    "url": u,
                    "source": "kugou",
                    "kgHash": hash,
                    "pic": pic,
                    "name": name,
                    "artist": artist,
                    "level": qlabel,
                    "quality_name": quality_name,
                    "preview": is_preview,
                }
            }));
        }
    }

    // Build a clear user-facing error from last privilege payload
    let err_msg = if session_ref.map(|s| s.token.is_empty()).unwrap_or(true) {
        "请先扫码登录酷狗音乐后再播放".to_string()
    } else if last_data
        .pointer("/data/0/pay_type")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
        || last_data
            .pointer("/data/0/privilege")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            > 0
    {
        "该歌曲需酷狗会员或付费后才能完整播放（当前账号无可用免费音源）".to_string()
    } else if last_data
        .get("error")
        .and_then(Value::as_str)
        .map(|s| !s.is_empty())
        .unwrap_or(false)
    {
        format!(
            "酷狗音源受限：{}",
            last_data.get("error").and_then(Value::as_str).unwrap_or("")
        )
    } else {
        "酷狗暂无可用播放地址，请稍后重试或重新登录".to_string()
    };

    eprintln!(
        "[kugou_song_play] FAIL hash={} preview_tried={} msg={}",
        last_hash, saw_preview, err_msg
    );

    Ok(json!({
        "data": {
            "url": null,
            "source": "kugou",
            "kgHash": last_hash,
            "level": args.level.as_deref().unwrap_or("standard"),
            "quality_name": args.level.as_deref().unwrap_or("standard"),
            "error": err_msg,
        }
    }))
}

/// Generic HTTP proxy for QQ / Kugou lyric APIs (CORS bypass in the webview).
#[derive(Deserialize)]
struct HttpProxyArgs {
    url: String,
    method: Option<String>,
    headers: Option<BTreeMap<String, String>>,
    body: Option<String>,
    /// When true, return body as base64 (for binary lyric payloads).
    binary: Option<bool>,
}

#[tauri::command]
async fn http_proxy(args: HttpProxyArgs) -> Result<Value, String> {
    let method = args
        .method
        .as_deref()
        .unwrap_or("GET")
        .to_ascii_uppercase();
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = match method.as_str() {
        "POST" => client.post(&args.url),
        "PUT" => client.put(&args.url),
        _ => client.get(&args.url),
    };

    if let Some(headers) = &args.headers {
        for (k, v) in headers {
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_str(v),
            ) {
                builder = builder.header(name, value);
            }
        }
    }

    if let Some(body) = &args.body {
        builder = builder.body(body.clone());
    }

    let res = builder.send().await.map_err(|e| format!("proxy request failed: {e}"))?;
    let status = res.status().as_u16();
    let content_type = res
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("proxy read body failed: {e}"))?;

    if args.binary.unwrap_or(false) {
        // Minimal base64 encoder (no extra crate).
        const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut body_b64 = String::with_capacity((bytes.len() + 2) / 3 * 4);
        let mut i = 0;
        while i < bytes.len() {
            let b0 = bytes[i] as u32;
            let b1 = if i + 1 < bytes.len() {
                bytes[i + 1] as u32
            } else {
                0
            };
            let b2 = if i + 2 < bytes.len() {
                bytes[i + 2] as u32
            } else {
                0
            };
            let triple = (b0 << 16) | (b1 << 8) | b2;
            body_b64.push(T[((triple >> 18) & 63) as usize] as char);
            body_b64.push(T[((triple >> 12) & 63) as usize] as char);
            body_b64.push(if i + 1 < bytes.len() {
                T[((triple >> 6) & 63) as usize] as char
            } else {
                '='
            });
            body_b64.push(if i + 2 < bytes.len() {
                T[(triple & 63) as usize] as char
            } else {
                '='
            });
            i += 3;
        }
        Ok(json!({
            "status": status,
            "contentType": content_type,
            "bodyBase64": body_b64,
        }))
    } else {
        let body_text = String::from_utf8_lossy(&bytes).to_string();
        Ok(json!({
            "status": status,
            "contentType": content_type,
            "bodyText": body_text,
        }))
    }
}

#[tauri::command]
async fn netease_user_playlists(
    state: State<'_, NeteaseState>,
    args: UserPlaylistsArgs,
) -> Result<Value, String> {
    let env = get_json(
        &state,
        &format!(
            "/api/user/playlist?uid={}&limit={}&offset={}",
            args.uid, args.limit, args.offset
        ),
        true,
    )
    .await?;
    let playlists = env
        .get("playlist")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| map_playlist(item, args.uid))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(json!({
        "data": {
            "playlists": playlists,
            "more": env.get("more").and_then(Value::as_bool).unwrap_or(false)
        }
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let client = Client::builder()
        .user_agent(UA)
        .build()
        .expect("failed to build NetEase HTTP client");
    let cookie_file = cookie_file_path();
    let device_file = cookie_file.with_file_name("device_id.txt");

    tauri::Builder::default()
        .manage(NeteaseState {
            client,
            cookie_file,
            device_file,
        })
        .manage(QqLoginState {
            pending: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // focus the existing window when a second instance is launched
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            // ---- Transparent window setup ----
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(false);
                let _ = window.set_title("");
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                // Workaround for Tauri #8632: transparent window shows a white
                // background until the first resize. Nudge size +1px then back.
                if let Ok(size) = window.outer_size() {
                    let _ = window.set_size(tauri::PhysicalSize::new(
                        size.width + 1,
                        size.height + 1,
                    ));
                    let _ = window.set_size(tauri::PhysicalSize::new(
                        size.width,
                        size.height,
                    ));
                }
            }

            // ---- System tray ----
            let show = MenuItem::with_id(app, "show", "显示", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("Cove · 可沃")
                .menu(&menu)
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // Close → hide to tray instead of quitting.
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![
            netease_qr_key,
            netease_qr_check,
            netease_login_status,
            netease_logout,
            netease_search,
            netease_song_url,
            netease_song_json,
            netease_playlist_page,
            netease_user_playlists,
            auth_status,
            auth_logout_all,
            qq_auth_status,
            qq_logout,
            qq_qr_key,
            qq_qr_check,
            kugou_auth_status,
            kugou_logout,
            kugou_qr_key,
            kugou_qr_check,
            kugou_user_playlists,
            kugou_playlist_page,
            qq_user_playlists,
            qq_playlist_page,
            http_proxy,
            qq_search,
            qq_song_play,
            kugou_search,
            kugou_song_play
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod qq_tests {
    use super::{qq_guid_from_cookie, qq_search, qq_song_play, QqPlayArgs, QqSearchArgs};

    #[test]
    fn qq_guid_is_uuid_style_and_unique() {
        let first = qq_guid_from_cookie(None);
        let second = qq_guid_from_cookie(None);
        assert_eq!(first.len(), 32);
        assert_eq!(second.len(), 32);
        assert!(first.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert!(second.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    #[ignore = "uses the live QQ Music search service"]
    fn qq_search_returns_results() {
        let result = tauri::async_runtime::block_on(qq_search(QqSearchArgs {
            keyword: "周杰伦".to_string(),
            limit: Some(10),
        }))
        .expect("qq_search command failed");
        let songs = result
            .get("data")
            .and_then(serde_json::Value::as_array)
            .expect("missing search data");
        assert!(!songs.is_empty(), "QQ search returned no songs: {result}");
        assert!(songs.iter().all(|song| song.get("qqMid").is_some()));

        let first = &songs[0];
        let play_result = tauri::async_runtime::block_on(qq_song_play(QqPlayArgs {
            songmid: first["qqMid"].as_str().unwrap_or_default().to_string(),
            media_mid: first["qqMediaMid"].as_str().map(str::to_string),
            level: Some("standard".to_string()),
        }))
        .expect("search result playback command failed");
        assert!(
            play_result
                .pointer("/data/url")
                .and_then(serde_json::Value::as_str)
                .is_some(),
            "first QQ search result was not playable: {play_result}"
        );
    }
}
