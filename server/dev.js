// Development entry point for both the Express API and Vite's React server.
import { createServer } from "vite";
import { MongoClient } from "mongodb";
import { makeApp } from "./app.js";

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const host = "127.0.0.1";
const flag = process.argv.indexOf("--port");
const webPort = flag >= 0 ? Number(process.argv[flag + 1]) : 5173;
const localUrl = `http://localhost:${webPort}`;

const uri = process.env.MONGO_URI;
if (!uri) throw new Error("MONGO_URI is required.");
const client = new MongoClient(uri);
await client.connect();
const app = await makeApp(client.db()),
  apiPort = Number(process.env.PORT || 4000);
const backend = app.listen(apiPort, host);
const vite = await createServer({
  server: {
    host,
    port: webPort,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:" + apiPort,
        changeOrigin: false,
      },
    },
  },
});
await vite.listen();
vite.printUrls();
async function stop() {
  await vite.close();
  await new Promise((r) => backend.close(r));
  await client.close();
  process.exit(0);
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
