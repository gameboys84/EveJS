# EveJS 服务模块参考手册

## 一、服务系统架构

### 1.1 服务管理器 (ServiceManager)

```
ServiceManager
├── register(name, service)     // 注册服务
├── lookup(name)               // 查找服务
├── registerAlias(alias, name) // 注册别名
└── registerBoundObject(oid, service) // 注册绑定对象
```

### 1.2 基础服务 (BaseService)

```javascript
class BaseService {
  name = "serviceName";

  // 自动分发 RPC 调用到子类方法
  callMethod(method, args, session, kwargs) { ... }
}
```

### 1.3 服务发现

启动时递归扫描 `src/services/` 目录下所有 `*Service.js` 文件（排除 `baseService.js` 和 `serviceManager.js`），自动实例化并注册。

---

## 二、服务模块详解

### 2.1 账户与认证服务

#### accountService
- **功能**: 账户生命周期管理
- **方法**: 创建账户、查询账户状态、角色管理

#### authenticationService
- **功能**: 登录认证
- **流程**: 验证用户名/密码 → 生成会话 → 返回角色列表

#### walletState
- **功能**: 钱包状态管理
- **方法**: `adjustCharacterBalance()`, `getCharacterWallet()`

#### billMgrService
- **功能**: 账单管理
- **范围**: 办公室租金、战争费用、保险费用

### 2.2 角色服务

#### characterState
- **功能**: 角色状态管理
- **数据**: 技能点、忠诚点、安全状态、位置

#### charMgrService
- **功能**: 角色管理
- **方法**: 创建角色、删除角色、角色转移

#### standingMgrService
- **功能**: 声望管理
- **数据**: 与 NPC 公司/派系的声望值

### 2.3 技能服务

#### skillMgrService / skillMgr2Service
- **功能**: 技能管理
- **方法**: 购买技能、训练技能、查询技能

#### skillQueueRuntime
- **功能**: 技能队列
- **机制**: 先进先出队列，按训练速度推进

#### skillState
- **功能**: 技能状态
- **数据**: 已学习技能、当前等级、SP 总量

### 2.4 公司服务

#### corpService / corpmgrService
- **功能**: 公司管理
- **方法**: 创建公司、修改图腾、查询成员

#### corpRegistryRuntime
- **功能**: 公司注册表
- **数据**: 公司 ID、名称、 ticker、CEO

#### allianceRegistryService
- **功能**: 联盟注册
- **方法**: 创建联盟、加入联盟、退出联盟

#### warRuntimeState
- **功能**: 战争状态
- **数据**: 宣战方、战争开始时间、击杀数

### 2.5 经济服务

#### marketService
- **功能**: 市场订单
- **代理**: 通过 marketDaemonClient 连接到 Rust 市场守护进程

#### marketProxyService
- **功能**: 市场代理
- **方法**: 买入/卖出订单、查询历史

#### tradeMgrService
- **功能**: 玩家间交易
- **机制**: 双方面确认的交易窗口

### 2.6 工业服务

#### industryManagerService
- **功能**: 工业管理
- **方法**: 提交作业、完成作业、查询设施

#### blueprintManagerService
- **功能**: 蓝图管理
- **数据**: 材料等级、运行次数、ME/TE 等级

### 2.7 物品与库存服务

#### itemStore
- **功能**: 物品存储核心
- **方法**:
  - `grantItemToCharacterLocation(charID, locID, flagID, itemType, qty, opts)` - 授予物品
  - `getItemMetadata(typeID, name)` - 获取物品元数据
  - `ITEM_FLAGS` - 物品标志常量

#### invBrokerService
- **功能**: 库存操作代理
- **方法**:
  - `_moveSourceItemToDestination()` - 移动物品
  - `_getCorporationOffice()` - 获取公司办公室
  - 处理残骸物品转移

#### itemTypeRegistry
- **功能**: 物品类型注册
- **方法**: `resolveItemByTypeID(typeID)` - 解析物品类型

#### spaceDebrisState
- **功能**: 空间碎片状态
- **方法**: `getSpaceDebrisLifetimeMs()` - 获取碎片生命周期

### 2.8 飞船服务

#### shipService
- **功能**: 飞船生命周期
- **方法**: 装配飞船、下船、更换飞船

#### fittingState / liveFittingState
- **功能**: 装配状态
- **方法**: 安装模块、卸载模块、计算属性

#### dogmaService
- **功能**: 属性引擎
- **范围**: 飞船/模块/植入体效果计算

