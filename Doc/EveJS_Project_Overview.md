# EveJS 项目概述与开发版本对比分析

## 一、项目简介

**EveJS** 是一个 EVE Online 服务器的本地模拟器（Server Emulator），目标客户端版本为 **24.01 (build 3396210, 2026年6月)**。

### 技术栈
- **运行时**: Node.js
- **网络协议**: MachoNet 二进制协议 (TCP)
- **持久化**: SQLite（运行时表）+ JSON（静态数据/SDE）
- **客户端目标**: EVE Online 24.01 build 3396210

### 项目结构
```
EveJS-v0.X/
├── server/                  # 服务器主目录
│   ├── index.js             # 入口文件
│   ├── src/
│   │   ├── config/          # 配置系统
│   │   ├── network/         # TCP/MachoNet 网络层
│   │   ├── services/        # 游戏服务 (~70+ 服务目录)
│   │   ├── space/           # 空间模拟引擎
│   │   ├── gameStore/       # 数据存储层
│   │   ├── _secondary/      # 辅助服务 (聊天/网关/图片)
│   │   ├── common/          # MachoNet 序列化原语
│   │   └── utils/           # 工具类
│   ├── scripts/             # 验证/一致性测试脚本
│   ├── externalservices/    # 外部服务
│   └── tools/               # 工具
├── tools/
│   └── DatabaseCreator/     # 数据库创建工具
│       └── staticTables/    # 静态数据表
├── doc/                     # 项目文档
└── evejs.config.local.json  # 本地配置
```

---

## 二、v0.12.1 与 v0.12.2 版本差异对比

### 2.1 新增文件 (v0.12.2)

| 文件 | 说明 |
|------|------|
| `server/src/services/account/billingMaintenance.js` | 启动时账单维护处理 |
| `server/src/services/dogma/activationHeatState.js` | 激活热量状态 |
| `server/src/services/ship/shipNameUtils.js` | 船名工具函数 |
| `server/src/config/productionMissionPolicy.js` + `.json` | 生产任务策略 |
| `server/src/_secondary/express/playerConnectEndpoints.js` | 玩家连接端点 |
| `tools/DatabaseCreator/enforce-production-mission-policy.js` | 任务策略执行 |
| `tools/DatabaseCreator/production-mission-policy.js` | 任务策略定义 |
| `Dockerfile` | Docker 构建文件 |
| `compose.yaml` | Docker Compose 配置 |
| `.dockerignore` | Docker 忽略文件 |

### 2.2 主要变更文件

| 文件 | 变更说明 |
|------|---------|
| `server/index.js` | 新增启动账单维护处理流程 |
| `server/src/config/index.js` | 新增 `gameServerBindHost`、`xmppServerBindHost`、`playerConnectToken` 配置项 |
| `server/src/gameStore/index.js` | 新增测试存储验证逻辑 |
| `server/src/gameStore/sqliteStore.js` | 新增 `_persistence_outbox` 持久化日志表 |
| `server/src/gameStore/persistenceWorker.js` | 持久化工作器改进 |
| `server/src/services/inventory/invBrokerService.js` | 新增公司仓库访问控制、角色权限验证 |
| `server/src/services/dogma/dogmaService.js` | 武器热量状态、激活状态改进 |
| `server/src/services/ship/shipService.js` | 船名处理改进 |
| `server/src/space/shipDestruction.js` | 玩家飞船销毁流程重构（物品同步改进）|
| `server/src/space/runtime.js` | 新增 Bastion 模块支持、结构体功能 |
| `server/src/space/npc/npcBehaviorLoop.js` | 新增隐身目标检测 (`isEntityCloakedForCombatTargeting`) |
| `server/src/space/combat/killmailTracker.js` | 新增 CONCORD 身份识别、通知支持 |
| `server/src/services/corporation/*.js` | 大量公司系统改进 |
| `server/src/network/tcp/index.js` | 绑定地址可配置化 |
| `server/src/_secondary/express/server.js` | Express 网关改进 |
| `server/src/_secondary/fitting/fittingStore.js` | 仓库存储改进 |

