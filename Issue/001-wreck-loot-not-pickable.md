# 问题 #001: v0.12.2 版本中消灭敌人后残骸无法拾取物品

### 基本信息

| 字段 | 内容 |
|------|------|
| **问题编号** | #001 |
| **发现日期** | 2026-07-20 |
| **影响版本** | EveJS v0.12.2 |
| **正常版本** | EveJS v0.12.1 |
| **严重程度** | 高 (影响核心游戏体验) |
| **状态** | 🔍 待验证（根因假设已建立） |
| **类别** | 掉落系统 / 残骸系统 |

### 问题描述

在 v0.12.2 版本中，消灭敌人（NPC）后：
- ✅ 残骸正常生成，玩家可见
- ❌ 无法从残骸中拾取到任何物品
- ❌ 残骸表现为"空"状态

对比 v0.12.1 版本：
- ✅ 残骸正常生成
- ✅ 可以从残骸中正常拾取物品
- ✅ 拾取几率较高，能获得价值较高的物品

### 排查过程

#### 第一步：核心代码比对

逐一比对了两个版本中所有与掉落/残骸相关的源代码文件：

| 文件路径 | 功能 | 比对结果 |
|---------|------|---------|
| `server/src/space/npc/npcLoot.js` | 掉落生成核心逻辑 | ✅ 完全一致 |
| `server/src/space/npc/nativeNpcWreckService.js` | 残骸创建与物品转移 | ✅ 完全一致 |
| `server/src/space/npc/nativeNpcStore.js` | 残骸数据存储 | ✅ 完全一致 |
| `server/src/space/npc/npcData.js` | NPC 数据索引 | ✅ 完全一致 |
| `server/src/space/npc/nativeNpcService.js` | NPC 实体创建 | ✅ 完全一致 |
| `server/src/space/npc/beltRatRuntime.js` | 海盗生成逻辑 | ✅ 完全一致 |
| `server/src/space/wreckUtils.js` | 残骸工具函数 | ✅ 完全一致 |
| `server/src/services/inventory/itemStore.js` | 物品存储核心 | ✅ 完全一致 |
| `server/src/services/inventory/spaceDebrisState.js` | 碎片状态 | ✅ 完全一致 |
| `tools/.../npcLootTables/data.json` | 掉落表数据 | ✅ 完全一致 |
| `tools/.../npcProfiles/data.json` | NPC 配置文件 | ✅ 完全一致 |
| `tools/.../npcLoadouts/data.json` | NPC 装备数据 | ✅ 完全一致 |
| `tools/.../npcSpawnPools/data.json` | 生成池数据 | ✅ 完全一致 |
| `tools/.../npcSpawnGroups/data.json` | 生成组数据 | ✅ 完全一致 |
| `tools/.../npcBehaviorProfiles/data.json` | 行为配置数据 | ✅ 完全一致 |

**结论**: 核心掉落/残骸代码完全一致，问题不在算法逻辑层。

#### 第二步：变更文件分析

分析了 v0.12.2 中所有变更的文件，评估与掉落系统的关联性：

| 变更文件 | 变更内容 | 影响评估 |
|---------|---------|---------|
| `sqliteStore.js` | 新增 _persistence_outbox 持久化日志 | ⚠️ 可能影响 |
| `gameStore/index.js` | 新增测试存储验证逻辑 | ⚠️ 可能影响 |
| `persistenceWorker.js` | 持久化工作器改进 | ⚠️ 可能影响 |
| `shipDestruction.js` | 玩家飞船销毁流程重构 | ❌ 不影响 NPC 残骸 |
| `runtime.js` | Bastion 模块/结构体支持 | ❌ 不影响 |
| `npcBehaviorLoop.js` | 隐身目标检测 | ❌ 不影响 |
| `dogmaService.js` | 武器热量状态 | ❌ 不影响 |
| `invBrokerService.js` | 公司仓库权限控制 | ❌ 不影响残骸拾取 |
| `clientSession.js` | 广播载荷格式变更 | ❌ 不太可能 |

#### 第三步：数据层比对

比对了两个版本的静态数据文件：

| 数据文件 | 比对结果 |
|---------|---------|
| `npcLootTables/data.json` | ✅ 完全一致 |
| `npcProfiles/data.json` | ✅ 完全一致 |
| `npcLoadouts/data.json` | ✅ 一致 |
| `npcSpawnPools/data.json` | ✅ 一致 |
| `npcSpawnGroups/data.json` | ✅ 一致 |
| `npcBehaviorProfiles/data.json` | ✅ 一致 |

### 根因假设（按可能性排序）

#### 假设 1: SQLite 异步持久化路径变更导致数据同步问题 ⭐⭐⭐⭐⭐

**依据**: v0.12.2 对 `sqliteStore.js` 进行了重大改动，新增 `_persistence_outbox` 持久化日志表：

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

