import { app, BrowserWindow, protocol } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";
import { handleRequest, ROOT } from "./routes.js";
import { startLiveDecodeProbe } from "../utils/hevcHw.js";

app.commandLine.appendSwitch(
  "disable-features",
  "VaapiVideoDecoder,VaapiVideoEncode,VaapiVideoDecoderLinuxGL,AcceleratedVideoDecodeLinuxGL",
);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

function loadEnvFile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

loadEnvFile(path.join(ROOT, ".env"));

app.whenReady().then(() => {
  protocol.handle("app", handleRequest);
  startLiveDecodeProbe();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.loadURL("app://ui/live");
});

app.on("window-all-closed", () => app.quit());
