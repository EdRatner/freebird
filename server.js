const express = require("express");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const migration_manager = require("./migration-manager.js");
const app = express();
const port = 3000;

const http = require("http");
const server = http.createServer(app);

// === OpenSky API credentials ===
const CLIENT_ID = "edratner-api-client";
const CLIENT_SECRET = "VMgQRqJGbqobrX2tkLxity6pPVGEtMS1";

// === Dynamic airport dictionary ===
const airports = {}; // Will be populated from airports.dat

// === Load airports.dat at startup ===
async function loadAirportsFromFile() {
  const filePath = path.join(__dirname, "airports.dat");
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    const parts = line.split(",");
    if (parts.length < 8) continue;

    const icao = parts[5].replace(/"/g, "").trim(); // ICAO code
    const lat = parseFloat(parts[6]);
    const lon = parseFloat(parts[7]);

    if (icao && !isNaN(lat) && !isNaN(lon)) {
      airports[icao] = { lat, lon };
    }
  }

const http = require("http");
const server = http.createServer(app);
  console.log(`✅ Loaded ${Object.keys(airports).length} airports`);
}

app.use(express.static('./public'));

// === Token management ===
let cachedToken = null;
let tokenExpiry = 0;

app.get("/api/surveys/", (req, res) => {
    res.json(migration_manager.get_all_downloaded_studies());
})

app.get("/api/movement", (req, res) => {
    res.json(migration_manager.get_all_movement_data(req.query.survey_id) || []);
})

server.listen(port, () => {
    console.log("Server Initiated.");
})
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiry > now + 60 * 1000) {
    return cachedToken;
  }
  const tokenRes = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    })
  });
  if (!tokenRes.ok) {
    throw new Error(`Failed to get token: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const tokenData = await tokenRes.json();
  cachedToken = tokenData.access_token;
  tokenExpiry = now + (tokenData.expires_in * 1000);
  return cachedToken;
}

// === /flights/all endpoint with multi-interval support ===
app.get("/flights/all", async (req, res) => {
  const { begin, end } = req.query;
  if (!begin || !end) {
    return res.status(400).json({ error: "Missing begin or end parameter" });
  }

  const beginInt = parseInt(begin);
  const endInt = parseInt(end);
  const interval = 2 * 3600;
  let allFlights = [];

  try {
    const accessToken = await getAccessToken();

    for (let t = beginInt; t < endInt; t += interval) {
      const sliceBegin = t;
      const sliceEnd = Math.min(t + interval, endInt);
      const url = `https://opensky-network.org/api/flights/all?begin=${sliceBegin}&end=${sliceEnd}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        console.error("OpenSky error slice", sliceBegin, sliceEnd, response.status);
        continue;
      }
      const data = await response.json();
      allFlights = allFlights.concat(data);
    }

    console.log("📦 Raw flights across intervals:", allFlights.length);

    const flights = allFlights.filter(f =>
      f.estDepartureAirport && f.estArrivalAirport &&
      airports[f.estDepartureAirport] && airports[f.estArrivalAirport]
    ).map(f => ({
      icao24: f.icao24,
      callsign: f.callsign,
      dep: f.estDepartureAirport,
      arr: f.estArrivalAirport
    }));

    console.log("✈️ Flights after filtering:", flights.length);
    res.json(flights);

  } catch (err) {
    console.error("❌ Error in /flights/all:", err);
    res.status(500).json({ error: "Server error", details: err.toString() });
  }
});

// === Serve airport coordinates ===
app.get("/airports", (req, res) => {
  res.json(airports);
});

// === Start server after loading airports ===
loadAirportsFromFile();
