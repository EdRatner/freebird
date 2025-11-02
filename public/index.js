mapboxgl.accessToken = 'pk.eyJ1IjoiZWRyYXRuZXIiLCJhIjoiY21oZ2IzdThuMGRyZDJrczNiZzhmZDR4ayJ9.KaVNTex49istqKLCQPdBUw';
const map = new mapboxgl.Map({
    container: 'map', // container ID
    center: [-1.589481, 54.914118], // starting position [lng, lat]. Note that lat must be set between -90 and 90
    zoom: 9 // starting zoom
});

const points_data = {
    type: 'FeatureCollection',
    features: []
};

// Wait for the map to be fully loaded
function map_ready(map) {
    return new Promise(resolve => {
        if (map.loaded()) resolve(); // already loaded
        else map.on('load', resolve);
    });
}

// Load data
async function load_points() {
    const res = await fetch('/api/surveys/');
    const data = await res.json();

    const surveyPromises = data.map(async survey => {
        const res = await fetch(`/api/movement?survey_id=${survey}`);
        const points = await res.json();

        for (const point of points) {
            if (point.longitude == null || point.latitude == null || point.id % 5 !== 0) continue;

            points_data.features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
                properties: {
                    title: `Observation #${point.id}`,
                    description: `Recorded in epoch time: ${point.timestamp}`,
                    icon: 'data-point',
                },
            });
        }
    });

    await Promise.all(surveyPromises);
}

// Main
(async () => {
    await Promise.all([map_ready(map), load_points()]);

    console.log('loaded:', points_data);

    map.addSource('points', {
        type: 'geojson',
        data: points_data,
        cluster: false,
    });

    map.addLayer({
        id: 'points-heatmap',
        type: 'heatmap',
        source: 'points',
        paint: {
            'heatmap-color': [
                'interpolate',
                ['linear'],
                ['heatmap-density'],
                0, 'rgba(255,255,255,0)',
                0.25, 'rgba(255, 240, 255, 20)',
                0.5, 'rgba(232, 233, 255, 40)',
                0.75, 'rgba(183, 232, 255, 60)',
                1, 'rgba(86, 235, 255, 75)'
            ],
            'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 15,
                9, 40,
                14, 80
            ],
            'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0, 0.5,
                9, 1.5
            ],
            'heatmap-opacity': 0.5
        }
    });

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    points_data.features.forEach(f => bounds.extend(f.geometry.coordinates));
    map.fitBounds(bounds, { padding: 80, duration: 1500 });
})();

let airports = {};
let flights = [];
let routeLayers = [];
let allPathsShown = false;
let globalMode = false; // false = Live (2h), true = Global (12h)

const DENSITY_SOURCE_ID = "density";
const DENSITY_LAYER_ID = "density";
const LINE_SOURCE_ID = "flight-lines";
const LINE_LAYER_ID = "flight-lines";
const AIRPORT_SOURCE_ID = "airport-markers";
const AIRPORT_LAYER_ID = "airport-markers";
const AIRPORT_LABEL_LAYER_ID = "airport-labels";

// === Load airports and add markers ===
async function loadAirports() {
    const res = await fetch("/airports");
    airports = await res.json();

    const features = Object.entries(airports).map(([code, coords]) => ({
        type: "Feature",
        properties: { code },
        geometry: { type: "Point", coordinates: [coords.lon, coords.lat] }
    }));

    if (map.getSource(AIRPORT_SOURCE_ID)) {
        if (map.getLayer(AIRPORT_LAYER_ID)) map.removeLayer(AIRPORT_LAYER_ID);
        if (map.getLayer(AIRPORT_LABEL_LAYER_ID)) map.removeLayer(AIRPORT_LABEL_LAYER_ID);
        map.removeSource(AIRPORT_SOURCE_ID);
    }

    map.addSource(AIRPORT_SOURCE_ID, {
        type: "geojson",
        data: { type: "FeatureCollection", features }
    });

    map.addLayer({
        id: AIRPORT_LAYER_ID,
        type: "circle",
        source: AIRPORT_SOURCE_ID,
        paint: {
            "circle-radius": 3,
            "circle-color": "#dedede",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#2d2d2d"
        }
    });

    map.addLayer({
        id: AIRPORT_LABEL_LAYER_ID,
        type: "symbol",
        source: AIRPORT_SOURCE_ID,
        layout: {
            "text-field": ["get", "code"],
            "text-size": 10,
            "text-offset": [0, 1.2],
            "text-allow-overlap": false
        },
        paint: { "text-color": "#2d2d2d" }
    });
}

