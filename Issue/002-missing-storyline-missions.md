# 问题 #002: v0.12.2 剧情任务(Storyline Missions)全部消失

### 基本信息

| 字段 | 内容 |
|------|------|
| **问题编号** | #002 |
| **发现日期** | 2026-07-20 |
| **影响版本** | EveJS v0.12.2 |
| **正常版本** | EveJS v0.12.1 (部分可用) / EveJS v0.12.0 (推测正常) |
| **严重程度** | **高**（剧情任务是 EVE 社区/任务核心内容，影响社区与任务体验） |
| **状态** | 🔄 修复中 |
| **类别** | 任务/代理(Mission/Agent)系统 / 数据 / 配置 |
| **根因置信度** | ⭐⭐⭐⭐⭐ |

### 问题描述

在 **v0.12.1** 版本中，玩家打开 F11 Journal → 剧情任务(Storyline)标签 → 能看到剧情代理人（如 Sister Alitura）和任务简介，可对话、可接受任务。但完成任务后存在**死循环 bug**（请求新任务 → 接受/取消 → 回到请求新任务界面）。

升级到 **v0.12.2** 后，点击剧情任务标签 → **完全空白**，看不到任何代理人或任务简介。

**预期行为**:
1. 剧情任务从一开始就可见、可交互（无需完成 16 个普通任务）
2. 完成 16 个普通任务后触发的应是**另一种特殊任务**，不是剧情任务
3. 任务流程应正常，不存在死循环

**实际行为**: v0.12.2 中剧情任务完全不可见。

### 排查过程

#### 第一步：确认代码文件是否被删除

通过文件对比确认：

- `server/src/services/agent/agentMissionRuntime.js` ✅ 存在 (6060 行)
- `server/src/services/agent/missionAuthority.js` ✅ 存在 (已修改)
- `server/src/services/agent/agentMgrService.js` ✅ 存在
- `server/src/services/agent/storylineAgentSelector.js` ✅ 存在
- `server/src/services/agent/missionRuntimeState.js` ✅ 存在
- `server/src/services/agent/epicArcStatusService.js` ✅ 存在
- `server/src/services/campaign/*` ✅ 存在
- `server/src/services/agency/customAgencyProviderService.js` ✅ 存在
- `server/src/services/account/tutorialSvcService.js` ✅ 存在
- `server/src/services/npe/*` ✅ 存在

**结论：代码文件完全没有被删除。** 服务通过 `server/index.js` 里的 `loadServices()` 按文件名约定 (`*Service.js`) 自动加载，无任何白名单/黑名单机制，因此所有代理(Agent)相关服务均正常注册。

#### 第二步：确认静态数据是否被删除

对比 `tools/DatabaseCreator/staticTables/`:

| 静态表 | v0.12.1 | v0.12.2 (当前 HEAD) | 说明 |
|--------|---------|---------|------|
| missionAuthority/data.json | — | 2,878 missions | 当前 `isStoryline:true` 仍有 1,249 条 |
| 其中 `isStoryline:true` | — | **1,249** | ✅ 不变 |
| 其中 `isGenericStoryline:true` | — | **263** | ✅ 不变 |
| 其中 `isEpicArc:true` | — | **276** | ✅ 不变 |
| 其中 `isHeraldry:true` | — | **74** | ✅ 不变 |
| agentAuthority/data.json (fc00f8d, v0.12.1) | **10,941 agents, 1.46M 模板引用, missionTemplateCount:640** | — | 有填充数据 |
| agentAuthority/data.json (当前 HEAD) | — | **10,941 agents, missionTemplateIDs 全部为空, missionTemplateCount:0** | **❌ 模板链接全部为空** |
| dungeonAuthority/data.json | — | 5,981 模板 | ✅ 完好 |

**结论：剧情任务记录本身仍在静态数据中（1,249条剧情任务、276条史诗弧）。** 但 `agentAuthority` 中的 agent→模板链接层被清空（从 v0.12.1 的 640 模板/1.46M 引用降至 0）。

#### 第三步：定位根因 —— v0.12.2 引入的制造任务策略

**git diff 全貌（fc00f8d → HEAD / v0.12.2）：**
```
agentAuthority/data.json: +10,922 / −1,483,946 行 (模板被清空)
```

> **Git 历史说明**: Git 仓库创建于 v0.12.2（a064ab9 Initial），之后通过 `fc00f8d` ("supplement v0.12.1") 补充提交 v0.12.1 的数据。因此 fc00f8d 在时间线上晚于 a064ab9，但内容为 v0.12.1。当前 HEAD 没有 fc00f8d 中的填充模板数据。

