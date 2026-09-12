import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCamera } from "./addCamera.js";

const execFileAsync = promisify(execFile);
const curlBin = "/usr/bin/curl";

export function env(name) {
  const raw = process.env[name] ?? process.env[`ENG_${name}`] ?? "";
  return String(raw).replaceAll('"', "");
}

function parseCookie(hdr) {
  const line = hdr.split(/\r?\n/).find((l) => /^set-cookie:/i.test(l));
  const m = line && line.match(/session_443=([^;]+)/);
  if (!m) throw new Error("no session_443 in login headers");
  return m[1];
}

function parseCsrf(hdr) {
  const line = hdr.split(/\r?\n/).find((l) => /^x-csrftoken:/i.test(l));
  const v = line && line.split(":").slice(1).join(":").trim();
  if (!v) throw new Error("no X-csrftoken in login headers");
  return v;
}

function isUnreachable(err) {
  const code = err?.code;
  return code === 7 || code === "7" ||
    /Failed to connect|No route to host|Connection refused/i.test(String(err?.stderr || err?.message || ""));
}

function isTimeout(err) {
  const code = err?.code;
  return code === 28 || code === "28" ||
    /timed out|Timeout/i.test(String(err?.stderr || err?.message || ""));
}

function isTransient(err) {
  const code = err?.code;
  return isTimeout(err) || isUnreachable(err) || code === 52 || code === "52";
}

