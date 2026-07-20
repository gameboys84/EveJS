# EveJS

🌐 **Language**: [简体中文](README.md) | **English**

---

## About

This project is organized based on [JohnElysian / evejs](https://github.com/JohnElysian/evejs) and the [Discord community](https://discord.gg/KMuJrMDEBa), intended solely for learning node.js large-scale project management. If there are any copyright concerns, please contact via email or submit an Issue, and I will remove the relevant content upon receipt.

This project is a local EVE Online server emulator targeting **EVE 24.01 build 3396210**.

Join the project Discord: [https://discord.gg/KMuJrMDEBa](https://discord.gg/KMuJrMDEBa)

---

## References

The development and documentation of this project reference the following sources:

- **[JohnElysian/evejs](https://github.com/JohnElysian/evejs)** — The original EVE.js project repository (V9), developed by JohnElysian, serving as the primary reference for this project
- **[Discord Community](https://discord.gg/KMuJrMDEBa)** — Community members including Farmer have continued development beyond V9 up to V12, providing extensive community support and updates
- **Special thanks**: Icey, deer_hunter, JohnElysian, and other community members for their contributions to the project

> ⚠️ CCP has previously issued a DMCA notice against eve.js, and related repositories may be taken down at any time. This project is for learning and research purposes only.

---

## Localhost Only

> **EVE.js is a localhost-only project.** Run the server and EVE client on the same computer. It is not hardened for a LAN, the public Internet, port forwarding, shared hosting, or untrusted users.

The supported address is `127.0.0.1`. The Docker configuration publishes every required port specifically on `127.0.0.1`, and native listener defaults are also loopback-only.

---

## Recommended: Docker Setup

Docker is the easiest backend setup. It builds a Linux image containing:

- the Node.js game server
- the Rust market daemon plus both v1 and v2 market seed engines
- automatic first-run static game-data initialization
- persistent game and market SQLite databases

The Windows EVE client still runs directly on your computer; it does not run inside the Linux container.

### Requirements

- Windows with Docker Desktop in **Linux containers** mode
- a full copied EVE shared cache for build `3396210` (the copy must include `EVE\tq`, `ResFiles`, and `index_tranquility.txt`)
- free local ports `443`, `5222`, `26000`–`26002`, and `40110`
- Internet access on the first start for image dependencies and the approximately 80 MB EVE SDE download

Use a copied EVE installation. Do not patch the same installation you use for normal live play.

### 1. Build the Linux Image

Open PowerShell in this project folder and confirm Docker is using Linux containers:

```powershell
docker info --format '{{.OSType}}'
```

It should print `linux`. Build the shared local image:

```powershell
docker compose build init
```

### 2. Choose and Build the Market

There is one Rust market daemon and two ways to populate its SQLite database. List the choices:

```powershell
docker compose run --rm --no-deps market-tools engines
```

For the recommended fast, repeatable synthetic market (v1):

```powershell
docker compose run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari
```

Alternatively, use the latest EVE Ref Tranquility station-market snapshot (v2):

```powershell
docker compose run --rm --no-deps market-tools rebuild v2 `
  --order-filter market-scope-with-npc `
  --market-solar-system-id 30000142
```

### 3. Start the Backend

```powershell
docker compose up --detach
```

Follow progress with:

```powershell
docker compose logs --follow init market server
```

Press `Ctrl+C` to stop following logs; the containers keep running. The backend is ready when `docker compose ps --all` shows `market` and `server` as healthy and `init` as exited with code `0`:

```powershell
docker compose ps --all
```

### 4. Prepare the Windows Client

After the Docker server is healthy, run:

```text
tools\ClientSETUP\StartClientSetup.bat
```

Select the copied build `3396210` shared-cache folder. The wizard patches the copied client, points it at `127.0.0.1`, and trusts the same local CA that the container generated.

### 5. Play

Keep the Docker backend running, then launch the client on Windows:

```text
Play.bat
```

### Daily Docker Use

```powershell
# Start or resume the backend
docker compose up --detach

# Check health
docker compose ps

# Follow server and market logs
docker compose logs --follow server market

# Stop the backend but keep all data
docker compose down
```

After pulling project updates, rebuild without resetting data:

```powershell
docker compose up --build --detach
```

### Local Ports

| Local address | Purpose |
|---|---|
| `127.0.0.1:26000` | Main game TCP server |
| `127.0.0.1:26001` | Image server |
| `127.0.0.1:26002` | Local HTTP proxy and gateway |
| `127.0.0.1:443` | Local HTTPS assets used by the client |
| `127.0.0.1:5222` | XMPP chat |
| `127.0.0.1:40110` | Rust market health and diagnostics |

---

## Native Windows Setup

Use this path only if you do not want Docker. It requires more host tooling and more separate steps.

### Requirements

- Node.js 24 LTS
- the full copied EVE build `3396210` shared cache
- Internet access for npm, the SDE, Rust, and build-tool downloads
- administrator permission for certificate installation and native build tools

### First-time Setup

From PowerShell in the project root:

```powershell
npm ci
npm --prefix server ci
```

Then run these launchers in order:

1. `tools\ClientSETUP\StartClientSetup.bat`
2. `tools\DatabaseCreator\CreateDatabase.bat`
3. `tools\InstallRustForMarket.bat`
4. `BuildMarketSeed.bat` — choose **Jita + New Caldari**
5. `StartMarketServer.bat` — choose the release-server option
6. `StartServer.bat` — choose **Server + Play**

### Daily Native Use

1. Run `StartMarketServer.bat` and leave it open.
2. Run `StartServer.bat` and choose **Server + Play**.
3. Use `Play.bat` when the backend is already running.

---

## Project Structure

```
EveJS/
├── README.md                   # documentation
├── CLAUDE.md                   # AI project documentation
├── LICENSE                     # License
│
├── Code/                       # Current development version
│   ├── server/                 # Server main directory
│   ├── tools/                  # Tools
│   └── ...
│
├── Doc/                        # Project analysis documents
└── Issue/                      # Issue tracking
```

---

## Compatibility

| Area | Current target |
|------|----------------|
| EVE version | `24.01` |
| Client build | `3396210` |
| Static-data point | June 16, 2026 |
| Primary platform | Windows |
| Runtime | Node.js LTS |

---

## More Documentation

- [Detailed native setup](Code/doc/SETUP.md)
- [Launcher guide](Code/doc/LAUNCHERS.md)
- [Market setup](Code/doc/MARKET_SETUP.md)
- [Market seeder guide](Code/doc/MARKET_SEEDER.md)
- [Troubleshooting](Code/doc/TROUBLESHOOTING.md)
- [Tools and admin basics](Code/doc/TOOLS.md)
- [Non-Docker setup audit report](Code/doc/NON_DOCKER_SETUP_AUDIT.md)

---

## Legal

EvEJS is independent and unofficial. EVE Online and related names, marks, assets, data, and client files belong to their respective owners.

```
AGPL-3.0-only

This project is licensed under the GNU Affero General Public License version 3.
See: https://www.gnu.org/licenses/agpl-3.0.en.html

No EVE Online client, CCP static data, CCP binaries, CCP artwork, CCP assets,
patched DLLs, private keys, generated market databases, or generated runtime
databases are licensed by this file.
```