**关键变更文件 (fc00f8d → HEAD):**

| 文件 | v0.12.1 → v0.12.2 | 作用 |
|------|-------------------|------|
| `server/src/config/productionMissionPolicy.js` | **新增 (+250行)** | 任务策略验证与谓词 |
| `server/src/config/productionMissionPolicy.json` | **新增 (+44行)** | 策略配置 |
| `tools/DatabaseCreator/production-mission-policy.js` | **新增 (+513行)** | 构建时静态表清洗 |
| `tools/DatabaseCreator/enforce-production-mission-policy.js` | **新增 (+153行)** | 新运行器 |
| `tools/DatabaseCreator/build-scraped-mission-authority.js` | 大幅缩减 (-403行) | 原有抓取逻辑删除 |
| `server/src/services/agent/missionAuthority.js` | **大量修改 (+374/-49)** | **运行时门控逻辑变化** |
| `server/src/services/agent/agentMissionRuntime.js` | 修改 (+10/-19) | 任务选择无回退池 |
| `server/src/services/agent/missionRuntimeState.js` | 修改 (+257/-12) | 退休任务清理 |

#### 第四步：分析运行时门控逻辑（根本原因）

`missionAuthority.js` 中新增的关键函数：

**`isOrdinarySecurityAgent`**（约 607–611 行）：
```js
function isOrdinarySecurityAgent(agentRecord = null) {
  return normalizeText(agentRecord && agentRecord.missionKind, "").toLowerCase() === "encounter"
    && !isExplicitStorylineAgent(agentRecord)
    && !hasAgentSpecificMissionIDs(agentRecord);
}
```

**`isMissionOfferAllowedForAgent`** + **`listMissionIDsForAgent`**（约 694+ 行）：
```js
if (isOrdinarySecurityAgent(agentRecord) &&
    !isGoldenSecurityMissionRecord(missionRecord, agentRecord.level)) {
  return false;   // <-- 普通安全代理除非是 golden，否则全部挡掉
}
```

**结果：**
1. **Level 1 普通 "encounter" 安全代理现在仅能白名单提供 4 个 golden 安全任务**（IDs: 1182、2504、2925、13735），它们的更广泛任务池被故意退休。
2. **Agent→模板链接被清空。** 静态表对比显示 `agentAuthority` 在 v0.12.1 中 10,919 个 agent 带有 `missionTemplateIDs`（主要是 eve-survival dungeon 模板），v0.12.2 中全部被清空为 `[]`；`missionPoolsByKindAndLevel` 从 6 降到 0。
3. **`agentMissionRuntime.js`（约 4840 行）** 里的选择逻辑：

```js
isOrdinarySecurityAgent ? [] : getMissionTemplatePool(agentRecord,...)
```

普通安全代理没有回退模板池。
4. **剧情任务仅通过显式的 storyline/epicArc/heraldry 等标记才可能被提供。** 如果玩家与剧情任务的交互依赖之前的"松散安全代理→eve-survival模板→任务"链路，这条链路现在已被切断。
5. **部分环境变量调试钩子被移除。** v0.12.1 曾有的 `EVEJS_FORCE_MISSION_TEMPLATE` 和 `EVEJS_FORCE_MISSION_DUNGEON_ID` 在 v0.12.2 中被移除；但 `EVEJS_FORCE_MISSION_ID` 仍保留（agentMissionRuntime.js:4820）。

#### 第五步：生产任务策略配置内容

**`server/src/config/productionMissionPolicy.json`：**
```json
{
  "version": 1,
  "goldenSecurityMissions": [
    { "missionID": 1182,  "dungeonID": 283,  "agentLevel": 1, "templateID": "client-dungeon:283" },
    { "missionID": 2504,  "dungeonID": 875,  "agentLevel": 1, "templateID": "client-dungeon:875" },
    { "missionID": 2925,  "dungeonID": 1940, "agentLevel": 1, "templateID": "client-dungeon:1940" },
    { "missionID": 13735, "dungeonID": 3030, "agentLevel": 1, "templateID": "client-dungeon:3030" }
  ],
  "disabledMissions": [
    { "missionID": 4743, "templateIDs": ["eve-survival:NewSlaves1"] }
  ],
  "generatedMissionIDRange": { "minInclusive": 900000000, "maxExclusive": 901000000 },
  "retiredTemplatePrefixes": ["eve-survival:"]
}
```

