const AREA_SOURCE_ID = "jma-warning-areas";
const AREA_LAYER_ID = "jma_warning_areas";
const AREA_TILES_URL =
  "pmtiles://" +
  new URL("./data/jma-warning-areas.pmtiles", location.href).href;
const WARNING_URL = new URL("./data/weather_warning.json", location.href);
const CODE_MAP_URL = new URL("./data/warning-code-map.json", location.href);
const AREA_SUMMARY_URL = new URL("./data/area-summary.json", location.href);
const JAPAN_BOUNDS = [
  [121.5, 23.0],
  [150.0, 46.0]
];
const COLORS = {
  mapBackground: "#daeeff",
  area: {
    none: "#eaeaea",
    advisory: "#ffd43b",
    warning: "#d73027",
    urgent: "#7b2cbf",
    emergency: "#111111"
  },
  boundary: {
    warned: "rgba(23, 32, 51, 0.42)",
    unwarned: "rgba(100, 116, 139, 0.22)"
  },
  highlight: {
    halo: "#ffffff",
    line: "#0891b2"
  },
  text: {
    dark: "#172033",
    light: "#ffffff"
  }
};
const LEVELS = [
  { key: "emergency", label: "特別警報" },
  { key: "urgent", label: "危険警報" },
  { key: "warning", label: "警報" },
  { key: "advisory", label: "注意報" },
  { key: "none", label: "発表なし" }
].map((level) => ({ ...level, color: getLevelColor(level.key) }));

document.documentElement.style.setProperty("--map-background", COLORS.mapBackground);

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const map = new maplibregl.Map({
  container: "map",
  center: [137.5, 38.2],
  zoom: 4.5,
  minZoom: 4,
  style: {
    version: 8,
    sources: {
      [AREA_SOURCE_ID]: {
        type: "vector",
        url: AREA_TILES_URL,
        promoteId: "area_id",
        attribution: "気象庁"
      }
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: {
          "background-color": COLORS.mapBackground
        }
      },
      {
        id: "areas-fill",
        type: "fill",
        source: AREA_SOURCE_ID,
        "source-layer": AREA_LAYER_ID,
        paint: {
          "fill-color": [
            "case",
            ["==", ["feature-state", "level"], "emergency"],
            COLORS.area.emergency,
            ["==", ["feature-state", "level"], "urgent"],
            COLORS.area.urgent,
            ["==", ["feature-state", "level"], "warning"],
            COLORS.area.warning,
            ["==", ["feature-state", "level"], "advisory"],
            COLORS.area.advisory,
            COLORS.area.none
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hasWarning"], false],
            0.86,
            1
          ]
        }
      },
      {
        id: "areas-line",
        type: "line",
        source: AREA_SOURCE_ID,
        "source-layer": AREA_LAYER_ID,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "hasWarning"], false],
            COLORS.boundary.warned,
            COLORS.boundary.unwarned
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            0.25,
            8,
            0.55,
            11,
            1
          ]
        }
      },
      {
        id: "areas-highlight-halo",
        type: "line",
        source: AREA_SOURCE_ID,
        "source-layer": AREA_LAYER_ID,
        paint: {
          "line-color": COLORS.highlight.halo,
          "line-opacity": [
            "case",
            [
              "any",
              ["boolean", ["feature-state", "hover"], false],
              ["boolean", ["feature-state", "kindHighlight"], false]
            ],
            0.9,
            0
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            2.4,
            8,
            3.2,
            11,
            4.2
          ],
          "line-blur": 0.7
        }
      },
      {
        id: "areas-highlight-line",
        type: "line",
        source: AREA_SOURCE_ID,
        "source-layer": AREA_LAYER_ID,
        paint: {
          "line-color": COLORS.highlight.line,
          "line-opacity": [
            "case",
            [
              "any",
              ["boolean", ["feature-state", "hover"], false],
              ["boolean", ["feature-state", "kindHighlight"], false]
            ],
            0.95,
            0
          ],
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            4,
            1,
            8,
            1.4,
            11,
            2
          ]
        }
      }
    ]
  }
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
map.fitBounds(JAPAN_BOUNDS, { padding: 10, duration: 0 });

