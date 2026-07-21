# EveJS 剧情任务 / 代理系统深度分析

> **版本**: EveJS v0.12.2 (2026-07)
> **关联问题**: [Issue/002-missing-storyline-missions.md](../Issue/002-missing-storyline-missions.md)
> **范围**: 剧情任务(Storyline)、代理(Agent)、史诗弧(Epic Arc)、职业代理(Campaign/Career)、教程(NPE/Opportunity)

---

## 一、概述

本文档分析 EveJS 中剧情任务相关系统的**代码、数据、版本变化**，以及 v0.12.1 → v0.12.2 版本间剧情任务"消失"的根因和修复方案。

### 关键结论

1. **代码未被删除** — 所有代理/剧情/Campaign 相关服务文件均存在且正常注册。
2. **剧情任务记录未删除** — 静态表中仍有 1,249 条 `isStoryline` 任务。
3. **数据链路被切断（主因）** — v0.12.2 新增的 `production-mission-policy.js` 清洗脚本删除了 eve-survival 模板和引用，导致剧情代理人无法提供任务。
4. **运行时门控收紧** — `missionAuthority.js` 引入 deny-by-default 策略，普通安全代理仅能白名单提供 4 个 golden 任务。
5. **修复方案** — 通过环境变量 `EVEJS_ENABLE_COMMUNITY_CONTENT_CLEANING=0` 或命令行参数 `--keep-community-content` 关闭清洗，保留 eve-survival 数据。

---

## 二、服务架构

### 2.1 服务加载机制

**加载器**: `Code/server/index.js`, 函数 `loadServices(dir)` (约 102–132 行)。

```js
// 基本逻辑：
fs.readdirSync(dir).forEach(file => {
  if (file.isFile()
      && file.name.endsWith("Service.js")    // 字面 10 字符匹配
      && file.name !== "baseService.js"
      && file.name !== "serviceManager.js") {
    const svc = require(path.join(dir, file.name));
    serviceManager.register(svc);
  }
});
```

**要点**:
- **无白名单/黑名单/条件注册** — 任何位于 `src/services/` 下、文件名为 `*Service.js` 的都会自动加载。
- 自动扫描是**递归**的，包含子目录（如 `agent/`, `campaign/`, `agency/`, `npe/`）。
- 辅助服务通过 `loadSecondaryServices(dir)` 加载 (`src/_secondary/*.js`)，仅在 `service.enabled === true` 时启动。
- 仅有一个手动别名：`trademgr` → `tradeMgr`。

### 2.2 剧情任务相关服务列表

| 服务 | 文件 | 功能 |
|------|------|------|
| agentMgr | `agent/agentMgrService.js` | 任务代理主服务；Handle_GetAvailableMissionsFromSupplier、GetMissionBriefingInfo、WarpToLocation |
| — | `agent/agentMissionRuntime.js` (~6060行) | 主任务运行时：offerMission、任务选择、掉落生成 |
| — | `agent/missionAuthority.js` | 任务权限 & 门控 (listMissionIDsForAgent、isOrdinarySecurityAgent、sanitizePayload) |
| — | `agent/missionRuntimeState.js` | 每位角色的进度：storylineProgress、epicArcProgress、退休清理 |
| — | `agent/storylineAgentSelector.js` | BFS 搜索最近同阵营剧情代理 |
| — | `agent/epicArcStatusService.js` | 史诗弧状态 |
| — | `agent/missionTrackerMgrService.js` | 任务日志/追踪器 |
| loginRewardFacilities | `campaign/loginRewardFacilitiesService.js` | 登录奖励 |
| — | `campaign/loginCampaignService.js` | 登录活动 |
| — | `campaign/crateService.js` | 箱子（crate）/ 战利品箱 |
| customAgency | `agency/customAgencyProviderService.js` | 自定义代理提供者 |
| tutorial | `account/tutorialSvcService.js` | 职业代理 (GetCareerAgents) |
| — | `npe/tutorialRuntime.js` | AIR/NPE 教程运行时 |
| — | `npe/tutorialHandoff.js` | 教程交接 |

**服务注册名（service.name）**: agentMgr、missionTrackerMgr 等。
**服务均未缺失** — 所有服务文件 v0.12.2 中仍存在且自动注册。