function isDeadSession(err) {
  const code = err?.code;
  return code === 56 || code === "56" ||
    err?.message === "no_login" ||
    err?.message === "no_heartbeat" ||
    err instanceof SyntaxError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cameraError(host, err) {
  if (err?.message && !/Command failed:|curl |Cookie:|csrftoken|-u /i.test(err.message) && err.status) {
    return err;
  }
  const out = isTimeout(err)
    ? new Error(`camera timed out: ${host}`)
    : isUnreachable(err)
      ? new Error(`camera unreachable: ${host}`)
      : err instanceof SyntaxError
        ? new Error("camera returned invalid JSON")
        : new Error(`camera request failed: ${host}`);
  out.code = isTimeout(err) ? 28 : isUnreachable(err) ? 7 : err?.code;
  out.status = isTimeout(err) ? 504 : isUnreachable(err) ? 503 : 502;
  return out;
}

function authOf(cam) {
  if (cam?.host) {
    return {
      id: cam.id || cam.host,
      host: cam.host,
      username: cam.username,
      password: cam.password,
    };
  }
  return {
    id: "env",
    host: env("CAMERA_HOSTNAME"),
    username: env("CAMERA_USERNAME"),
    password: env("CAMERA_PASSWORD"),
  };
}

export function createSession(cam) {
  const auth = authOf(cam);
  let cookie = "";
  let csrf = "";
  let connectFails = 0;
  let blockedUntil = 0;
  const hdrFile = path.join(os.tmpdir(), `cam-${auth.id}.hdr`);
  const bodyFile = path.join(os.tmpdir(), `cam-${auth.id}.body`);

  async function login(retries = 1) {
    if (Date.now() < blockedUntil) {
      throw Object.assign(new Error(`camera unreachable: ${auth.host}`), { code: 7, status: 503 });
    }
    try {
      await execFileAsync(curlBin, [
        "-k",
        "--tls-max", "1.2",
        "--digest",
        "-u", `${auth.username}:${auth.password}`,
        "-sS",
        "--connect-timeout", "10",
        "--max-time", "25",
        "-D", hdrFile,
        "-o", bodyFile,
        "-H", "Content-Type: application/json",
        "--data-raw",
        JSON.stringify({
          data: {
            support_new_schedule: true,
            remote_terminal_info: "WEB,unknown",
          },
        }),
        `https://${auth.host}/API/Web/Login`,
      ]);
      const hdr = fs.readFileSync(hdrFile, "utf8");
      cookie = parseCookie(hdr);
      csrf = parseCsrf(hdr);
      connectFails = 0;
      blockedUntil = 0;
    } catch (err) {
      if (retries > 0 && isTransient(err)) {
        await delay(500);
        return login(retries - 1);
      }
      if (isUnreachable(err)) {
        connectFails += 1;
        if (connectFails >= 2) {
          blockedUntil = Date.now() + 60_000;
          connectFails = 0;
          console.error(`camera ${auth.host} unreachable after 2 attempts, backing off`);
        }
      }
      throw cameraError(auth.host, err);
    }
  }

  async function postNow(apiPath, data, retries = 1) {
    try {
      if (!cookie) await login();
      const { stdout } = await execFileAsync(
        curlBin,
        [
          "-k",
          "--tls-max", "1.2",
          "--http1.1",
          "-sS",
          "--connect-timeout", "10",
          "--max-time", "25",
          "-H", "Content-Type: application/json",
          "-H", `Cookie: session_443=${cookie}`,
          "-H", `X-csrftoken: ${csrf}`,
          "--data-raw",
          JSON.stringify({ version: "1.0", data }),
          `https://${auth.host}${apiPath}`,
        ],
        { maxBuffer: 16 * 1024 * 1024 },
      );
      const json = JSON.parse(stdout);
      if (json.error_code === "no_login" || json.error_code === "no_heartbeat") {
        throw new Error(json.error_code);
      }
      return json;
    } catch (err) {
      if (retries > 0 && (isDeadSession(err) || isTransient(err))) {
        if (isDeadSession(err) || isTimeout(err) || isUnreachable(err)) {
          cookie = "";
          csrf = "";
        }
        await delay(500);
        return postNow(apiPath, data, retries - 1);
      }
      throw cameraError(auth.host, err);
    }
  }

  async function downloadNow(urlPath, outFile, maxTime, retries = 1) {
    try {
      if (!cookie) await login();
      const { stdout } = await execFileAsync(curlBin, [
        "-k",
        "--tls-max", "1.2",
        "--http1.1",
        "-sS",
        "--connect-timeout", "10",
        "--max-time", String(maxTime),
        "-H", `Cookie: session_443=${cookie}`,
        "-H", `X-csrftoken: ${csrf}`,
        "-X", "POST",
        "-o", outFile,
        "-w", "%{http_code} %{size_download}",
        `https://${auth.host}${urlPath}`,
      ]);
      const [code, bytes] = String(stdout).trim().split(/\s+/);
      if (code === "401" || code === "403") throw new Error("no_login");
      if (code !== "200") {
        throw Object.assign(new Error(`clip download failed (${code})`), { status: 502 });
      }
      if (Number(bytes) < 1024) {
        throw Object.assign(new Error("camera returned an empty clip"), { status: 502 });
      }
    } catch (err) {
      if (retries > 0 && (isDeadSession(err) || isTransient(err))) {
        cookie = "";
        csrf = "";
        await delay(500);
        return downloadNow(urlPath, outFile, maxTime, retries - 1);
      }
      throw cameraError(auth.host, err);
    }
  }

  let queue = Promise.resolve();
  function post(apiPath, data, retries = 1) {
    const run = () => postNow(apiPath, data, retries);
    const next = queue.then(run, run);
    queue = next.then(() => {}, () => {});
    return next;
  }

  function download(urlPath, outFile, maxTime = 120) {
    const run = () => downloadNow(urlPath, outFile, maxTime);
    const next = queue.then(run, run);
    queue = next.then(() => {}, () => {});
    return next;
  }

  return { id: auth.id, login, post, postNow, download };
}

const sessions = new Map();

export async function getSession(camId) {
  const cam = await getCamera(camId);
  const key = cam?.id || "env";
  let session = sessions.get(key);
  if (!session) {
    session = createSession(cam);
    sessions.set(key, session);
  }
  return session;
}
