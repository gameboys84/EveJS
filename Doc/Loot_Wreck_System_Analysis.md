# EveJS NPC 掉落与残骸系统深度分析

## 一、掉落系统架构

### 1.1 数据流概览

```
[npcProfiles] → profile.lootTableID
      ↓
[npcLootTables] → 掉落表定义 (selectors, emptyChance, min/maxEntries)
      ↓
[itemTypes] → 通用掉落池 (排除 wreck 组)
      ↓
rollNpcLootEntries() → 按规则筛选 + 加权随机
      ↓
seedNpcShipLoot() → 将物品植入残骸货舱
```

### 1.2 掉落表类型

#### 通用掉落表 (generic_random_any)
```json
{
  "lootTableID": "generic_random_any",
  "minEntries": 1,
  "maxEntries": 3,
  "stackableMinQuantity": 1,
  "stackableMaxQuantity": 25
}
```
- 无 selectors → 从整个物品池随机选择
- 无等级限制 → 可能掉落高价值物品
- 被 Concord/EverMore 等 NPC 使用

#### 规则掉落表 (mode: "rule")
```json
{
  "lootTableID": "loot_belt_normal_small",
  "mode": "rule",
  "minEntries": 2,
  "maxEntries": 5,
  "emptyChance": 0.22,
  "selectors": [
    { "kind": "ammo", "tier": "low", "sizeBand": "small", "weight": 6 },
    { "kind": "module", "tier": "low", "sizeBand": "small", "weight": 2 },
    { "kind": "utility", "tier": "low", "sizeBand": "small", "weight": 2 },
    { "kind": "trash", "tier": "low", "weight": 1 }
  ]
}
```
- 按 kind (ammo/module/utility/trash) 分类
- 按 tier (低/中/高) 限制品质
- 按 sizeBand (small/medium/large) 匹配舰船尺寸

### 1.3 掉落生成算法 (npcLoot.js)

```javascript
function rollNpcLootEntries(lootTable) {
  // 1. 空残骸检查
  if (emptyChance > 0 && Math.random() < emptyChance) return [];

  // 2. 按 selectors 生成条目
  for (let i = 0; i < entryCount; i++) {
    // 加权随机选择 selector
    const selected = chooseWeightedEntry(candidateSelectors);
    // 从候选池中随机选择物品
    const itemType = chooseRandomEntry(availablePool);
    // 检查物品是否符合规则
    if (itemMatchesLootSelector(itemType, selector)) {
      lootEntries.push(buildRuleLootEntry(itemType, selector, lootTable));
    }
  }
  return lootEntries;
}
```

### 1.4 物品过滤规则

**排除的物品:**
- `wreck` 组物品
- 蓝图 (categoryID === 9)
- T2 物品 (名称含 "II")
- 特殊等级物品 (faction/deadspace/officer 等，除非 selector 允许)

**包含的物品类型:**
| kind | 说明 | categoryID |
|------|------|-----------|
| ammo/charge | 弹药 | 8 |
| module | 武器/装甲/护盾/电容模块 | 7 |
| utility/tank | 维修/扩展/抗性模块 | 7 |
| trash/salvage | 打捞材料 | - |

---

## 二、残骸系统架构

### 2.1 残骸创建流程

```
NPC 死亡
  ↓
destroyNativeNpcEntityWithWreck(systemID, shipEntity, options)
  ↓
1. 解析残骸类型 (resolveEntityWreckType)
   - 根据 profileID/shipTypeID/groupName/classID/factionName
   ↓
2. 分配 wreckID (allocateWreckID)
   - transient → 使用内存计数器
   - persistent → 使用 SQLite 计数器
   ↓
3. 创建残骸记录 (upsertNativeWreck)
   - 写入 npcWrecks 表
   ↓
4. 生成货物掉落 (buildNativeCargoItems)
   - 从 NPC 的 cargo 表读取
   - 创建残骸物品记录 (sourceKind: "cargo")
   ↓
5. 生成战利品掉落 (rollNpcLootEntries)
   - 根据 NPC 的 lootTableID 查询掉落表
   - 按规则生成掉落物品
   - 创建残骸物品记录 (sourceKind: "loot")
   ↓
6. 移除 NPC 实体 + 控制器
   ↓
7. 生成残骸空间实体 (spawnNativeWreck)
```

### 2.2 残骸实体属性

```javascript
{
  // 基础属性
  itemID: wreckID,
  typeID: wreckTypeID,        // 残骸类型 ID
  kind: "wreck",
  itemName: "Wreck",

  // 所有权
  ownerID: Number,
  corporationID: Number,
  lootRightCorpID: Number,

  // 空间状态
  position: {x, y, z},
  dunRotation: [x, y, z, w],  // 四元数旋转

  // 时间
  createdAtMs: Number,
  expiresAtMs: Number,        // 过期时间

  // 标志
  isEmpty: Boolean,           // 是否已掏空
  nativeNpcWreck: true,       // NPC 残骸标志
  transient: Boolean,         // 临时标志
  salvaged: Boolean,          // 已被打捞
  salvageComplete: Boolean    // 打捞完成
}
```

