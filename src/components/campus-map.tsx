"use client";

import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import L from "leaflet";
import {
  Bus,
  Crosshair,
  Layers,
  LocateFixed,
  Minus,
  Plus,
  RotateCcw,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  campusBounds,
  incidents,
  places,
  type Place,
  type Route,
} from "@/lib/campus";
import type { BusLine } from "@/lib/bus";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

const routeColors = { walk: "#24745d", bus: "#3978be", bike: "#159a9a" };
const vehicleIcon = renderToStaticMarkup(<Bus size={18} aria-hidden="true" />);

export default function CampusMap({
  route,
  origin,
  destination,
  view,
  busData,
  busStatus,
  showBusVehicles,
  onPick,
  onOrigin,
  onMessage,
}: {
  route?: Route;
  origin: Place;
  destination: Place;
  view: string;
  busData?: BusLine;
  busStatus: string;
  showBusVehicles: boolean;
  onPick: (place: Place) => void;
  onOrigin: (place: Place) => void;
  onMessage: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const routeRef = useRef<L.LayerGroup | null>(null);
  const tilesRef = useRef<L.TileLayer | null>(null);
  const pickRef = useRef(onPick);
  const originPickRef = useRef(onOrigin);
  const [layersOpen, setLayersOpen] = useState(false);
  const [busLayerOverride, setBusLayerOverride] = useState<boolean | null>(
    null,
  );
  const showBus = busLayerOverride ?? (view === "bus" || route?.mode === "bus");
  const [showIncidents, setShowIncidents] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [baseMap, setBaseMap] = useState("light");
  const [mapZoom, setMapZoom] = useState(16);
  // A new vehicle snapshot must not reset a user's map position.
  const busBoundsKey = JSON.stringify(
    busData?.stops.map((stop) => [stop.lat, stop.lng]) ?? [],
  );
  const busLineId = busData?.id;
  useEffect(() => {
    pickRef.current = onPick;
    originPickRef.current = onOrigin;
  }, [onPick, onOrigin]);

  useEffect(() => {
    if (!container.current || mapRef.current) return;
    const map = L.map(container.current, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 12,
      maxZoom: 19,
    });
    map.on("zoomend", () => setMapZoom(map.getZoom()));
    map.on("click", (event) => {
      if (
        (event.originalEvent.target as Element)?.closest?.(
          ".leaflet-marker-icon",
        )
      )
        return;
      const { lat, lng } = event.latlng;
      pickRef.current({
        id: `map:${lat.toFixed(7)}:${lng.toFixed(7)}`,
        name: "地图选点",
        area: "用户选择的坐标",
        aliases: [],
        lat,
        lng,
        source: "地图选点 · 入口需核实",
      });
    });
    map.fitBounds(campusBounds, { padding: [20, 20] });
    const tiles = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, maxNativeZoom: 16 },
    );
    let errorCount = 0;
    tiles.on("tileerror", () => {
      if (++errorCount > 3) setMapError(true);
    });
    tiles.on("tileload", () => setMapError(false));
    tiles.addTo(map);
    tilesRef.current = tiles;
    L.control
      .attribution({ position: "bottomright", prefix: false })
      .addAttribution(
        'Tiles &copy; <a href="https://www.esri.com/en-us/legal/terms/data-attributions" target="_blank" rel="noreferrer">Esri &amp; contributors</a>',
      )
      .addAttribution(
        'Roads &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
      )
      .addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    routeRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tilesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const service =
      baseMap === "satellite"
        ? "World_Imagery"
        : "Canvas/World_Light_Gray_Base";
    tilesRef.current?.setUrl(
      `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`,
    );
  }, [baseMap]);

  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) return;
    layer.clearLayers();
    places.forEach((place) => {
      const endpoint =
        view === "route" &&
        (place.id === origin.id || place.id === destination.id);
      if (endpoint) return;
      if (mapZoom < 16) return;
      const marker = L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: "campus-poi",
          html: `<span class="poi-dot"></span>${mapZoom >= 17 ? `<span class="poi-name">${escapeHtml(place.name)}</span>` : ""}`,
          iconSize: [110, 28],
          iconAnchor: [5, 14],
        }),
        keyboard: true,
        title: `${place.name}，设为终点`,
      }).on("click", () => pickRef.current(place));
      marker.addTo(layer);
    });
    if (showBus) {
      if (busData?.path.length)
        L.polyline(busData.path, {
          color: routeColors.bus,
          weight: 3,
          opacity: 0.55,
          dashArray: "6 8",
        }).addTo(layer);
      if (showBusVehicles)
        busData?.vehicles.forEach((vehicle) => {
          L.marker([vehicle.lat, vehicle.lng], {
            icon: L.divIcon({
              className: "bus-marker",
              html: `<span>${vehicleIcon}</span>`,
              iconSize: [44, 44],
              iconAnchor: [22, 22],
            }),
            title: `${busData.name} · ${busStatus} · 车辆 ${vehicle.id}`,
          })
            .bindPopup(
              `${escapeHtml(busData.name)} · ${escapeHtml(busStatus)}<br>${escapeHtml(busData.stops[0].name)} → ${escapeHtml(busData.stops.at(-1)?.name ?? "")}<br>车辆 ${escapeHtml(vehicle.id)}<br>来源：bus.whu.edu.cn<br>${escapeHtml(busData.vehiclesFetchedAt ?? "暂无读取时间")}<br>坐标按推断转换，尚未实地核验`,
            )
            .addTo(layer);
        });
      if (view === "bus")
        busData?.stops.forEach((stop) => {
          L.circleMarker([stop.lat, stop.lng], {
            radius: 4,
            color: "#3978be",
            fillOpacity: 0.9,
          })
            .bindPopup(
              `${stop.order}. ${escapeHtml(stop.name)}<br>来源：bus.whu.edu.cn`,
            )
            .addTo(layer);
        });
    }
    if (showIncidents)
      incidents.forEach((item) => {
        L.circle([item.lat, item.lng], {
          radius: 95,
          color: "#c58b2d",
          weight: 1,
          dashArray: "4 4",
          fillColor: "#efbd58",
          fillOpacity: 0.18,
        }).addTo(layer);
        L.marker([item.lat, item.lng], {
          icon: L.divIcon({
            className: "incident-marker",
            html: `<span>!</span><b>${item.type}</b>`,
            iconSize: [64, 28],
            iconAnchor: [15, 14],
          }),
          title: item.title,
        })
          .bindPopup(
            `<strong>${item.title}</strong><br>${item.detail}<br>${item.time}<br>来源：本地演示数据`,
          )
          .addTo(layer);
      });
  }, [
    origin,
    destination,
    showBus,
    showIncidents,
    view,
    mapZoom,
    busData,
    busStatus,
    showBusVehicles,
  ]);

  useEffect(() => {
    const layer = routeRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    map.invalidateSize({ pan: false });
    layer.clearLayers();
    if (view !== "route" || !route) {
      const busPoints: [number, number][] = JSON.parse(busBoundsKey);
      const bounds =
        view === "bus" && busPoints.length
          ? L.latLngBounds(busPoints)
          : L.latLngBounds(campusBounds);
      map.fitBounds(bounds, { padding: [35, 35], maxZoom: 16, animate: false });
      return;
    }
    L.polyline(route.points, {
      color: "white",
      weight: 10,
      opacity: 0.9,
      lineCap: "round",
    }).addTo(layer);
    route.legs.forEach((leg) =>
      L.polyline(leg.points, {
        color: leg.connector ? "#7b8088" : routeColors[leg.mode],
        weight: leg.connector ? 3 : 5,
        opacity: 0.95,
        lineCap: "round",
        dashArray: leg.connector ? "4 6" : undefined,
      })
        .bindTooltip(
          leg.connector ? "地点接入段 · 入口与通行需核实" : "沿真实道路行进",
        )
        .addTo(layer),
    );
    [origin, destination].forEach((place, index) => {
      L.marker([place.lat, place.lng], {
        icon: L.divIcon({
          className: `endpoint-marker ${index ? "destination-marker" : "origin-marker"}`,
          html: `<span>${index ? "终" : "起"}</span><b>${escapeHtml(place.name)}</b>`,
          iconSize: [140, 42],
          iconAnchor: [21, 21],
        }),
        title: place.name,
        zIndexOffset: 1000,
      }).addTo(layer);
    });
    // Keep campus context visible even when the selected journey is short.
    const compactMap = container.current!.clientWidth <= 760;
    map.fitBounds(L.latLngBounds(route.points).pad(compactMap ? 0.15 : 0.8), {
      animate: false,
      maxZoom: compactMap ? 17 : 16,
      paddingTopLeft: compactMap ? [42, 55] : [45, 100],
      paddingBottomRight: compactMap ? [65, 65] : [80, 50],
    });
  }, [route, origin, destination, view, busBoundsKey, busLineId]);

  function locate() {
    if (!navigator.geolocation) {
      onMessage("浏览器不支持定位，请手动选择校园地点。");
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationBusy(false);
        const { latitude, longitude } = position.coords;
        const map = mapRef.current;
        if (!map) return;
        map.flyTo([latitude, longitude], 16);
        originPickRef.current({
          id: "current-location",
          name: "当前位置",
          area: "浏览器定位",
          aliases: [],
          lat: latitude,
          lng: longitude,
          source: `浏览器定位 · 精度约 ${Math.round(position.coords.accuracy)} 米`,
        });
        L.circleMarker([latitude, longitude], {
          radius: 7,
          color: "white",
          weight: 3,
          fillColor: "#3b82f6",
          fillOpacity: 1,
        })
          .bindPopup("当前位置")
          .addTo(map);
        onMessage(
          `已将当前位置设为起点，定位精度约 ${Math.round(position.coords.accuracy)} 米。`,
        );
      },
      () => {
        setLocationBusy(false);
        onMessage("暂时无法获取位置，请检查浏览器定位权限。");
      },
      { timeout: 10000 },
    );
  }

  return (
    <div className="map-surface" data-testid="campus-map">
      <div
        ref={container}
        className="leaflet-surface"
        aria-label="武汉大学校园地图"
      />
      <div className="map-heading">
        <span className="map-heading-dot" />
        <strong>武汉大学</strong>
        <span className="map-heading-divider" />
        <span>文理学部及周边</span>
      </div>
      {showIncidents && (
        <div className="map-alert">
          <TriangleAlert size={17} />
          <span>
            <strong>樱园路局部施工</strong>
            <span className="map-alert-extra"> · 注意绕行</span>
          </span>
          <span className="tiny-demo">演示</span>
        </div>
      )}
      {mapError && (
        <div className="map-error" role="status">
          地图底图暂时无法加载，请检查网络。路线和地点标记仍可查看。
        </div>
      )}
      <div className="map-tools">
        <button
          title="放大地图"
          aria-label="放大地图"
          onClick={() => mapRef.current?.zoomIn()}
        >
          <Plus size={20} />
        </button>
        <button
          title="缩小地图"
          aria-label="缩小地图"
          onClick={() => mapRef.current?.zoomOut()}
        >
          <Minus size={20} />
        </button>
        <div className="tool-divider" />
        <button
          title="定位当前位置"
          aria-label="定位当前位置"
          disabled={locationBusy}
          onClick={locate}
        >
          <LocateFixed size={19} className={locationBusy ? "spin" : ""} />
        </button>
        <button
          title="显示整个校园"
          aria-label="显示整个校园"
          onClick={() =>
            mapRef.current?.fitBounds(
              view === "bus" && busData?.stops.length
                ? L.latLngBounds(
                    busData.stops.map((stop) => [stop.lat, stop.lng]),
                  )
                : campusBounds,
            )
          }
        >
          <RotateCcw size={18} />
        </button>
      </div>
      <div className="layer-tools">
        <button
          className={layersOpen ? "active" : ""}
          title="地图图层"
          aria-label="地图图层"
          aria-expanded={layersOpen}
          onClick={() => setLayersOpen(!layersOpen)}
        >
          <Layers size={19} />
        </button>
      </div>
      {layersOpen && (
        <div className="layers-popover">
          <div>
            <strong>地图图层</strong>
            <button
              title="关闭图层"
              aria-label="关闭图层"
              onClick={() => setLayersOpen(false)}
            >
              <X size={15} />
            </button>
          </div>
          <label>
            <input
              type="radio"
              name="basemap"
              checked={baseMap === "light"}
              onChange={() => setBaseMap("light")}
            />
            浅色底图
          </label>
          <label>
            <input
              type="radio"
              name="basemap"
              checked={baseMap === "satellite"}
              onChange={() => setBaseMap("satellite")}
            />
            卫星影像
          </label>
          <div className="layers-divider" />
          <label>
            <input
              type="checkbox"
              checked={showBus}
              onChange={(e) => setBusLayerOverride(e.target.checked)}
            />
            校巴线路与车辆
          </label>
          <label>
            <input
              type="checkbox"
              checked={showIncidents}
              onChange={(e) => setShowIncidents(e.target.checked)}
            />
            道路管制区域
          </label>
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="legend-route" />
          步行
        </span>
        <span>
          <i className="legend-bus" />
          校巴
        </span>
        <span>
          <i className="legend-bike" />
          骑行
        </span>
        <span>
          <i className="legend-alert" />
          管制区域
        </span>
      </div>
      <div className="map-north">
        <Crosshair size={15} />
        <span>N</span>
      </div>
    </div>
  );
}
