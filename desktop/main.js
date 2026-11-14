const { app, BrowserWindow, Menu, dialog, shell } = require("electron");
const { fork, exec } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const legacyDataPath = app.getPath("userData");
const appDataPath = path.join(app.getPath("appData"), "AFIT ClassDesk");
if (path.resolve(legacyDataPath) !== path.resolve(appDataPath)) {
  if (fs.existsSync(legacyDataPath) && !fs.existsSync(appDataPath)) fs.renameSync(legacyDataPath, appDataPath);
  app.setPath("userData", appDataPath);
}

let win = null, server = null, pgInstance = null, pgProcess = null, pgPort = null, url = "", quitting = false;
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

const data = () => app.getPath("userData");
const res = (...p) => app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(__dirname, "payload", ...p);
function startupLog(message) {
  try { fs.appendFileSync(path.join(data(), "startup.log"), `${new Date().toISOString()} ${message}\r\n`, { mode: 0o600 }); } catch {}
}

function loadEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) { const v = m[2].replace(/^"(.*)"$/, "$1"); if (v !== "") env[m[1]] = v; }
  }
  return env;
}
const freePort = () => new Promise((ok, bad) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); }); s.on("error", bad); });
async function desktopPort() {
  const file = path.join(data(), "server.port");
  if (fs.existsSync(file)) {
    const port = Number(fs.readFileSync(file, "utf8"));
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
      const probe = net.createServer();
      try {
        await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", resolve); });
        await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
        return port;
      } catch (error) {
        throw new Error(`ClassDesk's saved local port ${port} is unavailable. Close the process using it and restart ClassDesk to preserve offline data.`, { cause: error });
      }
    }
  }
  const port = await freePort();
  fs.writeFileSync(file, String(port), { mode: 0o600 });
  return port;
}
const waitPort = (port, tries = 120) => new Promise((ok, bad) => { const t = (n) => { const c = net.connect(port, "127.0.0.1"); c.on("connect", () => { c.destroy(); ok(); }); c.on("error", () => { c.destroy(); n <= 0 ? bad(new Error("Server did not start")) : setTimeout(() => t(n - 1), 250); }); }; t(tries); });

