import { MongoClient } from "mongodb";
import { makeApp } from "./app.js";
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);
await client.connect();
function getDb(c, u) {
  try {
    const p = new URL(u).pathname;
    if (p && p.length > 1) return c.db(p.slice(1));
  } catch {}
  return c.db("playon");
}
const app = await makeApp(getDb(client, uri));
const server = app.listen(Number(process.env.PORT || 4000), () =>
  console.log("Play On listening on port", server.address().port),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(async () => {
      await client.close();
      process.exit(0);
    }),
  );
