from pathlib import Path

path = Path(r"C:\Users\saymiao\netease-music-player\src-tauri\src\lib.rs")
text = path.read_text(encoding="utf-8")
start = text.find(
    "/// After QQ OAuth cookies, best-effort bootstrap y.qq.com music cookies."
)
end = text.find("#[tauri::command]\nasync fn qq_qr_key", start)
assert start > 0 and end > start, (start, end)

new = r'''
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

'''

path.write_text(text[:start] + new + text[end:], encoding="utf-8")
print("ok", path.stat().st_size)
