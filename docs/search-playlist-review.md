# 搜索与歌单逻辑检查

## 设置与队列交互补充

- 1.5.1 修正毛玻璃与窗口圆角的边界不一致。此前 1.5.0 的自定义 `SetWindowRgn` 方案经用户反馈未解决实际显示问题，已撤掉。改为清除自定义窗口区域，通过 `DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND` 让 DWM 同时处理原生圆角和材质；界面外框及封面背景同步使用 8px，内部封面卡片保持原样。尺寸及 DPI 变化由 DWM 处理，不再注册圆角的 resize 回调，也不在滚动时调用原生设置。见 [Microsoft 原生圆角说明](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/ui/apply-rounded-corners) 与 [Windows 11 的 8px 窗口圆角规范](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/geometry)。
- 本轮用独立标识的 Tauri/WebView2 实例加载真实 App，仅模拟账号数据，保留真实毛玻璃命令。实测 1080px 与 700px 宽度、背景模糊关闭/开启、封面背景开启，检查了原生窗口截图；运行状态为无自定义区域、DWM 圆角值 2、毛玻璃值 3。700px 封面场景截图保存在 `.tmp/cove-window-preview.png`。本机验证为 100% 显示缩放，跨 DPI 的原生视觉表现未单独实测。
- “全部退出”按钮最小宽度为 88 px，禁止收缩和换行，图标保持 12 px；700、900、1080 px 窗口宽度下验证单行显示。
- 播放队列打开时，在面板后方添加透明点击层，点击面板外部关闭队列；面板内部点击、滚动以及上层歌曲操作弹窗不触发该点击层。关闭按钮与 Esc 保留，不影响完整歌单页面的交互。
- 浏览器回归覆盖外部关闭、内部点击、歌曲菜单、滚轮、关闭按钮、反复打开及 Esc。队列列表的无障碍名称按当前模式选择，避免浏览歌单后切回队列仍标记为“歌单歌曲”。

## 本次修复

| 问题 | 原因 | 调整 |
| --- | --- | --- |
| 输入新关键词、切换音源时可能选中旧歌曲 | 搜索结果与输入状态分开保存，防抖期间仍显示、允许回车选择旧结果 | `useMusicSearch` 用关键词和音源标识结果归属；输入变化立即隐藏旧结果；请求清理后丢弃迟到响应 |
| 中文输入法确认可能触发播放 | Enter 未区分输入法组合事件 | 组合输入期间暂停搜索；确认输入时不播放 |
| 搜索报错显示为无结果或丢失原因 | Rust 未检查上游业务状态；IPC 拒绝值是字符串，页面只读取 `message` | Rust 区分失败、异常响应、正常空结果；IPC 将字符串错误统一为 Error；页面提供重试 |
| 搜索列表停留在上一组结果的底部 | 查询改变未重置滚动位置 | 查询、音源、打开状态变化时归零 |
| 列表切换、缩短后可能不显示歌曲 | 虚拟行起点可超出新列表长度；滚动状态只在部分事件中同步 | 统一使用有边界保护的 `getVirtualListRange`；绘制前同步滚动与尺寸，重新打开时重置，取消旧动画帧 |
| 首次显示依赖滚动触发重绘的风险 | 滚动容器同时使用 strict containment 和独立位移动画 | 显式 `min-height: 0`，滚动容器保留 layout/style containment，去掉其独立入场动画；外层抽屉动画保留 |
| 切换网易云、QQ、酷狗歌单后被旧响应覆盖 | App 与 store 各自持有请求代次，无法相互失效 | 所有平台统一走 store 的 `browsePlaylist`；`playlistCatalog` 按平台路由，统一过期检查、错误、加载状态 |
| 同一歌单加载中被重复请求 | 只判断已有歌曲，未判断正在加载 | 同平台、同 ID 的加载中请求不重复发起 |
| 点击侧边封面不切换歌曲 | 3D 透明容器截获点击，事件目标不是封面 | 透明容器不接收指针事件，封面按钮显式接收；真实页面回归已复现原问题 |
| 轮播箭头切换后歌曲未更新 | 父容器捕获指针导致按钮 click 被重定向；箭头处理函数仅改变焦点 | 箭头按钮不参与拖动捕获，切换焦点时同时请求对应歌单 |

## 调整后的职责

- `components/SearchOverlay.tsx`：输入、输入法事件、音源切换、结果与错误展示。
- `hooks/useMusicSearch.ts`：防抖、查询身份、请求生命周期、重试状态。
- `lib/native.ts`：统一 IPC 错误类型与停止等待能力。Abort 不会中止已经运行的 Rust 命令。
- `lib/playlistCatalog.ts`：平台歌单 ID、分页参数和加载函数的选择。
- `store/playerStore.ts`：统一管理歌单浏览状态及过期响应；浏览过程不修改播放队列。
- `components/CollectionSongVirtualList.tsx`：尺寸、滚动、可见行与行操作；滚动不触发网络请求。
- `lib/virtualList.ts`：可单独测试的窗口范围计算。
- `App.tsx`：连接页面与 store，移出搜索和歌曲虚拟列表组件。

