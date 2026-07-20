# EveJS

🌐 **Language**: **简体中文** | [English](README.en.md)

---

## 说明

本项目是基于 [JohnElysian / evejs](https://github.com/JohnElysian/evejs) 和 [Discord 社区](https://discord.gg/KMuJrMDEBa) 整理，仅用于学习 node.js 管理大型项目之用。如果涉及版权问题，请直接 email 联系，或者提交 Issue，我将在收到后删除相应的内容。

本项目是一个本地 EVE Online 服务器模拟器，目标客户端版本 **EVE 24.01 build 3396210**。

加入项目 Discord 社区：[https://discord.gg/KMuJrMDEBa](https://discord.gg/KMuJrMDEBa)

---

## 参考来源

本项目的开发和说明参考了以下来源：

- **[JohnElysian/evejs](https://github.com/JohnElysian/evejs)** — EVE.js 原始项目仓库 (V9)，由 JohnElysian 开发，是本项目的主要参考来源
- **[Discord 社区](https://discord.gg/KMuJrMDEBa)** — Farmer 等社区成员在 V9 基础上持续开发至 V12 版本，提供了大量的社区支持和更新
- **特别感谢**: Icey、deer_hunter、JohnElysian 等社区成员对项目的贡献

> ⚠️ CCP 此前曾对 eve.js 发出过 DMCA 通知，相关仓库可能随时被下架。本项目仅用于学习研究目的。

---

## 仅限本地运行

> **EVE.js 是一个仅限本地运行的项目。** 请在同一台计算机上运行服务器和 EVE 客户端。该项目未针对局域网、公共互联网、端口转发、共享托管或不受信任的用户进行加固。

支持的地址为 `127.0.0.1`。Docker 配置将所有必需的端口发布在 `127.0.0.1` 上，原生监听器默认也仅限回环地址。

---

## 推荐方式：Docker 安装

Docker 是最简单的后端搭建方式，构建的 Linux 镜像包含：

- Node.js 游戏服务器
- Rust 市场守护进程及 v1/v2 市场种子引擎
- 首次运行时自动初始化静态游戏数据
- 持久化的游戏和市场 SQLite 数据库

Windows EVE 客户端仍在你的电脑上直接运行，不运行在 Linux 容器内。

### 环境要求

- Windows + Docker Desktop（**Linux 容器**模式）
- 完整的 EVE build `3396210` 客户端副本（必须包含 `EVE\tq`、`ResFiles` 和 `index_tranquility.txt`）
- 空闲本地端口：`443`、`5222`、`26000`–`26002`、`40110`
- 首次启动需要网络访问（下载镜像依赖和约 80MB 的 EVE SDE 数据）

请使用 EVE 客户端副本，不要对你正常游玩的客户端进行补丁修改。

### 1. 构建 Linux 镜像

在项目文件夹中打开 PowerShell，确认 Docker 使用 Linux 容器：

```powershell
docker info --format '{{.OSType}}'
```

应该输出 `linux`。构建本地镜像：

```powershell
docker compose build init
```

### 2. 选择并构建市场

有一个 Rust 市场守护进程和两种填充其 SQLite 数据库的方式。列出选项：

```powershell
docker compose run --rm --no-deps market-tools engines
```

推荐使用快速、可重复的合成市场 (v1)：

```powershell
docker compose run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari
```

或使用最新的 EVE Ref Tranquility 站点市场快照 (v2)：

```powershell
docker compose run --rm --no-deps market-tools rebuild v2 `
  --order-filter market-scope-with-npc `
  --market-solar-system-id 30000142
```

### 3. 启动后端

```powershell
docker compose up --detach
```

查看启动进度：

```powershell
docker compose logs --follow init market server
```

按 `Ctrl+C` 停止跟踪日志；容器继续运行。当 `docker compose ps --all` 显示 `market` 和 `server` 为 healthy 且 `init` 以退出码 `0` 结束时，后端就绪：

```powershell
docker compose ps --all
```

### 4. 准备 Windows 客户端

Docker 服务器就绪后，运行：

```text
tools\ClientSETUP\StartClientSetup.bat
```

选择副本 build `3396210` 的共享缓存文件夹。向导将补丁副本客户端，指向 `127.0.0.1`，并信任容器生成的同一本地 CA。

### 5. 开始游戏

保持 Docker 后端运行，然后在 Windows 上启动客户端：

```text
Play.bat
```

### 日常 Docker 使用

```powershell
# 启动或恢复后端
docker compose up --detach

# 检查健康状态
docker compose ps

# 跟踪服务器和市场日志
docker compose logs --follow server market

# 停止后端但保留所有数据
docker compose down
```

拉取项目更新后，重建而不重置数据：

```powershell
docker compose up --build --detach
```

### 本地端口

| 本地地址 | 用途 |
|---------|------|
| `127.0.0.1:26000` | 主游戏 TCP 服务器 |
| `127.0.0.1:26001` | 图片服务器 |
| `127.0.0.1:26002` | 本地 HTTP 代理和网关 |
| `127.0.0.1:443` | 客户端使用的本地 HTTPS 资源 |
| `127.0.0.1:5222` | XMPP 聊天 |
| `127.0.0.1:40110` | Rust 市场健康和诊断 |

---

## 原生 Windows 安装

仅在你不想使用 Docker 时使用此方式。需要更多主机工具和步骤。

### 环境要求

- Node.js 24 LTS
- 完整的 EVE build `3396210` 客户端副本
- 网络访问（npm、SDE、Rust 和构建工具下载）
- 管理员权限（用于证书安装和原生构建工具）

### 首次设置

在项目根目录的 PowerShell 中：

```powershell
npm ci
npm --prefix server ci
```

然后按顺序运行以下启动器：

1. `tools\ClientSETUP\StartClientSetup.bat`
2. `tools\DatabaseCreator\CreateDatabase.bat`
3. `tools\InstallRustForMarket.bat`
4. `BuildMarketSeed.bat` — 选择 **Jita + New Caldari**
5. `StartMarketServer.bat` — 选择 release-server 选项
6. `StartServer.bat` — 选择 **Server + Play**

### 日常原生使用

1. 运行 `StartMarketServer.bat` 并保持打开
2. 运行 `StartServer.bat` 并选择 **Server + Play**
3. 后端已运行时使用 `Play.bat`

---

## 项目结构

```
EveJS/
├── README.md                   # 说明文档
├── CLAUDE.md                   # AI 项目说明
├── LICENSE                     # 许可证
│
├── Code/                       # 当前开发版本
│   ├── server/                 # 服务器主目录
│   ├── tools/                  # 工具
│   └── ...
│
├── Doc/                        # 项目分析文档
└── Issue/                      # 问题跟踪
```

---

## 兼容性

| 项目 | 当前目标 |
|------|---------|
| EVE 版本 | `24.01` |
| 客户端构建 | `3396210` |
| 静态数据时间点 | 2026年6月16日 |
| 主要平台 | Windows |
| 运行时 | Node.js LTS |

---

## 更多文档

- [详细原生安装指南](Code/doc/SETUP.md)
- [启动器指南](Code/doc/LAUNCHERS.md)
- [市场设置](Code/doc/MARKET_SETUP.md)
- [市场种子指南](Code/doc/MARKET_SEEDER.md)
- [故障排除](Code/doc/TROUBLESHOOTING.md)
- [工具和管理基础](Code/doc/TOOLS.md)
- [非 Docker 安装审计报告](Code/doc/NON_DOCKER_SETUP_AUDIT.md)

---

## 法律声明

EvEJS 是独立且非官方的。EVE Online 及相关名称、标记、资产、数据和客户端文件属于其各自所有者。

```
AGPL-3.0-only

本项目基于 GNU Affero General Public License version 3 许可。
参见: https://www.gnu.org/licenses/agpl-3.0.en.html

本文件不许可任何 EVE Online 客户端、CCP 静态数据、CCP 二进制文件、
CCP 艺术作品、CCP 资产、修补的 DLL、私钥、生成的市场数据库或
生成的运行时数据库。
```