// Build density grid (choropleth, single-hue red, smoother) ===
function buildDensityGrid(flights) {
    const cellSize = 1; // degrees — finer for smoother blending
    const grid = {};

    flights.forEach(f => {
        const dep = airports[f.dep];
        const arr = airports[f.arr];
        if (!dep || !arr) return;

        // Emphasize hubs
        [dep, arr].forEach(pt => {
            const x = Math.floor(pt.lon / cellSize) * cellSize;
            const y = Math.floor(pt.lat / cellSize) * cellSize;
            const key = `${x},${y}`;
            grid[key] = (grid[key] || 0) + 2;
        });

        // Lightly spread density along route
        const samples = 12;
        for (let i = 1; i < samples; i++) {
            const t = i / samples;
            const lon = dep.lon * (1 - t) + arr.lon * t;
            const lat = dep.lat * (1 - t) + arr.lat * t;
            const x = Math.floor(lon / cellSize) * cellSize;
            const y = Math.floor(lat / cellSize) * cellSize;
            const key = `${x},${y}`;
            grid[key] = (grid[key] || 0) + 1;
        }
    });

    const features = Object.entries(grid).map(([key, count]) => {
        const [x, y] = key.split(",").map(Number);
        return {
            type: "Feature",
            properties: { count },
            geometry: {
                type: "Polygon",
                coordinates: [[
                    [x, y],
                    [x + cellSize, y],
                    [x + cellSize, y + cellSize],
                    [x, y + cellSize],
                    [x, y]
                ]]
            }
        };
    });

    return { type: "FeatureCollection", features };
}

// === Clear routes and density layers ===
function clearRoutes() {
    routeLayers.forEach(routeId => {
        if (map.getLayer(routeId)) map.removeLayer(routeId);
        if (map.getSource(routeId)) map.removeSource(routeId);
    });
    routeLayers = [];

    [DENSITY_LAYER_ID, LINE_LAYER_ID].forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
    [DENSITY_SOURCE_ID, LINE_SOURCE_ID].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
}

// === Show all routes with density grid + line gradient ===
function showAllRoutes() {
    clearRoutes();

    // Land-based density gradient
    const densityGeoJSON = buildDensityGrid(flights);
    map.addSource(DENSITY_SOURCE_ID, { type: "geojson", data: densityGeoJSON });
    map.addLayer({
        id: DENSITY_LAYER_ID,
        type: "fill",
        source: DENSITY_SOURCE_ID,
        paint: {
            // ... paint properties (unchanged) ...
            "fill-blur": [
                "interpolate", ["linear"], ["zoom"],
                2, 2.5,  // Slight blur at low zoom
                6, 1.5,  // Less blur at higher zoom
                10, 0    // No blur when zoomed in close
            ],
            // 🌟 Adjusted color stops to use more transparent intermediate colors
            "fill-color": [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,  "rgba(255,230,230,0.30)",  // Very light, low opacity
                5,  "rgba(255,180,180,0.45)",  // Medium light, medium opacity
                12, "rgba(255,120,120,0.60)",  // Medium red
                24, "rgba(210,60,60,0.75)",    // Stronger red
                48, "rgba(140,0,0,0.85)"        // Dark red core, high opacity
            ],
            // Kept fill-opacity interpolation (controls overall transparency)
            "fill-opacity": [
                "interpolate", ["linear"], ["zoom"],
                2, 0.5,
                4, 0.7,
                6, 0.9
            ]
        }
    }, AIRPORT_LABEL_LAYER_ID); // 🌟 INSERTED BEFORE Airport Labels (on top of heatmap)

    const lineFeatures = flights.map(f => {
        const dep = airports[f.dep];
        const arr = airports[f.arr];

        // 🛑 The original conditional check (which returns null if airport data is missing)
        if (!dep || !arr) {
            // 🚨 FOR DEBUGGING ONLY: Log the missing data to find the root cause
            console.warn(`Flight ${f.callsign} skipped: Missing airport data for ${f.dep} or ${f.arr}`);
            return null;
        }

        // If both airports exist, return a valid feature
        return {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[dep.lon, dep.lat], [arr.lon, arr.lat]] }
        };
    }).filter(Boolean); // Filters out the nulls from flights without airport data

    if (lineFeatures.length > 0) {
        // ... (rest of your map.addSource and map.addLayer logic unchanged) ...
        map.addSource(LINE_SOURCE_ID, {
            type: "geojson",
            lineMetrics: true,
            data: { type: "FeatureCollection", features: lineFeatures }
        });
        map.addLayer({
            id: LINE_LAYER_ID,
            type: "line",
            source: LINE_SOURCE_ID,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: {
                "line-width": [
                    "interpolate", ["linear"], ["zoom"],
                    2, 3,
                    5, 5,
                    9, 7
                ],
                "line-gradient": [
                    "interpolate",
                    ["linear"],
                    ["line-progress"],
                    0, "rgba(255,200,200,0.4)",
                    0.5, "rgba(210,60,60,0.75)",
                    1, "rgba(140,0,0,0.90)"
                ]
            }
        }, AIRPORT_LABEL_LAYER_ID);
    } else {
        console.warn("🚫 No valid flight lines to draw. Check airport codes against 'airports' object.");
    }

}

