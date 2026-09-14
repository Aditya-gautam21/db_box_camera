import { app, BrowserWindow, protocol } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { handleRequest, ROOT } from "./routes.js";

function raspberryPi() {
  try {
    return readFileSync("/proc/device-tree/model", "utf8").includes("Raspberry Pi");
  } catch {
    return false;
  }
}

function dbusAddress(value) {
  const addr = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  return /^(unix|tcp):/.test(addr) ? addr : "";
}

function attachLocalDisplay() {
  const uid = process.getuid?.();
  if (uid != null && !process.env.XDG_RUNTIME_DIR) {
    const dir = `/run/user/${uid}`;
    if (existsSync(dir)) process.env.XDG_RUNTIME_DIR = dir;
  }
  const runtime = process.env.XDG_RUNTIME_DIR;
  const session = dbusAddress(process.env.DBUS_SESSION_BUS_ADDRESS);
  if (session) {
    process.env.DBUS_SESSION_BUS_ADDRESS = session;
  } else if (runtime && existsSync(`${runtime}/bus`)) {
    process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${runtime}/bus`;
  } else {
    delete process.env.DBUS_SESSION_BUS_ADDRESS;
  }
  const system = dbusAddress(process.env.DBUS_SYSTEM_BUS_ADDRESS);
  if (system) process.env.DBUS_SYSTEM_BUS_ADDRESS = system;
  else delete process.env.DBUS_SYSTEM_BUS_ADDRESS;
  if (!process.env.DISPLAY && existsSync("/tmp/.X11-unix/X0")) {
    process.env.DISPLAY = ":0";
  }
  if (!process.env.XAUTHORITY && process.env.HOME) {
    const auth = path.join(process.env.HOME, ".Xauthority");
    if (existsSync(auth)) process.env.XAUTHORITY = auth;
  }
}

attachLocalDisplay();
app.commandLine.appendSwitch("ozone-platform-hint", "auto");
if (raspberryPi()) {
  // Pi desktop here is X11 (lxterminal). Wayland ozone puts the window off-screen.
  // SwiftShader is not shipped for linux-arm64, so disable-gpu leaves a black window.
  // Skia software GL still paints HTML and the JPEG canvas.
  app.commandLine.appendSwitch("ozone-platform", process.env.DISPLAY ? "x11" : "wayland");
  app.commandLine.appendSwitch("use-gl", "disabled");
}
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
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });
  window.loadURL("app://ui/live");
});

app.on("window-all-closed", () => app.quit());
