import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

export function createSession() {
    let cookie = "";
    let csrf = "";
    const dir = os.tmpdir();
    const hdrFile = path.join(dir, "cam.hdr");
    const bodyFile = path.join(dir, "cam.body");

    async function login() {
        const { stdout, stderr } = await execFileAsync(curlBin, [
            "-k",
            "--tls-max", "1.2",
            "--digest",
            "-u", `${env("CAMERA_USERNAME")}:${env("CAMERA_PASSWORD")}`,
            "-sS",
            "-D", hdrFile,
            "-o", bodyFile,
            "-H", "Content-Type: application/json",
            "--data-raw",
            JSON.stringify({
                data: {
                    support_new_schedule: true,
                    remote_terminal_info: "WEB,unknown"
                }
            }),
            `https://${env("CAMERA_HOSTNAME")}/API/Web/Login`
        ]);
        const hdr = fs.readFileSync(hdrFile, "utf8");
        cookie = parseCookie(hdr);
        csrf = parseCsrf(hdr);
    }

    async function post(apiPath, data, retries = 1) {
        if (!cookie) await login();
        try {
            const { stdout } = await execFileAsync(curlBin, [
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
                `https://${env("CAMERA_HOSTNAME")}${apiPath}`,
            ]);
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
            return post(apiPath, data, retries - 1);
        }
    }

    async function heartbeat() {
        try {
            await post("/API/Login/Heartbeat", {});
        } catch (err) {
            console.error("heartbeat failed", err.message || err);
        }
    }

    return { login, post, heartbeat };
}

let shared;

export function getSession() {
    if (!shared) shared = createSession();
    return shared;
}