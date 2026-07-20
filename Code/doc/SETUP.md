# EvEJS Setup

This is the clear, first-time setup guide.

If you are brand new to EvEJS, start here.

## What You Need

- a Windows PC
- Node.js `LTS`
- this repo on your machine
- a copied EVE client folder for **EVE 24.01 build 3396210**

Important:

- use a copied EVE folder
- do not point EvEJS at the same EVE install you use for normal live play
- the supported compatibility point is build `3396210`, validated June 16, 2026
- the setup wizard will warn when the selected client is older or newer

## The One-Time Setup

### 1. Install Node.js

Install the current `LTS` release from:

- `https://nodejs.org`

You only need to do this once.

### 2. Install the repo packages

Open this repo folder in Terminal and run:

```powershell
npm ci
npm --prefix server ci
```

You usually only need to do this:

- the first time you set the project up
- after pulling down a major update

### 3. Run the setup wizard

Double-click:

```text
tools\ClientSETUP\StartClientSetup.bat
```

The wizard will:

- ask for your copied EVE client folder
- save that path for later launches
- install the EvEJS certificate
- patch the copied client
- point the copied client at your local server

If Windows asks for permission during certificate or patching steps, allow it.

### 4. Create the local database

`StartServer.bat` does this automatically the first time it runs.

If you want to do it manually before starting the server, double-click:

```text
tools\DatabaseCreator\CreateDatabase.bat
```

That downloads the public EVE SDE, generates the EvEJS database, and writes it to:

```text
_local\gameStore
```

To rebuild it later, run:

```text
tools\DatabaseCreator\CreateDatabase.bat /force
```

The generated database is local machine data and is not committed to git.

### 5. Start the server and game

Double-click:

```text
StartServer.bat
```

Then choose:

```text
2 = Server + Play
```

That starts the server, gives it a moment to come up, and then launches the game.

## Daily Use

After the first setup is done, the normal routine is simple:

1. Double-click `StartServer.bat`
2. Choose `2`
3. Play

If you want the server running without launching the client, choose `1` instead.

## Upgrading From an Older Version

If you used EvEJS before the runtime data moved to a local SQLite database, you
do **not** need to do anything special. The next time you run `StartServer.bat`
it migrates your existing data automatically — it moves your old local data into
place and converts the runtime tables into the SQLite database. Your original
files are left untouched.

If you ever want to run the migration by hand:

```powershell
cd server
npm run db:migrate-legacy
```

First-time users can ignore this entirely — a fresh install has nothing to
migrate.

## What You Do Not Need To Do

You do **not** need to:

- edit certificates by hand
- patch the client by hand
- browse internal repo plumbing
- set up the standalone market just to log in

## Optional Market Setup

The standalone market is optional.

If you want it, follow:

- [MARKET_SETUP.md](MARKET_SETUP.md)

## If Something Feels Off

Start here:

- [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

## The Shortest Possible Version

1. Install Node.js `LTS`
2. Run `npm ci`
3. Run `npm --prefix server ci`
4. Run `tools\ClientSETUP\StartClientSetup.bat`
5. Run `StartServer.bat`
6. Choose `2`