// === Draw single route (for list clicks) ===
function drawRoute(depCode, arrCode, callsign, layerId) {
    const dep = airports[depCode];
    const arr = airports[arrCode];
    if (!dep || !arr) return;

    layerId = layerId || `${depCode}-${arrCode}-${callsign || 'route'}-route`;

    if (map.getLayer(layerId)) map.removeLayer(layerId);
    if (map.getSource(layerId)) map.removeSource(layerId);

    map.addSource(layerId, {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [[dep.lon, dep.lat], [arr.lon, arr.lat]] }
        }
    });
    map.addLayer({
        id: layerId,
        type: "line",
        source: layerId,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#00aaff", "line-width": 3 }
    });
    routeLayers.push(layerId);
}

// === Load flights (supports Live 2h and Global 12h) ===
async function loadFlights() {
    clearRoutes();
    allPathsShown = false;
    document.getElementById("toggleAll").textContent = "Show All Paths";

    const beginVal = document.getElementById("begin").value;
    const endVal = document.getElementById("end").value;
    const begin = Math.floor(new Date(beginVal).getTime() / 1000);
    const end = Math.floor(new Date(endVal).getTime() / 1000);

    const listDiv = document.getElementById("flight-list");
    listDiv.innerHTML = "<em>Loading...</em>";

    try {
        // Server will internally slice into 2h chunks between begin/end
        const res = await fetch(`/flights/all?begin=${begin}&end=${end}`);
        flights = await res.json();

        if (flights.error) {
            listDiv.innerHTML = "<span style='color:red'>" + flights.error + "</span>";
            return;
        }
        if (!Array.isArray(flights) || flights.length === 0) {
            listDiv.innerHTML = "<em>No flights found in this interval.</em>";
            return;
        }

        listDiv.innerHTML = "<strong>Flights:</strong><ul>" +
            flights.map(f =>
                `<li>
          <a class="route-link" onclick="drawRoute('${f.dep}','${f.arr}','${f.callsign}')">
            ${f.callsign || '[no callsign]'} (${f.dep} → ${f.arr})
          </a>
        </li>`
            ).join('') +
            "</ul>";
    } catch (err) {
        console.error(err);
        listDiv.innerHTML = "<span style='color:red'>Error loading flights.</span>";
    }
}

// === Toggle all flight paths ===
document.getElementById("toggleAll").onclick = function () {
    if (!allPathsShown) {
        showAllRoutes();
        this.textContent = "Hide All Paths";
        allPathsShown = true;
    } else {
        clearRoutes();
        this.textContent = "Show All Paths";
        allPathsShown = false;
    }
};

// === Toggle mode (Live 2h vs Global 12h) ===
document.getElementById("modeBtn").onclick = function () {
    globalMode = !globalMode;
    const now = new Date();
    const hours = globalMode ? 12 : 2;
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    document.getElementById("end").value = now.toISOString().slice(0,16);
    document.getElementById("begin").value = start.toISOString().slice(0,16);
    this.textContent = `Mode: ${globalMode ? "Global (12h)" : "Live (2h)"}`;
};

// === Default time interval (Live 2h) and init ===
window.onload = async () => {
    await loadAirports();
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    document.getElementById("end").value = now.toISOString().slice(0,16);
    document.getElementById("begin").value = twoHoursAgo.toISOString().slice(0,16);
    document.getElementById("loadBtn").onclick = loadFlights;
};