**推测机制**:
- 新的异步持久化路径可能延迟了 `npcWreckItems` 表的写入
- 玩家尝试拾取时，物品记录可能尚未提交到 SQLite
- 或者读取时缓存与 SQLite 不同步
- `table_name TEXT NOT NULL UNIQUE` 约束意味着同一表只能有一个未完成操作，后续写入可能被阻塞

#### 假设 2: 数据库迁移导致数据关联丢失 ⭐⭐⭐

**依据**: 如果从 v0.12.1 的数据库迁移到 v0.12.2 时未正确处理：

**可能情况**:
- `npcProfiles` 中的 `lootTableID` 字段迁移后丢失
- `npcLootTables` 表数据未正确导入新的 SQLite 数据库
- 外键关联断裂

#### 假设 3: isEmpty 标志设置时机错误 ⭐⭐⭐

**依据**: `buildNativeWreckRuntimeEntity` 中的 isEmpty 判断逻辑：

```javascript
entity.isEmpty = nativeNpcStore.listNativeWreckItemsForWreck(wreckID).length === 0;
```

**推测机制**: 如果残骸实体生成时物品尚未写入（异步时序问题），`isEmpty` 会被错误设为 `true`，导致客户端认为残骸是空的。

#### 假设 4: 运行时数据加载差异 ⭐⭐

**依据**: v0.12.2 的 `gameStore/index.js` 新增了大量测试存储验证逻辑，可能改变了数据加载顺序或时机。

#### 假设 5: 配置差异 ⭐

**依据**: 两个版本的 `evejs.config.local.json` 存在细微差异，可能间接影响 NPC 生成或残骸生命周期。

### 建议排查步骤

> 日志格式遵循项目规范：`log.info("[Tag] key=value")`，使用 `src/utils/logger`。

1. **添加运行时日志验证掉落生成**
   ```javascript
   // 在 nativeNpcWreckService.js 的 destroyNativeNpcEntityWithWreck 中添加:
   log.info(`[WreckLoot] npc=${entityID} lootTableID=${nativeEntityRecord.lootTableID} rolledEntries=${rolledLootEntries.length}`);
   ```

2. **验证残骸物品是否正确写入存储**
   ```javascript
   // 在残骸生成后检查:
   const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckID);
   log.info(`[WreckLoot] wreck=${wreckID} storedItems=${wreckItems.length}`);
   ```

3. **检查 isEmpty 标志**
   ```javascript
   // 在 buildNativeWreckRuntimeEntity 中:
   log.info(`[WreckLoot] wreck=${wreckID} isEmpty=${entity.isEmpty} itemCount=${nativeNpcStore.listNativeWreckItemsForWreck(wreckID).length}`);
   ```

4. **对比数据库内容**
   - 运行两个版本，对比 `gamestore.sqlite` 中 `npcLootTables` 表
   - 检查 `npcProfiles` 中 `lootTableID` 字段是否正确加载

5. **检查 _persistence_outbox 状态**
   ```sql
   SELECT * FROM _persistence_outbox WHERE state = 'pending';
   ```

### 建议修复方向

1. **方案 A**: 在残骸生成后立即验证物品是否正确写入，如未写入则报错或重试
   ```javascript
   // 在 destroyNativeNpcEntityWithWreck 末尾添加:
   const finalWreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID);
   if (finalWreckItems.length === 0 && rolledLootEntries.length > 0) {
     log.err(`[WreckLoot] Items rolled but not persisted! wreck=${wreckRecord.wreckID} rolled=${rolledLootEntries.length} stored=${finalWreckItems.length}`);
   }
   ```

2. **方案 B**: 检查并修复 SQLite 持久化路径，确保 `npcWreckItems` 表的写入是同步的或在读取前已完成

3. **方案 C**: 如果是数据库迁移问题，重新运行迁移脚本
   ```bash
   node src/gameStore/migrateJsonToSqlite.js npcLootTables npcProfiles
   ```

### 关于 v0.12.1 高价值物品掉落说明

v0.12.1 中"高价值物品几率较大"的原因是 `generic_random_any` 掉落表被使用——它从整个物品池随机选择，不限制品质等级。而标准海盗掉落表 (`loot_belt_normal_*`) 使用 rule 模式，限制了低品质物品。

掉落表类型对比：

| 掉落表 | 模式 | 品质限制 | 高价值物品 |
|--------|------|---------|-----------|
| `generic_random_any` | 随机 | 无 | ✅ 可能 |
| `loot_belt_normal_small` | rule | 低品质 | ❌ 不可能 |
| `loot_belt_normal_medium` | rule | 低品质 | ❌ 不可能 |
| `loot_belt_normal_large` | rule | 低品质 | ❌ 不可能 |

### 相关文件

- `Doc/EveJS_Project_Overview.md` - 项目概述与版本对比
- `Doc/Loot_Wreck_System_Analysis.md` - 掉落系统深度分析
- `Doc/Service_Modules_Reference.md` - 服务模块参考
