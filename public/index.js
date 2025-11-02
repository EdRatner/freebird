mapboxgl.accessToken = 'pk.eyJ1IjoiZWRyYXRuZXIiLCJhIjoiY21oZ2IzdThuMGRyZDJrczNiZzhmZDR4ayJ9.KaVNTex49istqKLCQPdBUw';
const map = new mapboxgl.Map({
    container: 'map', // container ID
    center: [-1.589481, 54.914118], // starting position [lng, lat]. Note that lat must be set between -90 and 90
    zoom: 9 // starting zoom
});

const points_data = {
    type: 'FeatureCollection',
    features: [
        // --- Existing Global Points ---
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-0.1278, 51.5074] }, // London
            properties: { title: 'London', description: 'The capital of England and the United Kingdom.', icon: 'building' }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [2.3522, 48.8566] }, // Paris
            properties: { title: 'Paris', description: 'The City of Lights and romance.', icon: 'city' }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [139.6917, 35.6895] }, // Tokyo
            properties: { title: 'Tokyo', description: 'Japan\'s bustling capital and cultural hub.', icon: 'rocket' }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-74.0060, 40.7128] }, // New York
            properties: { title: 'New York City', description: 'The city that never sleeps.', icon: 'star' }
        },
        // --- New Data Points (Near Baltimore, MD, USA) ---
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-76.889, 39.207] },
            properties: { title: 'Observation #63082', description: 'Recorded in epoch time: 1996.', icon: 'data-point' }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-76.888, 39.207] },
            properties: { title: 'Observation #63083', description: 'Recorded in epoch time: 1996.', icon: 'data-point' }
        },
        {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-76.876, 39.206] },
            properties: { title: 'Observation #63084', description: 'Recorded in epoch time: 1996.', icon: 'data-point' }
        }
    ]
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
            if (point.longitude == null || point.latitude == null) continue;

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

    // Both map + data ready
    map.addSource('points', {
        type: 'geojson',
        data: points_data,
        cluster: true,
        clusterMaxZoom: 14, // Max zoom to cluster points
        clusterRadius: 50,  // Radius of cluster in pixels
    })

    map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'points',
        filter: ['has', 'point_count'],
        paint: {
            'circle-color': '#FACC15',
            'circle-radius': ['step', ['get', 'point_count'], 10, 100, 20, 750, 30]
        }
    });

    map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'points',
        filter: ['has', 'point_count'],
        layout: {
            'text-field': '{point_count_abbreviated}',
            'text-size': 12
        }
    });

    map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'points',
        filter: ['!', ['has', 'point_count']],
        paint: {
            'circle-color': '#9333EA',
            'circle-radius': 5,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff'
        }
    });

    // Fit bounds
    const bounds = new mapboxgl.LngLatBounds();
    points_data.features.forEach(f => bounds.extend(f.geometry.coordinates));
    map.fitBounds(bounds, { padding: 80, duration: 1500 });
})();