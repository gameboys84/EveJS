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
├── README.md                   # 项目对外说明
├── LICENSE                     # 许可证
│
├── Code/                       # 当前开发版本 (原 v0.12.2)
|   ├── evejs.config.local.json # 本地配置（最高优先级）
│   ├── server/                 # 服务器主目录
│   │   ├── index.js            # 入口文件
│   │   ├── src/
│   │   │   ├── config/         # 配置系统 (index.js ~2650行)
│   │   │   ├── network/        # TCP/MachoNet 网络层
│   │   │   ├── services/       # 游戏服务 (~70+ 目录, ~500+ 文件)
│   │   │   ├── space/          # 空间模拟引擎
│   │   │   ├── gameStore/      # 数据存储层 (SQLite + JSON)
│   │   │   ├── _secondary/     # 辅助服务 (聊天/网关/图片)
│   │   │   ├── common/         # MachoNet 序列化原语
│   │   │   └── utils/          # 工具类
│   │   ├── scripts/            # 验证/一致性测试脚本 (~48个)
│   │   ├── externalservices/   # 外部服务
│   │   └── ...
│   └── tools/
│       └── DatabaseCreator/    # 数据库创建工具
│           └── staticTables/   # 静态数据表 (npcLootTables, npcProfiles 等)
│
├── Doc/                        # 项目分析文档
│   ├── EveJS_Project_Overview.md        # 项目概述、版本对比、流程、模块
│   ├── Loot_Wreck_System_Analysis.md    # 掉落与残骸系统深度分析
│   ├── Service_Modules_Reference.md     # 服务模块参考手册
│   ├── Mission_Agent_System_Analysis.md # 剧情任务/代理/史诗弧系统深度分析
│   └── Debug_Commands_Reference.md      # 调试命令参考
│
└── Issue/                      # 问题跟踪
    ├── README.md               # 问题索引 + 报告模板
    ├── 001-wreck-loot-not-pickable.md   # 已知问题 #001
    └── 002-missing-storyline-missions.md# 已知问题 #002
```

### 版本管理约定

- `Code/` 目录 = 当前最新开发版本（如 v0.12.2）
- 旧版本通过 Git 分支记录管理

---

## 三、核心架构

### 3.1 服务系统架构

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

### 3.2 服务器启动流程

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

### 3.3 数据存储层 (gameStore)

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
1. `_local/gameStore/data/<表>/data.json`（`_local/` 被 `.gitignore`，是服务器实际读取的路径）
2. `server/src/gameStore/data/<表>/data.json`（同样被 `.gitignore`）
3. `tools/DatabaseCreator/staticTables/<表>/data.json`（静态源数据）

> 运行时数据需通过 `tools/DatabaseCreator/CreateDatabase.bat` 从静态表重新生成。

**⚠️ 剧情任务数据问题（v0.12.2 已知问题 #002）**:
- `agentAuthority/data.json` 中所有 10,941 个 agent 的 `missionTemplateIDs` 为空（`missionTemplateCount: 0`）
- Git 提交 `fc00f8d` ("supplement v0.12.1") 中包含 640 个模板 / 1.46M 引用的填充版本
- 当前 HEAD 丢失了这部分数据，导致剧情任务不可用

**写入机制**: 立即更新内存缓存 → 标记 dirty → 2秒防抖后异步写入磁盘

---

## 四、关键子系统

### 4.1 网络层 (network/)

- **TCP 服务器**: `tcp/index.js` — MachoNet 二进制协议
- **握手**: `tcp/handshake.js`
- **数据包分发**: `packetDispatcher.js`
- **会话**: `clientSession.js` — 维护角色/空间状态
- **MachoNet 原语**: `common/pyPacket.js`, `common/pyTypes.js`, `common/marshalStringTable.js`

### 4.2 空间模拟层 (space/)

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
| 文件 | 功能 |
|------|------|
| `nativeNpcService.js` | NPC 创建/管理 |
| `nativeNpcStore.js` | NPC 数据存储 (allocate/upsert/list) |
| `nativeNpcWreckService.js` | **残骸创建 + 物品转移核心** |
| `npcLoot.js` | **掉落生成算法** |
| `npcData.js` | NPC 数据索引 (掉落表/配置文件查询) |
| `npcBehaviorLoop.js` | NPC AI 行为循环 |
| `beltRatRuntime.js` | 小行星带海盗生成 |
| `capitalNpcCatalog.js` | 旗舰 NPC 目录 |
| `empireSecurityNpcCatalog.js` | Concord NPC 目录 |
| `trigDrifterNpcCatalog.js` | Triglavian NPC 目录 |

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

### 4.3 NPC 掉落与残骸系统（重点）

#### 掉落生成流程
```
NPC 死亡 → destroyNativeNpcEntityWithWreck()
  → getNpcLootTable(npcRecord.lootTableID) 查询掉落表
  → rollNpcLootEntries(lootTable) 生成掉落
    → 检查 emptyChance (空残骸概率)
    → 按 selectors 加权随机选择物品
    → 过滤: 排除 wreck 组/蓝图/T2/特殊等级(除非允许)
  → buildNativeWreckItemRecord() 写入残骸
