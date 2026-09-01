import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const lineFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "line_cross.json");

function pair(value) {
  const x = Number(Array.isArray(value) ? value[0] : value?.x);
  const y = Number(Array.isArray(value) ? value[1] : value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}

export async function getLineCross() {
  try {
    const data = JSON.parse(await readFile(lineFile, "utf8"));
    const a = pair(data.a);
    const b = pair(data.b);
    if (!a || !b) return { a: null, b: null, side: null, cam: data.cam ?? null };
    return { a, b, side: pair(data.side), cam: data.cam ?? null };
  } catch (err) {
    if (err.code === "ENOENT") return { a: null, b: null, side: null, cam: null };
    throw err;
  }
}

export async function saveLineCross(body) {
  const a = pair(body?.a);
  const b = pair(body?.b);
  if (!a || !b) {
    const err = new Error("a and b required as 0–1 points");
    err.status = 400;
    throw err;
  }
  const data = { a, b, side: pair(body?.side), cam: body?.cam || null };
  await mkdir(path.dirname(lineFile), { recursive: true });
  await writeFile(lineFile, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

export async function clearLineCross() {
  try {
    await unlink(lineFile);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  return { a: null, b: null, side: null, cam: null };
}