### 2.3 未变更的核心文件（与掉落/残骸相关）

以下关键文件在两个版本中**完全一致**：

| 文件 | 说明 |
|------|------|
| `server/src/space/npc/npcLoot.js` | NPC 掉落物生成逻辑 |
| `server/src/space/npc/nativeNpcWreckService.js` | NPC 残骸创建与物品转移 |
| `server/src/space/npc/nativeNpcStore.js` | NPC 残骸数据存储 |
| `server/src/space/npc/npcData.js` | NPC 数据索引（含掉落表查询）|
| `server/src/space/npc/nativeNpcService.js` | NPC 实体创建与配置加载 |
| `server/src/space/npc/beltRatRuntime.js` | 小行星带海盗生成逻辑 |
| `server/src/space/wreckUtils.js` | 残骸工具函数 |
| `server/src/services/inventory/itemStore.js` | 物品存储核心 |
| `server/src/services/inventory/spaceDebrisState.js` | 空间碎片状态 |
| `tools/DatabaseCreator/staticTables/npcLootTables/data.json` | NPC 掉落表数据 |
| `tools/DatabaseCreator/staticTables/npcProfiles/data.json` | NPC 配置文件数据 |
| `tools/DatabaseCreator/staticTables/npcLoadouts/data.json` | NPC 装备配置数据 |
| `tools/DatabaseCreator/staticTables/npcSpawnPools/data.json` | NPC 生成池数据 |
| `tools/DatabaseCreator/staticTables/npcSpawnGroups/data.json` | NPC 生成组数据 |
| `tools/DatabaseCreator/staticTables/npcBehaviorProfiles/data.json` | NPC 行为配置数据 |

---

## 三、项目主要流程

### 3.1 服务器启动流程

```
1. 安装进程生命周期日志
2. 加载配置 (config/index.js)
   - 优先级: 代码默认值 → evejs.config.json → evejs.config.local.json → EVEJS_* 环境变量
3. 数据库预加载 (gameStore.preloadAll())
   - SQLite 表加载到内存缓存
   - JSON 静态数据加载
4. 核心数据填充 (Fixtures)
   - 引导角色、玩家公司 98000000、联盟 99000000
   - 全局日历事件
5. 加载游戏服务
   - 递归扫描 src/services/ 下所有 *Service.js
   - 注册到 ServiceManager
6. 加载辅助服务 (_secondary/)
   - 聊天、Express 网关、图片服务器、启动器、红移监测
7. 虫洞数据填充（如启用）
8. 总览 MOTD 引导
9. 启动账单维护 (v0.12.2 新增)
10. 启动存在态协调器 (Presence Reconciler)
11. 启动 TCP 服务器 (MachoNet 协议)
```

### 3.2 网络协议流程

```
客户端 ←TCP→ 握手 → 认证 → 会话建立
         ↓
    MachoNet 协议
         ↓
    packetDispatcher → ServiceManager
         ↓
    BaseService.callMethod() → 具体服务方法
```

### 3.3 NPC 完整生命周期

```
1. 生成阶段 (Spawn)
   beltRatRuntime.js → 根据安全等级/区域选择海盗派系
   → 查询 npcSpawnPools → 选择具体 NPC profile
   → buildNpcDefinition() → 加载 profile + loadout + behavior + lootTable
   → 创建 NPC 实体 + 模块 + 货物

2. 行为阶段 (Behavior)
   npcBehaviorLoop.js → 每 tick 更新
   → 目标选择 → 移动 → 战斗 → 广播状态

3. 死亡阶段 (Destruction)
   laserTurrets.js / damage.js → 血量归零
   → destroyNativeNpcEntityWithWreck()
   → 创建残骸记录 + 货物掉落 + 战利品掉落
   → 移除 NPC 实体 → 生成残骸实体

4. 拾取阶段 (Loot)
   玩家打开残骸 → invBrokerService.js
   → transferNativeWreckItemToCharacterLocation()
   → 从残骸移除物品 → 添加到玩家飞船货舱
```

---

## 四、功能模块详解