## 验证方式

```powershell
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml netease_search_tests --offline
```

先运行 `pnpm dev`，再运行 `node scripts/check-search-playlists.mjs`。脚本使用 Playwright 与隔离的模拟 IPC 数据，验证搜索输入、竞态、输入法、错误重试、关闭重开，以及 2000 首歌单首屏、滚动、列表缩短、尺寸变化和实际 App 抽屉。

截图保存到 `.tmp/search-playlist-tests/`。浏览器模拟测试不代表真实网易云服务、登录状态、音频播放或桌面 WebView2 的验收。

本轮结果：87 个前端用例、2 个 Rust 搜索用例通过；TypeScript 检查、Vite 生产构建、浏览器组件和完整 App 回归通过。完整页面覆盖了侧边封面点击及上一个/下一个歌单，切到三首短歌单后无需滚动即可显示歌曲。

## 保留的限制与后续拆分边界

- 搜索仍只请求前 40 条，没有翻页；大量结果的分页需要同时扩展 Rust 参数、响应总数和前端加载状态。
- 歌单沿用先加载全部分页再展示的行为，并发上限为 4。大歌单的首次等待仍取决于网络；本次未改成边加载边显示。
- `App.tsx` 仍包含设置、账号歌单目录、启动队列和封面轮播；`playerStore.ts` 仍同时承担播放和浏览状态。下一步可拆分账号目录与播放启动控制，但需要覆盖登录切换、退出及启动加载的竞态。
- Rust 命令仍集中在 `src-tauri/src/lib.rs`，可按音源与认证拆分模块。本次保持接口路径不变，避免在缺少线上接口证据时更换搜索协议。

## 滚动性能优化

针对歌单、队列的共享虚拟列表，以及搜索结果封面加载进行了优化。

- 行定位样式移入行组件，避免父组件每次创建新 `style` 对象导致 `React.memo` 失效。滚动时复用未变化的歌曲行。
- 慢滚动保留已挂载的缓冲区，接近边缘才调整窗口；快速滚动按帧小批更新，避免积累一批新行后集中挂载。
- 容器尺寸由 `ResizeObserver` 缓存；滚动位置保存在 ref 中，仅窗口变化时更新 React 状态。
- `is-scrolling` 样式仅在开始和结束时切换。列表数据变化时取消持有旧长度的待执行动画帧。
- 歌单与搜索共用 `SongThumbnail`：平台缩略图、异步解码、搜索屏外图片延迟加载。封面失败缓存限制为 256 条，移除每次封面挂载时多余的状态同步 effect。

### 对比结果

条件为 Chromium 无头浏览器、React 开发构建、2000 首模拟歌曲、本地封面，慢滚每帧 18 px、快滚每帧 174 px，各运行 240 帧。数字用于同条件的代码开销对比，不等同于真实桌面 FPS。

| 指标 | 修改前 | 最终版本 |
| --- | ---: | ---: |
| 慢滚歌曲行渲染次数 | 1470 | 70 |
| 快滚歌曲行渲染次数 | 4780 | 720 |
| 慢滚 React 提交次数 | 148 | 10 |
| 慢滚脚本耗时 | 190.5 ms | 69.6 ms |
| 快滚脚本耗时 | 555.7 ms | 377.7 ms |
| 检测到可见区域未覆盖的帧数 | 0 | 0 |

最终最大挂载行数为 27 行。快滚保留按帧更新，所以提交次数约为每帧一次；减少的是未变化行的渲染工作。基线在该环境本就没有明显掉帧，最终快滚 P95 帧间隔为 18.3 ms，基线为 17.9 ms；本轮证明了脚本和 React 工作量下降，不能据此宣称桌面卡顿完全消除。

验证结果：90 个单元用例通过，TypeScript 检查及生产构建通过；浏览器回归覆盖真实滚轮、快速反向、滚动时缩短列表、歌曲点击及菜单操作，以及完整 App 歌单切换与搜索导航。

复现命令（先运行 `pnpm dev`）：

```powershell
node scripts/profile-scroll.mjs current --check
node scripts/check-search-playlists.mjs
```

性能原始数据位于 `.tmp/scroll-profile/before.json` 与 `.tmp/scroll-profile/after-final.json`。桌面 WebView2、真实封面网络及实际播放场景仍需实测；本次没有重写歌词手动滚动逻辑。

## 背景模糊度检查

原滑杆控制的是歌曲封面图的 CSS `filter: blur(...)`；“使用封面背景”默认关闭，关闭时没有对应图片，但滑杆仍然可操作，因此看起来没有效果。原实现没有启用透明窗口后的桌面模糊。

原滑杆调整为“封面背景模糊度”，在封面背景关闭或当前没有封面时禁用，并显示原因。启用且存在封面时可调节。

另外新增独立的“桌面背景模糊”开关，默认开启，保存到 `nmp.desktopBlur`。`useDesktopBlur` 串行应用设置，原生命令仅对调用它的 Cove 窗口句柄设置 Windows Desktop Acrylic。只模糊透过软件窗口看到的背景，不修改壁纸、全局透明效果设置或其他窗口；关闭软件后该窗口效果随之消失。系统接口失败时显示错误，保持上次成功的开关状态，允许重试。

