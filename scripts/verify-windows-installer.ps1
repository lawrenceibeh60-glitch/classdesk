$ErrorActionPreference = "Stop"

$installer = Join-Path $PSScriptRoot "..\dist-desktop\AFIT-ClassDesk-Setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\AFIT ClassDesk"
$appData = Join-Path $env:APPDATA "AFIT ClassDesk"
$exe = Join-Path $installDir "AFIT ClassDesk.exe"
$config = Join-Path $appData "xkiro keys\key.cd"
$serverPortFile = Join-Path $appData "server.port"
$uninstaller = Join-Path $installDir "Uninstall AFIT ClassDesk.exe"
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$expectedMigrations = (Get-ChildItem (Join-Path $PSScriptRoot "..\desktop\payload\migrations") -Directory).Count
$marker = [guid]::NewGuid().ToString()

if (!(Test-Path $installer)) { throw "Installer not found: $installer" }
Start-Process -FilePath $installer -ArgumentList "/S", "/D=$installDir" -Wait
if (!(Test-Path $exe)) { throw "Installed executable not found: $exe" }
if (!(Get-ChildItem -Path $startMenu -Filter "AFIT ClassDesk.lnk" -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) { throw "Start Menu shortcut was not installed." }

New-Item -ItemType Directory -Force -Path (Split-Path $config) | Out-Null
@'
ADMIN_PASSWORD="desktop-smoke-test-password"
ADMIN_PASSWORD_HASH=""
'@ | Set-Content -Path $config -Encoding ascii

function Start-ClassDesk([string]$databaseMode) {
  $process = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds(90)
  do {
    Start-Sleep -Milliseconds 500
    if ($process.HasExited) { throw "ClassDesk exited during startup with code $($process.ExitCode)." }
    if ((Test-Path (Join-Path $appData "pgdata\PG_VERSION")) -and (Test-Path (Join-Path $appData "server.log"))) {
      $log = Get-Content (Join-Path $appData "server.log") -Raw
      $match = [regex]::Match($log, "http://(?:localhost|127\.0\.0\.1):(?<port>\d+)")
      if ($match.Success) {
        $port = [int]$match.Groups["port"].Value
        try { $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 } catch { $health = $null }
        if ($health -and $health.ok) {
          $env:CLASSDESK_TEST_PORT = [string]$port
          $env:CLASSDESK_TEST_MARKER = $marker
          $env:CLASSDESK_EXPECTED_MIGRATIONS = [string]$expectedMigrations
          $env:CLASSDESK_DB_MODE = $databaseMode
          $nodeScript = @'
const { Client } = require("pg");
const client = new Client({ host: "127.0.0.1", port: Number(process.env.CLASSDESK_TEST_PORT), user: "classdesk", password: "classdesk-local", database: "classdesk" });
(async () => {
  await client.connect();
  const result = await client.query('SELECT count(*)::int AS count FROM "_desktop_migrations"');
  if (result.rows[0].count < Number(process.env.CLASSDESK_EXPECTED_MIGRATIONS)) throw new Error("Not all desktop migrations were applied.");
  await client.query('CREATE TABLE IF NOT EXISTS "_desktop_release_smoke" (id text PRIMARY KEY)');
  if (process.env.CLASSDESK_DB_MODE === "seed") await client.query('INSERT INTO "_desktop_release_smoke" (id) VALUES ($1) ON CONFLICT DO NOTHING', [process.env.CLASSDESK_TEST_MARKER]);
  else {
    const marker = await client.query('SELECT 1 FROM "_desktop_release_smoke" WHERE id = $1', [process.env.CLASSDESK_TEST_MARKER]);
    if (!marker.rowCount) throw new Error("Database test data did not persist across restart.");
  }
  await client.end();
})().catch(async error => { console.error(error); await client.end().catch(() => {}); process.exitCode = 1; });
'@
          node -e $nodeScript
          if ($LASTEXITCODE -ne 0) { throw "Database migrations or persistence check failed." }
          return $process
        }
      }
      if ($log -match "Error:|failed to start|Database setup failed") { throw "Startup log reports an error: $log" }
    }
  } while ((Get-Date) -lt $deadline)
  throw "ClassDesk did not initialize PostgreSQL and the local server before timeout."
}

$firstRun = Start-ClassDesk "seed"
$pgVersion = Get-Content (Join-Path $appData "pgdata\PG_VERSION") -Raw
$firstServerPort = Get-Content $serverPortFile -Raw
$firstRun.CloseMainWindow() | Out-Null
if (!$firstRun.WaitForExit(15000)) { throw "ClassDesk did not shut down gracefully." }

$secondRun = Start-ClassDesk "verify"
$secondRun.CloseMainWindow() | Out-Null
if (!$secondRun.WaitForExit(15000)) { throw "ClassDesk did not shut down gracefully after restart." }
if ((Get-Content (Join-Path $appData "pgdata\PG_VERSION") -Raw) -ne $pgVersion) { throw "Database files did not persist across restart." }
if ((Get-Content $serverPortFile -Raw) -ne $firstServerPort) { throw "The local server origin changed across restart." }

if (!(Test-Path $uninstaller)) { throw "Uninstaller not found: $uninstaller" }
Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait
if (Test-Path $exe) { throw "Uninstall left the application executable behind." }
if (!(Test-Path (Join-Path $appData "pgdata\PG_VERSION"))) { throw "Uninstall removed persistent user data." }