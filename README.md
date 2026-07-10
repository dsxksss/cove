# Cove · 可沃

多音源沉浸式桌面音乐播放器 —— 液态玻璃界面 + 同步歌词 + 网易云 / QQ / 酷狗。

基于 **Tauri 2 + React 18 + Tailwind CSS v4 + Zustand + Motion** 构建。
网易云音频源可使用内置接口或 [Suxiaoqinx/Netease_url](https://github.com/Suxiaoqinx/Netease_url) 自托管服务。

---

## ✨ 功能

- 🔍 关键词搜索（歌曲 / 歌手）
- 🎧 播放 / 暂停 / 上一首 / 下一首 / 拖动进度条 seek
- 📝 实时同步歌词（当前行高亮 + 翻译），自动居中滚动
- 🎨 沉浸式背景：当前封面放大模糊 + 提取主色辉光
- 🔁 循环模式（顺序 / 列表循环 / 单曲循环）/ 🔀 随机
- 🔊 音量控制（持久化）
- 📋 播放队列抽屉
- ⚙️ 设置：API 地址、音质档位
- ⌨️ 键盘快捷键（见下）
- 🪟 无边框自定义窗口 + 系统托盘（关闭转最小化）

---

## 🚀 快速开始

### 1. 启动音频源服务（必须）

本项目不内置网易云接口，需要先跑起 [Netease_url](https://github.com/Suxiaoqinx/Netease_url)：

```bash
git clone https://github.com/Suxiaoqinx/Netease_url.git
cd Netease_url
pip install -r requirements.txt
# 配置 cookie：把 MUSIC_U 填入 cookie.txt（高音质需要黑胶会员）
#   格式：MUSIC_U=你的token; appver=8.9.75;
python main.py          # 默认监听 http://localhost:5000
```

或 Docker：

```bash
docker-compose up -d
```

> 💡 获取 Cookie：登录网页版网易云 → F12 → Network → 复制任意请求的 Cookie 里的 `MUSIC_U` 值。
> 没有 cookie 也能用 `standard`（128k）音质，更高音质需要黑胶会员 cookie。

### 2. 安装并启动本应用

```bash
cd netease-music-player
pnpm install
pnpm tauri dev
```

如果 API 不在 `http://localhost:5000`，启动后打开 **设置（左上角 ⚙️ 或 Ctrl+,）** 修改地址。

### 3. 仅前端调试（浏览器，不启动 Tauri）

```bash
pnpm dev
```

> 浏览器模式下窗口控制按钮为空操作；音频与搜索功能照常工作（只要 API 服务在跑）。

---

## ⌨️ 键盘快捷键

| 按键 | 功能 |
|---|---|
| `空格` | 播放 / 暂停 |
| `←` / `→` | 后退 / 前进 5 秒 |
| `Ctrl/⌘ + ←` / `→` | 上一首 / 下一首 |
| `↑` / `↓` | 音量 ±5% |
| `/` | 打开搜索 |
| `q` | 播放队列 |
| `l` | 登录 |
| `Ctrl/⌘ + ,` | 打开设置 |
| `Esc` | 关闭浮层 / 取消输入聚焦 |
| 系统媒体键 / 耳机线控 | 播放、暂停、切歌、快进退（Media Session） |

---

## 📁 项目结构

```
src/                          React 前端
├── components/
│   ├── ImmersiveBg.tsx       模糊封面背景 + 主色辉光
│   ├── NowPlaying.tsx        中央玻璃卡片（封面 + 歌词）
│   ├── AlbumArt.tsx          专辑封面（带辉光、播放态呼吸）
│   ├── LyricsView.tsx        同步歌词（当前行高亮滚动）
│   ├── PlayerBar.tsx         底部播放栏（进度/控制/音量/搜索/队列）
│   ├── ProgressBar.tsx       可拖动进度条
│   ├── SearchOverlay.tsx     搜索浮层 + 结果列表
│   ├── QueueDrawer.tsx       播放队列抽屉
│   ├── SettingsModal.tsx     设置（API 地址 / 音质）
│   └── WindowControls.tsx    自定义窗口按钮（最小化/最大化/关闭）
├── hooks/
│   ├── useAudioEngine.ts     把 <audio> 事件桥接进 store
│   └── useActiveLyric.ts     由当前时间派生歌词行索引
├── lib/
│   ├── api.ts                Netease_url 客户端（search / song-url / song-json）
│   ├── lyric.ts              LRC 解析 + 翻译合并 + 当前行二分查找
│   ├── color.ts              Canvas 提取封面主色
│   ├── audio.ts              单例 HTMLAudioElement
│   ├── tauri.ts              窗口控制（浏览器下空操作）
│   └── types.ts              共享类型
└── store/
    ├── playerStore.ts        Zustand：队列/播放/歌词/音量/循环
    └── uiStore.ts            Zustand：浮层开关

src-tauri/                    Rust 后端
├── src/{lib.rs, main.rs}     托盘 + 单实例 + 关闭转隐藏
├── tauri.conf.json           无边框窗口 1080×720
└── capabilities/default.json 窗口权限
```

---

## 🔌 API 接口（本应用使用）

| 用途 | 请求 | 取值 |
|---|---|---|
| 搜索 | `GET /search?keyword=&limit=30&type=1` | `data[]` |
| 播放 URL | `GET /song?id=&level=exhigh&type=url` | `data.url` |
| 歌词+封面+URL | `GET /song?id=&type=json` | `data.{name,pic,lyric,tlyric,url}` |

音质档位：`standard` `exhigh` `lossless` `hires` `jyeffect`（高音质需会员 cookie）。

---

## ⚠️ 已知限制

- **必须自托管 Netease_url** + 配置 `MUSIC_U` cookie 才能播放高音质。
- **版权/VIP 歌曲** 可能返回 `url: null`，应用会提示并自动跳到下一首。
- **部分歌曲无 LRC** 时显示「暂无歌词」，不报错。
- 跨域封面取主色可能因 canvas 污染失败，会回退到默认深色背景。

---

## 🛠️ 构建

```bash
pnpm tauri build          # 生成 NSIS / MSI 安装包
```

---

## 📄 许可

仅供学习交流使用，请遵守网易云音乐服务条款，支持正版。
