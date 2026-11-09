import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(here, "..");
export const resourcesDir = path.join(projectRoot, "Resources");
export const catalogFile = path.join(resourcesDir, "catalog.json");

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  const left = import.meta.url;
  const right = pathToFileURL(path.resolve(entry)).href;
  if (left === right) return true;
  return process.platform === "win32" && left.toLowerCase() === right.toLowerCase();
}

function compareEntries(a, b) {
  if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

async function readLevel(dir, relPosix, outResolved) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const skipped = new Set(["thumbs.db", "desktop.ini"]);
  const visible = entries.filter(
    (entry) => !entry.name.startsWith(".") && !entry.isSymbolicLink() && !skipped.has(entry.name.toLowerCase()),
  );
  visible.sort(compareEntries);

  const items = [];
  for (const entry of visible) {
    const full = path.join(dir, entry.name);
    if (path.resolve(full) === outResolved) continue;
    const itemPath = `${relPosix}/${entry.name}`;
    if (entry.isDirectory()) {
      items.push({
        type: "folder",
        title: entry.name,
        name: entry.name,
        path: itemPath,
        extension: "",
        isImageFolder: entry.name.toLowerCase() === "images",
        items: await readLevel(full, itemPath, outResolved),
      });
    } else if (entry.isFile()) {
      const extension = path.extname(entry.name).toLowerCase();
      const title =
        extension && entry.name.toLowerCase().endsWith(extension)
          ? entry.name.slice(0, -extension.length)
          : entry.name;
      items.push({
        type: "file",
        title,
        name: entry.name,
        path: itemPath,
        extension,
        isImageFolder: false,
        items: [],
      });
    }
  }
  return items;
}

export async function generateCatalog(options = {}) {
  const resources = options.resourcesDir ?? resourcesDir;
  const outFile = options.outFile ?? catalogFile;
  const items = await readLevel(resources, "Resources", path.resolve(outFile));
  const next = `${JSON.stringify({ items }, null, 2)}\n`;
  let current = null;
  try {
    current = await fs.readFile(outFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (current !== next) {
    await fs.mkdir(path.dirname(outFile), { recursive: true });
    await fs.writeFile(outFile, next, "utf8");
  }
  return { items };
}

if (isDirectRun()) {
  generateCatalog()
    .then((catalog) => {
      console.log(`Wrote Resources/catalog.json (${catalog.items.length} top-level entries)`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