**核心问题：策略是硬编码的，不可通过环境变量或配置文件覆盖。**

### 根因结论 ⭐⭐⭐⭐⭐（2026-07-21 更新：完整流程追踪后精确定位）

**剧情任务的"offer 生成管线"是死代码。** 三个关键函数已定义并导出，但在整个代码库中**零调用**。因此 `storylineProgress.pendingOffersByAgentID` 永远为 `{}`，导致 journal/offer 界面永远为空。

#### 🔴 死代码管线（根本原因）

| 函数 | 文件:行号 | 调用者数量 |
|------|---------|----------|
| `recordPendingStorylineOffer(...)` | missionRuntimeState.js:947 | **0** |
| `markStorylineMilestoneIssued(...)` | missionRuntimeState.js:880 | **0** |
| `findNearestStorylineAgent({...})` | storylineAgentSelector.js:167 | **0** |

**应该工作的流程**:
```
完成任务 → recordStorylineQualifyingCompletion → reachedMilestone === true
  → findNearestStorylineAgent (找最近剧情代理)
  → recordPendingStorylineOffer (写入角色状态)
  → journal 显示 via buildPendingStorylineOfferJournalRows
```

**实际代码** (agentMissionRuntime.js:5225):
```js
recordStorylineQualifyingCompletion(characterState, agentRecord, missionRecord, {
  completedAtFileTime,
});
return cloneValue(missionRecord);   // ← milestone 结果被丢弃！
// 下方没有调用 findNearestStorylineAgent / recordPendingStorylineOffer
```

结果: `pendingOffersByAgentID` 永远 = `{}` → journal 永远空。

**影响**: 即使恢复全部数据 + 新建角色完成 16 个普通任务，剧情 offer 也**永远不会出现**。

#### 🟠 为什么数据恢复后仍然为空

完整 journal 读取路径:
```
Handle_GetMyJournalDetails → getJournalDetails (line 5247)
  ├─ missionRows = characterState.missionsByAgentID (普通任务，正常)
  └─ pendingStorylineRows = buildPendingStorylineOfferJournalRows (line 4257)
       └─ 读取 storylineProgress.pendingOffersByAgentID → 永远 {} → 永远 []
```

剧情 offer **仅**来自 `pendingOffersByAgentID`，不来自普通任务路径。

#### 🟡 数据层面的问题（仍需修复）

| 问题 | 位置 | 说明 |
|------|------|------|
| agentAuthority 模板丢失 | HEAD fc00f8d 差 | missionTemplateCount 0→640，已恢复 |
| dungeonAuthority 运行时缺少 eve-survival 模板 | 构建时清洗 | 源文件有 eve-survival 模板（约 200 万行），但 `enforce-production-mission-policy.js` 在构建时通过 `sanitizeDungeonAuthority` 全部清洗；`getMissionTemplatePool` 运行时返回 [] |
| isExplicitStorylineAgent 依赖数据标志 | missionAuthority.js:598 | 靠 `importantMission:true` 而非 agentTypeID 判断；fragile 但不是当前阻断 |

#### ⚪ 设计意图（非 bug）

| 行为 | 说明 |
|------|------|
| type-2 普通代理 deny-by-default | `isOrdinarySecurityAgent` 强制 pool=[]，仅 4 个 golden 任务 — 是 v0.12.2 设计 |
| STORYLINE_THRESHOLD = 16 | 需完成 16 个普通任务才触发剧情 — 但触发代码本身是死代码 |

### 建议排查步骤

1. 确认 `missionAuthority/data.json`（v0.12.2）中 `counts.storyline` / `isStoryline` 标志是否仍为 1,249（理论应不变）。
2. 客户端测试：登录 v0.12.2 后与 Type-6 (generic storyline) / Type-7 (storyline) 代理 NPC 对话，看是否仍可触发剧情任务。
3. 检查是否存在因为门控导致普通安全代理本应提供的剧情任务全部被过滤。
4. 检查 `missionRuntimeState.js` 中退休清理是否误删了角色的正在进行中的剧情任务记录。

### 建议修复方向

1. **方案 A（策略回滚/放宽）**: 
   - 修改 `productionMissionPolicy.json`，扩大 golden 任务列表或放开普通代理的门控（移除非 golden 安全代理的拒绝逻辑，恢复至少部分 fallback 池）。
   - 或把策略配置项暴露到 `config/index.js` 的 `CONFIG_ENTRY_DEFINITIONS` 中，允许通过 `evejs.config.local.json` 或环境变量开关控制。
   - **优点**：最小改动，立即可恢复剧情任务可见性。
   - **缺点**：如果移除策略是为了回滚 scraped/低质量内容，则需另外处理。

