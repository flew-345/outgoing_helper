# 数据与接口说明

本文合并原校巴接入与自有寻路说明，按 2026-10-11 源码记录。安装与启动见 [README](../README.md)，实现顺序与验收见 [TODO](../TODO.md)。以下明确区分已实现契约和建议新增接口。

## 1. 已有接口总览

| 接口/入口                                    | 提供方                                 | 当前用途                   | 状态与限制                                |
| -------------------------------------------- | -------------------------------------- | -------------------------- | ----------------------------------------- |
| `GET /api/transit` | Next.js / Cloudflare 网站服务端 | 自动采集、校验、缓存校方数据 | 默认数据源，无需 Python；失败保留历史时间 |
| `GET /api/transit`                           | Python 采集器，默认 `127.0.0.1:8766`   | 完整校巴 JSON              | 已实现，只读、本机，不是 Next.js API 路由 |
| `GET /api/transit`、`GET /data/whu-bus.json` | 带 `--feed` 的 preview server          | 同源代理采集器             | 已实现；不回退随包快照                    |
| `GET /data/whu-bus.json`                     | 开发/静态网页服务                      | 随包校巴快照               | 已实现；无采集进程就不会更新              |
| `GET /data/campus-roads.json`                | 开发/静态网页服务                      | OSM 路网快照               | 已实现；人工刷新、浏览器内计算            |
| `planRoutes` / `planRoadRoutes`              | `src/lib/campus.ts` / `road-router.ts` | 步行、自行车、一次乘车候选 | 已实现，是本地函数，不是 HTTP API         |
| `RouteProvider.plan`                         | `src/lib/route-provider.ts`            | 未来规划适配契约           | 仅 TypeScript 接口声明，没有服务端实现    |
| 高德 navigation URI                          | `amapNavigationUrl`                    | 独立路线跳转               | 已实现，不返回结果给本地规划器            |

当前没有数据库、管理员后端、账号系统、WebSocket/SSE 或大模型服务；不能因 UI 有入口就假定对应数据接口已经存在。

## 2. 上游校巴 H5

