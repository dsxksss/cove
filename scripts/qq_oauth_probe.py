import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ctx = ssl.create_default_context()
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)
raw = Path.home().joinpath("AppData/Roaming/Netease Music Player/qq_cookie.txt").read_text(
    encoding="utf-8"
).strip()
jar: dict[str, str] = {}
for p in raw.split(";"):
    if "=" in p:
        k, v = p.strip().split("=", 1)
        jar[k] = v
uin = re.sub(r"\D", "", jar.get("uin") or jar.get("p_uin") or "0")
superkey = jar.get("superkey", "")
skey = jar.get("skey", "")
print("uin", uin)


def cookie_str() -> str:
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def merge_sc(headers) -> None:
    sc = headers.get_all("Set-Cookie") if headers is not None else None
    if not sc:
        return
    for h in sc:
        first = h.split(";", 1)[0]
        if "=" in first:
            k, v = first.split("=", 1)
            jar[k.strip()] = v.strip()


def get(url: str, referer: str = "https://y.qq.com/") -> tuple[int, str | None, bytes]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Cookie": cookie_str(),
            "Referer": referer,
        },
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as resp:
            merge_sc(resp.headers)
            return resp.status, resp.geturl(), resp.read()
    except urllib.error.HTTPError as e:
        merge_sc(e.headers)
        loc = e.headers.get("Location") if e.headers else None
        return e.code, loc, b""


# 1) OAuth authorize (implicit token) with existing QQ session cookies
auth_url = "https://graph.qq.com/oauth2.0/authorize?" + urllib.parse.urlencode(
    {
        "response_type": "token",
        "client_id": "100497308",
        "redirect_uri": "https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/",
        "state": "state",
        "display": "pc",
        "scope": "get_user_info",
    }
)
st, final, body = get(auth_url, "https://y.qq.com/")
print("authorize", st, "final", (final or "")[:250], "body", body[:120])

# manual no-redirect follow
class NoRedir(urllib.request.HTTPErrorProcessor):
    def http_response(self, request, response):
        return response

    https_response = http_response


opener = urllib.request.build_opener(NoRedir)


def get_noredirect(url: str, referer: str = "https://y.qq.com/"):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Cookie": cookie_str(), "Referer": referer},
    )
    # can't pass context to opener easily on all py; use urlopen for HTTPS default context
    try:
        resp = opener.open(req, timeout=20)
        merge_sc(resp.headers)
        return resp.status, resp.headers.get("Location"), resp.read()[:200]
    except urllib.error.HTTPError as e:
        merge_sc(e.headers)
        return e.code, e.headers.get("Location") if e.headers else None, b""


url = auth_url
for i in range(8):
    st, loc, body = get_noredirect(url, "https://graph.qq.com/" if i else "https://y.qq.com/")
    print(f"step{i}", st, "loc", (loc or "")[:220])
    if loc and ("access_token" in loc or "code=" in loc or "#" in loc):
        print("TOKEN", loc[:400])
        # parse fragment
        frag = loc.split("#", 1)[-1] if "#" in loc else loc.split("?", 1)[-1]
        qs = urllib.parse.parse_qs(frag)
        print("parsed", {k: (v[0][:12] + "...") if v and len(v[0]) > 12 else v for k, v in qs.items()})
        access = (qs.get("access_token") or [None])[0]
        code = (qs.get("code") or [None])[0]
        if access or code:
            # QQConnect login with token
            g = 5381
            sk = jar.get("skey") or ""
            h = 5381
            for b in sk.encode():
                h = (h + ((h << 5) + b)) & 0x7FFFFFFF
            g = h
            param = {"expired_in": 7776000, "musicid": "0", "musickey": ""}
            if access:
                param["access_token"] = access
                param["onlyNeedAccessToken"] = 0
                param["forceRefreshToken"] = 0
            if code:
                param["code"] = code
            body_obj = {
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
                    "module": "QQConnectLogin.LoginServer",
                    "method": "QQLogin",
                    "param": param,
                },
            }
            data = json.dumps(body_obj).encode()
            req = urllib.request.Request(
                "https://u.y.qq.com/cgi-bin/musicu.fcg",
                data=data,
                headers={
                    "User-Agent": UA,
                    "Content-Type": "application/json",
                    "Referer": "https://y.qq.com/",
                    "Origin": "https://y.qq.com",
                    "Cookie": cookie_str(),
                },
                method="POST",
            )
            with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
                merge_sc(r.headers)
                j = json.loads(r.read())
            print("QQLogin", json.dumps(j, ensure_ascii=False)[:500])
            d = ((j.get("req_0") or {}).get("data")) or {}
            for k in ("musickey", "musicKey", "key", "access_token", "refresh_token", "musicid"):
                if d.get(k):
                    print(" got", k, "len", len(str(d[k])))
                    if k.lower() in ("musickey", "musickey", "key"):
                        jar["qm_keyst"] = str(d[k])
                        jar["qqmusic_key"] = str(d[k])
            break
    if not loc or st == 200:
        break
    if loc.startswith("http"):
        url = loc
    else:
        url = urllib.parse.urljoin(url, loc)

print("music keys?", "qm_keyst" in jar, "qqmusic_key" in jar)
print("final keys", sorted(jar.keys()))

# If we got music key, test M500
if jar.get("qm_keyst") or jar.get("qqmusic_key"):
    ak = jar.get("qm_keyst") or jar.get("qqmusic_key")
    sk = jar.get("skey") or ""
    h = 5381
    for b in sk.encode():
        h = (h + ((h << 5) + b)) & 0x7FFFFFFF
    media = "0012Ez0a1tFcOI"
    mid = "004Z8Ihr0JIu5s"
    body_obj = {
        "comm": {
            "uin": uin,
            "format": "json",
            "ct": 24,
            "cv": 0,
            "g_tk": h,
            "platform": "yqq.json",
            "needNewCode": 1,
            "authst": ak,
            "qqmusic_key": ak,
        },
        "req_0": {
            "module": "vkey.GetVkeyServer",
            "method": "CgiGetVkey",
            "param": {
                "guid": "10000",
                "songmid": [mid],
                "songtype": [0],
                "uin": uin,
                "loginflag": 1,
                "platform": "20",
                "filename": [f"M500{media}.mp3"],
            },
        },
    }
    req = urllib.request.Request(
        "https://u.y.qq.com/cgi-bin/musicu.fcg",
        data=json.dumps(body_obj).encode(),
        headers={
            "User-Agent": UA,
            "Content-Type": "application/json",
            "Referer": "https://y.qq.com/",
            "Cookie": cookie_str(),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
        j = json.loads(r.read())
    info = (((j.get("req_0") or {}).get("data") or {}).get("midurlinfo") or [{}])[0] or {}
    print("M500 after login code", (j.get("req_0") or {}).get("code"), "purl_len", len(info.get("purl") or ""))
