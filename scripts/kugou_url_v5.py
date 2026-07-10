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
userid = str(sess["userid"])
SALT = "OIlwieks28dk2k092lksi2UIkp"
APPID = "1005"
CLIENTVER = "20489"
UA = "Android14-1070-11070-201-0-Play-wifi"


def sign(params: dict, body: str = "") -> str:
    parts = sorted(f"{k}={v}" for k, v in params.items())
    return hashlib.md5((SALT + "".join(parts) + body + SALT).encode()).hexdigest()


def http(method, url, body=None, headers=None):
    h = {"User-Agent": UA}
    if headers:
        h.update(headers)
    data = body.encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, context=ctx, timeout=20) as r:
        return json.loads(r.read())


# get a song
search = http(
    "GET",
    "http://mobiles.kugou.com/api/v3/search/song?"
    + urllib.parse.urlencode(
        {
            "keyword": "告白气球",
            "page": "1",
            "pagesize": "1",
            "showtype": "14",
            "version": "9108",
        }
    ),
)
song = search["data"]["info"][0]
h = song["hash"]
aid = int(song.get("album_audio_id") or 0)
alid = str(song.get("album_id") or "0")
print("song", song["songname"], "hash", h, "aid", aid, "alid", alid)

# Candidate bodies from reverse-engineered mobile clients
candidates = []
resource = {
    "album_audio_id": aid,
    "album_id": alid,
    "hash": h,
    "id": 0,
    "name": song.get("songname") or "",
    "type": "audio",
}
candidates.append(
    {
        "area_code": "1",
        "behavior": "play",
        "qualities": ["128", "320", "flac"],
        "resource": [resource],
    }
)
candidates.append(
    {
        "behavior": "play",
        "relate": 1,
        "resource": [resource],
        "qualities": ["128"],
    }
)
candidates.append(
    {
        "fields": "hash,album_id,album_audio_id,filesize,timelength,url",
        "resource": [resource],
    }
)
# older single-object
candidates.append(
    {
        "hash": h,
        "album_audio_id": aid,
        "album_id": int(alid) if alid.isdigit() else 0,
        "quality": "128",
        "pid": 2,
        "pidversion": "3001",
        "behavior": "play",
        "module": "",
        "page_id": 1128,
    }
)

for i, body_obj in enumerate(candidates):
    body = json.dumps(body_obj, separators=(",", ":"), ensure_ascii=False)
    ct = str(int(time.time()))
    mid = hashlib.md5(ct.encode()).hexdigest()
    params = {
        "dfid": "-",
        "mid": mid,
        "uuid": mid,
        "appid": APPID,
        "clientver": CLIENTVER,
        "clienttime": ct,
        "token": token,
        "userid": userid,
    }
    params["signature"] = sign(params, body)
    url = "https://gateway.kugou.com/v5/url?" + urllib.parse.urlencode(params)
    headers = {
        "x-router": "tracker.kugou.com",
        "Content-Type": "application/json;charset=utf-8",
        "Cookie": f"token={token}; userid={userid}",
        "kg-rc": "1",
        "KG-RC": "1",
        "mid": mid,
        "dfid": "-",
        "clienttime": ct,
        "userid": userid,
        "token": token,
    }
    try:
        j = http("POST", url, body, headers)
        print(f"cand{i}", json.dumps(j, ensure_ascii=False)[:350])
        # walk for url fields
        s = json.dumps(j)
        if "http" in s and "error" not in s[:80].lower():
            print("  maybe success")
    except Exception as e:
        print(f"cand{i} FAIL", e)

# wwwapi with album_id
mid = hashlib.md5(str(time.time()).encode()).hexdigest()
for extra in [
    {"r": "play/getdata", "hash": h, "album_id": alid, "dfid": "-", "mid": mid, "platid": "4"},
    {
        "r": "play/getdata",
        "hash": h,
        "album_id": alid,
        "album_audio_id": str(aid),
        "dfid": "-",
        "mid": mid,
        "platid": "4",
        "userid": userid,
        "token": token,
        "appid": APPID,
    },
]:
    url = "https://wwwapi.kugou.com/yy/index.php?" + urllib.parse.urlencode(extra)
    try:
        j = http(
            "GET",
            url,
            headers={
                "Cookie": f"token={token}; userid={userid}",
                "Referer": "https://www.kugou.com/",
                "User-Agent": "Mozilla/5.0",
            },
        )
        print("wwwapi", extra.get("album_audio_id"), json.dumps(j, ensure_ascii=False)[:300])
    except Exception as e:
        print("wwwapi fail", e)

# free trial via vipauth - openapi
for path in [
    f"https://m.kugou.com/api/v1/song/get_song_info?cmd=playInfo&hash={h}&from=mkugou&userid={userid}&token={token}",
    f"https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash={h}&album_id={alid}&album_audio_id={aid}",
]:
    try:
        j = http(
            "GET",
            path,
            headers={"Cookie": f"token={token}; userid={userid}"},
        )
        print(
            "play",
            path.split("?")[0].split("/")[-1],
            "status",
            j.get("status"),
            "err",
            j.get("error"),
            "url",
            (j.get("url") or "")[:80] if isinstance(j.get("url"), str) else j.get("url"),
        )
    except Exception as e:
        print("play fail", e)