2. **方案 B（保持策略但修复链路）**:
   - 在 `missionAuthority.js` 中，让被退休的普通安全代理通过一个明确的"允许的任务池"（不含 eve-survival）重新提供剧情任务；
   - 或给剧情任务恢复一个独立于 eve-survival 的模板池。
   - **优点**：保留策略理念，同时修复剧情任务可达性。
   - **缺点**：改动较大，需要明确每个普通代理应回退到的任务集合。

3. **方案 C（数据修复）**:
   - 让 `production-mission-policy.js` 在清洗时区分"剧情任务"和"eve-survival 生成任务"，避免一刀切地删除模板链接；
   - 为剧情 agent（agentTypeID=6,7,10）显式保留 `missionTemplateIDs` 和对应 dungeon 模板。
   - **优点**：精确修复，不需要改动运行逻辑。
   - **缺点**：需要重新确认哪些数据是 eve-survival 爬虫生成的、哪些是 CCP 原版数据。

### 相关文件

- [Issue/001-wreck-loot-not-pickable.md](001-wreck-loot-not-pickable.md) — 另一个 v0.12.2 回归问题
- [Doc/Mission_Agent_System_Analysis.md](../Doc/Mission_Agent_System_Analysis.md) — 剧情任务系统专项分析文档
- [CLAUDE.md](../../CLAUDE.md) — 项目总览文档
- [Doc/Service_Modules_Reference.md](../Doc/Service_Modules_Reference.md) — 服务模块参考

### 相关代码

| 路径 | 作用 |
|------|------|
| `Code/server/src/services/agent/agentMissionRuntime.js` | 主任务运行时 (~6060行) |
| `Code/server/src/services/agent/missionAuthority.js` | 任务权限与门控逻辑 |
| `Code/server/src/services/agent/agentMgrService.js` | agentMgr 服务绑定 |
| `Code/server/src/services/agent/storylineAgentSelector.js` | 剧情代理发现 |
| `Code/server/src/services/agent/missionRuntimeState.js` | 任务运行时状态 + 退休清理 |
| `Code/server/src/services/agent/epicArcStatusService.js` | 史诗弧状态 |
| `Code/server/src/config/productionMissionPolicy.json` | 制造任务策略配置 (v0.12.2 新增) |
| `Code/server/src/config/productionMissionPolicy.js` | 策略的运行时验证与谓词 |
| `Code/tools/DatabaseCreator/production-mission-policy.js` | 构建时静态表清洗 (v0.12.2 新增) |
| `Code/tools/DatabaseCreator/enforce-production-mission-policy.js` | 构建运行器 |
| `Code/tools/DatabaseCreator/staticTables/missionAuthority/data.json` | 静态任务表 (1,249 剧情任务) |
| `Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json` | 静态代理表 (10,941 agents) |

### 附：版本差异关键数据

```
Git 提交历史 (从早到晚):
  0e7dd95  Initial commit
  a064ab9  "UpdateVersion : v0.12.2"         ← 仓库创建于 v0.12.2
  fc00f8d  "supplement v0.12.1"              ← 补充 v0.12.1 数据 (有填充模板)
  711ee84  update README
  e6c3373  HEAD (当前)                       ← 模板数据为空

agentAuthority/data.json 对比:
  fc00f8d (v0.12.1 补充): 1,896,106 行, missionTemplateCount: 640, missionPoolCount: 6
  HEAD (当前 v0.12.2):     423,082 行,   missionTemplateCount: 0,  missionPoolCount: 0
  差异: +10,922 / −1,483,946 行 (模板被清空)

剧情任务记录数 (missionAuthority 中): 不变
  - 1,249 isStoryline / 263 genericStoryline / 276 epicArc / 74 heraldry
```

---

## 深度分析

> 这部分内容已同步收录于 [Doc/Mission_Agent_System_Analysis.md](../Doc/Mission_Agent_System_Analysis.md)。

### `missionAuthority.js` 运行流程变更

v0.12.1 流程:
```
玩家访问 Agent
  → agentMgrService.GetAvailableMissionsFromSupplier
  → missionAuthority.listMissionIDsForAgent(agentRecord)
    → 每个 missionID 直接加入候选池（宽松，有 fallback 模板池）
    → missionPoolsByKindAndLevel 提供回退任务
```