### 4.1 核心服务层 (services/)

#### 4.1.1 账户与认证
- **accountService**: 账户生命周期管理
- **authenticationService**: 登录认证
- **walletState**: 钱包状态
- **billMgrService**: 账单管理

#### 4.1.2 角色与技能
- **characterState**: 角色状态
- **skillMgrService/skillMgr2Service**: 技能管理
- **skillQueueRuntime**: 技能队列
- **standingMgrService**: 声望管理

#### 4.1.3 公司与联盟
- **corpService/corpmgrService**: 公司管理
- **allianceRegistryService**: 联盟注册
- **warRuntimeState**: 战争状态
- **officeManagerService**: 办公室管理

#### 4.1.4 经济与市场
- **marketService**: 市场订单
- **tradeMgrService**: 玩家交易
- **industryManagerService**: 工业管理
- **blueprintManagerService**: 蓝图管理

#### 4.1.5 物品与库存
- **itemStore**: 物品存储核心
- **invBrokerService**: 库存操作代理
- **itemTypeRegistry**: 物品类型注册
- **spaceDebrisState**: 空间碎片状态

#### 4.1.6 飞船与装配
- **shipService**: 飞船生命周期
- **fittingState/liveFittingState**: 装配状态
- **dogmaService**: 属性引擎
- **shipCosmeticsState**: 飞船外观

#### 4.1.7 空间与战斗
- **destiny.js**: 气泡/位置模拟核心
- **npcBehaviorLoop.js**: NPC AI 循环
- **laserTurrets.js**: 激光炮塔
- **damage.js**: 伤害计算
- **killmailTracker.js**: 击杀邮件

### 4.2 空间模拟层 (space/)

#### 4.2.1 核心模拟
- **runtime.js**: 空间运行时（实体管理、广播）
- **destiny.js**: 命运权威（移动/位置）
- **worldData.js**: 世界数据
- **transitions.js**: 场景切换

#### 4.2.2 NPC 系统
- **nativeNpcService.js**: NPC 创建/管理
- **nativeNpcStore.js**: NPC 数据存储
- **nativeNpcWreckService.js**: NPC 残骸服务
- **npcLoot.js**: NPC 掉落生成
- **npcData.js**: NPC 数据索引
- **npcBehaviorLoop.js**: NPC 行为循环
- **beltRatRuntime.js**: 小行星带海盗
- **capitalNpcCatalog.js**: 旗舰 NPC
- **empireSecurityNpcCatalog.js**: 帝国安全 NPC
- **trigDrifterNpcCatalog.js**: Triglavian NPC

#### 4.2.3 战斗系统
- **combat/damage.js**: 伤害计算
- **combat/laserTurrets.js**: 激光炮塔
- **combat/weaponDogma.js**: 武器属性
- **combat/killmailTracker.js**: 击杀邮件

#### 4.2.4 模块系统
- **modules/salvagerRuntime.js**: 打捞器
- **modules/tractorBeamRuntime.js**: 牵引光束
- **modules/hostileModuleRuntime.js**: 敌对模块
- **modules/superweapons/superweaponRuntime.js**: 超级武器

### 4.3 数据存储层 (gameStore/)

#### 存储架构
- **内存缓存**: 所有表在启动时加载到内存
- **SQLite 后端**: 运行时可变表（npcEntities, npcWrecks, items 等）
- **JSON 后端**: 静态/SDE 数据表
- **持久化**: 延迟写入（2秒防抖）+ 持久化工作器

#### 关键表
| 表名 | 说明 |
|------|------|
| npcEntities | NPC 实体 |
| npcModules | NPC 模块 |
| npcCargo | NPC 货物 |
| npcWrecks | NPC 残骸 |
| npcWreckItems | 残骸内物品 |
| npcRuntimeControllers | NPC 运行时控制器 |
| items | 物品 |
| characters | 角色 |
| accounts | 账户 |

### 4.4 配置系统 (config/index.js)

