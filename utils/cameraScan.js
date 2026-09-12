import os from "node:os";
import dgram from "node:dgram";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadCameras, normalizeHost } from "./addCamera.js";

const WS_PORT = 3702;
const WS_MULTICAST = "239.255.255.250";
const DISCOVER_MS = 2500;

function lanIfaces() {
  const ifaces = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name === "lo" || name === "docker0" || name.startsWith("br-") || name.startsWith("veth")) continue;
    for (const addr of addrs || []) {
      if (addr.internal || (addr.family !== "IPv4" && addr.family !== 4)) continue;
      const [a, b] = addr.address.split(".");
      if (a === "127" || a === "100" || (a === "172" && b === "17")) continue;
      ifaces.push(addr.address);
    }
  }
  return ifaces;
}

function probeXml() {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?>` +
      `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"` +
      ` xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"` +
      ` xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"` +
      ` xmlns:dn="http://www.onvif.org/ver10/network/wsdl">` +
      `<e:Header>` +
      `<w:MessageID>uuid:${randomUUID()}</w:MessageID>` +
      `<w:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
      `<w:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>` +
      `</e:Header>` +
      `<e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body>` +
      `</e:Envelope>`,
  );
}

function hostFromMatch(msg, rinfo) {
  const text = msg.toString("utf8");
  if (!text.includes("ProbeMatch") && !text.includes("onvif")) return null;
  const m = text.match(/https?:\/\/(\d{1,3}(?:\.\d{1,3}){3})/i);
  return m ? m[1] : rinfo.address;
}

function sendAll(sock, buf, hosts, isOpen) {
  return new Promise((resolve) => {
    let i = 0;
    function next() {
      if (!isOpen() || i >= hosts.length) return resolve();
      const host = hosts[i++];
      try {
        sock.send(buf, WS_PORT, host, () => {
          if (!isOpen()) return resolve();
          next();
        });
      } catch {
        resolve();
      }
    }
    next();
  });
}

function discoverFrom(local) {
  return new Promise((resolve) => {
    const found = new Set();
    const sock = dgram.createSocket("udp4");
    let open = true;
    const done = () => {
      if (!open) return;
      open = false;
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(found);
    };

    sock.on("error", done);
    sock.on("message", (msg, rinfo) => {
      const host = hostFromMatch(msg, rinfo);
      if (host && host !== local) found.add(host);
    });

    sock.bind(0, local, async () => {
      try {
        sock.setMulticastTTL(1);
        sock.setMulticastInterface(local);
      } catch {
        /* interface may not support multicast opts */
      }
      const buf = probeXml();
      const prefix = local.split(".").slice(0, 3).join(".");
      const hosts = [WS_MULTICAST];
      for (let n = 1; n <= 254; n += 1) hosts.push(`${prefix}.${n}`);
      await sendAll(sock, buf, hosts, () => open);
    });

    setTimeout(done, DISCOVER_MS);
  });
}

export async function scanCameras() {
  const added = new Set((await loadCameras()).map((cam) => normalizeHost(cam.host)));
  const found = new Set();
  const sets = await Promise.all(lanIfaces().map(discoverFrom));
  for (const set of sets) {
    for (const host of set) {
      if (!added.has(host)) found.add(host);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosts = await scanCameras();
  if (!hosts.length) console.log("no cameras found");
  else hosts.forEach((h) => console.log(h));
}