let warningsByCode = new Map();
let kindToRegionCodes = new Map();
let codeMap = {};
let areaSummary = { totalAreas: 1805 };
let hoveredAreaId = null;
let activeKindCode = null;
let highlightedRegionCodes = new Set();

map.on("load", async () => {
  try {
    const [warningResponse, codeMapResponse, areaSummaryResponse] = await Promise.all([
      fetch(WARNING_URL, { cache: "no-store" }),
      fetch(CODE_MAP_URL),
      fetch(AREA_SUMMARY_URL)
    ]);
    if (!warningResponse.ok) {
      throw new Error("weather_warning.json を読み込めませんでした。");
    }
    if (!codeMapResponse.ok) {
      throw new Error("warning-code-map.json を読み込めませんでした。");
    }
    if (!areaSummaryResponse.ok) {
      throw new Error("area-summary.json を読み込めませんでした。");
    }
    const warningData = await warningResponse.json();
    codeMap = await codeMapResponse.json();
    areaSummary = await areaSummaryResponse.json();
    applyWarnings(warningData);
    renderSummary(warningData);
  } catch (error) {
    showError(error.message);
  }
});

map.on("mousemove", "areas-fill", (event) => {
  const feature = event.features && event.features[0];
  if (!feature) return;
  const regionCode = feature.properties.regioncode;
  if (!regionCode) {
    map.getCanvas().style.cursor = "";
    if (hoveredAreaId) {
      setRegionState(hoveredAreaId, { hover: false });
    }
    hoveredAreaId = null;
    return;
  }
  const areaId = feature.properties.area_id;
  if (!areaId) return;
  map.getCanvas().style.cursor = "pointer";
  if (hoveredAreaId && hoveredAreaId !== areaId) {
    setRegionState(hoveredAreaId, { hover: false });
  }
  hoveredAreaId = areaId;
  setRegionState(areaId, { hover: true });
});

map.on("mouseleave", "areas-fill", () => {
  map.getCanvas().style.cursor = "";
  if (hoveredAreaId) {
    setRegionState(hoveredAreaId, { hover: false });
  }
  hoveredAreaId = null;
});

map.on("click", "areas-fill", (event) => {
  const feature = event.features && event.features[0];
  if (!feature) return;
  const regionCode = feature.properties.regioncode;
  if (!regionCode) return;
  const warning = regionCode ? warningsByCode.get(regionCode) : null;
  const entries = warning ? warning.kind.filter((code) => code !== "00") : [];
  const popupContent = entries.length
    ? `<div class="popup-labels">${entries.map((code) => renderWarningLabel(code)).join("")}</div>`
    : `<p class="popup-empty">${escapeHtml(codeMap["00"]?.name || "気象警報・注意報は発表されていません")}</p>`;
  const html = `
    <p class="popup-title">${escapeHtml(feature.properties.name || regionCode || feature.properties.area_id)}</p>
    ${popupContent}
  `;
  new maplibregl.Popup({ closeButton: false })
    .setLngLat(event.lngLat)
    .setHTML(html)
    .addTo(map);
});

function applyWarnings(warningData) {
  warningsByCode = new Map(warningData.areas.map((area) => [area.code, area]));
  kindToRegionCodes = new Map();
  for (const area of warningData.areas) {
    const highest = getHighestLevel(area.kind);
    setRegionState(area.code, {
      hasWarning: highest.rank > 0,
      level: highest.level,
      hover: false
    });
    for (const code of area.kind) {
      if (code === "00") continue;
      if (!kindToRegionCodes.has(code)) {
        kindToRegionCodes.set(code, new Set());
      }
      kindToRegionCodes.get(code).add(area.code);
    }
  }
}

function getHighestLevel(kindCodes) {
  return kindCodes
    .map((code) => codeMap[code] || codeMap["00"])
    .reduce((highest, current) => (current.rank > highest.rank ? current : highest), codeMap["00"]);
}