配置项覆盖：
- 版本信息 (clientVersion, clientBuild, machoVersion)
- 网络设置 (serverPort, bindHost)
- 游戏参数 (skillTrainingSpeed, industrySystemCostIndex)
- NPC/采矿 (beltRatSpawnChance, miningFleetProfiles)
- 虫洞 (wormholesEnabled, wormholeLifetimeScale)
- 市场 (marketDaemonHost, marketDaemonPort)
- TiDi (tidiAutoscaler)
- 代理 (proxyBlockedHosts, proxyAllowedHosts)

---

## 五、NPC 掉落与残骸系统详解

### 5.1 掉落表结构 (npcLootTables)

```json
{
  "lootTableID": "loot_belt_normal_small",
  "name": "Normal Belt Loot - Small Hulls",
  "mode": "rule",
  "minEntries": 2,
  "maxEntries": 5,
  "emptyChance": 0.22,
  "allowDuplicates": false,
  "selectors": [
    { "kind": "ammo", "tier": "low", "sizeBand": "small", "weight": 6 },
    { "kind": "module", "tier": "low", "sizeBand": "small", "weight": 2 },
    { "kind": "utility", "tier": "low", "sizeBand": "small", "weight": 2 },
    { "kind": "trash", "tier": "low", "weight": 1 }
  ]
}
```

### 5.2 掉落生成流程

```
1. NPC 死亡触发 destroyNativeNpcEntityWithWreck()
2. 从 nativeEntityRecord.lootTableID 获取掉落表 ID
3. 调用 getNpcLootTable(lootTableID) 查询掉落表
4. 调用 rollNpcLootEntries(lootTable) 生成掉落
   - 检查 emptyChance (空残骸概率)
   - 遍历 selectors 按权重选择物品类型
   - 过滤: 排除蓝图、T2、特殊等级物品
   - 按 sizeBand 匹配物品尺寸
5. 将掉落物品写入残骸 (buildNativeWreckItemRecord)
6. 生成残骸实体并广播
```

### 5.3 残骸数据模型

```javascript
// 残骸记录 (npcWrecks 表)
{
  wreckID: Number,
  sourceEntityID: Number,
  systemID: Number,
  lootTableID: String,
  typeID: Number,        // 残骸类型
  position: {x, y, z},
  ownerID: Number,
  corporationID: Number,
  createdAtMs: Number,
  expiresAtMs: Number,   // 过期时间
  transient: Boolean     // 是否临时（不持久化）
}

// 残骸物品记录 (npcWreckItems 表)
{
  wreckItemID: Number,
  wreckID: Number,
  typeID: Number,
  quantity: Number,
  singleton: Boolean,
  sourceKind: String,    // "cargo" | "loot"
  moduleState: Object,
  volume: Number
}
```

### 5.4 物品拾取流程

```
1. 玩家打开残骸 → 客户端发送 RPC
2. invBrokerService._moveSourceItemToDestination()
3. 判断 sourceItemDescriptor.sourceKind === "nativeWreck"
4. 调用 nativeNpcWreckService.transferNativeWreckItemToCharacterLocation()
   - 验证残骸和物品存在
   - 检查请求数量 <= 可用数量
   - 调用 grantItemToCharacterLocation() 添加到玩家货舱
   - 从残骸移除物品（或减少数量）
   - 刷新残骸实体状态
5. 广播库存变更
```

---

## 六、v0.12.2 残骸无法拾取物品问题分析

### 6.1 问题描述

在 v0.12.2 版本中，消灭敌人后：
- 残骸正常生成
- 但无法从残骸中拾取到物品
- 相比之下，v0.12.1 版本可以正常拾取，且几率较高能获得高价值物品

### 6.2 代码对比结果

经过详细对比两个版本的源代码，发现以下关键文件**完全一致**：

