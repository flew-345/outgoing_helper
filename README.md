# 珞珈畅行

面向武汉大学校园的出行助手，提供地图选点、步行与自行车道路规划，以及校巴线路、车辆位置和剩余站数查询。当前版本为 `0.1.0`；本文按 2026-10-11 的源码整理。

自有路线在浏览器中基于 OSM 路网计算，不需要高德 Key。校巴默认由网站服务端自动采集校方 H5 数据，通过同源 `/api/transit` 接入，无需单独启动 Python 或填写接口地址。

## 文档导航

- [待办清单](TODO.md)：已完成能力、源码缺口、优先级和验收条件。
- [数据与接口说明](docs/DATA-INTERFACES.md)：已有接口契约、上游解析、路网规则和缺失接口。
- [团队交付说明](docs/TEAM-PREVIEW.md)：免安装预览包的运行与数据限制。
- [开发约定](AGENTS.md)：相关测试与 Git commit 要求。

旧的 MVP、校巴接入和道路规划文档已整合到上述文档，避免多份说明的功能状态不一致。

## 当前功能与边界

| 功能             | 当前实现                                                          | 使用边界                                           |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| 步行、自行车规划 | 有向路网 Dijkstra、道路距离与步骤、通行权限筛选                   | 耗时按固定速度估算，未接入实时门禁、坡度和临时封路 |
| 校巴组合路线     | 步行到站 → 单次乘车 → 步行到终点，按实际轨迹与站序匹配            | 无多线换乘，不判断当前是否运营；候车与乘车耗时未知 |
| 校巴查询         | 1、2、5 号线及 5 号线返向，共四个方向；站次、轨迹、车辆、剩余站数 | 无服务端 ETA 分钟；空响应、失败和过期快照分别显示  |
| 地点与地图       | 八个预置地点、模糊搜索、起终点交换、地图选终点、定位起点          | 多数预置坐标是建筑中心，入口尚未核实               |
| 收藏             | 预置地点收藏写入 localStorage                                     | 自选地图地点尚不能完整恢复                         |
| 地图底图         | Leaflet + Esri 灰色底图与卫星影像                                 | 瓦片需要联网                                       |
| 公告与问答       | 公告筛选、本地规则问答、桌面与手机布局                            | 公告为固定演示记录，问答未接入大模型               |
| 高德入口         | 可选步行/骑行 URI 跳转，预留 `RouteProvider`                      | 高德独立规划，未实现服务端路线 API                 |

方案数量取决于道路和站点是否可达，并非每次都有三种方案。校巴总耗时保持未知，不参与“估算最快”比较。道路缺失、越界或不连通时不会画直线替代路线。自行车规划不代表共享电动车服务，当前没有真实租车库存、平台价格或开锁接口。

## 安装与开发

在本项目根目录执行。需要 Node.js **22.12+**；使用采集器还需要 Python **3.10+**。

```powershell
npm ci
npm run dev
```

