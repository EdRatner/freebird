const path = require("path");
const express = require("express");
const app = express();

const migration_manager = require("./migration-manager.js");

const http = require("http");
const server = http.createServer(app);

const port = 3000

app.use(express.static('./public/'));

app.get("/api/surveys/", (req, res) => {
    res.json(migration_manager.get_all_downloaded_studies());
})

app.get("/api/movement", (req, res) => {
    res.json(migration_manager.get_all_movement_data(req.query.survey_id) || []);
})

server.listen(port, () => {
    console.log("Server Initiated.");
})










