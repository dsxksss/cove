import json
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ctx = ssl.create_default_context()
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36"
raw = Path.home().joinpath("AppData/Roaming/Netease Music Player/qq_cookie.txt").read_text(
    encoding="utf-8"
).strip()
jar: dict[str, str] = {}
for p in raw.split(";"):
    if "=" in p:
        k, v = p.strip().split("=", 1)
        jar[k] = v
uin = re.sub(r"\D", "", jar.get("uin", ""))
skey = jar.get("skey", "")
h = 5381
for b in skey.encode():
    h = (h + ((h << 5) + b)) & 0x7FFFFFFF
print("uin", uin, "gtk", h)


def cookie_hdr() -> str:
    return "; ".join(f"{k}={v}" for k, v in jar.items())


def merge(headers) -> None:
    if not headers:
        return
    for hval in headers.get_all("Set-Cookie") or []:
        first = hval.split(";", 1)[0]
        if "=" in first:
            k, v = first.split("=", 1)
            jar[k.strip()] = v.strip()


def get(url: str, referer: str = "https://y.qq.com/"):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Cookie": cookie_hdr(), "Referer": referer}
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            merge(r.headers)
            return r.status, r.geturl(), r.read()[:400]
    except urllib.error.HTTPError as e:
        merge(e.headers)
        return e.code, e.headers.get("Location") if e.headers else None, b""


for tok in [str(h), jar.get("pt4_token", ""), jar.get("ptcz", "")[:20]]:
    if not tok:
        continue
    url = f"https://ssl.ptlogin2.qq.com/pt4_auth?daid=383&appid=716027609&auth_token={tok}"
    st, final, body = get(url, "https://xui.ptlogin2.qq.com/")
    print("pt4", tok[:24], st, final, body[:80])

redir = urllib.parse.quote("https://y.qq.com/", safe="")
urls = [
    f"https://y.qq.com/portal/wx_redirect.html?login_type=1&surl={redir}",
    f"https://graph.qq.com/oauth2.0/authorize?response_type=token&client_id=100497308&redirect_uri={redir}&state=1&display=pc",
    f"https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=100497308&redirect_uri={redir}&state=1&display=pc",
]
for u in urls:
    st, final, body = get(u)
    print("GET", u[:70], "st", st, "final", str(final)[:100], "music", "qm_keyst" in jar)

# Follow authorize with no redirect handler
class NoRedir(urllib.request.HTTPErrorProcessor):
    def http_response(self, request, response):
        return response

    https_response = http_response


opener = urllib.request.build_opener(NoRedir)
url = f"https://graph.qq.com/oauth2.0/authorize?response_type=token&client_id=100497308&redirect_uri={redir}&state=1&display=pc"
for i in range(10):
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Cookie": cookie_hdr(), "Referer": "https://y.qq.com/"}
    )
    try:
        resp = opener.open(req, timeout=20)
        merge(resp.headers)
        st = resp.status
        loc = resp.headers.get("Location")
        body = resp.read()[:200]
    except urllib.error.HTTPError as e:
        merge(e.headers)
        st = e.code
        loc = e.headers.get("Location") if e.headers else None
        body = b""
    print(f"auth{i}", st, "loc", (loc or "")[:200])
    if loc and ("access_token" in loc or "code=" in loc):
        print("FOUND", loc)
        frag = loc.split("#", 1)[-1] if "#" in loc else loc.split("?", 1)[-1]
        qs = urllib.parse.parse_qs(frag)
        access = (qs.get("access_token") or [None])[0]
        code = (qs.get("code") or [None])[0]
        print("access", bool(access), "code", bool(code))
        # QQLogin
        param: dict = {"expired_in": 7776000}
        if access:
            param["access_token"] = access
        if code:
            param["code"] = code
        body_obj = {
            "comm": {
                "uin": uin,
                "format": "json",
                "ct": 24,
                "cv": 0,
                "g_tk": h,
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
                "Cookie": cookie_hdr(),
            },
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
            merge(r.headers)
            j = json.loads(r.read())
        print("login", json.dumps(j, ensure_ascii=False)[:600])
        d = ((j.get("req_0") or {}).get("data")) or {}
        mk = d.get("musickey") or d.get("musicKey") or d.get("sessionKey")
        if mk:
            jar["qm_keyst"] = str(mk)
            jar["qqmusic_key"] = str(mk)
            print("GOT musickey len", len(str(mk)))
        break
    if not loc:
        # parse body for access_token
        if b"access_token" in body:
            print("body has token", body[:200])
        break
    url = loc if loc.startswith("http") else urllib.parse.urljoin(url, loc)

print("music?", "qm_keyst" in jar)
print("key-like", [k for k in sorted(jar) if any(x in k.lower() for x in ("key", "token", "open", "login"))])
