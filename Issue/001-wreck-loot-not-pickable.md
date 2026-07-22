# 问题 #001: 残骸掉落/拾取/刷新异常（社区数据 vs 官方数据行为差异）

### 基本信息

| 字段 | 内容 |
|------|------|
| **问题编号** | #001 |
| **发现日期** | 2026-07-20 |
| **影响版本** | EveJS v0.12.2 |
| **严重程度** | 高（影响核心游戏体验） |
| **状态** | 🔍 根因已定位，待修复 |
| **类别** | 掉落系统 / 残骸系统 |

### 问题描述

消灭敌人（NPC）后，残骸的掉落、拾取和刷新机制存在异常。**社区数据（eve-survival 爬取）和官方数据（CCP SDE）表现不一致**。

### 社区数据 vs 官方数据行为对比

| 行为 | 社区数据（eve-survival） | 官方数据（CCP SDE） |
|------|------------------------|-------------------|
| **总览列表** | ❌ 敌人不出现在总览中，只能通过点击星空模型锁定 | ✅ 敌人正常出现在总览中 |
| **残骸位置** | ✅ 残骸出现在死亡位置 | ❌ 残骸位置与死亡位置不一致（强制创建） |
| **掉落物品** | ✅ 高价值物品掉落 | ❌ 残骸始终为空 |
| **残骸总览** | ✅ 残骸显示在总览中，有明暗状态区分已查看/未查看 | ❌ 残骸不在总览中 |
| **拾取后刷新** | ❌ 物品仍显示但无法拾取，图标状态异常 | ❌ 无物品可拾取，无同步问题 |

### 具体问题

#### 问题 1: 社区数据 NPC 不出现在总览列表

社区数据的 NPC 不会出现在总览（Overview）列表中，导致无法通过总览进行锁定操作，只能点选星空中的模型进行锁定。

#### 问题 2: 社区数据残骸拾取后状态不同步

全部拾取残骸内物品后：
- ❌ 残骸内部物品仍显示（看起来像没刷新）
- ✅ 物品已无法拾取
- ❌ 残骸图标仍显示"有物品"状态（应为空残骸图标）
- ✅ 状态变为已查看的灰色图标
- ❌ 可以再次打开，物品仍显示但无法拾取

**预期行为**: 拾取后残骸应变为空残骸图标，物品列表清空。

#### 问题 3: 官方数据残骸位置异常

官方数据的 NPC 死亡后，残骸位置与死亡位置不一致，感觉像是强制创建出来的一个残骸。

#### 问题 4: 官方数据残骸无掉落

官方数据的残骸内一直没有物品掉落，可以正常打开但无物品可拾取。

### 根因分析（代码级验证）

#### 根因 1: 残骸状态同步双重缺陷（已确认 ✅）

**Bug A** — `nativeNpcWreckService.js:375` 拾取后调用 `refreshNativeWreckRuntimeEntity` 时**缺少 `{ broadcast: true }`**：
```js
// 当前代码（错误）
refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);
// 应改为
refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID, { broadcast: true });
```

**Bug B** — `nativeNpcWreckService.js:178` 调用了**不存在的方法**：
```js
// 当前代码（方法不存在）
scene.sendSlimItemChangesToAllSessions([entity]);
// 应为（runtime.js:27565 定义的真实方法）
scene.broadcastSlimItemChanges([entity]);
```

**影响**: 拾取后服务端的 `isEmpty` 已正确更新，但客户端永远收不到通知 → 图标不刷新、物品列表残留。

#### 根因 2: 社区数据 NPC 总览列表缺失（已确认 ✅）

社区数据 NPC 通过 `dungeonUniverseSiteService.js` 生成（不走标准 NPC 生成路径），存在三个复合问题：

| # | 问题 | 位置 | 影响 |
|---|------|------|------|
| 1 | `suppressSlimName:true` + `nameID:null` | `dungeonAuthority/data.json` → `nativeNpcService.js:1244` | slimItem 无 name → 客户端总览过滤掉无名船只 |
| 2 | `ownerIDOverride` 应用了但 `corporationID`/`allianceID`/`warFactionID` 未覆盖 | `nativeNpcService.js:1278-1284` | faction 字段来自 resolved profile 而非 dungeon entry → 可能被 faction 过滤器排除 |
| 3 | `dunObjectID`/`objectiveTargetGroup` 未传播到 NPC 实体 | `dungeonUniverseSiteService.js:4932` | 客户端 dungeon-objective 过滤器无法关联 |

**修复方向**: 在 `dungeonUniverseSiteService.js:4932` 处统一处理 name、faction 和 objective 字段。

#### 根因 3: 残骸位置偏移（待验证 ⚠️）

服务端位置链（`nativeNpcWreckService.js:500` → `runtime.js:18471` → `spawnDynamicEntity`）无偏移。观察到的位置差异可能是客户端 `freshAcquire: false` 获取通道的渲染时序问题（`nativeNpcWreckService.js:232-238`）。需运行时验证。

#### 根因 4: 官方数据残骸无掉落（待验证 ⚠️）

掉落本身有随机性（`emptyChance`、加权随机），静态分析无法确认。需运行时对比两种数据源的 lootTableID 解析路径。

### 代码比对结论

已逐一比对两个版本中所有与掉落/残骸相关的源代码文件：

| 文件路径 | 功能 | 比对结果 |
|---------|------|---------|
| `server/src/space/npc/npcLoot.js` | 掉落生成核心逻辑 | ✅ 完全一致 |
| `server/src/space/npc/nativeNpcWreckService.js` | 残骸创建与物品转移 | ⚠️ 发现 2 个 bug |
| `server/src/space/npc/nativeNpcStore.js` | 残骸数据存储 | ✅ 完全一致 |
| `server/src/space/npc/npcData.js` | NPC 数据索引 | ✅ 完全一致 |
| `server/src/space/wreckUtils.js` | 残骸工具函数 | ✅ 完全一致 |

**结论**: 核心掉落算法一致，问题在残骸状态同步逻辑和社区数据 NPC 生成路径。

### 修复方案

| 方案 | 描述 | 优先级 | 状态 |
|------|------|--------|------|
| **A. 修复残骸状态同步** | 修复 Bug A（添加 broadcast）+ Bug B（方法名） | 高 | 代码已定位 |
| **B. 修复社区数据 NPC 总览** | 在 `dungeonUniverseSiteService.js:4932` 统一处理 name/faction/objective | 高 | 代码已定位 |
| **C. 验证残骸位置** | 运行时验证是否为客户端渲染问题 | 中 | 待验证 |
| **D. 验证官方数据掉落** | 运行时对比 lootTableID 解析路径 | 中 | 待验证 |

### 相关文件

- [Doc/Loot_Wreck_System_Analysis.md](../Doc/Loot_Wreck_System_Analysis.md) — 掉落系统深度分析
- [Issue/002-missing-storyline-missions.md](002-missing-storyline-missions.md) — 剧情任务问题
