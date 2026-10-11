# 校巴数据导入与实时服务

完整链路：武汉大学官方 H5 公开接口 → Python 采集/解码 → schemaVersion 1 JSON → 珞珈畅行的线路、站点、轨迹、车辆和站数视图。车辆接口成功返回空数组、请求失败和旧快照是不同状态。

## 直接运行

需要 Python 3.10+、cryptography 和项目原有 Node.js 环境。在项目根目录执行：

```sh
python -m pip install -r scripts/transit/requirements.txt
python scripts/transit/collector.py
npm run dev
```

一次采集写入 `public/data/whu-bus.json`。页面默认每 10 秒读取它，但静态文件不会自动生成新车辆信息：车辆时间超过 30 秒即显示过期。

实时使用时，在另一个终端运行：

```sh
python scripts/transit/collector.py --serve
```

在页面“数据说明”的“校巴数据地址”填入 `http://127.0.0.1:8766/api/transit`，点击“应用数据地址”。服务仅监听本机，10 秒轮询车辆，站点与轨迹默认缓存 6 小时。按 Ctrl+C 停止，最后快照保留。静态导出预览也可使用这个地址；手机上的 `127.0.0.1` 指手机本身，本服务不开放局域网访问。由 HTTPS 部署页面访问本机 HTTP 服务时，浏览器策略可能阻止请求；需要部署同源代理。

## 本机直接进入实采页面

先构建静态导出（PowerShell），然后分别在两个终端运行采集与网页服务：

```powershell
$env:TRANSIT_STATIC_EXPORT='1'
npm run build
python scripts/transit/collector.py --serve --no-persist
```

```sh
node scripts/preview-server.mjs --root out --port 4174 --feed http://127.0.0.1:8766/api/transit --no-open
```

打开 `http://127.0.0.1:4174/?live=1&view=bus`。`live=1` 让前端选择同源 `/api/transit`，优先于浏览器保存的旧地址；`view=bus` 直接进入校巴页。preview server 的 `--feed` 将 `/api/transit` 和原 `/data/whu-bus.json` 都代理到实时采集服务，不读取随包快照作为替代。这个入口适用于带 `--feed` 的预览服务；单独 `npm run dev` 时仍可用上面的“数据说明”设置独立采集 API 地址。

`--no-persist` 模式把新响应保存在内存中，不反复替换 JSON 文件。Windows 拒绝文件替换时，默认持久化模式也会继续更新 API，并单独报告缓存错误。网页必须能看到时间连续变化，不能仅以 HTTP 200 判断采集正常。上游或采集服务失败时显示错误/历史状态，不悄悄退回静态样本。

没有改动系统或手机代理，不需要 Yakit。当前请求不带 Cookie 或 Authorization。若上游将来重定向登录或修改 JS/协议，脚本报错并保留最后数据；它不处理登录绕过。

## 保存部分响应，离线重复分析

```sh
python scripts/transit/collector.py --samples 3 --interval 10 --capture ../whu-bus/new-capture
python scripts/transit/analyze_capture.py ../whu-bus/new-capture --target 15
```

捕获目录保存 `.request.http`、`.response.json`（状态、响应头、时间）、`.response.body`（应用层响应正文）、`manifest.json`、三轮 `snapshot-*.json` 与 `analysis.json`。这不是 TCP/TLS 的 pcap：urllib 已处理传输编码，正文适合离线重跑解析。官方 app JS 一起保存，离线分析使用这份 JS 的转换参数，分析命令完全不联网。请求 URL 含时间戳，每次新请求应重新生成，不把旧 URL 当作长期接口。

采集目录须为空，重复采集请更换目录，以免覆盖已留存样本。`--capture` 用于有限轮数，不与持续运行的 `--serve` 混用。

此次样本位于同级 `whu-bus/capture-20261011`，2026-10-11 北京时间 15:34:22–15:34:43，22 次 HTTP 200：2 个网页资源、8 个站点/轨迹响应、12 个车辆响应。三轮中 1 号线各有 3 辆、2 号线各有 2 辆，5 号线双向都为空。车辆坐标变化；2 号线 50003 从站次 5/状态 1 转为站次 6/状态 0，50361 从状态 0 转为状态 1。数据只描述这个观察时段。

