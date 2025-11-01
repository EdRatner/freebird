const path = require("path");
const express = require("express");
const app = express();

const http = require("http");
const server = http.createServer(app);

const port = 3000

app.use(express.static('./public/'));

server.listen(port, () => {
    console.log("Server Initiated.");
})