```

#### 残骸数据结构
```javascript
// npcWrecks 表
{ wreckID, sourceEntityID, systemID, lootTableID, typeID, position, ownerID, ... }

// npcWreckItems 表
{ wreckItemID, wreckID, typeID, quantity, singleton, sourceKind: "cargo"|"loot", moduleState, volume }
```

#### 拾取流程
```
玩家打开残骸 → invBrokerService._moveSourceItemToDestination()
  → sourceKind === "nativeWreck"
  → nativeNpcWreckService.transferNativeWreckItemToCharacterLocation()
    → 验证归属 → 检查数量 → grantItemToCharacterLocation() 添加到玩家货舱
    → 从残骸移除物品 → 刷新残骸状态
```

#### 掉落表类型
| 掉落表 | 模式 | 品质限制 |
|--------|------|---------|
| `generic_random_any` | 全池随机 | 无限制 (可能出高价值) |
| `loot_belt_normal_small` | rule 模式 | 低品质/小型 |
| `loot_belt_normal_medium` | rule 模式 | 低品质/中型 |
| `loot_belt_normal_large` | rule 模式 | 低品质/大型 |

### 4.4 任务 / 代理系统（Mission/Agent）

> **详细分析**: 见 `Doc/Mission_Agent_System_Analysis.md` | **已知问题**: `Issue/002-missing-storyline-missions.md`

#### 核心服务（`server/src/services/agent/`）
| 文件 | 功能 |
|------|------|
| `agentMgrService.js` | agentMgr 主服务：GetAvailableMissionsFromSupplier、GetMissionBriefingInfo、WarpToLocation |
| `agentMissionRuntime.js` (~6060行) | 主任务运行时：offerMission、任务选择、掉落生成 |
| `missionAuthority.js` | 任务权限 & 门控（listMissionIDsForAgent、isOrdinarySecurityAgent、sanitizePayload）|
| `missionRuntimeState.js` | 角色任务进度：storylineProgress、epicArcProgress、退休清理 |
| `storylineAgentSelector.js` | BFS 搜索最近同阵营剧情代理 |
| `epicArcStatusService.js` | 史诗弧状态 |
| `missionTrackerMgrService.js` | 任务日志 / 追踪器 |

#### 相关服务（跨目录）
| 文件 | 功能 |
|------|------|
| `services/campaign/loginRewardFacilitiesService.js` | 登录奖励 |
| `services/campaign/loginCampaignService.js` | 登录活动 |
| `services/campaign/crateService.js` | 箱子 / 战利品箱 |
| `services/agency/customAgencyProviderService.js` | 自定义代理提供者 |
| `services/account/tutorialSvcService.js` | 职业代理 (GetCareerAgents) |
| `services/npe/tutorialRuntime.js` | AIR/NPE 教程运行时 |
| `services/npe/tutorialHandoff.js` | 教程交接 |

#### 任务提供流程
```
玩家访问 Agent NPC → agentMgrService.Handle_GetAvailableMissionsFromSupplier
  → missionAuthority.listMissionIDsForAgent(agentRecord)
    → isOrdinarySecurityAgent?  ← v0.12.2 新增 deny-by-default 门控
      - YES: 仅 golden 任务 (4个 L1) + agent-specific 任务可通过
      - NO:  走剧情/史诗弧/研究分支
    → sanitizePayload() 清洗退休/禁用记录
  → 每个 missionID 加入候选池
  → 通过 storylineAgentSelector 发现剧情代理