入口为 [校方校巴移动页面](https://bus.whu.edu.cn/mobile/index.html#/)。`scripts/transit/upstream.py` 获取当前 `app.*.js`，解析 H5 已发布的请求与响应转换参数。

| 逻辑 GET 路径             | 响应用途                     | 解码方式                       |
| ------------------------- | ---------------------------- | ------------------------------ |
| `10486/line/{lineId}`     | 线路元数据、站点             | 站点项 Base64 → UTF-8 JSON     |
| `10486/linePath/{lineId}` | 实际线路轨迹                 | `lat,lng;…` 字符串             |
| `10486/line/{lineId}/bus` | 车辆位置、当前站次与到站状态 | 数组项 RSA 解码 → 竖线分隔字段 |

实际请求地址为 `https://bus.whu.edu.cn/interface/whubus/weben/{encoded}`。`毫秒时间戳/逻辑路径` 经 RSA PKCS#1 v1.5、Base64，再将 `/` 替换为 `*`。每次请求生成新地址，不把捕获的旧 URL 作为固定接口。响应 `resultCode` 必须为 `1`；车辆 `data` 必须显式为数组，空数组与失败不同。

当前请求不带 Cookie 或 Authorization，不依赖手机与 Yakit。若页面 JS、协议变化或跳转到大学登录，采集器报错；没有授权会话管理或登录绕过逻辑。

| 方向       | lineId       | 当前样本站次数 |
| ---------- | ------------ | -------------- |
| 1 号线     | `10486-50-0` | 20             |
| 2 号线     | `10486-55-0` | 15             |
| 5 号线     | `10486-56-0` | 5              |
| 5 号线返向 | `10486-56-1` | 5              |

车辆原文为 `车辆ID|未知字段|站次|到站状态|经度|纬度`。未知字段当前样本为 `11`，未赋予业务含义。站次从 1 开始，状态字符串 `"0"` 表示尚未到站，`"1"` 表示已到站。上游没有已确认的独立站数或 ETA 分钟接口。

### “几站后”规则

给定目标站次 T、车辆站次 I、状态 A，按 H5 候选条件 `2*(I-1)-1+A <= 2*(T-1)` 筛选。保留响应顺序，取最后两个候选并逆序展示。同站按状态显示“即将到站/已到站”，否则显示 `T-I` 站后。

没有候选只表示本次没有可用候选，不推断下一圈、不据此断定未发车，也不从站数换算到站分钟。实现见 `src/lib/bus.ts` 的 `arrivalsAt`。

## 3. 校巴 JSON 契约（schemaVersion 1）

类型与前端运行时校验见 `src/lib/bus.ts`，线上归一化见 `src/server/transit-service.ts`，独立 Python 归一化见 `scripts/transit/collector.py`，真实样本见 `public/data/whu-bus.json`。

| 层级      | 字段                                                               | 含义                                            |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| 顶层      | `schemaVersion`, `source`, `fetchedAt`                             | 固定版本 1、来源 `bus.whu.edu.cn`、快照组装时间 |
| 顶层      | `coordinateSystem`, `displayCoordinateSystem`                      | `amap-gcj02-inferred`、`wgs84-approximate`      |
| 顶层      | `lines`                                                            | 可用线路数组，至少一条                          |
| 线路      | `id`, `name`, `direction`, `returnLineId`                          | 方向标识、名称与返向关联，返向可为 null         |
| 线路      | `firstTime`, `lastTime`, `priceRaw`, `timetable`, `rawMetadata`    | 上游运营与票价原文、H5 内置时刻表、原始元数据   |
| 线路      | `stops`, `path`, `vehicles`                                        | 站次数组、轨迹 `[lat,lng][]`、车辆数组          |
| 线路      | `vehiclesFetchedAt`, `vehicleStatus`, `warnings`                   | 最近成功车辆请求时间（可 null）、状态与提示     |
| 站次      | `occurrenceId`, `sourceStopId`, `order`, `name`, `area`, `aliases` | `occurrenceId = 线路ID:顺序`，同名站次不合并    |
| 站次/车辆 | `lat`, `lng`, `sourceLat`, `sourceLng`                             | 显示坐标与保留的源坐标                          |
| 车辆      | `id`, `lineId`, `stopOrder`, `arrivalState`, `rawFields`           | 车辆标识、线路、站次、状态字符串、原始字段      |

采集器还输出每条线路的 `metadataFetchedAt` 和顶层 `errors`；这两个附加字段目前未进入前端类型与专门展示契约。时间使用带时区 ISO 格式，界面按北京时间显示。站次应连续、有序；车辆 ID 在同一线路内不重复，车辆站次须属于该线路。

坐标系来自 H5 使用高德的方式推断，未获上游明确声明。转换到 WGS84 是近似值，保留源站点/车辆坐标；归一化轨迹未另存一套源坐标，原始轨迹可从捕获响应复核。坐标顺序必须分清：前端轨迹 `[lat,lng]`，`BusClient.path_points` 的中间结果为 `[lng,lat]`，高德 URI 为 `lng,lat`。

5 号线接口运营时间与 H5 内置时刻表冲突，分别保留并提示。`priceRaw` 不作为已核实票价。`vehiclesFetchedAt` 是请求完成时间，不能证明 GPS 最近上报。

### 状态与服务行为

- 网站默认 `/api/transit` 随 Next.js 或 Cloudflare 服务启动，按访客请求采集，不需要常驻 Python 或定时任务。元数据/官方协议缓存 6 小时，车辆结果复用 10 秒，同一实例的并发刷新合并。Cloudflare Cache API 在同一边缘节点共享最近快照（保留 6 小时），跨节点不保证全局单次采集；Cache API 不可用时继续使用内存。
- 网站采集总网络超时 8 秒、浏览器超时 10 秒。上游只允许固定校方域名，拒绝跳转；不接受客户端提供上游 URL，不带 Cookie/Authorization。RSA 解码复用校方 H5 的已发布协议，不执行下载的脚本。
- 网站返回 `Cache-Control: no-store`，避免浏览器/CDN 将历史响应长期缓存。首次完全失败为 503；部分线路失败在 JSON 的 `errors` 与线路 `warnings` 体现，失败线路的成功车辆时间不会刷新。页面不会自动退回随包快照。
- 静态导出排除 `route.live.ts`，默认仍读取随包文件。`live=0` 显式选择快照，`live=1` 显式选择自动接口；公开站点自动迁移旧本机地址，保留自定义远端源。

- 成功请求更新车辆数组和车辆时间，空数组也是成功；失败保留原车辆及原时间，已有历史为 `stale`，从未成功为 `unavailable`。
- 前端再次按快照与车辆时间判断 30 秒新鲜度；HTTP 200 不会让旧 JSON 变新，网络失败也不清空历史冒充“无车”。
- 车辆默认 10 秒轮询；线路与轨迹默认 TTL 6 小时。采集器 `--interval` 可调但不得小于 10 秒，元数据 TTL 目前没有 CLI 参数。
- `GET http://127.0.0.1:8766/api/transit` 有快照返回 200，无可用快照返回 503 `{"error":"No upstream snapshot yet"}`；已有快照即便包含错误仍可返回 200，应检查线路状态和时间。其他路径返回 404，未提供写接口或查询参数路由。
- 采集 API 返回 JSON、`Cache-Control: no-store`、CORS `*`。它是本机开发服务，不是公共部署后端。
- `--no-persist` 仅内存发布；持久化模式用原子替换，磁盘失败单独报告而不冻结 API。初始快照可从 `--out` 文件载入，不代表刚完成网络采集。
- preview server 仅接受 GET/HEAD，代理超时为 8 秒；不可达时返回 503，不回退静态文件。浏览器轮询超时为 10 秒。

## 4. 捕获与离线复核

命令见 README。采集支持 `--out`、`--capture`、`--samples`、`--interval`、`--serve`、`--port`、`--no-persist` 和用于离线提取转换参数的 `--script`。`--capture` 目录必须为空，仅用于有限轮数；`--no-persist` 必须与 `--serve` 使用。

目录内容包括 `.request.http`、`.response.json`（状态、响应头、时间）、`.response.body`、官方 JS、`manifest.json`、`snapshot-*.json` 与 `analysis.json`。urllib 已处理传输编码，这是应用层留存，不是 TCP/TLS pcap。`analyze_capture.py` 使用保存的 JS 参数离线解析，不联网。

既有样本在项目同级 `whu-bus/capture-20261011`，不属于源码包必含内容：北京时间 2026-10-11 15:34:22–15:34:43，共 22 次 HTTP 200，含 2 个网页资源、8 个站点/轨迹响应、12 个车辆响应。三轮中 1 号线各 3 辆、2 号线各 2 辆，5 号线双向为空；2 号线车辆出现站次/到站状态变化。样本仅代表该时段，不能据此确定日常运营或 ETA。

## 5. 路网与本地规划契约

`scripts/fetch-roads.py` 人工请求 Overpass，默认 `https://overpass-api.de/api/interpreter`；支持 `--endpoint` 与请求专用 `--proxy`，不修改系统或手机设置。网页不为每条行程请求公共 Overpass。

`public/data/campus-roads.json` 包含：

- `schemaVersion = 1`、`source = OpenStreetMap`、`license`、`attributionUrl`、`endpoint`、`fetchedAt`、`dataTimestamp`。
- `bbox = [30.515,114.337,30.560,114.388]`，顺序为南、西、北、东。
- `nodes`：节点 ID → WGS84 `[lat,lng]`；`nodeTags`：门禁等节点标记。
- `ways`：`{id,nodes,tags}` 道路数组；`pois`：有名称的地点 `{id,name,lat,lng}`，当前未接入地点搜索。

`parseRoadGraph` 校验并读取寻路所需字段。OSM 数据 © OpenStreetMap contributors，按 [ODbL](https://www.openstreetmap.org/copyright) 使用和提供；包内须保留 JSON 来源和页面署名。数据服务说明见 [Overpass 项目文档](https://wiki.openstreetmap.org/wiki/Overpass_API)。

### 路径规则

- 分别过滤步行/自行车道路：施工、禁止、私有且无明确开放、无法判断的条件限制均保守排除；自行车排除台阶与未明确允许骑行的人行道，遵守单行；门禁依据已有标签，不代表实时开门状态。
- 起终点投影到最近可通行道路，接入最多 120 米；交叉但无共同节点的道路不拼接。只在 bbox 内计算，无路径时不给出直线替代。
- 灰色虚线为未核实接入段。步行 72 米/分、自行车 200 米/分，自行车接入按步速。没有坡度、天气、库存或电动车规则，不提供实时定位转向导航。
- 校巴对每端选直线距离小于 900 米的最近三个站次，步行接驳各不超过 1100 米；上车序号小于下车序号，站次顺序投影轨迹的误差不超过 120 米，乘车路径至少 150 米。
- 有全程步行路径时，仅保留减少步行距离的校巴候选。候选分数为 `接入步行 + 离站步行 + 乘车距离 × 0.12`，是距离权重，不是 ETA；最终返回最佳一次乘车方案。

预置地点来源 ID 在 `Place.source`。桂园宿舍为桂园一舍中心、工学部教学楼为工学部第二教学楼中心；“总图书馆”旧演示项已替换为有 OSM 来源的工学部图书馆。总馆位置尚待核实，可临时地图选点。

### Route 与扩展

`Route` 定义见 `src/lib/campus.ts`：`mode/title/minutes/distance/cost/reason/segments/points/legs/steps/affected/busLineId?`。距离单位米，耗时单位分钟且允许 null；`legs.connector` 标记虚线，点为 WGS84 `[lat,lng]`。当前 `affected` 未接入真实管制，不能用它证明路线已避障。

`RouteProvider.plan(origin, destination, mode, signal?) → Promise<Route | undefined>` 只有声明；尚无 HTTP `/api/routes`。可在将来实现服务端适配，Key 不进入浏览器。高德 URI 跳转近似将 WGS84 转 GCJ-02，传起终点由高德重新算路，不传本地路径；骑行跳转仅适用于移动端。参考 [路线 API](https://lbs.amap.com/api/webservice/guide/api/direction)、[导航 URI](https://lbs.amap.com/api/uri-api/guide/travel/route)。校巴方案不跳转为通用公交，以免误认为第三方包含校内校巴。

## 6. 缺失接口与开发入口

**下表路径均为建议设计，当前不存在，不可直接调用。** 上游能力“未确认”也不代表一定有对应校方接口。先确定数据提供方，再设计适配器；不可用时应返回明确未知状态，不能用演示值补齐。

| 缺口               | 建议契约/路径（未实现）                              | 最少需要的字段或能力                                                       | 开发入口与依赖                                                                  |
| ------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 校巴运营日历/停运  | `GET /api/transit/service`                           | lineId、日期/有效期、时区、运营状态、发车计划、来源、核实时间              | 扩展采集适配和 `BusLine`；当前首末时间与冲突时刻表不足以判断运营                |
| 校巴 ETA           | `GET /api/transit/eta?lineId=…&stopOrder=…`          | occurrenceId、候选车辆、预测时间、生成时间、设备上报时间、置信度、未知原因 | `arrivalsAt` 仅算站数；没有已确认的上游 ETA 或设备时间，需运营数据/可靠历史模型 |
| POI/入口与校门状态 | `GET /api/places?q=…`、`GET /api/access`             | 稳定 ID、名称/别名、坐标系、入口类型、权限/模式、有效期、来源              | 先整合路网 `pois` 与 `Place`，再加人工核验/校方源                               |
| 真实公告/空间管制  | `GET /api/incidents`                                 | geometry 或 roadIds、开始/结束、受影响模式、状态、来源、更新时间           | 替换 `campus.ts` 演示记录，给 `road-router.ts` 增加动态边过滤                   |
| 管制维护与审核     | 管理端 create/update/revoke（路径待定）              | 权限、草稿/发布状态、审核、撤销、变更历史                                  | 当前无数据库、身份/权限和管理服务；先选持久化方案                               |
| 共享电动车/租车    | `GET /api/mobility/vehicles`、`/parking`、`/pricing` | provider、位置、可用性、车辆时间、服务/停车范围、计费规则                  | 当前只有自备自行车规划；需平台正式数据源，不具备账号/开锁/支付接口              |
| 服务端路线         | `POST /api/routes`                                   | 起终点/坐标系、mode、提供方、路网版本、Route、失败原因                     | 实现 `RouteProvider`，或将自有引擎服务化；第三方 Key、超时与配额服务端处理      |
| 独立健康检查 | `GET /api/health` | 最近成功时间、各源状态、版本 | 生产同源 `/api/transit` 已实现，独立健康检查仍待补充 |
| 查询工具/自然语言  | `POST /api/journeys/query`                           | 地点解析、路线/状态引用、数据时间、未知原因                                | 目前规则解析；如引入 LLM，工具复用已有能力，不生成未核实事实                    |
| 订阅与推送         | subscriptions API（路径待定）                        | 目标站次/路线、触发条件、用户偏好、取消、去重、投递结果                    | 无用户/任务/推送后端；先从站内提醒开始                                          |

### 新接口共同要求

1. 明确版本、ID 稳定性、坐标系与单位；重复站名使用 occurrenceId，不用名称作唯一键。
2. 区分业务空结果、源不可用、历史过期和部分成功；未知耗时/价格保持 null 或明确状态。
3. 同时记录读取时间与源数据时间；来源未提供源时间时明确说明，避免把读取时间当作设备时间。
4. 使用有效区间与数据版本触发路线重算，避免将车辆每轮轮询等同于路网或站点变更。
5. 提供可离线复核的有限样本和故障测试，公共服务共享采集缓存，不由每个浏览器直接重复访问上游。