const keysFile = () => path.join(data(), "xkiro keys", "key.cd");
function ensureConfig() {
  const file = keysFile();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const legacyFile = [
      path.join(data(), "keys", "API-KEYS.env"),
      path.join(legacyDataPath, "keys", "API-KEYS.env")
    ].find(candidate => fs.existsSync(candidate));
    if (legacyFile) fs.copyFileSync(legacyFile, file);
    else fs.writeFileSync(file, [
        'ADMIN_PASSWORD=""',
        'ADMIN_PASSWORD_HASH=""',
        'ELEVENLABS_API_KEY=""',
        'ELEVENLABS_VOICE_ID="pFZP5JQG7iQjIQuC4Bku"',
        'ELEVENLABS_MODEL="eleven_turbo_v2_5"',
        'AI_BASE_URL=""',
        'AI_API_KEY=""',
        'AI_MODEL=""',
        ""
      ].join("\r\n"), { mode: 0o600, flag: "wx" });
  }
  try { fs.chmodSync(file, 0o600); } catch {}
  return file;
}
function sessionSecret() {
  const f = path.join(data(), "secret.key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString("hex"));
  return fs.readFileSync(f, "utf8").trim();
}

/* ---- Offline database: a real PostgreSQL running from this app, data kept on this PC ---- */
function runNativeCommand(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env }, windowsHide: true });
    let output = "";
    const collect = chunk => {
      const text = chunk.toString("utf8");
      output = `${output}${text}`.slice(-20000);
      startupLog(`${label}: ${text.trim()}`);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.once("error", error => reject(new Error(`${label} could not start: ${error.message}`)));
    child.once("close", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${label} exited with code ${code}, signal ${signal || "none"}. ${output.trim()}`)));
  });
}

async function startWindowsPostgres(dir, port, password) {
  const { initdb, postgres } = await import("@embedded-postgres/windows-x64");
  if (!fs.existsSync(path.join(dir, "PG_VERSION"))) {
    const passwordFile = path.join(data(), "pg-password.tmp");
    fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
    try {
      await runNativeCommand(initdb, [
        `--pgdata=${dir}`,
        "--auth=password",
        "--username=classdesk",
        `--pwfile=${passwordFile}`
      ], "initdb");
    } finally {
      fs.rmSync(passwordFile, { force: true });
    }
  }

  pgPort = port;
  pgProcess = spawn(postgres, ["-D", dir, "-p", String(port)], {
    cwd: data(),
    env: { ...process.env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  startupLog(`postgres process started pid=${pgProcess.pid} port=${port} executable=${postgres}`);

  await new Promise((resolve, reject) => {
    let ready = false;
    let output = "";
    const timeout = setTimeout(() => {
      if (!ready) reject(new Error(`PostgreSQL did not become ready within 60 seconds. ${output.trim()}`));
    }, 60000);
    const collect = chunk => {
      const text = chunk.toString("utf8");
      output = `${output}${text}`.slice(-20000);
      startupLog(`postgres: ${text.trim()}`);
      if (!ready && text.includes("database system is ready to accept connections")) {
        ready = true;
        clearTimeout(timeout);
        resolve();
      }
    };
    pgProcess.stdout.on("data", collect);
    pgProcess.stderr.on("data", collect);
    pgProcess.once("error", error => {
      clearTimeout(timeout);
      reject(new Error(`PostgreSQL could not start: ${error.message}`));
    });
    pgProcess.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (!ready) reject(new Error(`PostgreSQL exited before becoming ready (code ${code}, signal ${signal || "none"}). ${output.trim()}`));
    });
  });
}

async function startDatabase() {
  const { Client } = require("pg");
  const dir = path.join(data(), "pgdata"), port = await freePort(), pass = "classdesk-local";
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (process.platform === "win32") {
    await startWindowsPostgres(dir, port, pass);
  } else {
    const { default: EmbeddedPostgres } = await import("embedded-postgres");
    pgInstance = new EmbeddedPostgres({ databaseDir: dir, user: "classdesk", password: pass, port, persistent: true, onLog: message => startupLog(`postgres: ${String(message).trim()}`), onError: error => startupLog(`postgres error: ${error && error.stack || error}`) });
    if (!fs.existsSync(path.join(dir, "PG_VERSION"))) await pgInstance.initialise();
    await pgInstance.start();
  }
  const admin = new Client({ host: "127.0.0.1", port, user: "classdesk", password: pass, database: "postgres" });
  await admin.connect();
  const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname='classdesk'");
  if (!exists.rowCount) await admin.query('CREATE DATABASE "classdesk"');
  await admin.end();
  const db = new Client({ host: "127.0.0.1", port, user: "classdesk", password: pass, database: "classdesk" });
  await db.connect();
  await db.query('CREATE TABLE IF NOT EXISTS "_desktop_migrations" (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
  const done = new Set((await db.query('SELECT name FROM "_desktop_migrations"')).rows.map(r => r.name));
  const mdir = res("migrations");
  for (const name of fs.readdirSync(mdir).filter(n => fs.existsSync(path.join(mdir, n, "migration.sql"))).sort()) {
    if (done.has(name)) continue;
    await db.query("BEGIN");
    try { await db.query(fs.readFileSync(path.join(mdir, name, "migration.sql"), "utf8")); await db.query('INSERT INTO "_desktop_migrations"(name) VALUES ($1)', [name]); await db.query("COMMIT"); }
    catch (e) { await db.query("ROLLBACK"); throw new Error(`Database setup failed in ${name}: ${e.message}`); }
  }
  await db.end();
  return `postgresql://classdesk:${pass}@127.0.0.1:${port}/classdesk`;
}

async function start() {
  startupLog(`startup begin packaged=${app.isPackaged} userData=${data()}`);
  const cfg = ensureConfig(); const env = loadEnv(cfg);
  startupLog(`config loaded file=${cfg} adminPassword=${Boolean(env.ADMIN_PASSWORD)} adminPasswordHash=${Boolean(env.ADMIN_PASSWORD_HASH)}`);
  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    startupLog("administrator credentials missing; opening setup config");
    await shell.openPath(cfg);
    await dialog.showMessageBox({ type: "info", title: "AFIT ClassDesk setup", message: "First-time setup", detail: "Your API keys file opened in Notepad.\n\nType your login password between the quotes after ADMIN_PASSWORD=. Configure your xKiro-compatible AI_BASE_URL, AI_API_KEY and AI_MODEL, and, if you like, ELEVENLABS_API_KEY for Ava\'s voice. Save, then start ClassDesk again." });
    app.quit(); return;
  }
  startupLog("starting embedded PostgreSQL");
  const databaseUrl = await startDatabase();
  startupLog("embedded PostgreSQL ready and migrations applied");
  const port = await desktopPort();
  const dir = res("server");
  fs.mkdirSync(path.join(data(), "files"), { recursive: true });
  server = fork(path.join(dir, "server.js"), [], { cwd: dir, silent: true, env: { ...process.env, ...env, DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret(), LOCAL_STORAGE_DIR: path.join(data(), "files"), ELECTRON_RUN_AS_NODE: "1", NODE_ENV: "production", PORT: String(port), HOSTNAME: "127.0.0.1" } });
  startupLog(`local server child started pid=${server.pid} port=${port}`);
  const logFile = path.join(data(), "server.log"); const log = fs.createWriteStream(logFile, { flags: "a" });
  server.stdout.pipe(log); server.stderr.pipe(log);
  server.on("exit", (code) => { if (!quitting && code) dialog.showErrorBox("ClassDesk stopped", `The local server exited (code ${code}).\nLog: ${logFile}`); });
  await waitPort(port);
  url = `http://127.0.0.1:${port}`;
  startupLog(`local server ready url=${url}`);
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 420, title: "AFIT ClassDesk", icon: path.join(__dirname, "build", "icon.png"), backgroundColor: "#07111f", webPreferences: { contextIsolation: true, sandbox: true, devTools: !app.isPackaged } });
  win.webContents.setWindowOpenHandler(({ url: u }) => { if (!u.startsWith(url)) { shell.openExternal(u); return { action: "deny" }; } return { action: "allow" }; });
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(["media", "notifications"].includes(perm)));
  win.on("closed", () => { win = null; });
  await win.loadURL(`${url}/login`);
}

