const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
});

function getDbNameFromUrl(connectionString) {
  const u = new URL(connectionString);
  const name = decodeURIComponent(String(u.pathname || "").replace(/^\//, ""));
  if (!name) return null;
  if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
  return name;
}

async function ensureDatabaseExists() {
  try {
    await pool.query("SELECT 1");
    return;
  } catch (e) {
    if (!e || e.code !== "3D000") throw e;
  }

  const dbName = getDbNameFromUrl(DATABASE_URL);
  if (!dbName) throw new Error("Database name in DATABASE_URL is invalid");

  const adminUrl = new URL(DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const adminPool = new Pool({ connectionString: adminUrl.toString() });
  try {
    await adminPool.query(`CREATE DATABASE "${dbName}"`);
  } catch (e) {
    if (!(e && e.code === "42P04")) throw e;
  } finally {
    await adminPool.end();
  }
}

module.exports = {
  pool,
  getDbNameFromUrl,
  ensureDatabaseExists
};
