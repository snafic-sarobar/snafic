// Minimal static file server for local development.
// Production: deploy to Firebase Hosting (no server needed).
const express = require("express");
const path = require("path");
const app = express();
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Dev server: http://localhost:" + PORT));