---

## 三、数据存储层

### 3.1 静态数据表 (JSON)

由 `tools/DatabaseCreator/staticTables/` 提供，加载类型 `PRESERVED_STATIC_AUTHORITY_TABLES`:

| 表 | 路径 | v0.12.1 规模 | v0.12.2 规模 | 变化原因 |
|----|------|-------------|--------------|---------|
| missionAuthority | `staticTables/missionAuthority/data.json` | — | 2,878 missions / 15MB | 当前 HEAD |
| agentAuthority (fc00f8d, v0.12.1) | `staticTables/agentAuthority/data.json` | 10,941 agents / **~73MB** | — | 有填充数据 |
| agentAuthority (HEAD, v0.12.2) | `staticTables/agentAuthority/data.json` | — | 10,941 agents / **~11.3MB** | missionTemplateIDs 全部清空 (−1.46M 行) |
| dungeonAuthority | `staticTables/dungeonAuthority/data.json` | — | 5,981 模板 / 78MB | ✅ 完好 |

**关键不变量**:

| 指标 | v0.12.1 (fc00f8d) | v0.12.2 (HEAD) | 状态 |
|------|---------|---------|------|
| `isStoryline:true` 任务 | 1,249 | **1,249** | ✅ 不变 |
| `isGenericStoryline:true` 任务 | 263 | **263** | ✅ 不变 |
| `isEpicArc:true` 任务 | 276 | **276** | ✅ 不变 |
| `isHeraldry:true` 任务 | 74 | **74** | ✅ 不变 |
| 剧情代理 (typeID 6/7) | 662 | **662** | ✅ 不变 |
| Agent 数 | 10,941 | 10,941 | ✅ 不变 |
| **missionTemplateCount** | **640** | **0** | ❌ 清空 |
| **missionPoolCount** | **6** | **0** | ❌ 清空 |
| **missionTemplateIDs 引用总数** | ~1.46M | **0** | ❌ 全清 |

> **结论**: 剧情任务记录本身完好，丢失的是 agent→模板 的链接层。

### 3.2 运行时数据表 (SQLite)

由 `server/src/gameStore/index.js` 的 `SQLITE_TABLES` 注册:

| 表 | 功能 |
|----|------|
| missionRuntimeState | 每位角色的活任务、提供、接受、完成记录 |
| dungeonRuntimeState | 活 dungeon 实例 |

这些表不涉及静态数据丢失问题。

### 3.3 运行时数据读取

服务器读取数据的路径优先级:
1. `_local/gameStore/data/<tableKey>/data.json` (本地 gameStore，gitignored)
2. `server/src/gameStore/data/<tableKey>/data.json` (gitignored 后备)
3. `tools/DatabaseCreator/staticTables/<tableKey>/data.json` (源数据)

> 注意: `_local/` 和 `src/gameStore/data/` 均被 `.gitignore` 排除（路径 `/server/src/gameStore/data/*/data.json`）。需通过 `tools/DatabaseCreator/CreateDatabase.bat` 重新生成。

---

## 四、v0.12.1 → v0.12.2 版本差异

### 4.1 提交历史

```
git log --oneline (从早到晚):
  0e7dd95   Initial commit
  a064ab9   "UpdateVersion : v0.12.2"        ← 仓库创建于 v0.12.2 (agentAuthority 模板为空)
  fc00f8d   "supplement v0.12.1"             ← 补充 v0.12.1 数据 (agentAuthority 有 640 模板 / 1.46M 引用)
  711ee84   update README
  e6c3373   HEAD (当前)                      ← 模板数据为空
```

> **说明**: Git 仓库创建于 v0.12.2（a064ab9），之后通过 fc00f8d 提交补充 v0.12.1 的数据。因此 fc00f8d 在时间线上晚于 a064ab9，但内容为更早的 v0.12.1。当前 HEAD 没有 fc00f8d 中的填充模板数据。

### 4.2 Git diff 总览

```
fc00f8d (v0.12.1 补充) → HEAD (v0.12.2 当前):

agentAuthority/data.json: +10,922 / −1,483,946 行 (模板被清空)
dungeonAuthority/data.json: 变化
missionAuthority/data.json: 变化
missionAuthority.js:        大量修改 (+374/−49)
missionRuntimeState.js:     修改 (+257/−12)
agentMissionRuntime.js:     修改 (+10/−19)
新增 productionMissionPolicy 文件 ×4
```

