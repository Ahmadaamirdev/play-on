// Vercel Serverless Function entrypoint for Express app
import dns from "node:dns";
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {}
import { MongoClient } from "mongodb";
import { makeApp } from "../server/app.js";

// Connect to MongoDB (Vercel functions are stateless; reuse global client when possible)
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const app = await makeApp(client.db());
export default app;
