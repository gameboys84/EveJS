# Non-Docker Setup Audit

This is a report on the current native Windows setup. It intentionally does not redesign or replace the existing native launchers.

## Executive summary

The individual pieces work, but the setup is split across client preparation, Node dependency installation, static-data creation, two Rust builds, market seeding, and two long-running processes. Several launchers duplicate part of another launcher's work, while other steps have undocumented ordering dependencies.

The most useful improvement would be one root-level native orchestrator with explicit `setup`, `start`, `doctor`, and `reset` commands. Client preparation should remain a separate Windows-only phase, while server-only setup should not require client configuration.

## Current flow

| Phase | Current entry point | Output or dependency |
|---|---|---|
| Node tools | `npm ci` | Root tool dependencies |
| Node server | `npm --prefix server ci` or implicit work in `StartServer.bat` | Server dependencies, including native `better-sqlite3` |
| Client | `tools\ClientSETUP\StartClientSetup.bat` | Patched copied client, launcher config, and trusted local certificates |
| Static data | `tools\DatabaseCreator\CreateDatabase.bat` or implicit work in `StartServer.bat` | `_local\gameStore\data` and `manifest.json` |
| Main persistence | Created by the Node game store | `_local\gameStore\gamestore.sqlite` |
| Market toolchain | `tools\InstallRustForMarket.bat` | Rust, MSVC build tools, both Rust projects |
| Market seed | `BuildMarketSeed.bat` | `externalservices\market-server\data\generated\market.sqlite` |
| Market runtime | `StartMarketServer.bat` | Rust HTTP `40110` and RPC `40111` listeners |
| Node runtime | `StartServer.bat` | Game, image, gateway, XMPP, and monitor listeners |
| Client runtime | `Play.bat` | Windows EVE client |

The verified first-time sequence is:

```text
npm ci
npm --prefix server ci
tools\ClientSETUP\StartClientSetup.bat
tools\DatabaseCreator\CreateDatabase.bat
tools\InstallRustForMarket.bat
BuildMarketSeed.bat
StartMarketServer.bat
StartServer.bat
```

## Findings

### 1. Server startup is coupled to client setup

`StartServer.bat` resolves and loads the client-generated `EvEJSConfig.bat` before it checks server dependencies or data. As a result, even **Server only** cannot start until the client wizard has run. The Node server itself uses root JSON and `EVEJS_*` environment variables, so this is a launcher coupling rather than a runtime requirement.

**Recommendation:** let server-only setup and startup run without an EVE client path. Load client launcher configuration only when the user asks to launch the client.

### 2. Bootstrap responsibilities overlap

`doc/SETUP.md` tells users to install both root and server packages. `StartServer.bat` also installs server packages when its single Express-file check fails, creates static data when the manifest is absent, migrates legacy state, and optionally launches the client.

**Recommendation:** create explicit idempotent commands for dependency installation, data initialization, migration, and runtime startup. The interactive launcher can call those commands instead of implementing its own partial checks.

### 3. Direct Node startup can select a different data location

The normal launcher sets `EVEJS_GAMESTORE_DATA_DIR` under `_local\gameStore\data`. Direct `npm start` can fall back to `server\src\gameStore\data` when `_local` is absent, placing SQLite beside source data.

**Recommendation:** make the local state root invariant. If generated data is missing, fail with a bootstrap command instead of silently selecting a source-tree store.

### 4. Main and market persistence have unrelated locations

The Node database is under `_local\gameStore`, while the market database is under `externalservices\market-server\data\generated`. Users must discover and back up both locations.

**Recommendation:** move all mutable native state under one documented `_local` root, with separate `game` and `market` children.

### 5. Market reseeding is destructive

The market seeder replaces `market.sqlite`. That same file contains seeded stock, player orders, order events, and market history. A routine reseed can therefore erase live market activity.

**Recommendation:** never include forced reseeding in daily startup. Longer term, separate immutable seed input from mutable player market state or implement a migration-backed merge operation.

### 6. The native launcher flow exposes only one of two supported market seeders