v0.12.2 流程:
```
玩家访问 Agent (itemID)
  → agentMgrService.GetAvailableMissionsFromSupplier
  → missionAuthority.listMissionIDsForAgent(agentRecord)
    → 判断 isOrdinarySecurityAgent?
      - YES: 仅 golden 任务 + agent-specific 任务可通过
      - NO:  走剧情/史诗弧/研究分支
    → sanitizePayload() 清洗所有标志退休内容的记录
```

### 受影响的任务类型

| 类别 | v0.12.1 (fc00f8d) | v0.12.2 (HEAD) | 受影响 |
|------|---------|---------|--------|
| 普通安全代理 + eve-survival 模板 (640个) | ✅ 提供 | ❌ 模板被清空 | **🔴 主路径切断** |
| 6 个 missionPoolsByKindAndLevel 池 | ✅ | ❌ 全部为空 `{}` | **🔴 池消失** |
| Type-6 generic storyline agent (651个) | ✅ | ⚠️ 数据在但运行时读不到 | **🟠 间接影响** |
| Type-7 storyline agent (11个) | ✅ | ⚠️ 数据在但运行时读不到 | **🟠 间接影响** |
| 4 golden L1 安全任务 (1182/2504/2925/13735) | ✅ | ✅ 特供 | 不受影响 |
| 任务 4743 (新奴隶1) | ✅ | ❌ disabled | 单个禁用 |
| eve-survival: 前缀模板 | ✅ | ❌ retiredTemplatePrefixes 过滤 | **🟡 三重过滤** |

### 剧情任务的静态数据格式参考

`missionAuthority/data.json` 中 `missionsByID` keyed by `missionID`:
```json
{
  "missionID": 2919,
  "contentTemplate": "agent.missionTemplatizedContent_GenericStorylineCourierMission",
  "missionKind": "courier",
  "missionFlavor": "genericStoryline",
  "isStoryline": true,
  "isGenericStoryline": true,
  "contentID": null,
  "killMission": null
}
```

### 代理的 agentTypeID 含义

| typeID | 含义 | 数量 |
|--------|------|------|
| 2 | 普通安全代理 | 8,751 |
| 6 | 通用剧情 (GENERIC_STORYLINE) | 651 |
| 7 | 剧情 (STORYLINE) | 11 |
| 8 | 其他 | 696 |
| 10 | 类剧情 | — |

`importantMission: true` 在 `[6,7,10].includes(agentTypeID)` 时为 true。

---

## 数据恢复尝试与后续分析（2026-07-21）

> 按用户要求：优先恢复数据 → 验证逻辑 → 再决定是否修改代码逻辑。

### D1. 已执行的恢复操作

#### D1.1 agentAuthority/data.json 恢复

从 fc00f8d（supplement v0.12.1）恢复了填充版本：

```bash
git show fc00f8d:Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json \
  > Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json
```

| 指标 | HEAD（恢复前） | fc00f8d（恢复后） |
|------|--------------|-----------------|
| 行数 | 423,082 | 1,896,106 |
| missionTemplateCount | 0 | 640 |
| missionPoolCount | 0 | 6 |
| 模板前缀分布 | — | `eve-survival:` = 640（100%） |

#### D1.2 dungeonAuthority / missionAuthority 恢复

用户同时恢复了 `dungeonAuthority/data.json` 和 `missionAuthority/data.json`。

#### D1.3 运行时数据重建

```bash
cd Code/tools/DatabaseCreator
node --max-old-space-size=8192 database-creator.js \
  --sde-dir ../../_local/sde/eve-online-static-data-3396210-jsonl \
  --out ../../_local/gameStore/data --build 3396210 --force
```

重建成功时运行时数据：

| 指标 | 运行时 (_local/gameStore/data/) |
|------|------|
| agentAuthority 行数 | 1,892,333 |
| missionTemplateCount | 639（比 640 少 1 = disabledMissions 中 4743/NewSlaves1 被正确移除）|
| missionPoolCount | 6 |

### D2. 恢复后的用户测试结果

**测试结果**: 用户在恢复三个 data.json 并重建后登录游戏，**"代理人任务/剧情任务下还是空的"**。

→ **结论: 数据恢复不足使任务可见，问题在代码逻辑层面。**

### D3. 代码逻辑分析

#### D3.1 构建时数据流（database-creator.js）

关键发现: `agentAuthority` 是 `PRESERVED_STATIC_AUTHORITY_TABLE`—构建时：
1. 从 `staticTables/agentAuthority/data.json` 读取
2. 在内存中运行 `sanitizeAgentAuthority`（移除 retired/禁用的 ID）
3. **不会修改源文件**，只写入输出到 `_local/gameStore/data/`
4. `buildAgentAuthority()` 中硬编码的 `missionTemplateIDs: []` **从不用于此表**的输出

