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
  busStops,
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
  const [origin, setOrigin] = useState(places[0]);
  const [destination, setDestination] = useState(places[1]);
  const [journey, setJourney] = useState({
    origin: places[0],
    destination: places[1],
  });
  const [routes, setRoutes] = useState<Route[]>(() =>
    planRoutes(places[0], places[1]),
  );
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
  const selectedRoute = routes.find((r) => r.mode === selectedMode);
  const fastest = recommendRoute(routes);
  const saved = favorites.includes(destination.id);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

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
    setBusy(true);
    if (routeTimer.current) clearTimeout(routeTimer.current);
    routeTimer.current = setTimeout(() => {
      setRoutes(planRoutes(from, to));
      setJourney({ origin: from, destination: to });
      setSelectedMode("walk");
      setBusy(false);
      setView("route");
    }, 400);
  }
  function pickDestination(place: Place) {
    setDestination(place);
    calculate(origin, place);
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
      const options = planRoutes(parsed.origin, parsed.destination);
      const walk = options.find((r) => r.mode === "walk")!;
      reply = `从${parsed.origin.name}到${parsed.destination.name}，步行估算 ${walk.minutes} 分钟，约 ${formatDistance(walk.distance)}。${walk.affected ? "樱园路有演示施工记录，示意路线已调整。" : "步行无需候车。"}校巴和电动车状态尚未接入，出发前请核实。来源：本地演示数据，${DEMO_TIME}；路线仅供 UI 预览。`;
      setOrigin(parsed.origin);
      setDestination(parsed.destination);
      calculate(parsed.origin, parsed.destination);
    } else if (/管制|施工|封路/.test(text)) {
      reply = `演示管制记录：${incidents.map((i) => `${i.title}（${i.time}）`).join("；")}。来源：本地演示数据，${DEMO_TIME}。这些记录不代表校园当前实际管制。`;
    } else if (/校巴|等车|骑车/.test(text)) {
      reply = `当前行程步行估算 ${routes.find((r) => r.mode === "walk")?.minutes ?? "--"} 分钟。校巴到站和车辆数量都是演示数据，无法据此判断实际是否适合等车或骑车。没有实时信息时，步行是可自行执行的备用方案。来源：本地演示数据，${DEMO_TIME}。`;
    } else {
      reply =
        "暂时没有识别出完整行程。可查询桂园宿舍、第一教学楼、总图书馆、樱顶老图书馆、梅园食堂、珞珈门、工学部教学楼和凌波门，或查询道路管制。";
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
        </nav>
        <div className="topbar-right">
          <span className="campus-label">
            <MapPin size={14} />
            武汉大学
          </span>
          <span className="topbar-divider" />
          <span className="demo-status">
            <i />
            演示模式
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
                ? "下一站，去哪里？"
                : view === "bus"
                  ? "校巴，连接每一站"
                  : "校园出行动态"}
            </h1>
            <p>
              {view === "route"
                ? "从宿舍到课堂，让每一段校园路程更从容。"
                : view === "bus"
                  ? "文理学部、工学部与东湖，一线串联校园。"
                  : "留意道路变化，安排好今天的行程。"}
            </p>
          </div>
          <div className="workspace-meta">
            <Sun size={21} />
            <div>
              <strong>珞珈山 · 武汉大学</strong>
              <span>2026 年 10 月 10 日 · 星期六</span>
            </div>
            <span className="meta-divider" />
            <button onClick={() => setDataOpen(true)} className="data-pill">
              <ShieldCheck size={15} />
              数据说明
              <ChevronDown size={13} />
            </button>
          </div>
        </div>

        <div className="workspace-body">
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
                    <button
                      className="search-button"
                      type="submit"
                      disabled={busy}
                    >
                      <Search size={17} />
                      <span>{busy ? "正在规划…" : "查找路线"}</span>
                      <ArrowRight size={17} />
                    </button>
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

                <section className="route-section" aria-label="出行方案">
                  <div className="route-section-title">
                    <h2>
                      出行方案 <span>{routes.length}</span>
                    </h2>
                    <span>总耗时比较</span>
                  </div>
                  <div className={`route-list ${busy ? "is-loading" : ""}`}>
                    {routes.map((route) => {
                      const Icon = modeIcons[route.mode];
                      const active = selectedMode === route.mode;
                      return (
                        <button
                          className={`route-option ${route.mode} ${active ? "selected" : ""}`}
                          key={route.mode}
                          aria-pressed={active}
                          onClick={() => setSelectedMode(route.mode)}
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
                                    ? "预计最快"
                                    : "少走路"}
                              </small>
                            </span>
                            <span className="selection-circle">
                              {active && <Check size={11} />}
                            </span>
                          </div>
                          <div className="route-option-stats">
                            <strong>
                              {route.minutes}
                              <span>分钟</span>
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
                                    flexGrow: Math.max(segment.minutes, 2),
                                  }}
                                />
                                <small>
                                  {segment.label} {segment.minutes}′
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
                    <span>耗时为演示估算，车辆状态尚未接入。</span>
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
                <div className="section-title">
                  <h2>校园校巴</h2>
                  <span className="small-tag">1 条演示线路</span>
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
                <div className="bus-line-title">
                  <span className="mode-icon bus">
                    <Bus size={22} />
                  </span>
                  <div>
                    <h3>校园 1 号线</h3>
                    <p>
                      珞珈门 <ArrowRight size={12} /> 凌波门
                    </p>
                  </div>
                </div>
                <div className="bus-operating">
                  <span>
                    <Clock3 size={14} />
                    07:00 — 21:30
                  </span>
                  <span>演示时刻</span>
                </div>
                <div className="bus-arrival">
                  <span>桂园站 · 下一班</span>
                  <strong>
                    约 5 <small>分钟</small>
                  </strong>
                  <span className="small-tag">模拟到站</span>
                </div>
                <div className="bus-stop-list">
                  {busStops.map((stop, index) => (
                    <div className="bus-stop" key={stop.id}>
                      <span className="bus-stop-dot" />
                      <span>
                        <strong>{stop.name}</strong>
                        {busLineView === "站点" && <small>{stop.area}</small>}
                      </span>
                      {index === 1 && (
                        <span className="station-tag">演示车辆附近</span>
                      )}
                      <button
                        className="icon-button"
                        title={`前往${stop.name}`}
                        aria-label={`前往${stop.name}`}
                        onClick={() => pickDestination(stop)}
                      >
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="data-footnote">
                  <Info size={15} />
                  <p>
                    线路、站点、运营时间及车辆位置均为演示数据。实际线路与票价待校方确认。
                  </p>
                </div>
                <div className="source-line">
                  来源：本地演示数据
                  <br />
                  数据时间：{DEMO_TIME}
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
              onPick={pickDestination}
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
                      {selectedRoute.affected
                        ? "已按演示施工记录调整路线"
                        : "校园内行程"}
                      <span>·</span>
                      {formatDistance(selectedRoute.distance)}
                      <span>·</span>路线为示意，非导航
                    </p>
                  </div>
                </div>
                <div className="detail-estimate">
                  <strong>
                    {selectedRoute.minutes}
                    <small>分钟</small>
                  </strong>
                  <span>预计总耗时</span>
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
                        {view === "bus" ? "校园 1 号线" : "校园管制区域"}
                      </strong>
                    </div>
                    <p>
                      {view === "bus"
                        ? "6 个演示站点 · 车辆位置非实时"
                        : "2 条演示记录 · 有效时间以各条公告为准"}
                    </p>
                  </div>
                </div>
                <span className="small-tag">本地演示数据</span>
              </div>
            )}
            <div className="map-statusbar">
              <span>
                <span className="status-dot" />
                校园底图 · Esri
              </span>
              <span>
                <Clock3 size={11} />
                演示数据 {DEMO_TIME}
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
            <p>当前为 UI 审查版本，校园出行状态尚未接入实时服务。</p>
            <dl>
              <div>
                <dt>地图底图</dt>
                <dd>Esri Gray Canvas / World Imagery · 在线底图</dd>
              </div>
              <div>
                <dt>校园地点</dt>
                <dd>本地演示数据 · 坐标待实地校验</dd>
              </div>
              <div>
                <dt>路线与耗时</dt>
                <dd>距离估算 · 非实际道路导航</dd>
              </div>
              <div>
                <dt>校巴 / 电动车</dt>
                <dd>演示数据 · 实时状态不可用</dd>
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
                <dd>仅限预览，不作为实际出行依据</dd>
              </div>
            </dl>
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
                <span>本地演示 · 非实时 AI 服务</span>
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
                      "从桂园到总图书馆怎么走",
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
              回答仅引用本地演示记录，实际出行请核实。
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
