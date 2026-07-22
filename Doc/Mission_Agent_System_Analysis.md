# EveJS 任务 / 代理系统分析

> **范围**: 任务代理(Agent)、剧情任务(Storyline)、史诗弧(Epic Arc)、职业代理(Campaign/Career)、教程(NPE)
>
> **相关系统**: 掉落系统见 `Doc/Loot_Wreck_System_Analysis.md`，项目总览见 `Doc/EveJS_Project_Overview.md`

---

## 一、概述

本文档描述 EveJS 中任务/代理系统的**代码架构、数据流、静态数据结构**。

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
| 1 | 14117 | A Beacon Beckons，信标的指引 | encounter |
| 2 | 14118 | Agent Inquiry，特工调查 | talkToAgent |
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

**玩家实际体验**:
1. 打开 代理人任务 → 剧情任务 → **列表为空，内容空白**
2. 无法看到任何剧情代理或任务简介
3. 打开 机遇，能看到剧情任务，且能点击查看任务信息和接受任务

对比官方的任务线会分为几个章节，每章节下有多个任务，显示时会有完整列表
1. 怜悯的精度，1/7
   1. 信标的指引
   2. 特工调查
   3. 利益相关
   4. 带回红衣男
   5. 通知阿里桃拉修女
   6. 清理看门人
   7. 被骚扰的厨子
   8. 接送医生
   9. ......
2. 碍事的机器，2/7
3. 影子傀儡，3/7
4. 无人机和女皇们，4/7
5. 基础的变更，5/7
6. 信任危机，6/7
7. 深入逼近，7/7

### 6.5 运行时状态

`missionRuntimeState` 存储每位角色的:
- `storylineProgress`: 按 faction×level 的计数器、里程碑、`pendingOffersByAgentID`、`issuedMilestones`
- `epicArcProgress`: 史诗弧进度
- `completedCareerAgentIDs`: 已完成职业代理

`recordStorylineQualifyingCompletion` 在 `STORYLINE_THRESHOLD` 个普通任务完成后触发剧情任务提供。

---

## 七、构建时数据清洗

### 7.1 清洗机制

`tools/DatabaseCreator/production-mission-policy.js` 在构建运行时数据时，根据 `productionMissionPolicy.json` 的配置执行清洗：

| 清洗项 | 效果 |
|--------|------|
| `goldenSecurityMissions` | 白名单保留 4 个 L1 安全任务 |
| `disabledMissions` | 移除禁用任务（当前 1 个） |
| `retiredTemplatePrefixes` | 移除前缀匹配 `eve-survival:` 的模板 |
| `generatedMissionIDRange` | 移除 ID 在 900000000-901000000 的生成任务 |

### 7.2 清洗开关

| 方式 | 命令 | 效果 |
|------|------|------|
| 默认 | `CreateDatabase.bat` | 清洗开启 |
| 环境变量 | `set EVEJS_ENABLE_COMMUNITY_CONTENT_CLEANING=0` | 清洗关闭 |
| 命令行参数 | `CreateDatabase.bat --keep-community-content` | 清洗关闭 |

### 7.3 数据流

```
staticTables/ (源数据)
  └─ CreateDatabase.bat
       └─ database-creator.js
            └─ sanitizeAuthorityTable()
                 └─ 基于 productionMissionPolicy.json + 环境变量
                      └─ _local/gameStore/data/ (运行时数据)
```

---

## 八、相关文件索引

### 代码文件

| 路径 | 功能 |
|------|------|
| `Code/server/src/services/agent/agentMissionRuntime.js` | 主任务运行时 (~6196行) |
| `Code/server/src/services/agent/missionAuthority.js` | 任务权限与门控 (~933行) |
| `Code/server/src/services/agent/missionRuntimeState.js` | 任务运行时状态 (~1602行) |
| `Code/server/src/services/agent/storylineAgentSelector.js` | 剧情代理发现 (~258行) |
| `Code/server/src/config/productionMissionPolicy.json` | 制造任务策略配置 |
| `Code/tools/DatabaseCreator/production-mission-policy.js` | 构建时清洗逻辑 |

### 数据文件

| 路径 | 功能 |
|------|------|
| `Code/tools/DatabaseCreator/staticTables/missionAuthority/data.json` | 静态任务表（2,878 任务） |
| `Code/tools/DatabaseCreator/staticTables/agentAuthority/data.json` | 静态代理表（10,941 agents） |
| `Code/tools/DatabaseCreator/staticTables/dungeonAuthority/data.json` | 静态 dungeon 表（5,981 模板） |
| `Code/_local/gameStore/data/` | 运行时镜像（gitignored） |
