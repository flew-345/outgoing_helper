"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownUp,
  ArrowRight,
  Bike,
  Bookmark,
  Bus,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Footprints,
  Info,
  Layers,
  Leaf,
  MapPin,
  MessageCircle,
  Navigation,
  Route as RouteIcon,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  DEMO_TIME,
  formatDistance,
  incidents,
  parseJourney,
  places,
  planRoutes,
  recommendRoute,
  searchPlaces,
  type Mode,
  type Place,
  type Route,
} from "@/lib/campus";
import {
  arrivalsAt,
  useTransitFeed,
  vehicleFreshness,
  type BusLine,
} from "@/lib/bus";
import { parseRoadGraph, type RoadGraph } from "@/lib/road-router";
import { amapNavigationUrl } from "@/lib/route-provider";

const CampusMap = dynamic(() => import("./campus-map"), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      <Layers size={28} />
      <span>校园地图加载中</span>
    </div>
  ),
});
const modeIcons = { walk: Footprints, bus: Bus, bike: Bike };
type View = "route" | "bus" | "notices";

function PlaceInput({
  label,
  place,
  onChange,
  kind,
}: {
  label: string;
  place: Place;
  onChange: (place: Place) => void;
  kind: string;
}) {
  const [text, setText] = useState(place.name);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const options = searchPlaces(text === place.name ? "" : text);
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) {
        setOpen(false);
        setText(place.name);
      }
    }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [place]);
  function choose(value: Place) {
    onChange(value);
    setText(value.name);
    setOpen(false);
  }
  return (
    <div
      className="place-field"
      ref={wrapper}
      onBlur={(event) => {
        if (!wrapper.current?.contains(event.relatedTarget as Node)) {
          setOpen(false);
          setText(place.name);
        }
      }}
    >
      <span className={`place-symbol ${kind}`} />
      <div className="place-field-text">
        <label htmlFor={`place-${kind}`}>{label}</label>
        <input
          id={`place-${kind}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`options-${kind}`}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[index] ? `option-${kind}-${index}` : undefined
          }
          autoComplete="off"
          value={text}
          onFocus={() => {
            setOpen(true);
            setIndex(0);
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              setText(place.name);
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setIndex((i) => Math.min(i + 1, options.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (options[index]) choose(options[index]);
            }
          }}
        />
      </div>
      <MapPin size={16} className="field-pin" />
      {open && (
        <div id={`options-${kind}`} role="listbox" className="place-options">
          {options.length ? (
            options.map((option, i) => (
              <button
                type="button"
                id={`option-${kind}-${i}`}
                key={option.id}
                role="option"
                aria-selected={i === index}
                className={i === index ? "highlighted" : ""}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(option)}
              >
                <MapPin size={16} />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.area}</small>
                </span>
                {place.id === option.id && <Check size={15} />}
              </button>
            ))
          ) : (
            <div className="no-options">未找到校园地点</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CampusApp() {
  const [view, setView] = useState<View>("route");
  const [routesExpanded, setRoutesExpanded] = useState(false);
  const [allStops, setAllStops] = useState(false);
  const [origin, setOrigin] = useState(places[0]);
  const [destination, setDestination] = useState(places[1]);
  const [journey, setJourney] = useState({
    origin: places[0],
    destination: places[1],
  });
  const [routes, setRoutes] = useState<Route[]>([]);
  const [roadGraph, setRoadGraph] = useState<RoadGraph | null>(null);
  const [roadError, setRoadError] = useState("");
  const [selectedMode, setSelectedMode] = useState<Mode>("walk");
  const [favorites, setFavorites] = useState<string[]>(["library", "meiyuan"]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState("");
  const [chatMessages, setChatMessages] = useState<
    { role: string; text: string }[]
  >([]);
  const [noticeFilter, setNoticeFilter] = useState("全部");
  const [expandedNotice, setExpandedNotice] = useState<string | null>(
    "construction",
  );
  const [dataOpen, setDataOpen] = useState(false);
  const [busLineView, setBusLineView] = useState("线路");
  const feed = useTransitFeed();
  const initialBusLines = useRef<BusLine[]>([]);
  useEffect(() => {
    initialBusLines.current = feed.snapshot?.lines ?? [];
  }, [feed.snapshot]);
  const [busLineId, setBusLineId] = useState("");
  const [busTarget, setBusTarget] = useState(1);
  const [feedAddress, setFeedAddress] = useState("");
  const busData =
    feed.snapshot?.lines.find((line) => line.id === busLineId) ??
    feed.snapshot?.lines[0];
  const targetStop =
    busData?.stops.find((stop) => stop.order === busTarget) ??
    busData?.stops[0];
  const busFreshness = vehicleFreshness(
    feed.snapshot,
    busData,
    feed.now,
    Boolean(feed.error),
  );
  const busStatus = feed.loading
    ? "校巴数据加载中"
    : busFreshness === "fresh"
      ? "车辆状态已更新"
      : busFreshness === "stale"
        ? "车辆历史快照 · 已过期"
        : "实时状态不可用";
  const busArrivals =
    busData && targetStop ? arrivalsAt(busData, targetStop.order) : [];
  const busMode = feed.loading
    ? "校巴连接中"
    : busFreshness === "fresh"
      ? "校巴实采"
      : busFreshness === "stale"
        ? "历史快照"
        : "校巴未连接";
  const busReadTime = busData?.vehiclesFetchedAt ?? feed.snapshot?.fetchedAt;
  const busReadTimeText = busReadTime
    ? new Date(busReadTime).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
      })
    : "暂无读取时间";
  const selectedRoute = routes.find((r) => r.mode === selectedMode);
  const fastest = recommendRoute(routes);
  const saved = favorites.includes(destination.id);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(
      () =>
        controller.abort(new DOMException("道路数据加载超时", "TimeoutError")),
      15000,
    );
    fetch("/data/campus-roads.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok)
          throw new Error(`道路数据读取失败：${response.status}`);
        return response.json();
      })
      .then(parseRoadGraph)
      .then((graph) => {
        setRoadGraph(graph);
        setRoutes(
          planRoutes(places[0], places[1], graph, initialBusLines.current),
        );
      })
      .catch((error) => {
        if (
          !controller.signal.aborted ||
          controller.signal.reason?.name === "TimeoutError"
        )
          setRoadError(
            error instanceof Error ? error.message : "道路数据读取失败",
          );
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "bus") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("bus");
    }
  }, []);
  useEffect(() => {
    // Restore browser-only preferences after hydration.
    try {
      const value = localStorage.getItem("luojia-favorites");
      if (value) {
        const parsed: unknown = JSON.parse(value);
        if (Array.isArray(parsed))
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFavorites(
            parsed.filter(
              (id): id is string =>
                typeof id === "string" && places.some((p) => p.id === id),
            ),
          );
      }
    } catch {
      /* Browsing storage may be unavailable. */
    }
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (routeTimer.current) clearTimeout(routeTimer.current);
    };
  }, []);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [chatMessages]);
  useEffect(() => {
    if (!chatOpen && !dataOpen) return;
    const dialog = document.querySelector<HTMLElement>('[aria-modal="true"]');
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const selector =
      'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]';
    (
      dialog.querySelector<HTMLElement>("[data-autofocus]") ??
      dialog.querySelector<HTMLElement>(selector)
    )?.focus();
    function trapFocus(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog) return;
      const elements = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [chatOpen, dataOpen]);

  function notify(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  }
  function calculate(from = origin, to = destination) {
    if (from.id === to.id) {
      notify("起点和终点相同，请选择不同的地点。");
      return;
    }
    if (!roadGraph) {
      notify(roadError || "道路数据正在加载，请稍后重试。");
      return;
    }
    setBusy(true);
    if (routeTimer.current) clearTimeout(routeTimer.current);
    routeTimer.current = setTimeout(() => {
      const next = planRoutes(from, to, roadGraph, feed.snapshot?.lines);
      setRoutes(next);
      setJourney({ origin: from, destination: to });
      setSelectedMode(next[0]?.mode ?? "walk");
      if (!next.length)
        notify(
          "没有找到连通的可通行道路，请选择其他地点；不会绘制直线替代路线。",
        );
      setBusy(false);
      setView("route");
    }, 0);
  }
  function pickDestination(place: Place) {
    setDestination(place);
    calculate(origin, place);
  }
  function pickOrigin(place: Place) {
    setOrigin(place);
    calculate(place, destination);
  }
  function toggleFavorite() {
    const next = saved
      ? favorites.filter((id) => id !== destination.id)
      : [...favorites, destination.id];
    setFavorites(next);
    try {
      localStorage.setItem("luojia-favorites", JSON.stringify(next));
    } catch {
      notify("浏览器未允许保存，收藏仅在本次访问有效。");
      return;
    }
    notify(saved ? "已取消收藏" : `已收藏${destination.name}`);
  }
  function ask(text: string) {
    if (!text.trim()) return;
    const parsed = parseJourney(text);
    let reply: string;
    if (parsed.origin && parsed.destination) {
      const options = roadGraph
        ? planRoutes(
            parsed.origin,
            parsed.destination,
            roadGraph,
            feed.snapshot?.lines,
          )
        : [];
      const walk = options.find((r) => r.mode === "walk");
      reply = walk
        ? `从${parsed.origin.name}到${parsed.destination.name}，按真实道路计算步行约 ${walk.minutes} 分钟，${formatDistance(walk.distance)}。耗时按步速估算，入口接入段需核实。来源：OpenStreetMap 道路快照；校巴候车及乘车耗时未知，车辆状态请查看校巴页。`
        : "道路尚未加载或地点间没有可用的连通道路，请查看路线页提示。";
      setOrigin(parsed.origin);
      setDestination(parsed.destination);
      calculate(parsed.origin, parsed.destination);
    } else if (/管制|施工|封路/.test(text)) {
      reply = `演示管制记录：${incidents.map((i) => `${i.title}（${i.time}）`).join("；")}。来源：本地演示数据，${DEMO_TIME}。这些记录不代表校园当前实际管制。`;
    } else if (/校巴|等车|骑车/.test(text)) {
      reply = busData
        ? `${busData.name}，${targetStop?.name}：${busStatus}。${busFreshness === "unavailable" ? "暂无可用车辆状态。" : busArrivals.map((item) => `车辆 ${item.vehicle.id} ${item.label}`).join("；") || "该站次暂无候选车。"}来源：bus.whu.edu.cn，车辆读取时间 ${busData.vehiclesFetchedAt ?? "暂无"}。接口未提供抵达分钟数；自行车方案不含车辆租借状态，无法据此比较实际等车与骑车耗时。`
        : `校巴${busStatus}，暂时无法判断候车情况。可查看真实道路步行方案。`;
    } else {
      reply =
        "暂时没有识别出完整行程。可查询桂园宿舍、第一教学楼、工学部图书馆、樱顶老图书馆、梅园食堂、珞珈门、工学部教学楼和凌波门，或查询道路管制。";
    }
    setChatMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: reply },
    ]);
    setChatText("");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link
          className="brand"
          href="/"
          aria-label="珞珈畅行首页"
          onClick={() => setView("route")}
        >
          <span className="brand-mark">
            <Navigation size={23} fill="currentColor" />
          </span>
          <span className="brand-name">
            珞珈畅行<small>LUOJIA TRANSIT</small>
          </span>
        </Link>
        <nav className="main-nav" aria-label="主导航">
          {(
            [
              { id: "route", label: "路线规划", icon: RouteIcon },
              { id: "bus", label: "校园校巴", icon: Bus },
              { id: "notices", label: "出行公告", icon: TriangleAlert },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <item.icon size={17} />
              <span>{item.label}</span>
              {item.id === "notices" && <i className="nav-notice-dot" />}
            </button>
          ))}
          <button
            className="nav-chat"
            aria-label="打开出行问答"
            title="出行问答"
            onClick={() => setChatOpen(true)}
          >
            <MessageCircle size={18} />
            <span>问答</span>
          </button>
        </nav>
        <div className="topbar-right">
          <span className="campus-label">
            <MapPin size={14} />
            武汉大学
          </span>
          <span className="topbar-divider" />
          <span className="demo-status">
            <i />
            {view === "bus"
              ? busMode
              : view === "route"
                ? roadGraph
                  ? "道路寻路"
                  : roadError
                    ? "路网未连接"
                    : "路网加载中"
                : "公告演示"}
          </span>
          <button
            className="avatar"
            aria-label="查看数据状态"
            title="查看数据状态"
            onClick={() => setDataOpen(true)}
          >
            珞
          </button>
        </div>
      </header>

      <main className="main-workspace">
        <div className="workspace-header">
          <div>
            <div className="section-kicker">
              <span />
              CAMPUS MOBILITY
            </div>
            <h1>
              {view === "route"
                ? "校园路线"
                : view === "bus"
                  ? "校园校巴"
                  : "校园出行动态"}
            </h1>
            <p>
              {view === "route"
                ? "选择地点或点击地图设置终点；定位可设为起点。"
                : view === "bus"
                  ? "文理学部、工学部与东湖，一线串联校园。"
                  : "留意道路变化，安排好今天的行程。"}
            </p>
          </div>
          <div className="workspace-meta">
            <Sun size={21} />
            <div>
              <strong>珞珈山 · 武汉大学</strong>
              <span>
                {view === "bus"
                  ? `数据读取：${busReadTimeText}（北京时间）`
                  : view === "route"
                    ? `路网数据：${roadGraph?.dataTimestamp.slice(0, 10) ?? "加载中"}`
                    : "演示公告 · 2026 年 10 月 10 日"}
              </span>
            </div>
            <span className="meta-divider" />
            <button onClick={() => setDataOpen(true)} className="data-pill">
              <ShieldCheck size={15} />
              数据说明
              <ChevronDown size={13} />
            </button>
          </div>
        </div>

        <div className={`workspace-body view-${view}`}>
          <aside className="sidebar">
            {view === "route" && (
              <>
                <section className="planner-section">
                  <div className="section-title">
                    <h2>规划行程</h2>
                    <button
                      className={`icon-button favorite-button ${saved ? "is-saved" : ""}`}
                      onClick={toggleFavorite}
                      title={saved ? "取消收藏终点" : "收藏终点"}
                      aria-label={saved ? "取消收藏终点" : "收藏终点"}
                    >
                      <Star size={17} fill={saved ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      calculate();
                    }}
                  >
                    <div className="journey-fields">
                      <div className="journey-connector" />
                      <PlaceInput
                        key={`origin-${origin.id}`}
                        label="出发地"
                        kind="origin"
                        place={origin}
                        onChange={setOrigin}
                      />
                      <div className="field-separator" />
                      <PlaceInput
                        key={`destination-${destination.id}`}
                        label="目的地"
                        kind="destination"
                        place={destination}
                        onChange={setDestination}
                      />
                      <button
                        className="swap-button"
                        type="button"
                        title="交换起点与终点"
                        aria-label="交换起点与终点"
                        onClick={() => {
                          setOrigin(destination);
                          setDestination(origin);
                        }}
                      >
                        <ArrowDownUp size={16} />
                      </button>
                    </div>
                    <div className="planner-actions">
                      <button
                        className="search-button"
                        type="submit"
                        aria-label={busy ? "正在规划" : "查找路线"}
                        title="查找路线"
                        disabled={busy}
                      >
                        <Search size={17} />
                        <span>{busy ? "正在规划…" : "查找路线"}</span>
                        <ArrowRight size={17} />
                      </button>
                      <button
                        type="button"
                        className={`icon-button mobile-favorite ${saved ? "is-saved" : ""}`}
                        onClick={toggleFavorite}
                        title={saved ? "取消收藏终点" : "收藏终点"}
                        aria-label={saved ? "取消收藏终点" : "收藏终点"}
                      >
                        <Star
                          size={18}
                          fill={saved ? "currentColor" : "none"}
                        />
                      </button>
                    </div>
                  </form>
                  <div className="favorite-places">
                    <Bookmark size={13} />
                    {favorites.length ? (
                      favorites.map((id) => {
                        const p = places.find((place) => place.id === id)!;
                        return (
                          <button key={id} onClick={() => pickDestination(p)}>
                            {p.name}
                            <ChevronRight size={11} />
                          </button>
                        );
                      })
                    ) : (
                      <span>暂无收藏地点</span>
                    )}
                  </div>
                </section>

                <section
                  className={`route-section ${routesExpanded ? "panel-expanded" : "panel-collapsed"}`}
                  aria-label="出行方案"
                >
                  <div className="route-section-title">
                    <h2>
                      出行方案 <span>{routes.length}</span>
                    </h2>
                    <span className="route-desktop-caption">估算耗时</span>
                    <button
                      className="panel-toggle"
                      aria-expanded={routesExpanded}
                      aria-controls="route-options"
                      onClick={() => setRoutesExpanded(!routesExpanded)}
                    >
                      {routesExpanded ? "收起方案" : "全部方案"}
                      <ChevronDown
                        size={16}
                        className={routesExpanded ? "rotated" : ""}
                      />
                    </button>
                  </div>
                  <div
                    id="route-options"
                    className={`route-list ${busy ? "is-loading" : ""}`}
                  >
                    {!routes.length && (
                      <p role="status">
                        {roadError ||
                          (roadGraph
                            ? "未找到连通道路，请选择其他地点。"
                            : "正在加载校园路网…")}
                      </p>
                    )}
                    {routes.map((route) => {
                      const Icon = modeIcons[route.mode];
                      const active = selectedMode === route.mode;
                      return (
                        <button
                          className={`route-option ${route.mode} ${active ? "selected" : ""}`}
                          key={route.mode}
                          aria-pressed={active}
                          onClick={() => {
                            setSelectedMode(route.mode);
                            if (route.busLineId) setBusLineId(route.busLineId);
                          }}
                        >
                          <div className="route-option-top">
                            <span className={`mode-icon ${route.mode}`}>
                              <Icon size={20} />
                            </span>
                            <span className="route-name">
                              {route.title}
                              <small>
                                {route.mode === "walk"
                                  ? "免等候"
                                  : route.mode === fastest?.mode
                                    ? "估算最快"
                                    : route.mode === "bike"
                                      ? "道路骑行"
                                      : "步行接驳"}
                              </small>
                            </span>
                            <span className="selection-circle">
                              {active && <Check size={14} />}
                            </span>
                          </div>
                          <div className="route-option-stats">
                            <strong>
                              {route.minutes ?? "未知"}
                              <span>
                                {route.minutes === null ? "耗时" : "分钟"}
                              </span>
                            </strong>
                            <span>{formatDistance(route.distance)}</span>
                            <i />
                            <span>{route.cost}</span>
                          </div>
                          <div className="route-segments">
                            {route.segments.map((segment, i) => (
                              <span key={i}>
                                <span
                                  className={`segment-line ${segment.mode}`}
                                  style={{
                                    flexGrow: Math.max(segment.minutes ?? 2, 2),
                                  }}
                                />
                                <small>
                                  {segment.label}{" "}
                                  {segment.minutes === null
                                    ? "未知"
                                    : `${segment.minutes}′`}
                                </small>
                              </span>
                            ))}
                          </div>
                          <div className="route-option-bottom">
                            <span>{route.reason}</span>
                            <ChevronRight size={14} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="estimate-note">
                    <Info size={14} />
                    <span>耗时为估算 · 入口待核实 · 校巴耗时未知</span>
                    <button
                      className="icon-button"
                      aria-label="查看估算与数据说明"
                      title="估算与数据说明"
                      onClick={() => setDataOpen(true)}
                    >
                      <Info size={16} />
                    </button>
                  </div>
                  {selectedRoute && (
                    <details className="road-steps">
                      <summary>
                        道路步骤 · {selectedRoute.steps.length} 段
                      </summary>
                      <ol>
                        {selectedRoute.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {selectedRoute && selectedRoute.mode !== "bus" && (
                    <div className="road-credit">
                      <a
                        href={amapNavigationUrl(
                          journey.origin,
                          journey.destination,
                          selectedRoute.mode,
                        )}
                        target="_blank"
                        rel="noreferrer"
                      >
                        在高德查看同起终点路线
                        {selectedRoute.mode === "bike" ? "（骑行需手机）" : ""}
                      </a>{" "}
                      · 高德会独立规划
                    </div>
                  )}
                  <div className="road-credit">
                    路网 ©{" "}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noreferrer"
                    >
                      OpenStreetMap contributors
                    </a>{" "}
                    · ODbL · {roadGraph?.dataTimestamp.slice(0, 10) ?? "加载中"}
                  </div>
                </section>
                <div className="sidebar-bottom">
                  <Leaf size={16} />
                  <span>走进校园，也走进好风景。</span>
                  <span className="bottom-dots">···</span>
                </div>
              </>
            )}

            {view === "bus" && (
              <section className="bus-section">
                <div className="bus-controls">
                  <div className="section-title">
                    <h2>校园校巴</h2>
                    <span className="small-tag">
                      {feed.snapshot
                        ? `${feed.snapshot.lines.length} 个线路方向`
                        : busStatus}
                    </span>
                  </div>
                  <div className="segmented-control">
                    {["线路", "站点"].map((tab) => (
                      <button
                        key={tab}
                        aria-pressed={busLineView === tab}
                        className={busLineView === tab ? "selected" : ""}
                        onClick={() => setBusLineView(tab)}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  {busData && (
                    <>
                      <label className="bus-selector">
                        线路与方向
                        <select
                          aria-label="校巴线路与方向"
                          value={busData.id}
                          onChange={(event) => {
                            setBusLineId(event.target.value);
                            setBusTarget(1);
                            setAllStops(false);
                          }}
                        >
                          {feed.snapshot?.lines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.name} · {line.stops[0].name} →{" "}
                              {line.stops.at(-1)?.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="bus-line-title">
                        <span className="mode-icon bus">
                          <Bus size={22} />
                        </span>
                        <div>
                          <h3>{busData.name}</h3>
                          <p>
                            {busData.stops[0].name} <ArrowRight size={12} />{" "}
                            {busData.stops.at(-1)?.name}
                          </p>
                        </div>
                      </div>
                      <div className="bus-operating">
                        <span>
                          <Clock3 size={14} />
                          {busData.firstTime || "--"} —{" "}
                          {busData.lastTime || "--"}
                        </span>
                        <span>接口运营时间 · 票价待核实</span>
                      </div>
                      <label className="bus-selector">
                        查看到站站次
                        <select
                          aria-label="校巴目标站次"
                          value={targetStop?.order ?? 1}
                          onChange={(event) =>
                            setBusTarget(Number(event.target.value))
                          }
                        >
                          {busData.stops.map((stop) => (
                            <option key={stop.occurrenceId} value={stop.order}>
                              {stop.order}. {stop.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
                <div className="bus-results">
                  {busData && (
                    <>
                      <div
                        className={`bus-arrival ${busFreshness === "stale" ? "is-stale" : ""}`}
                      >
                        <span>
                          {targetStop?.name} · {busStatus}
                        </span>
                        {busFreshness === "unavailable" ? (
                          <strong>暂无车辆状态</strong>
                        ) : busArrivals.length ? (
                          busArrivals.map(({ vehicle, label }) => (
                            <div className="bus-arrival-row" key={vehicle.id}>
                              <strong>{label}</strong>
                              <small>
                                车辆 {vehicle.id}
                                {busFreshness === "stale" ? " · 历史状态" : ""}
                              </small>
                            </div>
                          ))
                        ) : (
                          <strong>
                            {busData.vehicles.length
                              ? "该站次暂无候选车"
                              : "本次响应无车辆"}
                          </strong>
                        )}
                        <small>站数由站序计算；接口未提供抵达分钟数。</small>
                        <small>车辆读取：{busReadTimeText}（北京时间）</small>
                      </div>
                      <div className="bus-stops-heading">
                        <h3>{allStops ? "全部站点" : "目标站附近"}</h3>
                        <button
                          className="panel-toggle stops-toggle"
                          aria-expanded={allStops}
                          aria-controls="bus-stops"
                          onClick={() => setAllStops(!allStops)}
                        >
                          {allStops ? "收起站点" : "全部站点"}
                          <ChevronDown
                            size={16}
                            className={allStops ? "rotated" : ""}
                          />
                        </button>
                      </div>
                      <div className="bus-stop-list" id="bus-stops">
                        {busData.stops
                          .filter((_, index) => {
                            const targetIndex = Math.max(
                              0,
                              busData.stops.findIndex(
                                (stop) => stop.order === targetStop?.order,
                              ),
                            );
                            const start = Math.max(
                              0,
                              Math.min(
                                targetIndex - 2,
                                busData.stops.length - 5,
                              ),
                            );
                            return (
                              allStops || (index >= start && index < start + 5)
                            );
                          })
                          .map((stop) => (
                            <div
                              className={`bus-stop ${stop.order === targetStop?.order ? "target-stop" : ""}`}
                              key={stop.occurrenceId}
                            >
                              <span className="bus-stop-dot" />
                              <span>
                                <strong>
                                  {stop.order}. {stop.name}
                                </strong>
                                {busLineView === "站点" && (
                                  <small>{stop.area}</small>
                                )}
                              </span>
                              {stop.order === targetStop?.order && (
                                <span className="station-tag">目标站次</span>
                              )}
                              <button
                                className="icon-button"
                                title={`前往${stop.name}`}
                                aria-label={`前往${stop.name}`}
                                onClick={() =>
                                  pickDestination({
                                    ...stop,
                                    id: stop.occurrenceId,
                                  })
                                }
                              >
                                <ArrowRight size={16} />
                              </button>
                            </div>
                          ))}
                      </div>
                      {busData.timetable.length > 0 && (
                        <details className="bus-timetable">
                          <summary>页面班次表</summary>
                          {busData.timetable.map((entry, index) => (
                            <p key={index}>
                              {entry.time} · {entry.from} → {entry.to}
                            </p>
                          ))}
                        </details>
                      )}
                      {busData.warnings.map((warning, index) => (
                        <p className="bus-warning" key={index}>
                          {warning}
                        </p>
                      ))}
                    </>
                  )}
                  {!busData && (
                    <p className="bus-empty" role="status">
                      {busStatus}。读取成功后显示线路与站次。
                    </p>
                  )}
                  {feed.error && (
                    <p className="bus-warning" role="status">
                      读取失败：{feed.error}。
                      {feed.snapshot
                        ? "保留上次成功数据，车辆状态已标为历史快照。"
                        : "暂时无法显示车辆位置。"}
                    </p>
                  )}
                  <details className="bus-data-details">
                    <summary>
                      <Info size={15} /> 数据来源与运营说明
                    </summary>
                    <div className="data-footnote">
                      <Info size={15} />
                      <p>
                        来源：武大校巴页面接口。站点与车辆坐标按高德坐标推断转换，尚未实地核验；步行与骑行按
                        OSM 道路寻路，入口接入段需核实。
                      </p>
                    </div>
                    <div className="source-line">
                      {busStatus}
                      <br />
                      车辆读取：
                      {busData?.vehiclesFetchedAt
                        ? new Date(busData.vehiclesFetchedAt).toLocaleString(
                            "zh-CN",
                            { timeZone: "Asia/Shanghai" },
                          )
                        : "暂无"}
                      （北京时间）
                      <br />每 10 秒读取；超过 30
                      秒显示历史快照。可在“数据说明”设置数据来源。
                    </div>
                  </details>
                </div>
              </section>
            )}

            {view === "notices" && (
              <section className="notice-section">
                <div className="section-title">
                  <h2>道路与临时管制</h2>
                  <span className="small-tag">
                    {incidents.length} 条演示记录
                  </span>
                </div>
                <div className="notice-filters">
                  {["全部", "施工", "限行"].map((filter) => (
                    <button
                      key={filter}
                      aria-pressed={noticeFilter === filter}
                      className={noticeFilter === filter ? "selected" : ""}
                      onClick={() => setNoticeFilter(filter)}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
                <div className="notice-list">
                  {incidents
                    .filter(
                      (item) =>
                        noticeFilter === "全部" || item.type === noticeFilter,
                    )
                    .map((item) => (
                      <article className="notice-item" key={item.id}>
                        <button
                          className="notice-item-header"
                          aria-expanded={expandedNotice === item.id}
                          onClick={() =>
                            setExpandedNotice(
                              expandedNotice === item.id ? null : item.id,
                            )
                          }
                        >
                          <span className={`notice-type ${item.severity}`}>
                            <TriangleAlert size={16} />
                          </span>
                          <span>
                            <strong>{item.title}</strong>
                            <small>
                              {item.area} · {item.type}
                            </small>
                          </span>
                          <ChevronDown
                            size={16}
                            className={
                              expandedNotice === item.id ? "rotated" : ""
                            }
                          />
                        </button>
                        {expandedNotice === item.id && (
                          <div className="notice-item-detail">
                            <p>{item.detail}</p>
                            <span>
                              <Clock3 size={13} />
                              {item.time}
                            </span>
                            <small>来源：本地演示数据 · 更新于 09:30</small>
                            <button
                              onClick={() =>
                                pickDestination(
                                  item.id === "construction"
                                    ? places[3]
                                    : places[6],
                                )
                              }
                            >
                              规划前往此处的路线
                              <ArrowRight size={14} />
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                </div>
                <div className="data-footnote">
                  <ShieldCheck size={16} />
                  <p>
                    管制记录用于预览，尚未接入校方公告。请以学校实际通知为准。
                  </p>
                </div>
              </section>
            )}
          </aside>

          <section className="map-workspace" aria-label="校园地图与行程详情">
            <CampusMap
              route={selectedRoute}
              origin={journey.origin}
              destination={journey.destination}
              view={view}
              busData={busData}
              busStatus={busStatus}
              showBusVehicles={busFreshness !== "unavailable"}
              onPick={pickDestination}
              onOrigin={pickOrigin}
              onMessage={notify}
            />
            {view === "route" && selectedRoute ? (
              <div className="journey-detail">
                <div className="journey-detail-main">
                  <span className={`detail-mode-icon ${selectedRoute.mode}`}>
                    {(() => {
                      const Icon = modeIcons[selectedRoute.mode];
                      return <Icon size={21} />;
                    })()}
                  </span>
                  <div>
                    <div className="detail-place-names">
                      <strong>{journey.origin.name}</strong>
                      <ArrowRight size={14} />
                      <strong>{journey.destination.name}</strong>
                    </div>
                    <p>
                      真实道路方案
                      <span>·</span>
                      {formatDistance(selectedRoute.distance)}
                      <span>·</span>接入段需核实
                    </p>
                  </div>
                </div>
                <div className="detail-estimate">
                  <strong>
                    {selectedRoute.minutes ?? "未知"}
                    <small>
                      {selectedRoute.minutes === null ? "耗时" : "分钟"}
                    </small>
                  </strong>
                  <span>
                    {selectedRoute.minutes === null
                      ? "候车及乘车未知"
                      : "按速度估算"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="journey-detail">
                <div className="journey-detail-main">
                  <span className="detail-mode-icon bus">
                    {view === "bus" ? (
                      <Bus size={21} />
                    ) : (
                      <TriangleAlert size={21} />
                    )}
                  </span>
                  <div>
                    <div className="detail-place-names">
                      <strong>
                        {view === "bus"
                          ? (busData?.name ?? "校园校巴")
                          : view === "route"
                            ? "道路方案不可用"
                            : "校园管制区域"}
                      </strong>
                    </div>
                    <p>
                      {view === "bus"
                        ? `${busData?.stops.length ?? 0} 个站次 · ${busStatus}`
                        : view === "route"
                          ? roadError ||
                            (roadGraph
                              ? "未找到连通道路，请重新选择地点"
                              : "道路数据正在加载")
                          : "2 条演示记录 · 有效时间以各条公告为准"}
                    </p>
                  </div>
                </div>
                <span className="small-tag">
                  {view === "bus"
                    ? "bus.whu.edu.cn"
                    : view === "route"
                      ? "OpenStreetMap"
                      : "本地演示数据"}
                </span>
              </div>
            )}
            <div className="map-statusbar">
              <span>
                <span className="status-dot" />
                校园底图 · Esri
              </span>
              <span>
                <Clock3 size={11} />
                {view === "bus"
                  ? busStatus
                  : view === "route"
                    ? `OSM 路网 ${roadGraph?.dataTimestamp.slice(0, 10) ?? "加载中"}`
                    : `演示数据 ${DEMO_TIME}`}
              </span>
            </div>
          </section>
        </div>
        <footer className="app-footer">
          <span>
            珞珈畅行 <i /> 与你同行，畅行珞珈
          </span>
          <span>
            武汉大学校园出行{" "}
            <span className="footer-version">MVP 预览 · v0.1</span>
          </span>
        </footer>
      </main>

      <button
        className="chat-launcher"
        onClick={() => setChatOpen(true)}
        aria-label="打开出行问答"
      >
        <MessageCircle size={20} />
        <span>出行问答</span>
        <span className="chat-launcher-dot" />
      </button>
      {toast && (
        <div className="toast" role="status">
          <Info size={17} />
          <span>{toast}</span>
          <button
            aria-label="关闭提示"
            title="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {dataOpen && (
        <div className="modal-backdrop" onClick={() => setDataOpen(false)}>
          <section
            className="data-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDataOpen(false);
            }}
          >
            <button
              className="modal-close icon-button"
              title="关闭数据说明"
              aria-label="关闭数据说明"
              onClick={() => setDataOpen(false)}
            >
              <X size={20} />
            </button>
            <span className="data-modal-icon">
              <ShieldCheck size={27} />
            </span>
            <h2 id="data-title">数据来源与状态</h2>
            <p>
              步行与骑行使用 OpenStreetMap
              路网，校巴使用校方接口；公告仍为演示记录。
            </p>
            <dl>
              <div>
                <dt>地图底图</dt>
                <dd>Esri Gray Canvas / World Imagery · 在线底图</dd>
              </div>
              <div>
                <dt>校园地点</dt>
                <dd>
                  OSM
                  建筑中心或校门坐标，入口尚未实地校验。总馆尚无可靠预置坐标，可在地图选点。
                </dd>
              </div>
              <div>
                <dt>路线与耗时</dt>
                <dd>
                  真实路网 Dijkstra 寻路；步行 72 米/分、骑行 200
                  米/分。虚线为地点到路网的接入段，通行与入口需核实；台阶不提供骑行。
                </dd>
              </div>
              <div>
                <dt>校巴</dt>
                <dd>
                  bus.whu.edu.cn · {busStatus}。车辆状态超过 30
                  秒标为历史快照；坐标按 GCJ-02 推断转换为近似
                  WGS84，尚未实地核验。
                </dd>
              </div>
              <div>
                <dt>自行车</dt>
                <dd>路线可计算；车辆租借实时状态不可用。不适用于电动车。</dd>
              </div>
              <div>
                <dt>道路管制</dt>
                <dd>本地演示记录 · 非校方公告</dd>
              </div>
              <div>
                <dt>演示数据时间</dt>
                <dd>{DEMO_TIME}（固定快照）</dd>
              </div>
              <div>
                <dt>数据有效性</dt>
                <dd>
                  道路静态快照，未接入临时门禁、施工或现场通行状态；校巴仅提供单次乘车候选，不计算换乘和总耗时。
                </dd>
              </div>
            </dl>
            <form
              className="bus-feed-form"
              onSubmit={(event) => {
                event.preventDefault();
                try {
                  feed.configure(feedAddress);
                  notify("已切换校巴数据来源。");
                } catch (error) {
                  notify(
                    error instanceof Error ? error.message : "数据地址无效",
                  );
                }
              }}
            >
              <label htmlFor="bus-feed-url">校巴数据地址</label>
              <input
                id="bus-feed-url"
                value={feedAddress}
                placeholder={feed.url}
                onChange={(event) => setFeedAddress(event.target.value)}
              />
              <small>留空恢复随包快照；填写采集服务地址可持续更新。</small>
              <button type="submit" className="search-button">
                应用数据地址
              </button>
            </form>
            <button
              className="search-button"
              onClick={() => setDataOpen(false)}
            >
              知道了
              <Check size={16} />
            </button>
          </section>
        </div>
      )}

      {chatOpen && (
        <div className="chat-backdrop" onClick={() => setChatOpen(false)}>
          <section
            className="chat-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="chat-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setChatOpen(false);
            }}
          >
            <div className="chat-header">
              <span className="chat-header-icon">
                <Sparkles size={20} />
              </span>
              <div>
                <h2 id="chat-title">出行问答</h2>
                <span>本地道路与校巴查询 · 非 AI 服务</span>
              </div>
              <button
                className="icon-button"
                aria-label="关闭出行问答"
                title="关闭出行问答"
                onClick={() => setChatOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="chat-body">
              {!chatMessages.length && (
                <div className="chat-empty">
                  <span>
                    <Navigation size={30} />
                  </span>
                  <h3>你的下一段校园旅程</h3>
                  <div className="chat-suggestions">
                    {[
                      "从桂园到工学部图书馆怎么走",
                      "现在适合等校巴还是骑车",
                      "今天有哪些道路管制",
                    ].map((text) => (
                      <button key={text} onClick={() => ask(text)}>
                        {text}
                        <ArrowRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((message, index) => (
                <div className={`chat-message ${message.role}`} key={index}>
                  {message.text}
                </div>
              ))}
              <div ref={chatEnd} />
            </div>
            <form
              className="chat-form"
              onSubmit={(e) => {
                e.preventDefault();
                ask(chatText);
              }}
            >
              <input
                data-autofocus
                aria-label="出行问题"
                placeholder="输入你的出发地与目的地…"
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
              />
              <button
                aria-label="发送问题"
                title="发送问题"
                disabled={!chatText.trim()}
              >
                <Send size={18} />
              </button>
            </form>
            <div className="chat-disclaimer">
              道路来自 OSM；实时车辆来自校巴接口；公告为演示记录。
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
