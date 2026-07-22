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

## 四、系统日志

> 本项目使用自定义日志系统 (`src/utils/logger/index.js`)，不使用 `console.log`。

### 4.1 日志 API

```javascript
const log = require(path.join(__dirname, "../../utils/logger"));

log.info("[Tag] key=value");    // 重要状态变更（控制台 + 文件）
log.debug("[Tag] key=value");   // 详细诊断（仅文件，需 logLevel ≥ 2）
log.warn("[Tag] key=value");    // 可恢复的失败
log.err("[Tag] key=value");     // 硬错误
```

### 4.2 日志标签

| 标签 | 用途 | 示例 |
|------|------|------|
| `[ShipDestruction]` | 舰船击杀/残骸生成 | `log.info("[ShipDestruction] Destroyed ship=123 type=456 wreck=789 system=30000142")` |
| `[NativeNpc]` | NPC 管理 | `log.warn("[NativeNpc] Pruned invalid transient controller entity=123")` |
| `[BeltRats]` | 海盗生成 | `log.debug("[BeltRats] spawned system=30000142 belt=456 faction=caldari")` |

### 4.3 关键日志点

| 事件 | 文件 | 日志示例 |
|------|------|---------|
| 残骸生成 | `space/shipDestruction.js:569` | `[ShipDestruction] Destroyed ship=X type=Y wreck=Z` |
| NPC 清理 | `space/npc/nativeNpcService.js:122` | `[NativeNpc] Pruned invalid transient...` |
| 海盗生成 | `space/npc/beltRatRuntime.js:1377` | `[BeltRats] spawned system=X belt=Y` |

> **注意**: `nativeNpcWreckService.js` 和 `nativeNpcStore.js` 本身不含日志。残骸相关日志在 `shipDestruction.js` 中输出。