## 上游接口与站数

官方入口：<https://bus.whu.edu.cn/mobile/index.html#/>。逻辑 GET 路径：

| 逻辑路径 | 用途 |
| --- | --- |
| `10486/line/{id}` | 线路元数据与 Base64 编码站点 |
| `10486/linePath/{id}` | `lat,lng;…` 轨迹 |
| `10486/line/{id}/bus` | RSA 编码车辆数组 |

实际 URL 为 `/interface/whubus/weben/{encoded}`。编码遵循官方公开 H5 脚本：`毫秒时间戳/逻辑路径` 经 RSA PKCS#1 v1.5 和 Base64，再将 `/` 替换为 `*`。脚本动态下载当前官方 app JS，解析其转换参数；没有把账号密钥写入工程。

车辆解码字段：`车辆ID|未知字段|站次|到站状态|经度|纬度`。未知字段目前观察到 `11`，未赋予业务含义。站次从 1 开始；到站状态 0 为尚未到站，1 为已到站。坐标与“几站后”来自同一车辆响应，没有另一个已确认的站数接口。

给定目标站次 T，车辆站次 I、状态 A，官方候选条件为 `2*(I-1)-1+A <= 2*(T-1)`。保持返回顺序，取最后两个候选并逆序展示；同站显示“即将到站/已到站”，否则显示 `T-I` 站后。没有候选表示当前响应无可用候选，不自动推断下一圈或未发车。没有服务端 ETA 分钟，不生成分钟预测。

方向 ID：1 号线 `10486-50-0`（20 站次），2 号线 `10486-55-0`（15），5 号线 `10486-56-0`（5），5 号线返向 `10486-56-1`（5）。站次 occurrenceId 为 `线路ID:顺序`，同名站不合并。

## JSON 约定与局限

TypeScript 结构和运行时校验见 `src/lib/bus.ts`，实际导入样本见 `public/data/whu-bus.json`。

顶层：`schemaVersion/source/fetchedAt/coordinateSystem/displayCoordinateSystem/lines`。每条线路包含 `id/name/direction/returnLineId/firstTime/lastTime/priceRaw/stops/path/vehiclesFetchedAt/vehicleStatus/vehicles/warnings/timetable/rawMetadata`。采集器额外保留 `metadataFetchedAt` 和顶层 `errors`。

站点和车辆保留 `sourceLat/sourceLng`；显示坐标为 `lat/lng`，轨迹为 `[lat,lng]`。官方 H5 直接使用高德地图，因此推断上游为 GCJ-02，并近似转换到 Esri/Leaflet 所需的 WGS84。上游没有明确声明坐标系，这不是校方确认；不能用于精确导航。[高德坐标说明](https://lbs.amap.com/api/javascript-api/guide/transform/convertfrom)。

5 号线接口运营时间与官方 H5 内置时刻表存在冲突，分别保留并提示；内置时刻表未验证是当前运营计划。`priceRaw` 保留上游字符串，不当作已核实票价。地点、步行/骑行路线、公告与问答仍为原有演示数据，校巴接入不改变这些数据的可靠性。

`vehicleStatus` 为 `fresh/stale/unavailable`。请求失败保留原车辆及原车辆时间，并标记 stale；初次失败标记 unavailable；成功空数组才表示本次无车辆。页面根据时间再次判断，HTTP 200 不会让旧文件重新变新。服务端原子替换 JSON，避免页面读到半个文件。

`vehiclesFetchedAt` 是请求完成时间，接口没有提供车辆设备上报时间。因此 fresh 表示最近成功读到上游响应，不能证明每个 GPS 点也是最近 30 秒上传的。

## 验证

```sh
python -m unittest discover -s tests/transit -v
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

测试覆盖加解码、坐标/站次约束、站数候选顺序、空响应/断线/旧数据、原子文件、HTTP 服务、桌面与手机导入和数据源配置。
