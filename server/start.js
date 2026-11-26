import { MongoClient } from "mongodb";
import { makeApp } from "./app.js";
if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required.");
const client = new MongoClient(
  process.env.MONGO_URI,
);
await client.connect();
const app = await makeApp(client.db());
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