The repository tracks both the synthetic `tools\market-seed` project and the snapshot-based `tools\market-seederv2` project. Docker exposes an explicit v1/v2 choice, but the documented native root workflow and its launchers still center on v1. V2 remains a separate project-specific path even though both engines replace the same native market database.

**Recommendation:** give the native flow one market administration command with an explicit v1/v2 engine argument, shared stop/lock checks, validation, and backup/restore behavior matching the Docker workflow.

### 7. Configuration is fragmented

Relevant values live in:

- `evejs.config.local.json` and `EVEJS_*` variables;
- ignored `EvEJSConfig.bat` client paths;
- the patched client `start.ini`;
- market-seed TOML;
- market-server TOML;
- hard-coded launcher health-check ports.

A port change in one layer does not update the others.

**Recommendation:** define one root configuration model and generate the client, Node, and Rust adapter settings from it.

### 8. Dependency checks are too shallow

`StartServer.bat` treats dependencies as installed when Express exists. That does not catch a missing or ABI-incompatible `better-sqlite3`, especially after changing Node versions. The current lock supports Node 20 and 22–26, but not Node 21.

**Recommendation:** pin Node 24 LTS, declare the supported engine in `package.json`, and perform a real `require("better-sqlite3")` check.

### 9. Native market prerequisites are understated

The market path needs more than Rust: its installer may require administrator elevation, `winget`, Visual Studio C++ Build Tools, the Windows SDK, and the MSVC Rust toolchain. It can also modify the user's Cargo linker configuration.

**Recommendation:** show these prerequisites before the installer starts and keep linker configuration project-local where possible.

### 10. Fixed delays replace readiness checks

Some launchers wait a fixed number of seconds before starting the next process. Both the Node HTTP side and Rust market expose health endpoints, so slower machines can be handled without guessing and fast machines do not need to wait unnecessarily.

**Recommendation:** gate each dependent startup on a health or TCP readiness check with a clear timeout and diagnostic message.

### 11. Several native instructions are stale

Examples found during the audit:

- `doc/MARKET_SEEDER.md` refers to `scripts\InstallRustForMarket.bat`; the file is under `tools`.
- database-creator errors mention a nonexistent `SetupEveJS.bat`.
- the client wizard mentions nonexistent `StartServerOnly.bat` and `StartClientOnly.bat` launchers.
- market documentation says seeded buy orders default off, while the tracked local TOML enables them.

**Recommendation:** add a documentation/launcher link check to CI and derive displayed paths from real files where practical.

## Prioritized improvement plan

### P0: protect state and local access

1. Keep all native listener bind defaults on `127.0.0.1`.
2. Remove forced market reseeding from any normal restart path.
3. Document and back up both SQLite stores until their locations are consolidated.

The listener-default issue was fixed as part of the Docker/local-only work; game TCP and XMPP now have separate bind settings that default to loopback.

### P1: create one backend workflow

Provide non-interactive root commands with stable exit codes:

```text
setup:server    install/validate Node and generate static data
setup:market    install/validate Rust and seed only when absent
start:server    run Node only
start:market    run Rust only
start           wait for market health, then run Node
doctor          validate versions, paths, ports, data, certs, and health
```

Keep client patching as an explicit Windows-only `setup:client` step.

### P1: make paths and configuration authoritative

1. Put game and market state beneath `_local`.
2. Make missing state an actionable error instead of a source-tree fallback.
3. Generate Rust and client adapter settings from one root config.
4. Make launchers consume configured ports rather than hard-coded values.

### P2: improve maintenance quality

1. Pin and validate Node, Rust, and native build prerequisites.
2. Replace fixed sleeps with readiness probes.
3. Add safe backup/restore commands.
4. Add automated checks for nonexistent paths in user-facing instructions.
5. Separate first setup, daily use, upgrades, resets, and advanced development commands in the documentation.

## Suggested target experience

A future native user should need one first-time backend command, one client-preparation command, and one daily start command. Those commands should be idempotent, preserve existing SQLite state, print the exact state paths in use, and stop with actionable errors rather than silently choosing alternate paths.
