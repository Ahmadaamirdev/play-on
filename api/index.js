// Vercel Serverless Function entrypoint for Express app
import dns from "node:dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}
import { MongoClient } from "mongodb";
import { makeApp } from "../server/app.js";

// Connect to MongoDB (Vercel functions are stateless; reuse global client when possible)
const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/playon");
await client.connect();
const app = await makeApp(client.db());
export default app;