打开 [开发页面](http://127.0.0.1:3000)。端口占用时使用 `npm run dev -- --port 3001`。只有使用独立采集脚本、离线捕获时才需要 `python -m pip install -r scripts/transit/requirements.txt`。

开发服务、普通 Next.js 服务及 Cloudflare 部署默认读取同源 `/api/transit`。打开网页即开始轮询，无人访问时不持续请求校方。浏览器每 10 秒读取一次；服务端合并并发请求、复用最近 10 秒的结果，站点和轨迹缓存 6 小时。Cloudflare 还使用同一边缘节点的 Cache API 共享最近快照，无需新增 R2、KV 或外部服务器；不同节点可能独立采集。

车辆读取时间超过 30 秒会标为过期。上游失败保留上次成功车辆及其时间，首次完全失败返回 503，并在后续轮询重试；不会自动拿随包旧快照冒充实采。`?live=0` 可显式查看随包快照，`?live=1` 显式选择自动接口。线上访问会迁移旧的默认快照或本机采集地址；自定义远端地址仍保留，数据地址留空恢复默认。

仍可按需使用独立 Python 采集器：

```powershell
python scripts/transit/collector.py --serve --no-persist
```

这只是调试、捕获的可选方式，网站自动接口无需此进程。

## 静态包接入独立采集器（可选）

先构建静态页面：

```powershell
$env:TRANSIT_STATIC_EXPORT = '1'
npm run build
Remove-Item Env:TRANSIT_STATIC_EXPORT
```

终端 A 持续采集：

```powershell
python scripts/transit/collector.py --serve --no-persist
```

终端 B 提供网页与同源代理：

```powershell
node scripts/preview-server.mjs --root out --port 4174 --feed http://127.0.0.1:8766/api/transit --no-open
```

打开 [路线规划页](http://127.0.0.1:4174/?live=1)，或 [校巴页](http://127.0.0.1:4174/?live=1&view=bus)。`live=1` 选择同源 `/api/transit`，优先于浏览器保存的旧地址。`--feed` 同时代理 `/api/transit` 和 `/data/whu-bus.json`，失败时不会退回随包文件冒充实时数据。

检查读取时间是否持续变化，并留意过期和错误提示；HTTP 200 本身不能证明车辆数据新鲜。`--no-persist` 从内存提供新快照，避免持续替换磁盘文件。两个终端均可用 Ctrl+C 停止。

当前链路不依赖手机、USB 调试或 Yakit，也不携带 Cookie 或 Authorization。遇到登录重定向或协议变化会报错。Python 服务仅监听本机；手机上的 `127.0.0.1` 指手机自身，不能访问电脑服务。公开网站应使用默认同源 HTTPS 自动接口。

## 数据链路

```text
bus.whu.edu.cn H5 响应
  → transit-upstream.ts 请求/解码 → transit-service.ts 校验/转换/缓存
  → schemaVersion 1 JSON / 同源 /api/transit（Cloudflare 或 Next.js）
  → bus.ts 校验/轮询/站数 → 校巴页面与单次乘车候选

独立采集/留存：upstream.py → collector.py → 本机 API 或磁盘快照

OSM Overpass（人工刷新）
  → fetch-roads.py → campus-roads.json
  → road-router.ts → 步行、自行车与校巴接入道路
```

车辆默认每 10 秒采集，线路与轨迹默认缓存 6 小时。车辆时间是请求完成时间，不是设备 GPS 上报时间。校巴坐标系按 H5 使用高德的方式推断，未获上游明确声明；5 号线时刻表与元数据存在冲突，票价原文未核实。

路网覆盖纬度 `30.515–30.560`、经度 `114.337–114.388`。灰色虚线表示地点至路网的接入段，入口与通行需核实。底图需要联网；路网文件加载后可在当前页面继续计算，不等于完整离线 PWA。公告固定为 2026-10-10 09:30 的演示记录，不参与避障。

## 刷新与样本留存

单次采集更新默认校巴快照：

```powershell
python scripts/transit/collector.py
```

有限轮数保存请求、响应、官方 JS 和解码快照，再离线分析：

```powershell
python scripts/transit/collector.py --samples 3 --interval 10 --capture ../whu-bus/new-capture
python scripts/transit/analyze_capture.py ../whu-bus/new-capture --target 15
```

捕获目录必须为空，重复采集请换目录；`--capture` 不与 `--serve` 混用。保存的是应用层请求与响应，并非 TCP/TLS pcap。

人工更新路网：

```powershell
python scripts/fetch-roads.py
```

脚本支持 `--endpoint` 和仅作用于该请求的 `--proxy`。更新源快照后需要重新构建静态导出，已有 `out/` 不会自动同步。

## 验证

```powershell
npm run test
python -m unittest discover -s tests/transit -v
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

单元测试覆盖路网权限、连通性、站序、过期状态、坐标/URI、代理与打包；Python 测试覆盖解码、采集异常与持久化；Playwright 覆盖桌面和手机流程。模拟响应测试不替代对实际运营和道路通行的核实。

每次改动按 `AGENTS.md` 补充或更新相关测试、通过验证并创建对应 Git commit。

## 团队打包

```powershell
npm run package:team
```

免安装包的构建目前需要 **Windows x64 + Node.js 24.16.0**，项目只附有该运行时版本的许可证文件。`releases/` 会生成预览 ZIP、源码 ZIP 和 SHA256 校验文件。预览包包含 Node.js、静态页面和数据快照，未包含 Python；持续采集仍需独立启动采集器。

已有 `out/` 时，`npm run preview` 默认在端口 4173 预览并自动打开浏览器。静态导出使用上面的构建流程，只包含随包快照；普通 Next.js 部署可在未设置 `TRANSIT_STATIC_EXPORT` 时运行 `npm run build` 和 `npm run start`，自动提供校巴 API。

## Cloudflare Workers 部署

仓库已配置 OpenNext Cloudflare 适配器。Worker 名称和 `WORKER_SELF_REFERENCE` 的目标均为 `whu-go`，对应公开地址 https://whu-go.2195135330.workers.dev/；更名时必须同时更新 `wrangler.json` 中的这两项及 Cloudflare 项目名称。

连接 GitHub 仓库后，在 Cloudflare Workers 的构建设置中填写：

| 设置     | 值                                 |
| -------- | ---------------------------------- |
| 根目录   | 仓库根目录                         |
| 构建命令 | `npm run build:cloudflare`         |
| 部署命令 | `npx opennextjs-cloudflare deploy` |

构建环境不要设置 `TRANSIT_STATIC_EXPORT=1`。`npm run build` 仍生成普通 Next.js 输出；Cloudflare 需要 `build:cloudflare` 生成的 `.open-next/worker.js` 和 `.open-next/assets`。Next.js 固定为 `16.3.8`：当前适配器无法处理 `16.4.0` 的 `preview-props.json`，会导致首页返回 500。适配器和 Wrangler 也已锁定版本，构建时无需自动迁移项目。

本地可运行 `npm run preview:cloudflare` 预览 Worker，或在 Cloudflare 授权后运行 `npm run deploy` 构建并发布。OpenNext 推荐在 Linux 或 WSL 下构建；Windows 原生环境的兼容性有限。现有静态预览和团队打包命令仍可使用。

当前页面不使用 ISR、Next.js 增量缓存或图片优化，因此不配置 R2 缓存桶或 Images 服务。校巴自动接口使用内存及 Cloudflare Cache API，随网站一起部署；首次访问会加载校方脚本和线路数据，校方不可达时显示暂不可用并自动重试。Cloudflare 运行环境访问上游的结果应在部署后检查 `/api/transit` 中的状态及时间。

`route.live.ts` 是网站服务端路由，`next.config.ts` 通过 `pageExtensions` 在普通构建时启用、静态导出时排除它，同时设置浏览器默认数据源。不要将它改名为 `route.ts`，否则会影响静态预览包构建。

## 技术栈与目录

Next.js 16 App Router、React 19、TypeScript 严格模式、Tailwind CSS 4、Leaflet；Python 标准库与 cryptography；Vitest 与 Playwright。

| 路径                         | 职责                                        |
| ---------------------------- | ------------------------------------------- |
| `src/app/`                   | 页面入口、全局样式与元数据                  |
| `src/components/`            | 工作台、地图与交互                          |
| `src/lib/campus.ts`          | 地点、路线类型与规则问答解析                |
| `src/lib/road-router.ts`     | 路网校验、通行规则、Dijkstra 与单次乘车组合 |
| `src/lib/bus.ts`             | 校巴契约、数据加载、状态与站数              |
| `src/lib/route-provider.ts`  | 高德 URI 与未来服务端适配契约               |
| `scripts/transit/`           | 采集、解码与离线样本分析                    |
| `scripts/fetch-roads.py`     | OSM 路网刷新                                |
| `scripts/preview-server.mjs` | 本机静态服务与校巴代理                      |
| `scripts/package-team.mjs`   | 预览包、源码包与校验文件                    |
| `public/data/`               | 校巴与路网快照                              |
| `tests/`                     | TypeScript、Python 与浏览器测试             |
| `docs/`                      | 接口说明与团队交付说明                      |
| `artifacts/`                 | 保存的界面截图                              |

OSM 数据 © OpenStreetMap contributors，按 [ODbL](https://www.openstreetmap.org/copyright) 使用和提供；数据包与页面须保留来源与署名。Esri 底图保留页面署名。项目尚未声明应用源码的开源许可证。