function renderSummary(warningData) {
  document.getElementById("updated").textContent =
    `${new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(warningData.updated))} 更新`;

  const counts = Object.fromEntries(LEVELS.map((level) => [level.key, 0]));
  const kindCounts = new Map();
  const warnedAreaCodes = new Set();
  for (const area of warningData.areas) {
    const highest = getHighestLevel(area.kind);
    if (highest.rank > 0) {
      counts[highest.level] += 1;
      warnedAreaCodes.add(area.code);
    }
    for (const code of area.kind) {
      kindCounts.set(code, (kindCounts.get(code) || 0) + 1);
    }
  }
  counts.none = Math.max((areaSummary.totalAreas || 0) - warnedAreaCodes.size, 0);

  document.getElementById("counts").innerHTML = LEVELS.map((level) => `
    <div class="count">
      <div class="count__label">
        <span class="swatch" style="background:${level.color}"></span>
        <span>${level.label}</span>
      </div>
      <div class="count__value">${counts[level.key] || 0}</div>
    </div>
  `).join("");

  document.getElementById("kindList").innerHTML = [...kindCounts.entries()]
    .filter(([code]) => code !== "00")
    .sort((a, b) => {
      const rankDiff = (codeMap[b[0]]?.rank || 0) - (codeMap[a[0]]?.rank || 0);
      return rankDiff || a[0].localeCompare(b[0], "ja");
    })
    .map(([code, count]) => {
      const meta = getCodeMeta(code);
      return `
        <li>
          <button class="kind-button" type="button" data-kind-code="${escapeHtml(code)}" aria-pressed="false" aria-label="${escapeHtml(`${meta.name}、${count}地域`)}">
            <span class="swatch" style="background:${meta.color}"></span>
            <span class="kind-name">${escapeHtml(meta.name)}</span>
            <span class="kind-badge" aria-hidden="true">${count}</span>
          </button>
        </li>
      `;
    })
    .join("");
  bindKindListEvents();
}

function bindKindListEvents() {
  for (const button of document.querySelectorAll("[data-kind-code]")) {
    const code = button.dataset.kindCode;
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") {
        setKindHighlight(code);
      }
    });
    button.addEventListener("pointerleave", (event) => {
      if (event.pointerType !== "touch") {
        clearKindHighlight();
      }
    });
    button.addEventListener("focus", () => {
      setKindHighlight(code);
    });
    button.addEventListener("blur", () => {
      clearKindHighlight();
    });
    button.addEventListener("click", () => {
      setKindHighlight(code);
    });
  }
}

document.addEventListener("pointerdown", (event) => {
  if (!(event.target instanceof Element) || !event.target.closest("[data-kind-code]")) {
    clearKindHighlight();
  }
});

function setKindHighlight(kindCode) {
  for (const regionCode of highlightedRegionCodes) {
    setRegionState(regionCode, { kindHighlight: false });
  }
  activeKindCode = kindCode;
  highlightedRegionCodes = new Set(kindToRegionCodes.get(kindCode) || []);
  for (const regionCode of highlightedRegionCodes) {
    setRegionState(regionCode, { kindHighlight: true });
  }
  updateKindButtons();
}

function clearKindHighlight() {
  for (const regionCode of highlightedRegionCodes) {
    setRegionState(regionCode, { kindHighlight: false });
  }
  activeKindCode = null;
  highlightedRegionCodes = new Set();
  updateKindButtons();
}

function updateKindButtons() {
  for (const button of document.querySelectorAll("[data-kind-code]")) {
    const isActive = button.dataset.kindCode === activeKindCode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function renderWarningLabel(code) {
  const meta = getCodeMeta(code);
  return `
    <span class="warning-label" style="background:${meta.color}; color:${getLabelTextColor(meta.level)}">
      ${escapeHtml(meta.name)}
    </span>
  `;
}

function getCodeMeta(code) {
  const meta = codeMap[code] || {
    name: code,
    level: "none",
    rank: 0
  };
  return { ...meta, color: getLevelColor(meta.level) };
}

function getLevelColor(level) {
  return COLORS.area[level] || COLORS.area.none;
}

function getLabelTextColor(level) {
  return level === "advisory" || level === "none" ? COLORS.text.dark : COLORS.text.light;
}

function setRegionState(areaId, state) {
  if (!areaId) return;
  map.setFeatureState(
    {
      source: AREA_SOURCE_ID,
      sourceLayer: AREA_LAYER_ID,
      id: areaId
    },
    state
  );
}

function showError(message) {
  const status = document.getElementById("status");
  status.hidden = false;
  status.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[char];
  });
}