#### ejectService / ejectRuntime
- **功能**: 弹射
- **流程**: 激活逃生舱 → 飞船被毁 → 角色进入逃生舱

#### jettisonRuntime
- **功能**: 抛弃
- **流程**: 从货舱抛弃物品 → 生成集装箱

### 2.9 空间服务

#### space/runtime.js
- **功能**: 空间运行时
- **方法**:
  - `ensureScene(systemID)` - 确保场景存在
  - `spawnDynamicEntity(entity)` - 生成动态实体
  - `removeDynamicEntity(systemID, entityID)` - 移除动态实体

#### space/destiny.js
- **功能**: 命运权威（移动/位置）
- **方法**: 更新实体位置、速度、方向

#### space/shipDestruction.js
- **功能**: 飞船销毁
- **方法**: `destroyShipEntityWithWreck()` - 销毁飞船并生成残骸

### 2.10 NPC 服务

#### space/npc/nativeNpcService
- **功能**: NPC 创建/管理
- **方法**: `spawnNpc()` - 生成 NPC

#### space/npc/nativeNpcStore
- **功能**: NPC 数据存储
- **方法**:
  - `allocateEntityID()` - 分配实体 ID
  - `upsertNativeEntity()` - 写入实体
  - `allocateWreckID()` - 分配残骸 ID
  - `upsertNativeWreck()` - 写入残骸
  - `upsertNativeWreckItem()` - 写入残骸物品

#### space/npc/nativeNpcWreckService
- **功能**: NPC 残骸服务
- **方法**:
  - `destroyNativeNpcEntityWithWreck()` - 销毁 NPC 并创建残骸
  - `transferNativeWreckItemToCharacterLocation()` - 转移残骸物品
  - `spawnNativeWreck()` - 生成残骸实体

#### space/npc/npcLoot
- **功能**: NPC 掉落生成
- **方法**: `rollNpcLootEntries(lootTable)` - 生成掉落

#### space/npc/npcData
- **功能**: NPC 数据索引
- **方法**:
  - `getNpcLootTable(lootTableID)` - 查询掉落表
  - `getNpcProfile(profileID)` - 查询配置文件
  - `buildNpcDefinition(profileID)` - 构建 NPC 定义

#### space/npc/beltRatRuntime
- **功能**: 小行星带海盗
- **方法**: 根据安全等级生成海盗

### 2.11 战斗服务

#### space/combat/damage.js
- **功能**: 伤害计算
- **方法**: 计算伤害类型、抗性、穿透

#### space/combat/laserTurrets.js
- **功能**: 激光炮塔
- **方法**: 发射、伤害应用、击杀检测

#### space/combat/killmailTracker
- **功能**: 击杀邮件
- **方法**: `recordKillmailFromDestruction()` - 记录击杀

### 2.12 模块服务

#### space/modules/salvagerRuntime
- **功能**: 打捞器
- **方法**: 激活打捞 → 生成打捞物品

#### space/modules/tractorBeamRuntime
- **功能**: 牵引光束
- **方法**: 牵引集装箱/残骸

#### space/modules/hostileModuleRuntime
- **功能**: 敌对模块
- **范围**: 扰断、扰频、网子、标记

### 2.13 任务与内容服务

#### agentMgrService
- **功能**: 代理人管理
- **方法**: 查询可用代理人

#### agentMissionRuntime
- **功能**: 任务运行时
- **方法**: 接受任务、完成任务、交付物品

#### dungeonService / dungeonAuthority
- **功能**: 地下城/站点
- **方法**: 生成站点、查询站点信息

### 2.14 探索服务

#### exploration/scanMgrService
- **功能**: 扫描管理
- **方法**: 发射探针、扫描签名

#### exploration/probes/probeScanRuntime
- **功能**: 探针扫描
- **方法**: 计算扫描结果

### 2.15 聊天服务

#### chat/xmppStubServer
- **功能**: XMPP 聊天服务器
- **协议**: XMPP 协议模拟

#### chat/lscService
- **功能**: 本地聊天 (Local Chat)
- **范围**: 同一星系内广播

### 2.16 其他服务

#### admin/slashService
- **功能**: GM 斜杠命令
- **命令**: `/spawn`, `/giveitem`, `/warp`, 等

#### bounty/bountyRuntime
- **功能**: 赏金系统
- **方法**: 领取赏金、发放赏金

#### insurance/insuranceService
- **功能**: 保险服务
- **方法**: 购买保险、理赔