**文件变化分类**:

| 类别 | 数量 | 说明 |
|------|------|------|
| **新增** | ~6 | 生产任务策略文件 (productionMissionPolicy.js/.json、enforce-*.js、production-mission-policy.js) |
| **修改** | ~6 | 静态表 + 运行时逻辑 |
| **删除** | 0 | — |

### 4.3 新增文件（关键）

| 文件 | 作用 |
|------|------|
| `server/src/config/productionMissionPolicy.json` | 策略配置（golden/禁用/退休模板） |
| `server/src/config/productionMissionPolicy.js` | 运行时验证与谓词 |
| `tools/DatabaseCreator/production-mission-policy.js` | 构建时静态表清洗 |
| `tools/DatabaseCreator/enforce-production-mission-policy.js` | 新运行器（替代 build-scraped） |

### 4.4 修改文件（关键）

| 文件 | +/- | 影响 |
|------|-----|------|
| `missionAuthority.js` | +374/−49 | **引入运行时门控逻辑** |
| `missionRuntimeState.js` | +257/−12 | 退休任务清理 |
| `agentMissionRuntime.js` | +10/−19 | 任务选择无回退池 |
| `agentMgrService.js` | 小改 | GetDisabledMissions 列表 |
| `agentAuthority/data.json` | +10,922/−1,483,946 | **模板数据被清空** |
| `dungeonAuthority/data.json` | +2,590/−217,457 | 模板数据被清空 |
| `missionAuthority/data.json` | +8/−35,695 | 移除 eve-survival 生成任务 |

---

## 五、运行时的任务门控逻辑（核心机制）

### 5.1 `missionAuthority.js` 关键新增函数

**`isOrdinarySecurityAgent`**（约 607–611 行）:

```js
function isOrdinarySecurityAgent(agentRecord = null) {
  return normalizeText(agentRecord && agentRecord.missionKind, "")
           .toLowerCase() === "encounter"
    && !isExplicitStorylineAgent(agentRecord)
    && !hasAgentSpecificMissionIDs(agentRecord);
}
```

> 将 `missionKind === "encounter"` 且没有特定任务 ID 的普通安全代理识别为 "普通"。

**`isMissionOfferAllowedForAgent`** + **`listMissionIDsForAgent`**（约 694+ 行）:

```js
if (isOrdinarySecurityAgent(agentRecord)
    && !isGoldenSecurityMissionRecord(missionRecord, agentRecord.level)) {
  return false;   // 拒绝 — 普通安全代理只能提供 golden 任务
}
```

**`isRetiredOrdinaryEncounterMissionForAgent`**（约 666–692 行）: deny-by-default 拒绝普通 encounter/非 golden 任务。

**`isExactConfiguredGoldenMissionRecord`**（约 630–664 行）: 白名单验证。

**`sanitizePayload()`**: 清洗所有匹配退休/禁用条件的记录。

### 5.2 `productionMissionPolicy.json` 完整配置

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

**要点**:
- 策略是**硬编码**的，不可通过环境变量或配置文件覆盖。
- `retiredTemplatePrefixes: ["eve-survival:"]` — 几乎所有剧情任务模板都使用 `eve-survival:` 前缀，因此即使数据恢复，这些模板也会被过滤。
- 仅 4 个 golden L1 安全任务被白名单保留。

### 5.3 `agentMissionRuntime.js` 任务选择逻辑（约 4840 行）

```js
isOrdinarySecurityAgent ? [] : getMissionTemplatePool(agentRecord, ...)
```

普通安全代理没有回退模板池。

### 5.4 被移除的调试钩子

v0.12.0/v0.12.1 中存在、v0.12.2 中移除的环境变量:
- `EVEJS_FORCE_MISSION_TEMPLATE` — 临时调试钩子（标注 "Safe to delete this block"），用于 EveAnomUtility 内容测试
- `EVEJS_FORCE_MISSION_DUNGEON_ID` — ad-hoc 测试钩子

保留的环境变量:
- `EVEJS_FORCE_MISSION_ID` — 仍保留（agentMissionRuntime.js:4820）

---

