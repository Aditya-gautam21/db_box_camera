import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCameras } from "./addCamera.js";

function lanPrefixes() {
  const prefixes = new Set();
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    if (iface === "lo" || iface === "docker0" || iface.startsWith("br-") || iface.startsWith("veth")) continue;
    for (const addr of addrs || []) {
      if (addr.internal || (addr.family !== "IPv4" && addr.family !== 4)) continue;
      const [a, b, c] = addr.address.split(".");
      if (a === "127" || a === "100" || (a === "172" && b === "17")) continue;
      prefixes.add(`${a}.${b}.${c}`);
    }
  }
  return [...prefixes];
}

async function isOnvif(host) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 400);
  try {
    const res = await fetch(`http://${host}/onvif/device_service`, {
      method: "GET",
      signal: ac.signal,
      redirect: "manual",
    });
    return res.status === 401 || res.status === 405;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function scanCameras() {
  const added = new Set((await loadCameras()).map((cam) => String(cam.host || "").trim()));
  const hosts = [];
  for (const prefix of lanPrefixes()) {
    for (let n = 1; n <= 254; n += 1) {
      const host = `${prefix}.${n}`;
      if (!added.has(host)) hosts.push(host);
    }
  }
  const found = [];
  let i = 0;
  async function worker() {
    while (i < hosts.length) {
      const host = hosts[i++];
      if (await isOnvif(host)) found.push(host);
    }
  }
  await Promise.all(Array.from({ length: 48 }, worker));
  return found.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosts = await scanCameras();
  if (!hosts.length) console.log("no cameras found");
  else hosts.forEach((h) => console.log(h));
}