```

#### 静态数据表（`tools/DatabaseCreator/staticTables/`）
| 表 | 内容 | 剧情相关计数 | 版本差异 |
|----|------|-------------|---------|
| `missionAuthority/data.json` (15MB) | 2,878 个任务 | 1,249 storyline + 263 genericStoryline + 276 epicArc + 74 heraldry | 稳定 |
| `agentAuthority/data.json` | 10,941 个代理 | 662 剧情代理 (agentTypeID=6/7) | ⚠️ HEAD: missionTemplateCount=0; fc00f8d: 640 模板 / 1.46M 引用 |
| `dungeonAuthority/data.json` | dungeon 模板 | 5,981 模板 | 稳定 |

> 运行时镜像: `_local/gameStore/data/<表>/data.json`（服务器实际读取的路径）
> ⚠️ **已知问题 #002**: 当前 HEAD 的 `agentAuthority` 模板为空。Git 提交 `fc00f8d` 包含填充版本（640 模板）。

#### 运行时数据表（SQLite，`server/src/gameStore/index.js`）
| 表 | 内容 |
|----|------|
| `missionRuntimeState` | 角色活任务/提供/接受/完成记录 |
| `dungeonRuntimeState` | 活 dungeon 实例 |

#### 制造任务策略（v0.12.2 新增）
配置文件: `server/src/config/productionMissionPolicy.json`
| 字段 | 值 | 说明 |
|------|----|------|
| `goldenSecurityMissions` | 4 个 L1 任务 (1182/2504/2925/13735) | 普通安全代理仅可提供这些 |
| `disabledMissions` | 1 个 (4743) | 禁用的 eve-survival 任务 |
| `retiredTemplatePrefixes` | `["eve-survival:"]` | 退休模板前缀 — **会过滤几乎所有剧情模板** |
| `generatedMissionIDRange` | 900000000–901000000 | 生成任务 ID 范围（视为合成/退休）|

构建时清洗: `tools/DatabaseCreator/production-mission-policy.js` 会清空 agent 的 `missionTemplateIDs` 和 dungeon 模板池。

#### 剧情任务数据标志（missionAuthority 中）
```
isStoryline / isGenericStoryline / isEpicArc / isHeraldry
isResearch / isAgentInteraction / isTalkToAgent
→ isScriptedMissionRecord() 判断是否为"脚本任务"
```

#### agentTypeID 含义
| typeID | 含义 | 数量 |
|--------|------|------|
| 2 | 普通安全代理 | 8,751 |
| 6 | 通用剧情 (GENERIC_STORYLINE) | 651 |
| 7 | 剧情 (STORYLINE) | 11 |
| 8 | 其他 | 696 |
| 10 | 类剧情 | — |

`importantMission: true` 当 `[6,7,10].includes(agentTypeID)`。

---

## 五、配置系统

配置项定义在 `config/index.js` 的 `CONFIG_ENTRY_DEFINITIONS` 数组中。

**优先级**: 代码默认值 < `evejs.config.json` < `evejs.config.local.json` < `EVEJS_*` 环境变量

### 关键配置项
| 键 | 默认值 | 说明 |
|----|--------|------|
| `clientVersion` | "24.01" | 客户端版本 |
| `clientBuild` | 3396210 | 客户端构建号 |
| `serverPort` | 26000 | 服务器端口 |
| `gameServerBindHost` | "127.0.0.1" | 绑定地址 |
| `devAutoCreateAccounts` | false | 自动创建账户 |
| `devSkipPasswordValidation` | false | 跳过密码验证 |
| `skillTrainingSpeed` | 1.0 | 技能训练速度 |
| `industrySystemCostIndex` | 0.04 | 工业成本指数 |
| `wormholesEnabled` | true | 启用虫洞 |
| `spaceDebrisLifetimeMs` | 3600000 | 碎片生命周期 |
| `beltRatSpawnChance` | 0.7 | 海盗生成几率 |
| `tidiAutoscaler` | true | 启用 TiDi |

---

## 六、开发注意事项

### 6.1 代码风格
- 使用 `path.join(__dirname, ...)` 构建相对路径
- 服务文件命名: `<name>Service.js` (大写 S)
- 文件开头有 JSDoc 注释说明模块功能
- 使用 `require()` 动态加载避免循环依赖

### 6.2 NPC 残骸物品流向（易踩坑）
1. `nativeNpcStore.allocateWreckID()` → 分配 ID
2. `nativeNpcStore.upsertNativeWreck()` → 写入残骸记录
3. `nativeNpcStore.buildNativeCargoItems()` → 从 NPC 货物生成掉落
4. `npcLoot.rollNpcLootEntries()` → 按掉落表生成战利品
5. `nativeNpcStore.upsertNativeWreckItem()` → 写入残骸物品
6. `spaceRuntime.spawnDynamicEntity()` → 生成空间实体

**注意**: `buildNativeWreckRuntimeEntity()` 中 `isEmpty` 标志在实体生成时设置，如果后续物品写入有异步延迟，可能导致 `isEmpty` 错误。

### 6.3 数据持久化
- SQLite 表通过 `persistenceWorker.js` 异步写入
- v0.12.2 新增 `_persistence_outbox` 表实现写入日志
- JSON 表直接序列化写入
- `transient: true` 的实体不持久化到磁盘

### 6.4 静态数据 vs 运行时数据
- **静态数据** (`tools/DatabaseCreator/staticTables/`): NPC 掉落表、配置文件、装备等，不随游戏变化
- **运行时数据** (`_local/gameStore/`): NPC 实体、残骸、物品等，随游戏进行变化
- **运行时读取路径**: `_local/gameStore/data/<tableKey>/data.json`（优先）→ `server/src/gameStore/data/<tableKey>/data.json`
- **重要**: `_local/` 和 `server/src/gameStore/data/` 均被 `.gitignore` 排除 — 需通过 `tools/DatabaseCreator/CreateDatabase.bat` 重新生成

### 6.5 版本对比排查方法论（回归分析通用流程）

当某功能在版本间"消失"时，按以下顺序排查：

**重要：本项目的 Git 版本说明**
- Git 仓库创建于 **v0.12.2**（初始提交）
- 之后通过 `fc00f8d` 提交了"supplement v0.12.1"来**补充** v0.12.1 的数据
- 因此提交时间线上 v0.12.1 数据在 v0.12.2 之后，但内容为更早版本
- **始终用 `git show <commit>:<file>` 验证具体内容，不要信任提交信息**

**第一步：确认代码文件是否被删除**
```bash
# 文件对比
git diff <commit_a> <commit_b> --name-only | grep -i <关键词>
# 检查服务是否注册（服务通过 *Service.js 文件名自动加载，无白名单）
grep -r "Service.js" server/index.js
```

**第二步：确认静态数据是否被删除/清空**
```bash
# 静态表 diff
git diff <commit_a> <commit_b> --stat -- tools/DatabaseCreator/staticTables/
# 检查运行时镜像是否 gitignored（需从静态表重新生成）
cat .gitignore | grep gameStore
# 直接检查具体提交的文件内容
git show fc00f8d:tools/DatabaseCreator/staticTables/agentAuthority/data.json | grep missionTemplateCount
```

**第三步：定位运行时逻辑变化**
```bash
# 关注文件
git diff <commit_a> <commit_b> --name-only | grep -iE "mission|agent|campaign|storyline|config"
# 策略文件（v0.12.2 新增 deny-by-default 门控的核心）
cat server/src/config/productionMissionPolicy.json
```

**第四步：检查构建时数据链路**
```bash
# 查看关键文件的 diff（了解模板清空的原因）
git diff fc00f8d..HEAD -- tools/DatabaseCreator/database-creator.js
git show HEAD:server/src/gameStore/index.js | grep -A5 "resolveDataDir\|LOCAL_DATA_DIR"
```

**关键原则**：
- 服务"不工作"≠"被删除" — 可能是数据被清空、运行时门控过滤、模板池断裂
- **数据/策略驱动** 比代码删除更常见（本项目的 `productionMissionPolicy.json` 就是例子）
- 静态表可能被 `*-policy.js` 脚本清洗，需同时检查构建时和运行时逻辑
- `_local/gameStore/data/` 中的运行时镜像是 gitignored 的，可能在提交间变化
- **版本可用性判断首先要看 git 实际内容而非提交信息标签**

---

## 七、已知问题

| 编号 | 问题 | 状态 | 详情 |
|------|------|------|------|
| #001 | v0.12.2 残骸无法拾取物品 | 🔍 待验证 | 见 `Issue/001-wreck-loot-not-pickable.md` |
| #002 | v0.12.2 剧情任务(Storyline)全部消失 | 🔍 已定位根因 | 见 `Issue/002-missing-storyline-missions.md` |

---

## 八、常用命令

### 启动服务器
```bash
cd Code
# 普通模式
node server/index.js
# 调试模式
node --inspect server/index.js
```

### 数据库迁移
```bash
cd Code
node server/src/gameStore/migrateJsonToSqlite.js <table_name>
```

### 运行验证脚本
```bash
cd Code
node server/scripts/verifyDestinyAuthorityCore.js
```

---

## 九、分析文档索引

| 文档 | 内容 |
|------|------|
| `Doc/EveJS_Project_Overview.md` | 完整项目概述、版本差异、启动流程、功能模块、掉落系统分析 |
| `Doc/Loot_Wreck_System_Analysis.md` | 掉落表结构、掉落算法、残骸生命周期、拾取流程、bug 分析 |
| `Doc/Service_Modules_Reference.md` | 全部服务模块参考、数据存储层、网络层、配置系统 |
| `Doc/Mission_Agent_System_Analysis.md` | 任务/代理/史诗弧系统深度分析、v0.12.1→v0.12.2 变更、根因、修复方案 |
| `Doc/Debug_Commands_Reference.md` | 调试命令参考 |
| `Issue/README.md` | 问题跟踪索引、报告模板 |
| `Issue/001-wreck-loot-not-pickable.md` | 残骸无法拾取 (问题 #001) |
| `Issue/002-missing-storyline-missions.md` | 剧情任务消失 (问题 #002) |

---

## 十、EVE 原版服务对照

> 对比 EveJS 与 CCP 原版 EVE Online 的服务，帮助识别功能缺口。

| 系统 | 原版服务名 | EveJS 实现 | 状态 |
|------|-----------|-----------|------|
| 任务代理 | `agentMgr` | `agent/agentMgrService.js` ✅ | 数据链路待修复 |
| 任务日志 | `missionTrackerMgr` | `agent/missionTrackerMgrService.js` ✅ | 部分 |
| 任务运行时 | 内嵌 | `agent/agentMissionRuntime.js` ✅ | 核心完整 |
| 史诗弧 | `epicArcStatus` | `agent/epicArcStatusService.js` ✅ | 数据待修复 |
| 职业代理 | `careerAgents` | `account/tutorialSvcService.js` | 未独立服务 |
| 教程(AIR/NPE) | `tutorial` | `services/npe/tutorialRuntime.js` | 部分 |
| 机会系统 | `opportunity` | ❌ 不存在 | 原版已退役，符合预期 |
| 登录活动 | `loginCampaign` | `campaign/loginCampaignService.js` ✅ | 部分 |
| 日志奖励 | `loginRewardFacilities` | `campaign/loginRewardFacilityService.js` ✅ | 部分 |
| 活动箱子 | `crate` / `pkg` | `campaign/crateService.js` ✅ | 部分 |
| 自定义代理 | `agency` | `agency/customAgencyProviderService.js` ✅ | 部分 |
| 制造任务策略 | `lageErrorPacket` | `config/productionMissionPolicy.json` | v0.12.2 新增 |
| 配置管理系统 | `config` | `src/config/index.js` (~2650行) ✅ | 完整 |

**代理类型（原版 `agentTypeID`）**:
| typeID | 原版含义 | EveJS 数量 |
|--------|---------|-----------|
| 1 | 研究 (Research) | — |
| 2 | 普通安全 (Encounter) | 8,751 |
| 3 |  Mining | — |
| 4 | 顾问 (Consultant) | — |
| 5 | 研究 (Research) | — |
| 6 | 通用剧情 (Generic Storyline) | 651 |
| 7 | 剧情 (Storyline) | 11 |
| 8 | 其他 | 696 |
| 9 | 故事代理 | — |
| 10 | 类剧情 | 见 agentAuthority |

---

## 十一、Git 分支与提交速查

### 版本说明
```
Git 仓库创建于 v0.12.2（a064ab9 Initial commit）
之后通过 fc00f8d 提交 "supplement v0.12.1" 补充了 v0.12.1 的数据
⚠️ 提交时间线上 v0.12.1 数据在 v0.12.2 之后，但内容为更早的 v0.12.1 版本
```

**本地提交 (从早到晚)**:
```
0e7dd95   Initial commit                     — 初始提交（基于 v0.12.2 代码）
a064ab9   "UpdateVersion : v0.12.2"           — v0.12.2 标记；agentAuthority 模板为空
fc00f8d   "supplement v0.12.1"                — 补充 v0.12.1 数据（640 模板 / 1.46M 引用）← 剧情任务可用版本
711ee84   update README                      — 模板数据在此提交后丢失
e6c3373   Add Debug_Commands doc (HEAD)       — 当前版本（agentAuthority 模板为空 = 问题 #002）
```

### 版本对比常用命令
```bash
# 查看提交历史（含日期，确认内容而非标签）
git log --oneline --all --decorate