## 六、剧情任务数据格式

### 6.1 任务记录 (`missionAuthority/data.json`)

```json
{
  "missionID": 2919,
  "contentTemplate": "agent.missionTemplatizedContent_GenericStorylineCourierMission",
  "missionKind": "courier",
  "missionFlavor": "genericStoryline",
  "isStoryline": true,
  "isGenericStoryline": true,
  "contentID": null,
  "killMission": null,
  "localizedName": { "text": "..." },
  "localizedMessages": { "messages.mission.briefing": {...} }
}
```

**标志位**: `isStoryline` / `isGenericStoryline` / `isEpicArc` / `isHeraldry` / `isResearch` / `isAgentInteraction` / `isTalkToAgent` — 决定是否为"脚本任务" (`isScriptedMissionRecord`)。

### 6.2 代理记录 (`agentAuthority/data.json`)

```json
{
  "agentID": 3017665,
  "agentTypeID": 6,
  "careerID": 14,
  "schoolID": 18,
  "specialityID": 12,
  "missionKind": "encounter",
  "missionPoolKey": "kind:encounter|level:1|agentType:6|...",
  "missionTemplateIDs": [],   // ← v0.12.2 中为空
  "importantMission": true,
  "level": 1,
  "divisionID": 24,
  "factionID": 500004,
  "stationID": ...,
  "solarSystemID": ...
}
```

**agentTypeID 完整含义**:

| typeID | 名称 | 数量 | Level | importantMission | 任务类型 | 说明 |
|--------|------|------|-------|-----------------|---------|------|
| 2 | 普通安全代理 | 8,751 | 1-5 | ❌ | encounter/courier/mining/trade/distribution | 标准代理人，按派系/公司/等级分布 |
| 3 | 职业代理 | 14 | 1 | ❌ | courier | 特定职业方向 |
| 4 | 研究代理 | 244 | 1-4 | ❌ | research | 科技研究类任务 |
| 5 | 特殊代理 | 143 | 1-4 | ❌ | courier | CONCORD/特殊组织 |
| **6** | **通用剧情代理** | **651** | **1** | **✅** | encounter/courier/mining | **剧情任务核心代理人**，全部有 eve-survival 模板 |
| **7** | **剧情代理** | **11** | **1** | **✅** | encounter/courier | 高级剧情代理人 |
| 8 | 军团代理 | 696 | 1-5 | ❌ | courier | 军团相关任务 |
| 9 | 军团战斗代理 | 260 | 1-4 | ❌ | encounter | 军团相关任务 |
| **10** | **类剧情代理** | **47** | **1-4** | **✅** | encounter/courier/mining | **高级剧情类任务，包含血色星辰起点** |
| 11 | 其他代理 | 12 | 1 | ❌ | courier | 特殊任务 |
| 12 | 其他代理 | 100 | 1 | ❌ | encounter | 特殊任务 |
| 13 | 其他代理 | 12 | 1 | ❌ | courier | 特殊任务 |

`importantMission: true` 当 `[6,7,10].includes(agentTypeID)`。

### 6.3.1 Type-6 剧情代理人派系分布

| 派系 | 数量 | courier | encounter | mining |
|------|------|---------|-----------|--------|
| Caldari State | 135 | 57 | 48 | 30 |
| Amarr Empire | 131 | 59 | 44 | 28 |
| Gallente Federation | 142 | 80 | 47 | 15 |
| Minmatar Republic | 82 | 22 | 47 | 13 |
| 其他 15 个派系 | 161 | 混合 | 混合 | 混合 |

**关键数据**: 所有 651 个 Type-6 代理的 `missionTemplateIDs` 都指向 `eve-survival:*` 模板。

### 6.3 剧情代理发现

`storylineAgentSelector.js`: 662 个剧情代理 (agentTypeID 6/7) 按太阳系索引，通过 BFS (`findNearestStorylineAgent`) 在星门网络中搜索最近同阵营剧情代理。

### 6.4 剧情任务起点：Sister Alitura（血色星辰）

**Sister Alitura** (agentID: 3019356) 是 EVE Online 中著名的剧情任务起点代理人：

