require("dotenv").config();
const path = require("path");
const express = require("express");
const { setMaybeAdvanceStep } = require("./src/duels");
const { maybeAdvanceStep } = require("./src/game-steps");
const { ensureDatabaseExists } = require("./src/db");
const { initDb } = require("./src/db-init");
const apiRouter = require("./src/api");

// Initialize the circular dependency for duels module
setMaybeAdvanceStep(maybeAdvanceStep);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "64kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use(apiRouter);

async function startServer() {
  try {
    await ensureDatabaseExists();
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