### 2.3 残骸生命周期

```
创建 → 可见/可交互 → 玩家拾取物品 → isEmpty=true (空残骸)
                                    ↓
                              过期 (expiresAtMs)
                                    ↓
                              自动销毁 (destroyNativeWreck)
```

---

## 三、物品拾取系统

### 3.1 拾取流程

```
玩家打开残骸 (客户端 RPC)
  ↓
invBrokerService._moveSourceItemToDestination()
  ↓
判断 sourceKind === "nativeWreck"
  ↓
nativeNpcWreckService.transferNativeWreckItemToCharacterLocation()
  ↓
1. 验证参数 (characterID, wreckID, wreckItemID, destinationLocationID)
2. 读取残骸记录和物品记录
3. 验证物品属于该残骸
4. 检查数量 (requestedQuantity <= availableQuantity)
5. 调用 grantItemToCharacterLocation() 添加到玩家货舱
6. 更新残骸物品:
   - 全部取走 → removeNativeWreckItem()
   - 部分取走 → 减少 quantity
7. 刷新残骸实体状态 (isEmpty)
8. 返回变更结果
```

### 3.2 关键函数

```javascript
// nativeNpcWreckService.js
function transferNativeWreckItemToCharacterLocation(options) {
  // 参数验证
  if (!characterID || !wreckID || !wreckItemID || !destinationLocationID) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }

  // 获取记录
  const wreckRecord = nativeNpcStore.getNativeWreck(wreckID);
  const wreckItemRecord = nativeNpcStore.getNativeWreckItem(wreckItemID);

  // 验证归属
  if (wreckItemRecord.wreckID !== wreckID) {
    return { success: false, errorMsg: "ITEM_NOT_FOUND" };
  }

  // 检查数量
  if (requestedQuantity > availableQuantity) {
    return { success: false, errorMsg: "INSUFFICIENT_ITEMS" };
  }

  // 授予物品到玩家位置
  const grantResult = grantItemToCharacterLocation(
    characterID, destinationLocationID, destinationFlagID,
    itemType, quantity, { singleton, moduleState }
  );

  // 更新残骸
  if (singleton || requestedQuantity === availableQuantity) {
    nativeNpcStore.removeNativeWreckItem(wreckItemID);
  } else {
    nativeNpcStore.upsertNativeWreckItem({
      ...wreckItemRecord,
      quantity: availableQuantity - requestedQuantity
    });
  }

  // 刷新残骸状态
  refreshNativeWreckRuntimeEntity(wreckRecord.systemID, wreckRecord.wreckID);
}
```

---

## 四、v0.12.2 残骸无法拾取问题深度分析

### 4.1 问题现象

- ✅ 残骸正常生成（可见）
- ❌ 无法从残骸中拾取物品
- ❌ 与 v0.12.1 对比：v0.12.1 可正常拾取，且高价值物品几率较大

### 4.2 核心代码一致性验证

经过逐文件比对，以下文件在 v0.12.1 和 v0.12.2 中**完全相同**：

| 文件路径 | 功能 |
|---------|------|
| `server/src/space/npc/npcLoot.js` | 掉落生成核心逻辑 |
| `server/src/space/npc/nativeNpcWreckService.js` | 残骸创建与物品转移 |
| `server/src/space/npc/nativeNpcStore.js` | 残骸数据存储层 |
| `server/src/space/npc/npcData.js` | NPC 数据索引 |
| `server/src/space/npc/nativeNpcService.js` | NPC 创建 |
| `server/src/space/npc/beltRatRuntime.js` | 海盗生成 |
| `server/src/space/wreckUtils.js` | 残骸工具 |
| `server/src/services/inventory/itemStore.js` | 物品存储 |
| `server/src/services/inventory/spaceDebrisState.js` | 碎片状态 |
| `tools/.../npcLootTables/data.json` | 掉落表数据 |
| `tools/.../npcProfiles/data.json` | NPC 配置文件 |
| `tools/.../npcLoadouts/data.json` | NPC 装备 |
| `tools/.../npcSpawnPools/data.json` | 生成池 |
| `tools/.../npcSpawnGroups/data.json` | 生成组 |
| `tools/.../npcBehaviorProfiles/data.json` | 行为配置 |

### 4.3 变更文件分析

v0.12.2 中变更的文件与掉落/残骸系统**无直接关联**：

| 变更文件 | 变更内容 | 影响掉落? |
|---------|---------|----------|
| `sqliteStore.js` | 新增 _persistence_outbox | ⚠️ 可能 |
| `gameStore/index.js` | 测试存储验证 | ⚠️ 可能 |
| `persistenceWorker.js` | 持久化改进 | ⚠️ 可能 |
| `shipDestruction.js` | 玩家飞船销毁 | ❌ 不影响 NPC 残骸 |
| `runtime.js` | Bastion/结构体 | ❌ 不影响 |
| `npcBehaviorLoop.js` | 隐身检测 | ❌ 不影响 |
| `dogmaService.js` | 武器热量 | ❌ 不影响 |
| `invBrokerService.js` | 公司仓库权限 | ❌ 不影响残骸拾取 |