| 字段 | 值 |
|------|-----|
| 名称 | Sister Alitura |
| agentTypeID | **10** (类剧情代理) |
| 所属 | Sisters of EVE (姐妹会) |
| factionID | 500016 (Mordu Legion) |
| corporationID | 1000130 |
| missionKind | encounter |
| level | 1 |
| importantMission | True |
| solarSystemID | 30005001 |
| 任务线 | **The Blood-Stained Stars** (血色星辰) — 史诗级任务线 |
| 位置 | 阿尔蒙星域 (Armon) 的姐妹会办公署 |

**关键发现**: Sister Alitura 的 `missionTemplateIDs` 全部指向 `eve-survival:*` 模板（如 `eve-survival:AfterTheSeven1`, `eve-survival:AirShow1` 等）。这些模板在运行时被 `enforce-production-mission-policy.js` 清洗，导致她无法提供任务。

#### Sister Alitura 任务链（血色星辰 The Blood-Stained Stars）

AgentID: 3019356 | agentTypeID: 10 | 派系: Mordu Legion (500016)

| 序号 | Mission ID | 名称 | 类型 |
|------|-----------|------|------|
| 1 | 14117 | A Beacon Beckons | encounter |
| 2 | 14118 | Agent Inquiry | talkToAgent |
| 3 | 14122 | Jet-Canning a Janitor | encounter |
| 4 | 14123 | Chivvying a Chef | encounter |
| 5 | 14124 | Delivering a Doctor | encounter |
| 6 | 14125 | Engineering a Rescue | encounter |
| 7 | 14126 | Going Gallente | talkToAgent |
| 8 | 14138 | Royal Jelly | encounter |
| 9 | 14139 | Tracking the Queen (Part 1) | encounter |
| 10 | 14140 | Nature Pictures | courier |
| ... | ... | ... | ... |

**注意**: 这些任务标记为 `isEpicArc: True`（史诗弧），不是普通 `isStoryline`。它们是顺序解锁的，完成一个后才能进行下一个。

**玩家实际体验** (v0.12.1):
1. 打开 F11 Journal → 剧情任务标签 → 能看到 Sister Alitura 和任务简介
2. 接受任务 → 完成任务 → 出现死循环（请求新任务 → 接受/取消 → 回到请求新任务）
3. 但至少 NPC 可见、可对话、可交互

**玩家实际体验** (v0.12.2):
1. 打开 F11 Journal → 剧情任务标签 → **完全空白**，无任何内容
2. 无法看到任何剧情代理或任务简介

### 6.5 运行时状态

`missionRuntimeState` 存储每位角色的:
- `storylineProgress`: 按 faction×level 的计数器、里程碑、`pendingOffersByAgentID`、`issuedMilestones`
- `epicArcProgress`: 史诗弧进度
- `completedCareerAgentIDs`: 已完成职业代理

`recordStorylineQualifyingCompletion` 在 `STORYLINE_THRESHOLD` 个普通任务完成后触发剧情任务提供。

---

## 七、根因总结

### 7.1 主因：模板数据被清空（数据链路切断）

当前 HEAD 的 `agentAuthority/data.json` 中所有 10,941 个 agent 的 `missionTemplateIDs` 为空（`missionTemplateCount: 0`, `missionPoolCount: 0`）。而 v0.12.1 补充提交 (fc00f8d) 中该值为 640 个模板 / 1.46M 引用，且有 6 个 `missionPoolsByKindAndLevel` 池。

服务器运行时读取 `_local/gameStore/data/agentAuthority/data.json`（由 `tools/DatabaseCreator/CreateDatabase.bat` 从静态表生成），该文件同样模板为空 → 代理无任务可提供。

### 7.2 次因：运行时门控收紧

`missionAuthority.js` 引入 deny-by-default 策略（`isOrdinarySecurityAgent` + `isRetiredOrdinaryEncounterMissionForAgent` + `isMissionOfferAllowedForAgent`），普通安全代理仅能白名单提供 4 个 golden 任务 (1182/2504/2925/13735)。

### 7.3 第三重过滤：退休模板前缀

`productionMissionPolicy.json` 中 `retiredTemplatePrefixes: ["eve-survival:"]` 会过滤掉几乎所有剧情任务模板（它们都使用 `eve-survival:` 前缀）。即使模板数据被恢复，这一层仍会过滤。

### 7.4 三重过滤叠加效果

