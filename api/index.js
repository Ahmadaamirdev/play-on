// Vercel Serverless Function entrypoint for Express app
import dns from "node:dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}
import { MongoClient } from "mongodb";
import { makeApp } from "../server/app.js";

let appPromise;

function getDb(client, uri) {
  try {
    const pathname = new URL(uri).pathname;
    if (pathname && pathname.length > 1) {
      return client.db(pathname.slice(1));
    }
  } catch {}
  return client.db("playon");
}

async function getApp() {
  if (!appPromise) {
    appPromise = (async () => {
      const uri = process.env.MONGO_URI;
      if (!uri) {
        throw new Error(
          "MONGO_URI environment variable is not defined. Please configure MONGO_URI in your Vercel Project Settings > Environment Variables."
        );
      }
      const client = new MongoClient(uri);
      await client.connect();
      return makeApp(getDb(client, uri));
    })().catch((err) => {
      appPromise = null; // Reset on failure so subsequent requests can retry
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req, res) {
  try {
    if (req.url && req.url.startsWith("/api/index.js")) {
      req.url = req.url.replace(/^\/api\/index\.js/, "/api") || "/api";
    }
    const app = await getApp();
    return app(req, res);
  } catch (err) {
    console.error("Vercel Serverless Function Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
}