#### D3.2 运行时读取路径（gameStore/index.js resolveDataDir）

```
优先级 1: EVEJS_GAMESTORE_DATA_DIR 环境变量
优先级 2: _local/gameStore/data/  (manifest.json 存在时)
优先级 3: server/src/gameStore/data/  (fallback)
```

→ 服务器读 `_local/gameStore/data/agentAuthority/data.json`

#### D3.3 任务提供主流程追踪

```
玩家打开代理对话 → agentMgrService.Handle_DoAction
  → actionID === REQUEST_MISSION
    → agentMissionRuntime.doAgentAction (line 5807)
      → offerMission (line 4797)
        → pool = isOrdinarySecurityAgent ? [] : getMissionTemplatePool(agentID)
        → availableClientMission = pickMissionForAgent(agentRecord)
        → if (!pool.length && !availableClientMission) return unavailable
```

#### D3.4 恢复的 missionTemplateIDs 为何无效

**`getMissionTemplatePool` (line 372)** 读取 `agentRecord.missionTemplateIDs`（639 个 `eve-survival:*` ID），然后对每个 ID 调用 `getMissionTemplateRecord` → `dungeonAuthority.getTemplateByID`。

问题: `dungeonAuthority` 中 **没有 `eve-survival:*` 模板定义**（dungeonAuthority 使用 `agent.missionTemplatizedContent_*` 命名空间）。

结果: `getMissionTemplatePool` 返回 `[]` — 对 **所有代理** 均如此（无论类型）。

#### D3.5 剧情代理的实际工作路径（独立于恢复的数据）

`offerMission` 有两条路径：
- 路径 A: `pool` (missionTemplateIDs → dungeon 模板) → **永远返回 []**
- 路径 B: `pickMissionForAgent` → `listMissionIDsForAgent`

`listMissionIDsForAgent` (line 826) 对 type-6 剧情代理的流程:
```
1. agentIDToMissionIDs 索引（54 个 key，仅史诗弧/特定代理）
2. isOrdinarySecurityAgent? → FALSE (importantMission:true)
3. templateBoundMissionIDs = listTemplateBoundMissionIDsForAgent → []
   (此函数 gate 在 kind==="encounter"，对 courier/mining 返回 [])
4. preferredMissionIDs = listPreferredMissionCandidateIDs
   → buildAgentPreferenceKeys → ["storylineEncounter","genericStorylineEncounter","basicEncounter"]
   → 查 preferredMissionIDs 索引 → 得到具体 missionID
   → 每个 missionID 有 contentTemplate (如 agent.missionTemplatizedContent_StorylineKillMission)
   → listMissionIDsByTemplate 展开
5. isExplicitStorylineAgent? → TRUE
6. 返回 storylineCandidateIDs (preferred 几百个)
```

→ `pickMissionForAgent` 应返回有效任务 → `offerMission` 应成功创建 offer。

#### D3.6 待确认的阻断点

虽然代码路径分析显示 type-6 剧情代理应能提供任务（通过 preferredMissionIDs），但用户测试结果为空。可能原因:

1. **`ensureCharacterState` 中的退休清理** (missionRuntimeState.js line 1118+): 可能在角色状态初始化时错误地清除了某些必要的 storyline 状态
2. **`isRetiredActiveMissionRuntimeRecord`** (missionRuntimeState.js line 71+): 可能在 offer 流程中被调用并过滤了任务
3. **pendingOffersByAgentID 死代码**: `recordPendingStorylineOffer` 被定义但从未被外部调用 — 剧情 offer 的 journal 行依赖此数据
4. **未知的运行时条件**: 可能有其他运行时检查阻止了任务 offer

#### D3.7 普通安全代理 (type-2) 的 deny-by-default

| 路径 | 结果 |
|------|------|
| `isOrdinarySecurityAgent` → TRUE | pool = []（故意）|
| `listMissionIDsForAgent` → `listGoldenSecurityMissionIDsForAgent` | 仅 4 个 L1 任务 |
| Level 2+ 代理 | 无 golden 任务 → 返回 unavailable |

→ 这是 v0.12.2 的**设计意图**，不是 bug。

### D4. 后续修复方向（待实施）

#### 修复死代码管线（必须）

在 `agentMissionRuntime.js` 的 `completeMission` 流程中（约 line 5225），当 `recordStorylineQualifyingCompletion` 返回 `reachedMilestone === true` 时，需要:

