"""Diagnose QQ Music cookie + GetVkey without printing secret values."""
from __future__ import annotations

import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

cookie_path = Path.home() / "AppData/Roaming/Netease Music Player/qq_cookie.txt"
raw = cookie_path.read_text(encoding="utf-8", errors="ignore").strip()
print("cookie_len", len(raw))
keys = [p.split("=", 1)[0].strip() for p in raw.split(";") if "=" in p]
print("keys", keys)
print("has_music_key", "qm_keyst" in keys or "qqmusic_key" in keys)

m = re.search(r"uin=o?(\d+)", raw)
uin = m.group(1) if m else "0"
sm = re.search(r"(?:^|;\s*)skey=([^;]+)", raw)
skey = sm.group(1).strip() if sm else ""
pm = re.search(r"p_skey=([^;]+)", raw)
pskey = pm.group(1).strip() if pm else ""
sk = re.search(r"superkey=([^;]+)", raw)
superkey = sk.group(1).strip() if sk else ""


def gtk(key: str) -> int:
    h = 5381
    for b in key.encode():
        h = (h + ((h << 5) + b)) & 0x7FFFFFFF
    return h


g = gtk(skey or pskey)
print("uin", uin, "gtk", g, "superkey_len", len(superkey), "skey_len", len(skey))

ctx = ssl.create_default_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def parse_cookie_header(header: str) -> dict[str, str]:
    jar: dict[str, str] = {}
    for p in header.split(";"):
        p = p.strip()
        if "=" in p:
            k, v = p.split("=", 1)
            k, v = k.strip(), v.strip()
            if k and v:
                jar[k] = v
    return jar


def cookie_header(jar: dict[str, str]) -> str:
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def merge_set_cookie(jar: dict[str, str], headers) -> None:
    sc = headers.get_all("Set-Cookie") if hasattr(headers, "get_all") else None
    if not sc:
        # http.client style
        raw_sc = headers.get("Set-Cookie")
        sc = [raw_sc] if raw_sc else []
    for h in sc or []:
        first = h.split(";", 1)[0]
        if "=" in first:
            k, v = first.split("=", 1)
            k, v = k.strip(), v.strip()
            if k and v and k.lower() not in {
                "path",
                "domain",
                "expires",
                "max-age",
                "secure",
                "httponly",
                "samesite",
            }:
                jar[k] = v


def http(
    method: str,
    url: str,
    jar: dict[str, str],
    body: bytes | None = None,
    headers: dict | None = None,
    allow_redirects: bool = True,
):
    h = {
        "User-Agent": UA,
        "Cookie": cookie_header(jar),
        "Referer": "https://y.qq.com/",
        "Origin": "https://y.qq.com",
    }
    if headers:
        h.update(headers)
    if body is not None:
        h.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    # manual redirect for cookie merge
    for _ in range(8):
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
                data = r.read()
                merge_set_cookie(jar, r.headers)
                return r.status, data, dict(r.headers)
        except urllib.error.HTTPError as e:
            merge_set_cookie(jar, e.headers)
            if e.code in (301, 302, 303, 307, 308) and allow_redirects:
                loc = e.headers.get("Location")
                if not loc:
                    raise
                req = urllib.request.Request(
                    urllib.parse.urljoin(url, loc),
                    headers={
                        "User-Agent": UA,
                        "Cookie": cookie_header(jar),
                        "Referer": "https://y.qq.com/",
                    },
                    method="GET",
                )
                url = loc
                continue
            raise


jar = parse_cookie_header(raw)

# GetVkey baseline
mid = "0039MnYb0qxYhV"
body = {
    "comm": {
        "uin": uin,
        "format": "json",
        "ct": 24,
        "cv": 0,
        "g_tk": g,
        "platform": "yqq.json",
        "needNewCode": 1,
    },
    "req_0": {
        "module": "vkey.GetVkeyServer",
        "method": "CgiGetVkey",
        "param": {
            "guid": "7332953645",
            "songmid": [mid],
            "songtype": [0],
            "uin": uin,
            "loginflag": 1,
            "platform": "20",
            "filename": [f"M500{mid}.mp3"],
        },
    },
}
status, data, _ = http("POST", "https://u.y.qq.com/cgi-bin/musicu.fcg", jar, json.dumps(body).encode())
j = json.loads(data)
info = ((j.get("req_0") or {}).get("data") or {}).get("midurlinfo") or [{}]
print(
    "GetVkey code",
    (j.get("req_0") or {}).get("code"),
    "purl_len",
    len((info[0] or {}).get("purl") or ""),
    "errtype",
    (info[0] or {}).get("errtype"),
    "subcode",
    (info[0] or {}).get("subcode"),
)