```
玩家访问代理
  → agentAuthority 中 missionTemplateIDs = [] → 无候选任务  ← 🔴 主因
  → 即使有候选，isOrdinarySecurityAgent 门控会拒绝非 golden 任务  ← 🟠 次因
  → 即使通过门控，retiredTemplatePrefixes 会过滤 eve-survival: 模板  ← 🟡 第三重
  → 结果：玩家看不到任何剧情任务
```

---

## 八、修复建议

### 方案 A：恢复数据 + 放宽策略（推荐，最直接）

1. 恢复 `agentAuthority/data.json` 到填充版本（commit `fc00f8d`，含 640 模板 / 1.46M 引用）:
   ```bash
   git show fc00f8d:Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json > Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json
   ```
2. 重新生成运行时数据:
   ```bash
   cd Code
   tools/DatabaseCreator/CreateDatabase.bat /force
   ```
3. 修改 `productionMissionPolicy.json`，将 `eve-survival:` 从 `retiredTemplatePrefixes` 移除或改为更精确过滤（避免误伤所有剧情模板）
4. 可选：放宽 `missionAuthority.js` 中的门控逻辑（恢复普通安全代理的任务回退池）

### 方案 B：保持策略但修复链路

1. 在 `missionAuthority.js` 中为被退休的普通安全代理添加明确的"允许任务池"（不含 eve-survival:crawler 但含 eve-survival:storyline）
2. 为剧情任务（StorylineKillMission, StorylineCourierMission 等 contentTemplate）恢复独立于 eve-survival 前缀的模板池

### 方案 C：数据精确修复（最精准但工作量大）

1. 让 `production-mission-policy.js` 区分"剧情任务模板"和"eve-survival 生成任务模板"（按 missionFlavor / contentTemplate 判断）
2. 为剧情 agent (agentTypeID=6,7,10) 显式保留 `missionTemplateIDs` 和对应 dungeon 模板
3. 保留 CCP 原版 dungeon 模板，仅移除爬虫生成的低质量内容

---

## 九、相关文件索引

### 代码文件

| 路径 | 功能 |
|------|------|
| `Code/server/index.js` | 服务加载入口 |
| `Code/server/src/services/agent/agentMissionRuntime.js` | 主任务运行时 (~6060行) |
| `Code/server/src/services/agent/missionAuthority.js` | 任务权限与门控 |
| `Code/server/src/services/agent/agentMgrService.js` | agentMgr 服务 |
| `Code/server/src/services/agent/storylineAgentSelector.js` | 剧情代理发现 |
| `Code/server/src/services/agent/missionRuntimeState.js` | 任务运行时状态 |
| `Code/server/src/services/agent/epicArcStatusService.js` | 史诗弧状态 |
| `Code/server/src/services/agent/missionTrackerMgrService.js` | 任务日志 |
| `Code/server/src/services/campaign/loginCampaignService.js` | 登录活动 |
| `Code/server/src/services/campaign/crateService.js` | 箱子 |
| `Code/server/src/services/agency/customAgencyProviderService.js` | 自定义代理 |
| `Code/server/src/services/account/tutorialSvcService.js` | 职业代理 |
| `Code/server/src/services/npe/tutorialRuntime.js` | NPE 教程 |
| `Code/server/src/config/productionMissionPolicy.json` | 制造任务策略配置 |
| `Code/server/src/config/productionMissionPolicy.js` | 策略运行时验证 |
| `Code/tools/DatabaseCreator/production-mission-policy.js` | 构建时清洗 |
| `Code/tools/DatabaseCreator/enforce-production-mission-policy.js` | 构建运行器 |
| `Code/tools/DatabaseCreator/build-scraped-mission-authority.js` | 已退休的抓取器 |

### 数据文件

| 路径 | 功能 | 版本差异 |
|------|------|---------|
| `Code/tools/DatabaseCreator/staticTables/missionAuthority/data.json` | 静态任务表（2,878 任务, 1,249 storyline） | 稳定 |
| `Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json` | 静态代理表（10,941 agents） | **fc00f8d: 640 模板 / HEAD: 0 模板** |
| `Code/tools/DatabaseCreator/staticTables/dungeonAuthority/data.json` | 静态 dungeon 表（5,981 模板） | 稳定 |
| `Code/_local/gameStore/data/agentAuthority/data.json` | 运行时镜像（服务器实际读取，由 CreateDatabase.bat 生成） | 跟随静态表 |
| `Code/_local/gameStore/data/missionAuthority/data.json` | 运行时镜像 | 稳定 |

