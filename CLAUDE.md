# CLAUDE.md — EveJS 项目说明

> 本文件供 AI 助手快速了解项目结构、核心架构、关键约定和开发注意事项。

---

## 一、项目概述

**EveJS** 是一个 EVE Online 服务器的本地模拟器（Server Emulator），用 Node.js 实现，目标客户端版本为 **EVE 24.01 (build 3396210, 2026年6月)**。

- **原始来源**: 基于 [JohnElysian/evejs](https://github.com/JohnElysian/evejs) 和 [Discord](https://discord.gg/KMuJrMDEBa) 社区整理
- **用途**: 仅用于学习 node.js 大型项目管理，不用于商业用途
- **协议**: AGPL-3.0
- **运行时**: Node.js LTS
- **平台**: Windows

---

## 二、目录结构

```
EveJS/
├── CLAUDE.md                   # 本文件 — AI 项目说明
├── README.md / README.en.md    # 项目对外说明
├── LICENSE                     # AGPL-3.0
│
├── Code/                       # 当前开发版本
│   ├── evejs.config.local.json # 本地配置（最高优先级）
│   ├── server/                 # 服务器主目录
│   │   ├── index.js            # 入口文件
│   │   ├── src/
│   │   │   ├── config/         # 配置系统 (index.js ~2650行)
│   │   │   ├── network/        # TCP/MachoNet 网络层
│   │   │   ├── services/       # 游戏服务 (70 目录, 206 *Service.js)
│   │   │   ├── space/          # 空间模拟引擎 (runtime.js ~1.2MB)
│   │   │   ├── gameStore/      # 数据存储层 (SQLite + JSON)
│   │   │   ├── _secondary/     # 辅助服务 (聊天/网关/图片)
│   │   │   ├── common/         # MachoNet 序列化原语
│   │   │   └── utils/          # 工具类
│   │   ├── scripts/            # 验证脚本 (48 个 .js)
│   │   └── externalservices/   # 外部服务
│   ├── _local/                 # 运行时数据 (gitignored, 141 子目录)
│   └── tools/
│       └── DatabaseCreator/    # 数据库创建工具
│           └── staticTables/   # 静态数据表 (30 个目录)
│
├── Doc/                        # 分析文档（通用模块/功能总结）
│   ├── EveJS_Project_Overview.md        # 项目概述、版本对比、流程、模块
│   ├── Loot_Wreck_System_Analysis.md    # 掉落与残骸系统分析
│   ├── Service_Modules_Reference.md     # 服务模块参考手册
│   ├── Mission_Agent_System_Analysis.md # 任务/代理系统分析
│   └── Debug_Commands_Reference.md      # 调试命令参考
│
├── Issue/                      # 问题跟踪（具体问题描述与修复）
│   ├── README.md               # 问题跟踪指导 + 未来目标
│   ├── 001-wreck-loot-not-pickable.md   # 问题 #001
│   └── 002-missing-storyline-missions.md# 问题 #002
│
├── Movie/                      # 测试录像（CCP vs EveJS 对比）
└── Tmp/                        # 历史版本对比文件 (gitignored)
```

### 关键规模数据

| 指标 | 数值 |
|------|------|
| 服务目录数 | 70 |
| *Service.js 文件数 | 206 |
| 静态表目录数 | 30 |
| 运行时数据目录数 | 141 |
| 验证脚本数 | 48 |
| 最大源文件 | runtime.js ~1.2 MB |

---

## 三、文档编写规则

> **编写任何文档时必须遵守以下规则。**

### 3.1 文档定位

| 目录 | 定位 | 内容范围 |
|------|------|---------|
| `Doc/` | **通用总结** | 项目、模块、功能、流程的描述性文档。不涉及具体问题的分析或修复。 |
| `Issue/` | **问题跟踪** | 具体 BUG/问题的完整描述：背景、复现条件、根因、修复方案。 |
| `Issue/README.md` | **指导纲领** | 问题跟踪的管理规范、报告模板、未来目标。不描述具体问题。 |
| `CLAUDE.md` | **项目总览** | 全局性信息：架构、约定、规则。引用其他文档，不重复内容。 |

### 3.2 核心原则

1. **独立性**: 每个文档相对独立，读者无需跨文件拼凑信息
2. **不重复**: 同一信息只在一处详细描述，其他位置引用链接
3. **Doc 讲通用**: Doc 目录下的文档只描述"系统长什么样"，不问"为什么坏了"
4. **Issue 讲具体**: Issue 目录下的文档只描述"某个问题是什么、怎么修"
5. **举例精简**: 用 1-2 个代表性例子说明，不穷举
6. **代码引用**: 文档中的代码示例/信息来源必须参照项目实际内容，不凭空编造

### 3.3 不应该做的事

- ❌ 在 Doc 文档中分析具体 BUG 的根因
- ❌ 在 Issue 文档中重复系统的通用描述（引用 Doc 链接即可）
- ❌ 在 CLAUDE.md 中大段复制其他文档内容
- ❌ 记录完整的 Git 提交历史（用命令查）

---

## 四、核心架构

### 4.1 服务系统架构

项目采用 CCP 原版的 `EVEServiceManager` 模式：

```
ServiceManager
├── register(name, service)      // 注册服务
├── lookup(name)                 // 查找服务
├── registerAlias(alias, name)   // 注册别名
└── registerBoundObject(oid, svc)// 绑定对象 OID
```

- **`BaseService`** (`services/baseService.js`): 所有服务的基类，自动将 RPC 调用分发到子类方法
- **`ServiceManager`** (`services/serviceManager.js`): 服务注册中心，管理命名服务和绑定对象 OID
- **服务发现**: 启动时递归扫描 `services/` 下所有 `*Service.js` 自动注册

### 4.2 服务器启动流程

```
1. 安装进程生命周期日志
2. 加载配置 (优先级: 默认值 < evejs.config.json < evejs.config.local.json < EVEJS_* 环境变量)
3. database.preloadAll() — SQLite + JSON 加载到内存缓存
4. ensureCoreFixtures() — 引导角色/公司/联盟
5. loadServices() — 注册所有 *Service.js
6. loadSecondaryServices() — 辅助服务 (聊天/网关/图片)
7. 虫洞数据填充 (如启用)
8. 总览 MOTD 引导
9. 启动账单维护
10. 启动存在态协调器
11. 启动 TCP 服务器 (MachoNet 协议, 默认端口 26000)
```

### 4.3 数据存储层 (gameStore)

```
gameStore (统一 read/write/remove API)
├── 内存缓存 (所有表启动时加载)
├── SQLite 后端 (运行时可变表)
│   ├── npcEntities, npcModules, npcCargo
│   ├── npcWrecks, npcWreckItems
│   ├── items, characters, accounts
│   └── _persistence_outbox (持久化日志)
└── JSON 后端 (静态/SDE 数据)
    ├── npcLootTables, npcProfiles, npcLoadouts
    ├── npcSpawnPools, npcSpawnGroups
    ├── itemTypes (SDE)
    ├── missionAuthority, agentAuthority, dungeonAuthority (← 任务/代理系统)
    └── 运行时数据镜象 (_local/gameStore/data/)
```

**运行时读取路径优先级**:
1. `_local/gameStore/data/<表>/data.json`（gitignored，服务器实际读取）
2. `server/src/gameStore/data/<表>/data.json`（gitignored）
3. `tools/DatabaseCreator/staticTables/<表>/data.json`（静态源数据）

> 运行时数据需通过 `tools/DatabaseCreator/CreateDatabase.bat` 从静态表重新生成。

**写入机制**: 立即更新内存缓存 → 标记 dirty → 2秒防抖后异步写入磁盘

---

## 五、关键子系统

### 5.1 网络层 (network/)

- **TCP 服务器**: `tcp/index.js` — MachoNet 二进制协议
- **握手**: `tcp/handshake.js`
- **数据包分发**: `packetDispatcher.js`
- **会话**: `clientSession.js` — 维护角色/空间状态
- **MachoNet 原语**: `common/pyPacket.js`, `common/pyTypes.js`, `common/marshalStringTable.js`

### 5.2 空间模拟层 (space/)

#### 核心文件
| 文件 | 功能 |
|------|------|
| `runtime.js` | 空间运行时（实体生成/移除/广播）|
| `destiny.js` | 命运权威（移动/位置/气泡）|
| `worldData.js` | 世界数据 |
| `shipDestruction.js` | 飞船销毁（玩家船 + NPC 残骸）|
| `transitions.js` | 场景切换 |
| `wreckUtils.js` | 残骸类型解析工具 |

#### NPC 系统 (space/npc/)

> 详细分析: 见 `Doc/Loot_Wreck_System_Analysis.md`

| 文件 | 功能 |
|------|------|
| `nativeNpcService.js` | NPC 创建/管理 |
| `nativeNpcStore.js` | NPC 数据存储 (allocate/upsert/list) |
| `nativeNpcWreckService.js` | **残骸创建 + 物品转移核心** |
| `npcLoot.js` | **掉落生成算法** |
| `npcData.js` | NPC 数据索引 (掉落表/配置文件查询) |
| `npcBehaviorLoop.js` | NPC AI 行为循环 |
| `beltRatRuntime.js` | 小行星带海盗生成 |

#### 战斗系统 (space/combat/)
| 文件 | 功能 |
|------|------|
| `damage.js` | 伤害计算 |
| `laserTurrets.js` | 激光炮塔（含击杀检测）|
| `weaponDogma.js` | 武器属性 |
| `killmailTracker.js` | 击杀邮件 |

#### 模块系统 (space/modules/)
| 文件 | 功能 |
|------|------|
| `salvagerRuntime.js` | 打捞器 |
| `tractorBeamRuntime.js` | 牵引光束 |
| `hostileModuleRuntime.js` | 敌对模块 (扰断/扰频/网子) |
| `superweaponRuntime.js` | 超级武器 |

### 5.3 任务 / 代理系统（Mission/Agent）

> 详细分析: 见 `Doc/Mission_Agent_System_Analysis.md`

#### 核心服务（`server/src/services/agent/`）
| 文件 | 功能 |
|------|------|
| `agentMgrService.js` | agentMgr 主服务 |
| `agentMissionRuntime.js` (~6196行) | 主任务运行时 |
| `missionAuthority.js` (~933行) | 任务权限 & 门控 |
| `missionRuntimeState.js` (~1602行) | 角色任务进度 |
| `storylineAgentSelector.js` (~258行) | BFS 搜索最近剧情代理 |
| `epicArcStatusService.js` | 史诗弧状态 |
| `missionTrackerMgrService.js` | 任务日志 / 追踪器 |

---

## 六、配置系统

配置项定义在 `config/index.js` 的 `CONFIG_ENTRY_DEFINITIONS` 数组中。

**优先级**: 代码默认值 < `evejs.config.json` < `evejs.config.local.json` < `EVEJS_*` 环境变量

---

## 七、开发注意事项

### 7.1 代码风格
- 使用 `path.join(__dirname, ...)` 构建相对路径
- 服务文件命名: `<name>Service.js` (大写 S)
- 文件开头有 JSDoc 注释说明模块功能
- 使用 `require()` 动态加载避免循环依赖

### 7.2 数据持久化
- SQLite 表通过 `persistenceWorker.js` 异步写入
- v0.12.2 新增 `_persistence_outbox` 表实现写入日志
- JSON 表直接序列化写入
- `transient: true` 的实体不持久化到磁盘

### 7.3 静态数据 vs 运行时数据
- **静态数据** (`tools/DatabaseCreator/staticTables/`, 30 个目录): 不随游戏变化
- **运行时数据** (`_local/gameStore/`, 141 个子目录): 随游戏进行变化
- `_local/` 和 `server/src/gameStore/data/` 均被 `.gitignore` 排除
- 需通过 `tools/DatabaseCreator/CreateDatabase.bat` 重新生成

### 7.4 静态表功能清单

| 目录 | 功能 |
|------|------|
| agentAuthority | NPC 代理定义（派系/星系/空间站关联）|
| missionAuthority | 任务/史诗弧数据 |
| dungeonAuthority | Dungeon/站点模板 |
| npcProfiles | NPC 实体档案（名称/描述/派系）|
| npcLootTables | NPC 残骸掉落表 |
| npcLoadouts | NPC 舰船装备配置 |
| npcSpawnPools | NPC 生成池（聚合生成组）|
| npcSpawnGroups | NPC 生成组（共同出现的 NPC）|
| npcBehaviorProfiles | NPC 行为 AI 配置 |
| npcHostileUtilities | NPC 敌对效用模板（按派系分组）|
| npcStandingsAuthority | NPC 声望/派系声望权威 |
| npcStartupRules | 星系场景创建时的 NPC 生成规则 |
| asteroidTypesBySolarSystemID | 星系-矿石类型映射 |
| capitalNpcAuthority | 旗舰 NPC 权限定义 |
| clientEntityStandings | 声望计算用的实体类型 ID |
| evermarksCatalog | EverMarks 纹章/舰船 logo 元数据 |
| expertSystems | 专家系统定义（技能授予/舰船类型）|
| explorationAuthority | 探索站点/合同权威 |
| explorationWormholeStatic | 虫洞静态数据（漫游者+静态配置文件）|
| fighterAbilities | 铁骑（航母/无畏）能力定义 |
| newEdenStore | 新 Eden 商城权威 |
| reprocessingClientRandomizedMaterial | 随机化精炼产出材料 |
| shipInsurancePrices | 舰船保险价格（来自 ESI）|
| skillTrainingAlphaCaps | Alpha 克隆技能训练上限 |
| stargateVisualOverrides | 星门视觉皮肤覆盖 |
| stationDockingPlacements | 空间站停靠点位置/朝向 |
| stationGraphicLocators | 空间站模型图形定位器 |
| stationStandingsRestrictions | 空间站声望准入限制 |
| structureGraphicLocators | 玩家建筑图形定位器 |
| trigDrifterSpawnAuthority | Triglavian 漂移者生成位置 |

---

## 八、常用命令

### 启动服务器
```bash
cd Code
StartServer.bat           # 普通模式
StartServerDebug.bat      # 调试模式
```

### 数据库操作
```bash
# 创建/重建数据库（默认清洗开启）
cd Code/tools/DatabaseCreator
CreateDatabase.bat

# 保留 eve-survival 内容（关闭清洗）
CreateDatabase.bat --force --keep-community-content

# 数据库迁移（JSON → SQLite）
cd Code/server
node src/gameStore/migrateJsonToSqlite.js <table_name>
```

### 运行验证脚本
```bash
cd Code
node server/scripts/verifyDestinyAuthorityCore.js
```

---

## 九、文档索引

| 文档 | 内容 |
|------|------|
| `Doc/EveJS_Project_Overview.md` | 项目概述、版本对比、流程、功能模块 |
| `Doc/Loot_Wreck_System_Analysis.md` | 掉落表、掉落算法、残骸生命周期、拾取流程 |
| `Doc/Service_Modules_Reference.md` | 服务模块参考 |
| `Doc/Mission_Agent_System_Analysis.md` | 任务/代理/史诗弧系统分析 |
| `Doc/Debug_Commands_Reference.md` | 调试命令参考 |
| `Issue/README.md` | 问题跟踪指导 + 未来目标 |

---

## 十、EVE 原版服务对照

> 对比 EveJS 与 CCP 原版 EVE Online 的服务实现。原版服务名来源于 EVE Online 客户端代码中的服务注册名称（可通过客户端反编译/社区文档获取）。

| 系统 | 原版服务名 | EveJS 实现 | 状态 |
|------|-----------|-----------|------|
| 任务代理 | `agentMgr` | `agent/agentMgrService.js` ✅ | 数据链路待修复 |
| 任务日志 | `missionTrackerMgr` | `agent/missionTrackerMgrService.js` ✅ | 部分 |
| 史诗弧 | `epicArcStatus` | `agent/epicArcStatusService.js` ✅ | 数据待修复 |
| 职业代理 | `careerAgents` | `account/tutorialSvcService.js` | 未独立服务 |
| 教程(AIR/NPE) | `tutorial` | `services/npe/tutorialRuntime.js` | 部分 |
| 登录活动 | `loginCampaign` | `campaign/loginCampaignService.js` ✅ | 部分 |
| 配置管理系统 | `config` | `src/config/index.js` (~2650行) ✅ | 完整 |

**代理类型（原版 `agentTypeID`）**:
| typeID | 含义 | 数量 |
|--------|------|------|
| 2 | 普通安全代理 (Encounter) | 8,751 |
| 6 | 通用剧情 (Generic Storyline) | 651 |
| 7 | 剧情 (Storyline) | 11 |
| 10 | 类剧情 | 47 |

---