const openInEdge = () => { if (url) exec(`start msedge --app=${url}`, { shell: "cmd.exe" }, (e) => { if (e) shell.openExternal(url); }); };
async function stopServices() {
  if (server) {
    const child = server;
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const timeout = setTimeout(() => child.kill(), 5000);
      child.once("exit", () => { clearTimeout(timeout); resolve(); });
      child.kill("SIGTERM");
    });
    server = null;
  }
  if (pgInstance) {
    const database = pgInstance;
    pgInstance = null;
    await database.stop();
  }
  if (pgProcess) {
    const child = pgProcess;
    pgProcess = null;
    const { pg_ctl } = await import("@embedded-postgres/windows-x64");
    try {
      await runNativeCommand(pg_ctl, ["stop", "-D", path.join(data(), "pgdata"), "-m", "fast", "-w"], "pg_ctl stop");
    } catch (error) {
      startupLog(`graceful PostgreSQL shutdown failed: ${error && error.stack || error}`);
      await new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const timeout = setTimeout(() => { child.kill(); resolve(); }, 5000);
        child.once("exit", () => { clearTimeout(timeout); resolve(); });
        child.kill();
      });
    }
  }
}
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "ClassDesk", submenu: [
      { label: "Open in Edge window (voice listening)", click: openInEdge },
      { label: "Edit XKIRO/API keys", click: () => shell.openPath(keysFile()) },
      { label: "Open data folder (backup this!)", click: () => shell.openPath(data()) },
      { label: "Open server log", click: () => shell.openPath(path.join(data(), "server.log")) },
      { type: "separator" }, { role: "reload" }, { role: "quit" } ] },
    { label: "Edit", submenu: [{ role: "copy" }, { role: "paste" }, { role: "selectAll" }] }
  ]));
  try { await start(); } catch (e) { startupLog(`startup failed: ${e && e.stack || e}`); dialog.showErrorBox("ClassDesk failed to start", String((e && e.message) || e)); quitting = true; try { await stopServices(); } catch {} app.exit(1); }
});
app.on("before-quit", async (e) => {
  if (quitting) return; quitting = true;
  if (server || pgInstance || pgProcess) { e.preventDefault(); try { await stopServices(); } catch (error) { dialog.showErrorBox("ClassDesk shutdown warning", String(error)); } app.exit(0); }
});
app.on("window-all-closed", () => app.quit());
