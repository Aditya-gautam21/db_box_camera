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

function isDeadSession(err) {
  const code = err?.code;
  return code === 56 || code === "56" || code === 7 ||
    err?.message === "no_login" || err instanceof SyntaxError;
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
  const hdrFile = path.join(os.tmpdir(), `cam-${auth.id}.hdr`);
  const bodyFile = path.join(os.tmpdir(), `cam-${auth.id}.body`);

  async function login() {
    await execFileAsync(curlBin, [
      "-k",
      "--tls-max", "1.2",
      "--digest",
      "-u", `${auth.username}:${auth.password}`,
      "-sS",
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
  }

  async function postNow(apiPath, data, retries = 1) {
    if (!cookie) await login();
    try {
      const { stdout } = await execFileAsync(
        curlBin,
        [
          "-k",
          "--tls-max", "1.2",
          "--http1.1",
          "-sS",
          "-H", "Content-Type: application/json",
          "-H", "Connection: close",
          "-H", `Cookie: session_443=${cookie}`,
          "-H", `X-csrftoken: ${csrf}`,
          "--data-raw",
          JSON.stringify({ version: "1.0", data }),
          `https://${auth.host}${apiPath}`,
        ],
        { maxBuffer: 32 * 1024 * 1024 },
      );
      const json = JSON.parse(stdout);
      if (json.error_code === "no_login") {
        throw new Error("no_login");
      }
      return json;
    } catch (err) {
      if (retries < 1 || !isDeadSession(err)) throw err;
      cookie = "";
      csrf = "";
      await login();
      return postNow(apiPath, data, retries - 1);
    }
  }

  let queue = Promise.resolve();
  function post(apiPath, data, retries = 1) {
    const run = () => postNow(apiPath, data, retries);
    const next = queue.then(run, run);
    queue = next.then(() => {}, () => {});
    return next;
  }

  return { id: auth.id, login, post };
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