#### loyalty/lpStoreOfferCatalog
- **功能**: 忠诚点商店
- **数据**: LP 兑换物品列表

---

## 三、数据存储层

### 3.1 存储架构

```
gameStore (统一接口)
├── 内存缓存 (cache)
├── SQLite 后端 (sqliteStore)
│   ├── 运行时表 (npcEntities, items, characters, ...)
│   └── 持久化日志 (_persistence_outbox)
└── JSON 后端 (静态数据)
    ├── SDE 数据 (itemTypes, 等)
    └── 配置数据
```

### 3.2 公共 API

```javascript
// 读取
database.read(tableName, path) → { success, data }

// 写入
database.write(tableName, path, value, options) → { success }

// 删除
database.remove(tableName, path) → { success }
```

### 3.3 持久化机制

1. **写入时**: 立即更新内存缓存，标记表为 dirty
2. **防抖**: 2 秒后触发磁盘写入
3. **SQLite 表**: 通过 persistenceWorker 异步写入
4. **JSON 表**: 直接序列化写入文件

### 3.4 关键数据表

| 表名 | 后端 | 说明 |
|------|------|------|
| npcEntities | SQLite | NPC 实体 |
| npcModules | SQLite | NPC 模块 |
| npcCargo | SQLite | NPC 货物 |
| npcWrecks | SQLite | NPC 残骸 |
| npcWreckItems | SQLite | 残骸物品 |
| npcRuntimeControllers | SQLite | NPC 控制器 |
| items | SQLite | 物品 |
| characters | SQLite | 角色 |
| accounts | SQLite | 账户 |
| npcLootTables | JSON | 掉落表 |
| npcProfiles | JSON | NPC 配置 |
| npcLoadouts | JSON | NPC 装备 |
| npcSpawnPools | JSON | 生成池 |
| npcSpawnGroups | JSON | 生成组 |
| npcBehaviorProfiles | JSON | 行为配置 |
| itemTypes | JSON | 物品类型 (SDE) |

---

## 四、网络层

### 4.1 TCP 服务器

```
tcp/index.js
├── 启动监听 (serverPort, gameServerBindHost)
├── 连接处理
│   ├── 握手 (handshake.js)
│   ├── 会话建立 (clientSession.js)
│   └── 数据包处理 (packetDispatcher.js)
└── 断开处理
```

### 4.2 MachoNet 协议

```
数据包结构:
├── 头部 (MachoHeader)
├── 载荷类型 (Call/Notify/Result)
└── 序列化数据 (Marshal)
```

### 4.3 会话管理

```
clientSession.js
├── 认证状态
├── 角色信息 (characterID, corporationID, ...)
├── 空间状态 (systemID, shipID, ...)
└── 通知队列
```

---

## 五、配置系统

### 5.1 配置优先级

```
代码默认值 < evejs.config.json < evejs.config.local.json < EVEJS_* 环境变量
```

### 5.2 关键配置项

| 配置键 | 默认值 | 说明 |
|--------|--------|------|
| clientVersion | "24.01" | 客户端版本 |
| clientBuild | 3396210 | 客户端构建号 |
| machoVersion | 496 | MachoNet 版本 |
| serverPort | 26000 | 服务器端口 |
| gameServerBindHost | "127.0.0.1" | 绑定地址 |
| devAutoCreateAccounts | true | 自动创建账户 |
| devSkipPasswordValidation | true | 跳过密码验证 |
| skillTrainingSpeed | 1.0 | 技能训练速度 |
| industrySystemCostIndex | 0.04 | 工业系统成本指数 |
| wormholesEnabled | true | 启用虫洞 |
| spaceDebrisLifetimeMs | 3600000 | 碎片生命周期 (1小时) |
| beltRatSpawnChance | 0.7 | 海盗生成几率 |
| tidiAutoscaler | true | 启用 TiDi |

---

## 六、辅助服务 (_secondary/)

### 6.1 聊天服务 (chat/)
- XMPP 聊天服务器
- 本地聊天 (LSC) 运行时
- 频道管理

### 6.2 Express 网关 (express/)
- TLS 公共网关
- REST API 端点
- 玩家连接端点 (v0.12.2 新增)

### 6.3 图片服务器 (image/)
- HTTP 图片服务
- 角色头像/公司标志

### 6.4 装配大脑 (fitting/)
- 离线装配构建器
- 装配验证

### 6.5 红移监测 (redshift/)
- TiDi 监测
- 性能统计
