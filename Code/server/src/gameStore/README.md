# gameStore (gameStore) — runtime data layer

In-memory cached data layer with two on-disk backends. Every consumer uses the
same synchronous API — `read(table, path)`, `write(table, path, value)`,
`remove(table, path)` — and reads are served from an in-memory cache, so call
sites never change regardless of backend.

## The three kinds of data

| Kind | Examples | Backend | Regenerable? |
|------|----------|---------|--------------|
| **SDE-generated** | celestials, typeDogma, itemTypes, stations | JSON → in-memory | Yes — `tools/DatabaseCreator` |
| **Static-sourced** | npcProfiles, expertSystems, newEdenStore | JSON → in-memory | No (hand-curated, in git) |
| **Runtime** | characters, items, skills, mail, market escrow, … | **SQLite** | No (live world state) |

SDE and static tables stay as JSON loaded into memory (they must be instant and
read-only). All **runtime** tables persist to SQLite.

## SQLite backend

Each runtime table maps to one SQL table `"<table>"(key TEXT PRIMARY KEY, json TEXT)`
— one row per top-level entity, value stored as a JSON blob. Benefits over the
old one-file-per-table JSON:

- **ACID writes (WAL):** a crash mid-write can no longer corrupt a table.
- **Per-row flushes:** changing one character upserts one row instead of
  rewriting the whole file. Flushes diff the cache against a per-row baseline.

Which tables are SQLite-backed is the `SQLITE_TABLES` set in `index.js`.

### Flat vs nested ("wrapper") tables

Most tables are **flat** — each top-level key is an entity (`characters[id]`),
so it's already one row per entity. A few tables nest their entities one level
under a named group (`notifications.boxes[characterID]`,
`wormholeRuntimeState.pairsByID[pairID]`). Storing the whole group as one row
would mean a change to one entity rewrites the entire group blob.

The `ROW_GROUPS` map in `sqliteStore.js` opts a table in to **per-entity rows**
for those groups: each entity becomes its own row (`group<US>entityID`, plus a
small skeleton row so an empty group still round-trips). A single change then
upserts a single small row. To add a table, list its group key(s):

```js
const ROW_GROUPS = {
  notifications: ["boxes"],
  wormholeRuntimeState: ["pairsByID", "staticSlotsByKey", "polarizationByCharacter"],
};
```

Loading reassembles the nested object losslessly; it also tolerates the legacy
whole-group blob, which the next flush (or `npm run db:migrate`) converts to
per-entity rows.

### First load / auto-seed

The first time a runtime table is read, if a legacy `data.json` with content
exists it is imported once and recorded in a `_migrations` marker table, so a
later delete is never resurrected from the stale JSON. After that, SQLite is
authoritative and the `data.json` is ignored.

Chat runtime tables (`chatState`, `chatStaticContracts`, `chatBacklog`) also
seed once from the older `_secondary/data/chat` sidecars when their SQLite
tables are empty. Those sidecars are legacy import sources only; runtime writes
go to `gamestore.sqlite`.

### Fresh / containerized first run

A brand-new install with no data works out of the box: `preloadAll()` creates
the data directory if missing and initializes every runtime table as an empty
SQLite table. No manual setup required.

## Where the database file lives

`<DATA_DIR>/../gamestore.sqlite`, where `DATA_DIR` is resolved as:

1. `$EVEJS_GAMESTORE_DATA_DIR` if set, else
2. `_local/gameStore/data` if present, else
3. the in-repo source data dir (fresh clone).

The `.sqlite` file (and its `-wal`/`-shm` sidecars) is gitignored. For Docker,
set `EVEJS_GAMESTORE_DATA_DIR` to a path on a mounted volume so runtime state
persists across containers.

## Manual migration (legacy JSON → SQLite)

Auto-seed handles this on first read, but you can migrate explicitly without
starting the server:

```bash
cd server
npm run db:migrate                 # all runtime tables
node src/gameStore/migrateJsonToSqlite.js accounts mail   # specific tables
node src/gameStore/migrateJsonToSqlite.js --help
```

It reads each `<DATA_DIR>/<table>/data.json` and loads its rows into SQLite.
Your `data.json` files are left untouched; re-running is safe (idempotent).

## Upgrading a pre-rename install

This layer used to be named `newDatabase` (data under `_local/newDatabase`, DB
file `newdatabase.sqlite`). `StartServer.bat` runs the one-time migration
automatically; to do it by hand:

```bash
cd server
npm run db:migrate-legacy
```

It moves `_local/newDatabase` → `_local/gameStore` and renames
`newdatabase.sqlite*` → `gamestore.sqlite*` (idempotent), so an existing install
carries its data forward instead of regenerating.

## Inspecting / querying

The file is plain SQLite — open it in DB Browser for SQLite, DBeaver, or the
`sqlite3` CLI while the server runs (WAL allows concurrent readers). Values are
JSON blobs; query into them with SQLite's JSON functions:

```sql
SELECT key, json_extract(json, '$.characterName') AS name
FROM   characters
WHERE  json_extract(json, '$.corporationID') = 98000000;
```
