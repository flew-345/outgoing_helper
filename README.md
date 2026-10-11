# 珞珈畅行

面向武汉大学师生的校园出行助手。当前版本提供可运行的前端工作台，用于审查 UI 风格和交互。

## 本地运行

需要 Node.js 22.12 或更高版本（包括测试工具）。

```sh
npm install
npm run dev
```

打开 http://127.0.0.1:3000。若端口被占用，可运行 `npm run dev -- --port 3001`。

## 当前内容

- Next.js App Router、React、TypeScript 严格模式与 Tailwind CSS 4。
- Leaflet 校园地图，使用 Esri Gray Canvas 浅色底图与 World Imagery 卫星影像，保留来源署名。
- 校园地点模糊搜索、起终点互换、持久化收藏和三种出行方案比较。
- 校巴线路与站点视图、公告筛选、图层控制、缩放与浏览器定位。
- 本地规则问答，支持已知地点的行程查询、管制和状态说明。
- 手机与桌面布局，数据说明、网络失败与定位失败状态。

所有地点坐标、线路、车辆、运营时间、管制记录和耗时均为本地演示数据，尚未实地校验或接入校方、车辆平台。固定数据快照为 2026-10-10 09:30。路线为示意折线和距离估算，不能用于实际导航；问答未调用大模型。地图底图需要联网。

## 验证

```sh
npm run test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

端到端测试覆盖桌面与手机、地点选择、线路切换、管制、收藏持久化、演示状态和问答，并在 `artifacts/` 生成 UI 截图。

## 团队打包

在 Windows x64、Node.js 24.16.0 环境运行：

```sh
npm run package:team
```

`releases/` 会生成 Windows 免安装预览 ZIP、源码 ZIP 和 SHA256 校验文件。预览包解压后双击 `start-preview.cmd` 即可打开，默认本地端口为 4173。完整说明见 `docs/TEAM-PREVIEW.md`。

打包时启用 Next.js 静态导出，不改变日常开发的运行模式。`npm run preview` 可预览打包生成的 `out/`，地图底图需要联网。

## 目录

- `src/app/`：页面入口、全局样式和元数据。
- `src/components/`：校园工作台和客户端地图。
- `src/lib/campus.ts`：演示数据、地点查询、路线估算与本地问答解析。
- `tests/`：逻辑测试和浏览器流程测试。
- `docs/`：MVP 功能和技术规划。

下一阶段可以在这些交互基础上接入经过校验的校园 POI、真实道路规划 API、校方管制记录与车辆适配器。