1. 调用 `findNearestStorylineAgent` 找到最近的同阵营剧情代理
2. 调用 `recordPendingStorylineOffer` 将 offer 写入角色状态
3. 这样 `buildPendingStorylineOfferJournalRows` 才能在 journal 中显示

#### 修复 eve-survival 模板解析（必须）

恢复的 639 个 `eve-survival:*` missionTemplateIDs 在运行时 dungeonAuthority 中无定义（构建时被清洗），`getMissionTemplatePool` 返回 `[]`。可选方案:
- 在 dungeonAuthority 源文件中补充 eve-survival 模板定义并禁用构建时清洗
- 或修改 `getMissionTemplatePool` 使其不依赖 dungeon 定义即可工作

#### 验证清单

- [ ] 修复 dead code 后，新建角色完成 16 个普通任务 → 验证剧情 offer 是否出现
- [ ] 修复后，type-6 剧情代理对话 → 验证任务是否正常提供
- [ ] 验证普通 type-2 代理仍保持 deny-by-default 行为（不应回归）

---

## 补充发现（2026-07-21 验证后新增）

> 通过对比 Tmp/EveJS-0.12.1（只读参考）与 Code 的代码差异，发现以下文档中未涉及的重要内容。

### S1. 死代码问题在 v0.12.1 中同样存在

对比 `Tmp/EveJS-0.12.1/server/src/services/agent/agentMissionRuntime.js:5234` 与 `Code/server/src/services/agent/agentMissionRuntime.js:5225`：

| 版本 | 代码行为 |
|------|---------|
| v0.12.1 | `recordStorylineQualifyingCompletion(...)` → `return cloneValue(missionRecord)` （返回值被丢弃） |
| v0.12.2 | 完全相同 |

三个死代码函数（`recordPendingStorylineOffer`、`markStorylineMilestoneIssued`、`findNearestStorylineAgent`）在 v0.12.1 中同样**零调用**。

**结论**：`pendingOffersByAgentID` 的死代码不是 v0.12.2 引入的回归，而是**历史遗留问题**。

### S2. 任务提供逻辑的关键差异（v0.12.1 → v0.12.2）

#### `listMissionIDsForAgent` 函数对比

| 步骤 | v0.12.1 | v0.12.2 |
|------|---------|---------|
| agent-specific 索引命中 | 过滤后返回 | 直接返回（不过滤） |
| 普通安全代理门控 | **无** | **有** → 仅返回 4 个 golden 任务 |
| 剧情代理路径 | **无专门路径** | **有** → 过滤 `isScriptedStorylineMissionRecord` |
| template-bound 检查 | 有 eve-survival 模板 → 返回 | 无 eve-survival 模板 → 返回空 |
| 最终回退 | `filterUnsupported(preferred)` | `filterUnsupported(preferred)` |

#### `offerMission` 函数对比

| 步骤 | v0.12.1 | v0.12.2 |
|------|---------|---------|
| pool 获取 | **所有 agents** 获取 `getMissionTemplatePool` | 仅非普通安全代理获取 pool |
| forcedMission 检查 | `if (forcedClientMission)` 真值检查 | `isMissionOfferAllowedForAgent()` 门控 |

#### v0.12.2 新增：`sanitizePayload`

- 过滤 `isPermanentlyDisabledMissionRecord`（任务 4743 等）
- 过滤 `isGeneratedScrapedMissionRecord`（generated/scraped 任务）
- 重建索引只保留存活任务

### S3. 待后续处理项（低优先级）

以下内容确认存在问题，但暂不深入分析，留待后续改进：

#### 死代码管线（历史遗留，两个版本共有）

**问题**：完成 16 个普通任务后触发的"特殊剧情 offer"路径永远不通。

**影响范围**：
- 玩家完成 16 个同派系普通任务后，不会收到剧情代理的特殊任务邀请
- journal 中 `pendingStorylineRows` 永远为空

**涉及函数**：
- `recordPendingStorylineOffer` (missionRuntimeState.js:947) — 零调用
- `markStorylineMilestoneIssued` (missionRuntimeState.js:880) — 零调用
- `findNearestStorylineAgent` (storylineAgentSelector.js:167) — 零调用

