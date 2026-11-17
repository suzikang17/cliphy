import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// Serves the full app inside the window. Pages come from the built app on
// disk. Calls to /api/ are passed on to Cliphy with the Mac's own key, so the
// page never holds the key and needs no sign-in of its own.

export interface AppServerDeps {
  /** Folder holding the built app (index.html and its files). */
  webDir: string;
  apiUrl: string;
  /** The Mac's key, or null when it is not connected. */
  apiKey: () => string | null;
  fetch: (request: Request) => Promise<Response>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/** The only request headers passed on to Cliphy. */
const PASSED_ON = ["content-type", "accept"];

const json = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export function createAppServer(deps: AppServerDeps): (request: Request) => Promise<Response> {
  const root = path.resolve(deps.webDir);
  const api = deps.apiUrl.replace(/\/+$/, "");

  const page = (request: Request, pathname: string): Response => {
    if (request.method !== "GET" && request.method !== "HEAD") return json(405, "Not allowed");
    let wanted: string;
    try {
      wanted = decodeURIComponent(pathname);
    } catch {
      return json(400, "Bad address");
    }
    const file = path.resolve(root, `.${path.posix.normalize(`/${wanted}`)}`);
    const inside = file === root || file.startsWith(root + path.sep);
    const found = inside && existsSync(file) && statSync(file).isFile();
    // An address with no file behind it is a screen in the app, unless it
    // names a file (has an extension), which is simply missing.
    if (!found && path.extname(wanted)) return json(404, "Not found");
    const target = found ? file : path.join(root, "index.html");
    if (!existsSync(target)) return json(404, "Not found");
    return new Response(readFileSync(target), {
      headers: {
        "Content-Type": TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream",
      },
    });
  };

  const call = async (request: Request, url: URL): Promise<Response> => {
    const key = deps.apiKey();
    if (!key) return json(401, "This Mac is not connected");
    const headers = new Headers({ Authorization: `Bearer ${key}` });
    for (const name of PASSED_ON) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    try {
      const res = await deps.fetch(
        new Request(`${api}${url.pathname}${url.search}`, {
          method: request.method,
          headers,
          body: hasBody ? await request.arrayBuffer() : undefined,
        }),
      );
      // A fresh response: the page gets the body and its type, nothing else.
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
      });
    } catch {
      return json(502, "Couldn't reach Cliphy");
    }
  };

  return async (request) => {
    const url = new URL(request.url);
    return url.pathname.startsWith("/api/") ? call(request, url) : page(request, url.pathname);
  };
}