> **重要**: `_local/` 目录和 `server/src/gameStore/data/*/data.json` 均被 `.gitignore` 排除。运行时数据需通过 `tools/DatabaseCreator/CreateDatabase.bat` 从静态表重新生成。

### 文档

| 路径 | 功能 |
|------|------|
| `Doc/EveJS_Project_Overview.md` | 项目总览 |
| `Doc/Service_Modules_Reference.md` | 服务模块参考 |
| `Doc/Loot_Wreck_System_Analysis.md` | 掉落/残骸系统分析 |
| `Issue/001-wreck-loot-not-pickable.md` | 残骸无法拾取 |
| `Issue/002-missing-storyline-missions.md` | 剧情任务消失 (本问题) |

---

## 十、EVE 原版对照

| 系统 | EVE 原版 | EveJS 0.12.2 | 状态 |
|------|---------|-------------|------|
| 普通安全代理任务 | ✅ | ✅ (仅 4 个 golden) | 部分 |
| 剧情代理 (Storyline) | ✅ | ✅ 代码存在，数据缺失 | 需修复 |
| 史诗弧 (Epic Arc) | ✅ | ✅ 代码存在，数据缺失 | 需修复 |
| 职业代理 (Career) | ✅ | ✅ 代码存在，数据缺失 | 需修复 |
| 研究代理 (Research) | ✅ | ✅ | 部分 |
| 教程 (Opportunity) | ❌ 已退役 | ❌ 不存在 | 符合原版 |
| NPE/AIR 教程 | ✅ | ✅ | 部分 |
| 登录活动 (Campaign) | ✅ | ✅ | 部分 |

---

## 十一、修复方案（2026-07-21）

### 11.1 问题根因

v0.12.2 新增的 `tools/DatabaseCreator/production-mission-policy.js` 清洗脚本会删除：
- `dungeonAuthority` 中所有 `eve-survival:*` 模板（548 个）
- `agentAuthority` 中代理人对 eve-survival 模板的引用
- `missionAuthority` 中 ID 在 900000000-901000000 范围内的生成任务

这导致剧情代理人（Type-6/7/10）的 `missionTemplateIDs` 被清空，无法通过 `getMissionTemplatePool` 获取模板。

### 11.2 修复方式

通过**环境变量**或**命令行参数**控制清洗开关：

```bash
# 默认：开启清洗（原始行为）
CreateDatabase.bat

# 关闭清洗：保留 eve-survival 内容
CreateDatabase.bat --force --keep-community-content

# 或者通过环境变量
set EVEJS_ENABLE_COMMUNITY_CONTENT_CLEANING=0
CreateDatabase.bat --force
```

### 11.3 修改文件

| 文件 | 修改 |
|------|------|
| `tools/DatabaseCreator/production-mission-policy.js` | 读取 `EVEJS_ENABLE_COMMUNITY_CONTENT_CLEANING` 环境变量控制清洗开关 |
| `tools/DatabaseCreator/CreateDatabase.bat` | 支持 `--keep-community-content` 参数 |
| `server/src/services/agent/agentMissionRuntime.js` | journal Storyline 标签页显示逻辑（显示一个剧情任务） |
| `server/src/services/agent/missionAuthority.js` | 新增 `getAgentIDToMissionIDs` 导出函数 |

### 11.4 运行时数据生成

```bash
# 重新生成运行时数据（保留 eve-survival 内容）
cd Code
tools\DatabaseCreator\CreateDatabase.bat --force --keep-community-content
```

### 11.5 验证清单

- [ ] 运行时 `dungeonAuthority` 包含 548 个 eve-survival 模板
- [ ] 运行时 `agentAuthority` 中剧情代理人的 `missionTemplateIDs` 非空
- [ ] journal Storyline 标签页显示剧情代理人
- [ ] 与剧情代理人对话可接受任务
- [ ] 任务完成后下一个任务自动解锁
- [ ] 无任务时代理人显示常规对话（非占位任务）
