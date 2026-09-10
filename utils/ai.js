import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAreaState } from "./areaIntrusion.js";
import { getLineCross } from "./lineCross.js";

const pythonDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "python");
const modelsFile = path.join(pythonDir, "ai_models.json");
const statsFile = path.join(pythonDir, "ai_stats.json");

export const AI_MODELS = ["area_intrusion", "line_cross", "fall", "fire", "face"];
export const AI_DEFAULTS = {
  area_intrusion: true,
  line_cross: true,
  fall: true,
  fire: true,
  face: false,
};

function asBool(value, fallback) {
  if (value === true || value === "On" || value === "on" || value === 1 || value === "1") return true;
  if (value === false || value === "Off" || value === "off" || value === 0 || value === "0") return false;
  return fallback;
}

function emptyModelStats() {
  return { total: 0, recent: [], updated: 0 };
}

function parseModelStats(entry) {
  const updated = Number(entry?.updated) || 0;
  return {
    total: Number(entry?.total) || 0,
    recent: Array.isArray(entry?.recent) ? entry.recent : [],
    updated,
    inside: Number(entry?.inside) || 0,
  };
}

export async function getAiModels() {
  try {
    const raw = (await readFile(modelsFile, "utf8")).trim();
    const data = raw ? JSON.parse(raw) : {};
    const src = data.models && typeof data.models === "object" ? data.models : data;
    const models = {};
    for (const key of AI_MODELS) models[key] = asBool(src[key], AI_DEFAULTS[key]);
    return models;
  } catch (err) {
    if (err.code === "ENOENT") return { ...AI_DEFAULTS };
    throw err;
  }
}

export async function setAiModels(patch = {}) {
  const src = patch.models && typeof patch.models === "object" ? patch.models : patch;
  const models = await getAiModels();
  for (const key of AI_MODELS) {
    if (key in src) models[key] = asBool(src[key], models[key]);
  }
  await mkdir(path.dirname(modelsFile), { recursive: true });
  await writeFile(modelsFile, `${JSON.stringify({ models }, null, 2)}\n`);
  return models;
}

async function getAiFileStats() {
  try {
    const raw = (await readFile(statsFile, "utf8")).trim();
    if (!raw) return { updated: 0, models: {} };
    const data = JSON.parse(raw);
    return {
      updated: Number(data.updated) || 0,
      models: data.models && typeof data.models === "object" ? data.models : {},
    };
  } catch (err) {
    if (err.code === "ENOENT" || err instanceof SyntaxError) return { updated: 0, models: {} };
    throw err;
  }
}

export async function getAiState(cam) {
  const [models, area, line, fileStats] = await Promise.all([
    getAiModels(),
    getAreaState(cam),
    getLineCross(cam),
    getAiFileStats(),
  ]);
  const updated = Math.max(fileStats.updated, Number(area.stats?.updated) || 0);
  const stats = { live: updated > 0 && Date.now() / 1000 - updated < 5 };
  for (const key of AI_MODELS) {
    stats[key] = parseModelStats(fileStats.models[key] || emptyModelStats());
  }
  stats.area_intrusion = {
    ...stats.area_intrusion,
    inside: area.stats?.inside ?? 0,
    total: area.stats?.total || stats.area_intrusion.total,
    recent: area.stats?.recent?.length ? area.stats.recent : stats.area_intrusion.recent,
    updated: area.stats?.updated || stats.area_intrusion.updated,
  };
  stats.live = stats.live || Boolean(area.stats?.live);
  return { models, zone: area.zone, line, stats };
}
