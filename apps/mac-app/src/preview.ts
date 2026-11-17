import { createServer } from "node:http";
import path from "node:path";
import { createAppServer } from "./appServer.js";
import { fakeApi } from "./fakeApi.js";

// `pnpm preview`: the full app in an ordinary browser, on made-up data. For
// working on its screens without a Mac, an account or a network.

const port = Number(process.env.PORT ?? 4310);
const handle = createAppServer({
  webDir: path.join(__dirname, "..", "web"),
  apiUrl: "http://fake.invalid",
  apiKey: () => "preview",
  fetch: fakeApi,
});

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const response = await handle(
    new Request(`http://localhost:${port}${req.url ?? "/"}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: hasBody ? Buffer.concat(chunks) : undefined,
    }),
  );
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, "127.0.0.1", () => console.log(`Preview on http://localhost:${port}`));