### 4.4 根因假设与验证

#### 假设 1: SQLite 持久化路径变更 (最可能)

**依据**: v0.12.2 新增 `_persistence_outbox` 表，改变了写入机制

```sql
CREATE TABLE IF NOT EXISTS _persistence_outbox (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL UNIQUE,  -- 同一表只能有一个未完成操作
  upserts_json TEXT NOT NULL,
  deletes_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'applied')),
  created_at TEXT NOT NULL,
  applied_at TEXT
);
```

**潜在问题**:
- 新的异步持久化可能延迟了 `npcWreckItems` 表的写入
- 当玩家尝试拾取时，物品记录可能尚未提交到 SQLite
- 或者读取时从缓存读取到过期数据

**验证方法**:
```javascript
// 在 destroyNativeNpcEntityWithWreck 末尾添加:
const wreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID);
console.log('[DEBUG] Wreck items after creation:', wreckItems.length);
console.log('[DEBUG] Items:', JSON.stringify(wreckItems, null, 2));

// 在 transferNativeWreckItemToCharacterLocation 开头添加:
console.log('[DEBUG] Transfer request:', options);
const item = nativeNpcStore.getNativeWreckItem(options.wreckItemID);
console.log('[DEBUG] Item found:', item);
```

#### 假设 2: 数据迁移导致掉落表 ID 丢失

**依据**: 如果从 v0.12.1 的数据库迁移到 v0.12.2，可能丢失关联

**验证方法**:
```javascript
// 检查 NPC 的 lootTableID 是否正确
const npcRecord = nativeNpcStore.getNativeEntity(entityID);
console.log('[DEBUG] NPC lootTableID:', npcRecord.lootTableID);

const lootTable = getNpcLootTable(npcRecord.lootTableID);
console.log('[DEBUG] Resolved lootTable:', lootTable);
```

#### 假设 3: 空残骸率配置异常

**依据**: emptyChance 控制空残骸概率

| 船体尺寸 | emptyChance |
|---------|-------------|
| Small (驱逐及以下) | 22% |
| Medium (巡洋舰) | 18% |
| Large (战列舰) | 8% |

如果所有掉落表都返回空，可能是：
- lootTable 解析失败返回 null
- NPC 的 lootTableID 为 null

**验证方法**:
```javascript
// 在 rollNpcLootEntries 调用前后
console.log('[DEBUG] Input lootTable:', lootTable);
const entries = rollNpcLootEntries(lootTable);
console.log('[DEBUG] Rolled entries count:', entries.length);
```

#### 假设 4: isEmpty 标志错误

**依据**: 如果 `buildNativeWreckRuntimeEntity` 中 `isEmpty` 被错误设为 true，客户端可能不显示物品列表

```javascript
entity.isEmpty = nativeNpcStore.listNativeWreckItemsForWreck(wreckID).length === 0;
```

**潜在问题**: 如果此时物品尚未写入（异步时序问题），isEmpty 会被错误设为 true

#### 假设 5: 客户端-服务器同步问题

v0.12.2 的 `clientSession.js` 变更:
```javascript
// v0.12.1
const unpickledPayload = [1, payloadTuple];

// v0.12.2
const unpickledPayload = [0, [1, payloadTuple]];
```

这可能影响广播通知的解析，但不太可能直接影响残骸物品列表。

### 4.5 综合结论

**v0.12.2 的残骸掉落问题不是由掉落算法或残骸创建逻辑的代码变更引起的**。

最可能的原因是:

1. **SQLite 异步持久化路径变更** - 导致残骸物品写入与读取之间的时序问题
2. **数据库迁移问题** - 如果 v0.12.2 使用了未正确迁移的数据库
3. **缓存一致性** - 内存缓存与 SQLite 之间的数据同步延迟

### 4.6 建议修复方向

1. 在残骸生成后立即验证物品是否正确写入
2. 检查 `isEmpty` 标志的设置时机
3. 确认 `npcWreckItems` 表的持久化状态
4. 对比两个版本的 SQLite 数据库内容（特别是 npcLootTables 和 npcProfiles 表）
5. 检查 `transient` 标志是否导致物品未持久化

```javascript
// 推荐补丁位置: nativeNpcWreckService.js
// 在 destroyNativeNpcEntityWithWreck 末尾添加验证
const finalWreckItems = nativeNpcStore.listNativeWreckItemsForWreck(wreckRecord.wreckID);
if (finalWreckItems.length === 0 && rolledLootEntries.length > 0) {
  console.error('[LOOT BUG] Items rolled but not persisted!', {
    wreckID: wreckRecord.wreckID,
    rolledCount: rolledLootEntries.length,
    storedCount: finalWreckItems.length
  });
}
```