# jump superkey
if superkey:
    for keyindex in ("19", "9", "23"):
        q = urllib.parse.urlencode(
            {
                "clientuin": uin,
                "clientkey": superkey,
                "keyindex": keyindex,
                "pt_aid": "716027609",
                "daid": "383",
                "u1": "https://y.qq.com/",
                "ptopt": "1",
                "style": "40",
            }
        )
        url = f"https://ssl.ptlogin2.qq.com/jump?{q}"
        try:
            st, body, _ = http("GET", url, jar, allow_redirects=True)
            print("jump", keyindex, "status", st, "music?", "qm_keyst" in jar or "qqmusic_key" in jar)
        except Exception as e:
            print("jump", keyindex, "fail", type(e).__name__, e)

# homepage
try:
    st, _, _ = http("GET", "https://y.qq.com/", jar)
    print("y.qq", st, "music?", "qm_keyst" in jar)
except Exception as e:
    print("y.qq fail", e)

try:
    st, _, _ = http("GET", "https://i.y.qq.com/n2/m/index.html", jar)
    print("i.y.qq", st, "music?", "qm_keyst" in jar)
except Exception as e:
    print("i.y.qq fail", e)

login_bodies = [
    {
        "comm": {
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "g_tk": g,
            "platform": "yqq.json",
            "needNewCode": 1,
        },
        "req_0": {"module": "QQConnectLogin.LoginServer", "method": "QQLogin", "param": {}},
    },
    {
        "comm": {
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "g_tk": g,
            "platform": "yqq.json",
            "needNewCode": 1,
        },
        "req_0": {
            "module": "music.login.LoginServer",
            "method": "Login",
            "param": {"strAppid": "100497308"},
        },
    },
    {
        "comm": {
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "g_tk": g,
            "platform": "yqq.json",
            "needNewCode": 1,
        },
        "req_0": {
            "module": "music.login.LoginServer",
            "method": "Login",
            "param": {},
        },
    },
    # wx_redirect style appid login
    {
        "comm": {
            "g_tk": g,
            "uin": uin,
            "format": "json",
            "inCharset": "utf-8",
            "outCharset": "utf-8",
            "notice": 0,
            "platform": "h5",
            "needNewCode": 1,
            "ct": 23,
            "cv": 0,
        },
        "req_0": {
            "module": "music.login.LoginServer",
            "method": "Login",
            "param": {"strAppid": "100497308"},
        },
    },
]

for i, b in enumerate(login_bodies, 1):
    try:
        st, data, _ = http(
            "POST",
            "https://u.y.qq.com/cgi-bin/musicu.fcg",
            jar,
            json.dumps(b).encode(),
        )
        j = json.loads(data)
        s = json.dumps(j, ensure_ascii=False)
        print(
            f"login{i}",
            "codes",
            {k: (j.get(k) or {}).get("code") for k in j if str(k).startswith("req")},
            "music?",
            "qm_keyst" in jar or "qqmusic_key" in jar,
        )
        # extract potential keys from JSON
        for path in re.findall(r'"(?:musickey|musicKey|sessionKey|key|qm_keyst|qqmusic_key)"\s*:\s*"([^"]{8,})"', s):
            print("  json_key_len", len(path))
            jar.setdefault("qqmusic_key", path)
            jar.setdefault("qm_keyst", path)
        print("  snippet", s[:220].replace("\n", " "))
    except Exception as e:
        print(f"login{i} fail", e)

# auth.music.qq.com style?
for url in [
    f"https://authc.music.qq.com/login/transfer?g_tk={g}&uin={uin}",
    "https://y.qq.com/portal/profile.html",
    f"https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&userid={uin}&reqfrom=1&reqtype=0&g_tk={g}&loginUin={uin}&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
]:
    try:
        st, data, _ = http("GET", url, jar)
        print("GET", url.split("?")[0], "st", st, "music?", "qm_keyst" in jar, "body", data[:80])
    except Exception as e:
        print("GET fail", url.split("?")[0], type(e).__name__)

print("FINAL music?", "qm_keyst" in jar or "qqmusic_key" in jar)
print("final keys", sorted(jar.keys()))

# Retry GetVkey after enrichment
body["comm"]["g_tk"] = gtk(jar.get("skey") or jar.get("p_skey") or skey)
if jar.get("qm_keyst") or jar.get("qqmusic_key"):
    ak = jar.get("qm_keyst") or jar.get("qqmusic_key")
    body["comm"]["authst"] = ak
    body["comm"]["qqmusic_key"] = ak
status, data, _ = http(
    "POST",
    "https://u.y.qq.com/cgi-bin/musicu.fcg",
    jar,
    json.dumps(body).encode(),
)
j = json.loads(data)
info = ((j.get("req_0") or {}).get("data") or {}).get("midurlinfo") or [{}]
print(
    "GetVkey2 code",
    (j.get("req_0") or {}).get("code"),
    "purl_len",
    len((info[0] or {}).get("purl") or ""),
    "errtype",
    (info[0] or {}).get("errtype"),
)
