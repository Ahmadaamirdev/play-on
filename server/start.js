import { MongoClient } from "mongodb";
import { makeApp } from "./app.js";
const client = new MongoClient(
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/playon",
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
