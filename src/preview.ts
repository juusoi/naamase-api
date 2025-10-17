import "dotenv/config";
import http from "node:http";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = process.env.FACEIT_OUT_DIR || "out";
const PORT = process.env.PORT ? Number(process.env.PORT) : 5174;

async function listCsvFiles(): Promise<string[]> {
  try {
    const all = await readdir(OUT_DIR, { withFileTypes: true } as any);
    return all
      .filter((e: any) => e.isFile && (e.isFile() || e.dirent?.isFile?.()))
      .map((e: any) => e.name ?? e.filename)
      .filter(
        (n: string) => typeof n === "string" && n.endsWith(".csv"),
      ) as string[];
  } catch {
    return [];
  }
}

function send(
  res: http.ServerResponse,
  code: number,
  body: string,
  type = "text/plain; charset=utf-8",
) {
  res.writeHead(code, { "content-type": type });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await readFile(path.join("public", "viewer.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }
    if (url.pathname === "/files") {
      const files = await listCsvFiles();
      return send(res, 200, JSON.stringify(files), "application/json");
    }
    if (url.pathname.startsWith("/csv/")) {
      const name = decodeURIComponent(url.pathname.slice("/csv/".length));
      if (name.includes("..") || name.includes("/") || name.includes("\\"))
        return send(res, 404, "Not Found");
      const filePath = path.join(OUT_DIR, name);
      try {
        await access(filePath);
        const data = await readFile(filePath, "utf8");
        return send(res, 200, data, "text/csv; charset=utf-8");
      } catch {
        return send(res, 404, "Not Found");
      }
    }
    return send(res, 404, "Not Found");
  } catch (e: any) {
    return send(res, 500, "Server error");
  }
});

server.listen(PORT, () => {
  console.log(
    `Preview server on http://localhost:${PORT} (serving CSVs from ./${OUT_DIR})`,
  );
});