**可能的修复方向**（待后续分析确认）：
- 在 `agentMissionRuntime.js` 的 `completeMission` 流程中，当 `recordStorylineQualifyingCompletion` 返回 `reachedMilestone === true` 时：
  1. 调用 `findNearestStorylineAgent` 找到最近的同阵营剧情代理
  2. 调用 `recordPendingStorylineOffer` 将 offer 写入角色状态
  3. 这样 `buildPendingStorylineOfferJournalRows` 才能在 journal 中显示

**注意**：此问题不影响剧情代理直接提供的任务（type-6/type-7 代理通过 `preferredMissionIDs` 路径），仅影响"完成 N 轮普通任务后触发"的特殊剧情 offer。

---

## v0.12.0 对比分析（待补充）

> **状态**: ⏸️ 待获取运行时数据后继续分析

### 对比版本

| 版本 | 目录 | 说明 |
|------|------|------|
| v0.12.0 | `Tmp/EveJS-0.12.0/` | 推测剧情任务正常 |
| v0.12.1 | `Tmp/EveJS-0.12.1/` | 剧情任务部分可用（有死循环 bug） |
| v0.12.2 | `Code/` | 剧情任务完全不可见 |

### 代码差异（v0.12.0 → v0.12.2）

| 文件 | 变化 |
|------|------|
| `missionAuthority.js` | +423 行：新增 `sanitizePayload`、`isOrdinarySecurityAgent`、`isExplicitStorylineAgent` 等门控 |
| `missionRuntimeState.js` | +269 行：新增退休清理逻辑 |
| `agentMissionRuntime.js` | +29 行：移除调试钩子、新增门控 |
| `agentMgrService.js` | +2 行：新增 `listDisabledMissionIDs` |

### 待确认

- [ ] 获取 v0.12.0 运行时数据（`_local/gameStore/data/`）进行对比
- [ ] 确认 v0.12.0 中剧情任务是否真的正常
- [ ] 定位 v0.12.0 → v0.12.2 中导致剧情任务不可见的具体变更

---

## 修复方案（2026-07-21 更新）

### 修复目标

1. **剧情任务从一开始就可见** — 无需完成 16 个普通任务
2. **16 个普通任务后触发的特殊任务** — 不是剧情任务，是另一种奖励
3. **修复死循环 bug** — 任务流程正常

### 修复方案

#### 方案 1：角色创建时初始化剧情 offer（推荐）

在 `missionRuntimeState.js` 的 `createDefaultStorylineProgress()` 中，预填充 `pendingOffersByAgentID`，使剧情代理从一开始就可见。

**优点**：最小改动，立即可见
**缺点**：需要确定预填充哪些代理

#### 方案 2：修改 `buildPendingStorylineOfferJournalRows`

修改该函数，使其不仅读取 `pendingOffersByAgentID`，还显示可用的剧情代理。

**优点**：更灵活
**缺点**：改动较大

#### 方案 3：修复死循环 + 初始化剧情 offer

同时修复死循环 bug 和初始化剧情 offer。

**死循环现象** (v0.12.1)：
1. 完成任务
2. 点击"请求新任务" → 出现接受/取消提示
3. 点击接受 → 回到"请求新任务"界面
4. 重复步骤 2-3

**死循环原因推测**：
- 运行时数据被清洗（`eve-survival:*` 模板缺失）
- `offerMission` 创建的任务缺少有效的 contentID
- 客户端接受任务后因数据无效而立即移除
- 玩家回到代理人对话框，再次点击"请求新任务" → 循环

**修复方向**：
- 运行 `CreateDatabase.bat` 应用恢复的静态数据
- 确保 `offerMission` 创建的任务有有效的 contentID
- 确保任务不会立即被标记为完成

---

## 已实施的修复（2026-07-21）

### Fix 1: 剧情任务从一开始就可见

**文件**: `Code/server/src/services/agent/agentMissionRuntime.js`

**修改内容**：
1. 新增 `listAgents` 导入
2. 修改 `buildPendingStorylineOfferJournalRows`：当 `pendingOffersByAgentID` 为空时，显示可用的剧情代理人
3. 新增 `listAvailableStorylineAgentJournalRows`：列出指定派系的剧情代理人（agentTypeID 6/7/10）
4. 新增 `buildAvailableStorylineAgentMissionRecord`：为可用剧情代理人生成任务记录

**效果**：玩家打开 F11 Journal → 剧情任务标签 → 能看到剧情代理人列表（按派系筛选）

### Fix 2: 待实施 — 应用运行时数据

需要运行 `CreateDatabase.bat` 将恢复的静态表数据应用到 `_local/gameStore/data/`。

### Fix 3: 待实施 — 修复死循环

需要运行时数据支持才能测试和修复。
