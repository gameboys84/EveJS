# EveJS

# 说明

本项目是基于[JohnElysian / evejs](https://github.com/JohnElysian/evejs) 和 [Discord](https://discord.gg/KMuJrMDEBa) 社区整理，仅用于学习node.js管理大型项目之用，如果涉及版权问题，请直接email联系，或者提交Issue，我将在收到后删除相应的内容。

具体使用方法可以参考此文档中的内容或者不同版本中的README文件。



# 参考来源

说明和协议许可均参考自evejs和社区项目

**A local EVE Online emulator for research, preservation, and New Eden tinkering.**

[![Windows](https://camo.githubusercontent.com/c9241e3646895eda4d75b17737b18311434204867c60d0d617165b65de65dff4/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f57696e646f77732d313025323025324625323031312d3030373844343f6c6f676f3d77696e646f7773266c6f676f436f6c6f723d7768697465)](https://github.com/JohnElysian/evejs?tab=readme-ov-file#quick-start) [![Node.js](https://camo.githubusercontent.com/0edc0dc67faf119c207b45c70b1676fc89d6611cf80a1c9882f093bdf336aa51/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4e6f64652e6a732d4c54532d3546413034453f6c6f676f3d6e6f6465646f746a73266c6f676f436f6c6f723d7768697465)](https://github.com/JohnElysian/evejs?tab=readme-ov-file#quick-start) [![License: AGPL-3.0](https://camo.githubusercontent.com/c77148b2545a6460d987db4f36a4e1c7e4641c3d9f8ab7b25b0afbdfaddb2061/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4c6963656e73652d4147504c2d2d332e302d626c75652e737667)](https://github.com/JohnElysian/evejs/blob/main/LICENSE) [![EVE 24.01](https://camo.githubusercontent.com/f0259782874c07af857ef95d0c6c90f736b1224d8928ceaa9fec4a5cd4d003bc/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f4556452d32342e30312532306275696c64253230333339363231302d384132424532)](https://github.com/JohnElysian/evejs?tab=readme-ov-file#compatibility) [![Setup](https://camo.githubusercontent.com/eaa3b1a585a55d5cb607d86e6770ae5c4ddeaf94ed8efaf90a5cf86572653f28/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f53657475702d4f6e652d2d436c69636b2d73756363657373)](https://github.com/JohnElysian/evejs?tab=readme-ov-file#quick-start) [![Discord](https://camo.githubusercontent.com/ff2de568b26d9e957b4d3d5cd68f275a0d089c3d8a02deeb08328f137255aaf3/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f446973636f72642d4a6f696e253230746865253230636f6d6d756e6974792d3538363546323f6c6f676f3d646973636f7264266c6f676f436f6c6f723d7768697465)](https://discord.gg/KMuJrMDEBa)

Note: This GitHub is V9 of Eve.JS. i'm proud of it.

A hero/lovely guy named Farmer has started updating eve.js, presently at V12, You can find these on discord!

this repo wont be updated -- or supported! However, it is working for what it is! you can fight rats, mine, time dilation, full market, try out all the ships, explore the universe :)

thank you to Icey, deer_hunter & myself for this project existing today :)

CCP have issued a DMCA against eve.js before, this repo may vanish at any time.

EvEJS lets you run a local research server against your own copied EVE Online client. It is built for people who want to explore how EVE works, preserve client/server behavior, test ideas, and help push emulator parity forward.

This project is unofficial, community-run, and not affiliated with CCP Games / Fenris Creations.

## Quick Start

1. Download or clone this repository.
2. Make a separate copy of your EVE Online client.
3. Run `SetupEveJS.bat`.
4. Select your copied EVE client when the setup wizard asks for it.
5. Let setup *automatically* run `DatabaseCreator.bat` to build the complete local database.
6. Run `StartServer.bat`.
7. Choose option `2` to start the server and launch the client.

The setup flow installs the needed Node packages, creates the local EvEJS database, prepares local certificates, and opens the client setup wizard.

## Compatibility

| Area              | Current target |
| ----------------- | -------------- |
| EVE version       | `24.01`        |
| Client build      | `3396210`      |
| Static-data point | June 16, 2026  |
| Primary platform  | Windows        |
| Runtime           | Node.js LTS    |

Use a copied client folder. Do not point EvEJS at the same EVE install you use for Tranquility.

## What You Get

- One-click first-time setup with `SetupEveJS.bat`.
- Complete local database generation with `DatabaseCreator.bat`.
- Client setup wizard for copied-client configuration.
- Local chat and public-gateway certificate generation.
- Starter accounts: `test` and `test2`.
- Built-in HyperNet seed support for local experimentation.
- Optional market tooling and market daemon support.
- A growing server codebase focused on EVE client parity.

## Database Creation

EvEJS does not ship the generated database as loose JSON files. Instead, the repo includes a native database creator:

```
DatabaseCreator.bat
```

That launcher calls:

```
tools\DatabaseCreator\bin\DatabaseCreator.exe
```

The creator verifies your copied client, downloads or reuses the supported public EVE static-data export, and creates the local database. The finished database is written to:

```
_local\newDatabase\data
```

If client setup has already saved your copied-client path, you can run `DatabaseCreator.bat` with no arguments. Otherwise pass it explicitly:

```
DatabaseCreator.bat --client-dir C:\Path\To\Copied\EVE\tq
```

## Daily Use

After setup, the normal loop is simple:

```
StartServer.bat
```

Choose:

- `1` for server only.
- `2` for server plus client launch.

## Client Files

EvEJS does not include a patched `blue.dll`, an EVE client, or any CCP/Fenris-owned client files. You must provide your own legally obtained EVE Online client.

Client setup is designed for a copied client folder so your normal EVE install stays untouched.

## Documentation

- [Setup guide](https://github.com/JohnElysian/evejs/blob/main/doc/SETUP.md)
- [Launcher guide](https://github.com/JohnElysian/evejs/blob/main/doc/LAUNCHERS.md)
- [Optional market setup](https://github.com/JohnElysian/evejs/blob/main/doc/MARKET_SETUP.md)
- [Market seeder guide](https://github.com/JohnElysian/evejs/blob/main/doc/MARKET_SEEDER.md)
- [Troubleshooting](https://github.com/JohnElysian/evejs/blob/main/doc/TROUBLESHOOTING.md)
- [Tools and admin basics](https://github.com/JohnElysian/evejs/blob/main/doc/TOOLS.md)

## Community

Questions, testing notes, weird discoveries, and useful bug reports are welcome. Join the Discord here:

https://discord.gg/KMuJrMDEBa

## Legal

EvEJS is independent and unofficial. EVE Online and related names, marks, assets, data, and client files belong to their respective owners. See [LEGAL.md](https://github.com/JohnElysian/evejs/blob/main/LEGAL.md), [NOTICE.md](https://github.com/JohnElysian/evejs/blob/main/NOTICE.md), [ACCEPTABLE_USE.md](https://github.com/JohnElysian/evejs/blob/main/ACCEPTABLE_USE.md), and [THIRD_PARTY_NOTICES.md](https://github.com/JohnElysian/evejs/blob/main/THIRD_PARTY_NOTICES.md).

```
AGPL-3.0-only

This project is licensed under the GNU Affero General Public License version 3.
See: https://www.gnu.org/licenses/agpl-3.0.en.html

No EVE Online client, CCP static data, CCP binaries, CCP artwork, CCP assets,
patched DLLs, private keys, generated market databases, or generated runtime
databases are licensed by this file.
```

