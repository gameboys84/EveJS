# 问题 #002: 剧情任务标签页(Storyline Tab)始终为空

### 基本信息

| 字段 | 内容 |
|------|------|
| **问题编号** | #002 |
| **发现日期** | 2026-07-20 |
| **影响版本** | EveJS v0.12.0 / v0.12.1 / v0.12.2（全版本） |
| **正常版本** | 无（全版本均存在问题） |
| **严重程度** | **高**（剧情任务是 EVE 核心内容） |
| **状态** | 🔍 根因已定位，待修复 |
| **类别** | 任务/代理(Mission/Agent)系统 |
| **根因置信度** | ⭐⭐⭐⭐⭐ |

### 问题描述

打开 F11 Journal → 剧情任务(Storyline)标签 → **始终为空**，看不到任何代理人或任务简介。

**注意**: 剧情任务可通过**机遇列表**（ALT+J）访问，该界面使用 `eve_public.freelance.project.api` 能正常显示剧情任务。但代理人任务列表中的"剧情任务"标签页始终为空。

**全版本验证结果**:
- v0.12.0: 剧情标签为空 ❌
- v0.12.1: 剧情标签为空 ❌
- v0.12.2: 剧情标签为空 ❌

### 根因结论

**剧情标签页的数据管线从未工作。** EveJS 中剧情 offer 生成函数是死代码（已定义但零调用）。

#### 死代码管线

| 函数 | 文件 | 调用者 |
|------|------|--------|
| `recordPendingStorylineOffer` | missionRuntimeState.js:947 | 0 |
| `markStorylineMilestoneIssued` | missionRuntimeState.js:880 | 0 |
| `findNearestStorylineAgent` | storylineAgentSelector.js:167 | 0 |

**应该工作的流程**:
```
完成普通任务 → recordStorylineQualifyingCompletion → reachedMilestone === true
  → findNearestStorylineAgent（找最近剧情代理）
  → recordPendingStorylineOffer（写入角色状态）
  → journal 显示 via buildPendingStorylineOfferJournalRows
```

**实际代码** (`agentMissionRuntime.js`):
```js
recordStorylineQualifyingCompletion(characterState, agentRecord, missionRecord, {
  completedAtFileTime,
});
return cloneValue(missionRecord);   // ← milestone 结果被丢弃！
```

结果: `pendingOffersByAgentID` 永远为 `{}` → 剧情标签页永远无数据。

### 服务端数据 vs 客户端渲染

已验证服务端返回正确数据（通过注入测试）:
```
getJournalDetails 返回:
  row[0]: {state:1, imp:true, typeLabel:"Encounter", agent:3019356}  ← 正常显示
  row[1]: {state:1, imp:true, typeLabel:"Storyline", agent:3017107}  ← 客户端不渲染
```

**结论**: 客户端不用 `getJournalDetails` 的数据来填充剧情标签页。剧情标签页可能有独立的数据源或需要特定的 RPC 触发。

### 已执行的修复

| 操作 | 结果 |
|------|------|
| 恢复 fc00f8d 的 agentAuthority 数据（640 模板） | ✅ 数据已恢复 |
| 恢复 dungeonAuthority / missionAuthority 数据 | ✅ 数据已恢复 |
| 添加剧情行 fallback 到 getJournalDetails | ✅ 代码已添加，但客户端仍不渲染 |
| 添加 `buildSingleStorylineAgentJournalRow` | ✅ 提供无 pending offers 时的 fallback |
| 添加 `findStorylineMissionForAgent` | ✅ 为剧情代理匹配真实任务 |

### 后续修复方向

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 修复剧情 offer 管线** | 在任务完成时调用 `recordPendingStorylineOffer` 生成剧情 offer | 高 |
| **B. 通过机遇系统注入** | 将剧情任务注入到 freelance project API 的广播列表中 | 中 |
| **C. 实现剧情专属 RPC** | 创建 `GetStorylineOffers` 等 RPC，返回剧情代理独立列表 | 中 |

**推荐方案 B** — 机遇系统已能显示剧情任务，只需确保剧情任务正确注入。

### 相关文档

- [Doc/Mission_Agent_System_Analysis.md](../Doc/Mission_Agent_System_Analysis.md) — 深度分析文档（含完整 RPC 流程追踪）
- [CLAUDE.md](../../CLAUDE.md) — 项目总览
- [Issue/001-wreck-loot-not-pickable.md](001-wreck-loot-not-pickable.md) — 另一个已知问题