| 文件 | 功能 | 一致性 |
|------|------|--------|
| `npcLoot.js` | 掉落物生成算法 | ✅ 完全一致 |
| `nativeNpcWreckService.js` | 残骸创建与物品转移 | ✅ 完全一致 |
| `nativeNpcStore.js` | 残骸数据存储 | ✅ 完全一致 |
| `npcData.js` | NPC 数据索引 | ✅ 完全一致 |
| `nativeNpcService.js` | NPC 实体创建 | ✅ 完全一致 |
| `beltRatRuntime.js` | 海盗生成逻辑 | ✅ 完全一致 |
| `itemStore.js` | 物品存储核心 | ✅ 完全一致 |
| `wreckUtils.js` | 残骸工具 | ✅ 完全一致 |
| `npcLootTables/data.json` | 掉落表数据 | ✅ 完全一致 |
| `npcProfiles/data.json` | NPC 配置文件 | ✅ 完全一致 |
| `npcLoadouts/data.json` | NPC 装备数据 | ✅ 完全一致 |

### 6.3 问题根因分析

由于核心掉落/残骸代码完全一致，问题可能出在以下几个方面：

#### 可能性 1: 数据持久化差异 (最可能)

v0.12.2 对 `sqliteStore.js` 进行了重大改动，新增了 `_persistence_outbox` 持久化日志表。这改变了写入路径：

```sql
CREATE TABLE IF NOT EXISTS _persistence_outbox (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL UNIQUE,
  upserts_json TEXT NOT NULL,
  deletes_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'applied')),
  created_at TEXT NOT NULL,
  applied_at TEXT
);
```

**潜在问题**: 如果新的异步持久化路径存在 bug，可能导致：
- 残骸物品写入 `npcWreckItems` 表后未被正确读取
- 或者读取时缓存与 SQLite 不同步

#### 可能性 2: 运行时数据加载差异

v0.12.2 的 `gameStore/index.js` 新增了测试存储验证逻辑，可能影响了数据加载顺序或时机。

#### 可能性 3: 配置差异

两个版本的 `evejs.config.local.json` 存在细微差异，可能影响：
- NPC 生成时的 lootTableID 分配
- 残骸生命周期 (`spaceDebrisLifetimeMs`)

#### 可能性 4: 数据库迁移问题

如果 v0.12.2 使用了新的 SQLite 数据库但未正确迁移旧数据，可能导致：
- 掉落表 (`npcLootTables`) 数据缺失
- NPC 配置文件中的 `lootTableID` 字段为空

### 6.4 排查建议

1. **检查运行时掉落表加载**
   ```javascript
   // 在 destroyNativeNpcEntityWithWreck 中添加日志
   const lootTable = getNpcLootTable(nativeEntityRecord.lootTableID);
   console.log('LootTableID:', nativeEntityRecord.lootTableID);
   console.log('Resolved LootTable:', lootTable);
   console.log('Rolled Entries:', rolledLootEntries);
   ```

2. **检查残骸物品是否正确写入**
   ```javascript
   // 在残骸生成后检查
   const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckID);
   console.log('Wreck Items Count:', wreckItems.length);
   ```

3. **检查 isEmpty 标志**
   ```javascript
   // 在 buildNativeWreckRuntimeEntity 中
   console.log('isEmpty:', entity.isEmpty);
   ```

4. **对比数据库内容**
   - 检查两个版本的 `gamestore.sqlite` 中 `npcLootTables` 表内容是否一致
   - 检查 `npcProfiles` 中 `lootTableID` 字段是否正确

5. **检查 emptyChance 配置**
   - 小型船: 22% 空残骸率
   - 中型船: 18% 空残骸率
   - 大型船: 8% 空残骸率

### 6.5 结论

基于代码对比，**v0.12.2 的残骸掉落问题不是由掉落算法或残骸创建逻辑的代码变更引起的**。两个版本的核心掉落/残骸代码完全一致。

问题最可能的原因是：
1. **数据层问题**: SQLite 持久化路径变更导致的数据同步问题
2. **数据迁移问题**: 数据库迁移过程中掉落表数据丢失
3. **运行时数据加载**: 数据加载顺序或缓存一致性问题

建议通过添加运行时日志来确认：
- NPC 死亡时 `lootTableID` 是否正确解析
- `rollNpcLootEntries()` 是否返回了非空数组
- 残骸物品是否正确写入 `npcWreckItems` 表
- 客户端查询残骸内容时返回的物品列表是否为空