# 两个提交间的文件差异
git diff fc00f8d HEAD --stat
git diff fc00f8d HEAD --name-only

# 只看某个文件/目录的变化
git diff fc00f8d HEAD -- server/src/services/agent/
git diff fc00f8d HEAD -- tools/DatabaseCreator/staticTables/ --stat

# 查看某个文件在不同提交的内容（找填充数据版本）
git show fc00f8d:tools/DatabaseCreator/staticTables/agentAuthority/data.json | head -50
git show HEAD:tools/DatabaseCreator/staticTables/agentAuthority/data.json | head -50

# 恢复填充数据版本
git show fc00f8d:tools/DatabaseCreator/staticTables/agentAuthority/data.json \
  > tools/DatabaseCreator/staticTables/agentAuthority/data.json

# 查看某提交的信息
git show --stat a064ab9
git show --stat fc00f8d

# 重新生成运行时数据
cd Code && tools/DatabaseCreator/CreateDatabase.bat
```

### 关键文件版本对照表
```
文件                                          fc00f8d (v0.12.1 补充)         HEAD (v0.12.2 当前)
--------------------------------------------- ------------------------------  ------------------------------
staticTables/agentAuthority/data.json         1,896,106 行 (640 模板)         423,082 行 (0 模板) ← 问题 #002 主因
server/src/config/productionMissionPolicy.js  不存在                          存在
server/src/services/agent/missionAuthority.js 无门控逻辑                      有 deny-by-default 门控
missionRuntimeState.js                        无退休清理                      有 isRetiredMissionRuntimeRecord 清理
```
