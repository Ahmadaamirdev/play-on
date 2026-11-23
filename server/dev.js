// Development entry point for both the Express API and Vite's React server.
import { createServer } from "vite";
import { MongoClient } from "mongodb";
import { makeApp } from "./app.js";
import { mkdir } from "node:fs/promises";
import { connect } from "node:net";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const host = "127.0.0.1";
const mongoPort = 27177;
const flag = process.argv.indexOf("--port");
const webPort = flag >= 0 ? Number(process.argv[flag + 1]) : 5173;
const localUrl = `http://localhost:${webPort}`;

function portInUse(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}

let uri = process.env.MONGO_URI,
  instance;
if (!uri) {
  if (await portInUse(mongoPort)) {
    console.error(
      `Local MongoDB port ${mongoPort} is already in use. If Play On is running, open ${localUrl}. To restart it, stop the existing dev process first.`,
    );
    process.exit(1);
  }
  const dbPath = path.resolve(".playon/local-mongo");
  await mkdir(dbPath, { recursive: true });
  instance = await MongoMemoryReplSet.create({
    binary: { version: "7.0.24" },
    replSet: { count: 1, args: ["--nounixsocket"] },
    instanceOpts: [{ dbPath, port: mongoPort }],
  });
  uri = instance.getUri("playon");
  process.env.DEMO_SEED ??= "true";
  console.log(`Local MongoDB data: ${dbPath}`);
}
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
  await instance?.stop({ doCleanup: false });
  process.exit(0);
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
