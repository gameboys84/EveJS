EVE.js Discord server: https://discord.gg/KMuJrMDEBa, Come and say hey!


> Thank you to John, as well as many other contributers who kept this project going, and helped development chug along! You will always be appreciated :)\\\\



EVE.js is an easy-to-use server emulator for EVE Online. This release supports
**EVE 24.01 build 3396210**, validated against the client and static-data export
available on **16th June, 2026**.



## **Quick server startup:**

1. **First-time setup only —** run `tools\ClientSETUP\StartClientSetup.bat`
   - Points a *copied* EVE client at your local server, installs the EvEJS certificate, and writes your launcher config. Do this once before the first `StartServer.bat`, or the launcher stops with `Launcher config was not found`.

2. Run `StartServer.bat`
   - First run downloads the public EVE SDE and creates the local database under `_local\gameStore`.
   - Choose `2` to start the server **and** launch the game together.

3. `Play.bat` — launches the game when the server is already running.

To rebuild the local database manually, run:

```text
tools\DatabaseCreator\CreateDatabase.bat /force
```



## **Market setup**

1. Run `InstallRustForMarket.bat` inside `/tools`
2. Run `BuildMarketSeed.bat` inside `/tools/market-seed` (if you prefer to use the GUI version, run the script ending in `...Gui.bat`)
3. Run `StartMarketServer.bat` inside the root project directory.
*It's recommended to only seed Jita + New Caldari, because eeding the entire universe will take some time*

## **Other Guides**

* [Start here](doc/SETUP.md)
* [Launcher guide](doc/LAUNCHERS.md)
* [Optional market setup](doc/MARKET_SETUP.md)
* [Market seeder guide](doc/MARKET_SEEDER.md)
* [Troubleshooting](doc/TROUBLESHOOTING.md)
* [Tools and admin basics](doc/TOOLS.md)



Lots works, lots does not.

