import hashlib
import json
import ssl
import time
import urllib.parse
import urllib.request
from pathlib import Path

ctx = ssl.create_default_context()
sess = json.loads(
    Path.home()
    .joinpath("AppData/Roaming/Netease Music Player/kugou_session.json")
    .read_text(encoding="utf-8")
)
token = sess["token"]
userid = sess["userid"]
SALT = "OIlwieks28dk2k092lksi2UIkp"
APPID = "1005"
CLIENTVER = "20489"
UA = "Android14-1070-11070-201-0-Play-wifi"


def sign(params: dict, body: str = "") -> str:
    parts = sorted(f"{k}={v}" for k, v in params.items())
    return hashlib.md5((SALT + "".join(parts) + body + SALT).encode()).hexdigest()


def base_params() -> dict:
    ct = str(int(time.time()))
    mid = hashlib.md5(ct.encode()).hexdigest()
    return {
        "dfid": "-",
        "mid": mid,
        "uuid": mid,
        "appid": APPID,
        "clientver": CLIENTVER,
        "clienttime": ct,
        "token": token,
        "userid": userid,
    }


def http_json(method: str, url: str, body: str | None = None, headers: dict | None = None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    data = body.encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
        return json.loads(r.read())


# Search songs
url = "http://mobiles.kugou.com/api/v3/search/song?" + urllib.parse.urlencode(
    {
        "keyword": "周杰伦",
        "page": "1",
        "pagesize": "15",
        "showtype": "14",
        "version": "9108",
    }
)
data = http_json("GET", url)
info = data.get("data", {}).get("info") or []
print("search", len(info))

for song in info[:12]:
    h = (song.get("hash") or "").lower()
    name = song.get("songname")
    album_audio_id = song.get("album_audio_id") or song.get("AlbumAudioId") or 0
    album_id = song.get("album_id") or song.get("AlbumID") or 0
    u = "https://m.kugou.com/app/i/getSongInfo.php?" + urllib.parse.urlencode(
        {"cmd": "playInfo", "hash": h}
    )
    j = http_json(
        "GET",
        u,
        headers={"Cookie": f"token={token}; userid={userid}"},
    )
    urlp = j.get("url") or ""
    print(
        name,
        "hash",
        h[:8],
        "aid",
        album_audio_id,
        "status",
        j.get("status"),
        "err",
        j.get("error"),
        "url_len",
        len(urlp) if isinstance(urlp, str) else 0,
        "privilege",
        j.get("privilege"),
    )
    if isinstance(urlp, str) and urlp.startswith("http"):
        print("  HIT playInfo", urlp[:120])
        break

    # gateway v5/url with album_audio_id
    for quality in ("128", "320", "flac"):
        body_obj = {
            "hash": h,
            "album_id": int(album_id) if album_id else 0,
            "album_audio_id": int(album_audio_id) if album_audio_id else 0,
            "quality": quality,
            "pid": 2,
            "pidversion": "3001",
            "behavior": "play",
        }
        body = json.dumps(body_obj, separators=(",", ":"))
        p = base_params()
        p["signature"] = sign(p, body)
        gurl = "https://gateway.kugou.com/v5/url?" + urllib.parse.urlencode(p)
        try:
            gj = http_json(
                "POST",
                gurl,
                body,
                headers={
                    "x-router": "tracker.kugou.com",
                    "Content-Type": "application/json",
                    "Cookie": f"token={token}; userid={userid}",
                    "kg-rc": "1",
                    "mid": p["mid"],
                    "dfid": "-",
                    "clienttime": p["clienttime"],
                },
            )
            surl = gj.get("url") or gj.get("data", {}).get("url") if isinstance(gj.get("data"), dict) else None
            # sometimes url is array
            if not surl and isinstance(gj.get("url"), list):
                surl = gj["url"][0] if gj["url"] else None
            err = gj.get("error") or gj.get("errmsg") or gj.get("error_msg")
            if surl or (gj.get("status") == 1):
                print("  gateway", quality, json.dumps(gj, ensure_ascii=False)[:250])
            elif quality == "128":
                print("  gateway128", "status", gj.get("status"), "err", err, "keys", list(gj.keys())[:10])
        except Exception as e:
            print("  gateway fail", e)

# Try known free hash patterns via media.store
print("--- try media.store ---")
# Alternative endpoint used by some clients
h = (info[0].get("hash") or "").lower() if info else ""
if h:
    for path, x_router in [
        ("/v5/url", "tracker.kugou.com"),
        ("/v2/url", "tracker.kugou.com"),
        ("/v1/url", "tracker.kugou.com"),
    ]:
        body_obj = {
            "hash": h,
            "album_id": 0,
            "album_audio_id": int(info[0].get("album_audio_id") or 0),
            "quality": "128",
        }
        body = json.dumps(body_obj, separators=(",", ":"))
        p = base_params()
        # pid required for some versions
        p["pid"] = "2"
        p["pidversion"] = "3001"
        p["signature"] = sign(p, body)
        gurl = f"https://gateway.kugou.com{path}?" + urllib.parse.urlencode(p)
        try:
            gj = http_json(
                "POST",
                gurl,
                body,
                headers={
                    "x-router": x_router,
                    "Content-Type": "application/json",
                    "Cookie": f"token={token}; userid={userid}",
                    "kg-rc": "1",
                },
            )
            print(path, json.dumps(gj, ensure_ascii=False)[:300])
        except Exception as e:
            print(path, "fail", e)