采用 Windows 11 22H2（build 22621）起提供的 `DWMWA_SYSTEMBACKDROP_TYPE`，模糊半径由系统控制，因此桌面效果提供开关，封面效果保留像素滑杆。见 [Microsoft DWM_SYSTEMBACKDROP_TYPE 文档](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)。WebView 的全窗口 CSS `backdrop-filter` 仍关闭；原生效果在启动、修改开关及窗口移动/缩放开始与结束时应用，滚动及封面调整不重复调用原生接口。

回归脚本 `node scripts/check-background.mjs` 覆盖开关、失败重试、保存重载、封面 0/60 px 画面变化与禁用条件，以及封面调整不重设原生效果。`cargo test --manifest-path src-tauri/Cargo.toml native_desktop_blur_smoke --offline -- --ignored --nocapture` 在本机创建隐藏测试窗口，检查真实 Windows 接口的启用和关闭。该原生测试验证接口成功，不代表实际 Cove WebView2 的视觉效果或桌面滚动性能已验收。

## 窗口拖动性能保护（1.5.2）

桌面 Acrylic 原先在窗口移动时持续启用。新增窗口线程上的原生消息处理，在 `WM_ENTERSIZEMOVE` 暂停此材质，在 `WM_EXITSIZEMOVE` 恢复用户保存的开关状态。取消移动或隐藏窗口也会清理暂停状态；重复进入消息不会重复写入材质。拖动期间修改开关以最新选择为准，关闭的效果不会被松手事件重新开启。不会逐帧调用 DWM，也不修改封面模糊设置、播放状态或桌面设置。

Windows 移动和调整大小共用这组消息，见 [WM_ENTERSIZEMOVE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-entersizemove) 与 [WM_EXITSIZEMOVE](https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-exitsizemove)。Subclass 在窗口所属线程安装，设置命令通过同步窗口消息进入该线程；销毁时移除，状态按值保存于 subclass reference data。

验证结果：原生隐藏窗口测试覆盖启用、重复进入、结束恢复、拖动中开关变更、取消与关闭；隔离的真实 Tauri/WebView2 窗口完成实际鼠标拖动。空界面与封面背景 60 px 模糊两种场景均确认移动期间 DWM 材质为 NONE，松手后恢复 Acrylic。后者实际移动 120 px，57 个移动中采样全部为 NONE，记录在 `.tmp/real-window-drag.json`。

本机空界面 `SetWindowPos + DwmFlush` 对比未复现用户所述的严重卡顿，修改前后耗时范围有重叠，不能据此量化帧率提升或判定所有拖动卡顿已经消除。此版本已验证避免移动中持续使用桌面毛玻璃；真实账号、大队列播放及不同显卡环境的体验仍以安装包使用结果为准。

## 播放期间拖动窗口（1.5.3）

用户补充触发条件为歌曲播放中拖动。1.5.2 只暂停了桌面 Acrylic，音频时钟仍以约 30 Hz 发布 store 时间，继续驱动进度、逐字歌词遮罩、渐变与发光。播放中的验证补充了实际 HTMLAudioElement 解码播放、本地 WAV（静音）、2000 首模拟队列和 120 行歌词。

原生窗口仅在移动/调整大小的开始与结束向当前窗口发送 `cove://window-interaction`。`useAudioEngine` 收到开始事件后暂停 rAF、timeupdate 的画面时间发布以及正在运行的装饰动画，不暂停音频元素、不改音量或播放状态。结束或取消后从 audio.currentTime 同步一次，恢复时钟；拖动中暂停、播放或改变进度也以真实音频状态为准。关闭桌面毛玻璃时这项保护仍然生效。监听卸载后忽略迟到事件并清理动画暂停状态。

同一真实 Tauri/WebView2 测试窗口下，修改前约 4.94 秒的测试包含 137 次时间发布、5608 次播放器 DOM 变更；修改后约 4.69 秒包含 17 次时间发布、1058 次 DOM 变更（含拖动前后）。准确的原生拖动区间约 4.05 秒内，时钟保持不变，DOM 变更为 0；结束时发布一次真实播放时间。音频持续前进，未触发 pause 事件，结束后时钟误差约 24 ms。记录为 `.tmp/playing-drag-before.json` 和 `.tmp/playing-drag-after.json`。

原生消息结合真实音频的恢复回归覆盖：拖动中继续播放、暂停后跳到新进度再取消拖动、拖动中恢复播放、结束后重启时钟。脚本 `.tmp/check-playing-recovery.mjs <隔离预览进程 PID>` 验证通过。前后测试的 rAF P95 均约 7.1 ms，不能换算成已改善的桌面拖动 FPS；已验证的是播放画面不再持续抢占拖动期间的更新工作。真实网络音频、音频输出是否存在短暂 underrun 以及用户原始环境的主观流畅度仍需要实际使用确认。
