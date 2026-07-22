# 问题 #002: 剧情任务标签页(Storyline Tab)始终为空

### 基本信息

| 字段 | 内容 |
|------|------|
| **问题编号** | #002 |
| **发现日期** | 2026-07-20 |
| **影响版本** | EveJS v0.12.0 / v0.12.1 / v0.12.2（全版本） |
| **正常版本** | 无（全版本均存在问题） |
| **严重程度** | **高**（剧情任务是 EVE 核心内容） |
| **状态** | 🔄 修复中（代码已添加，运行时数据需重建） |
| **类别** | 任务/代理(Mission/Agent)系统 |
| **根因置信度** | ⭐⭐⭐⭐⭐ |

### 问题描述

打开 F11 Journal → 剧情任务(Storyline)标签 → **始终为空**，看不到任何代理人或任务简介。

**注意**: 剧情任务可通过**机遇列表**（ALT+J）访问，该界面使用 `eve_public.freelance.project.api` 能正常显示剧情任务。但代理人任务列表中的"剧情任务"标签页始终为空。

**全版本验证结果**:
- v0.12.0: 剧情标签为空 ❌
- v0.12.1: 剧情标签为空 ❌
- v0.12.2: 剧情标签为空 ❌

### 根因分析

#### 根因 1: 运行时数据缺失（直接原因）

静态表 `staticTables/agentAuthority/data.json` 已恢复（commit 80c4b81，640 模板），但运行时数据 `_local/gameStore/data/agentAuthority/data.json` 仍是清洗后版本（0 模板）。

| 数据文件 | 静态表 (staticTables/) | 运行时 (_local/gameStore/data/) | 状态 |
|---------|----------------------|-------------------------------|------|
| agentAuthority | 1,896,106 行 (640 模板) ✅ | 423,081 行 (0 模板) ⚠️ | **不一致** |

**修复**: 运行 `CreateDatabase.bat --force --keep-community-content` 重建运行时数据。

#### 根因 2: 剧情 offer 生成管线是死代码（深层原因）

即使数据完整，剧情 offer 生成函数也从未被调用：

| 函数 | 文件 | 调用者 |
|------|------|--------|
| `recordPendingStorylineOffer` | missionRuntimeState.js:947 | **0** |
| `markStorylineMilestoneIssued` | missionRuntimeState.js:880 | **0** |
| `findNearestStorylineAgent` | storylineAgentSelector.js:167 | **0** |

**应该工作的流程**:
```
完成普通任务 → recordStorylineQualifyingCompletion → reachedMilestone === true
  → findNearestStorylineAgent（找最近剧情代理）
  → recordPendingStorylineOffer（写入角色状态）
  → journal 显示 via buildPendingStorylineOfferJournalRows
```

**实际代码** (`agentMissionRuntime.js:5332`):
```js
recordStorylineQualifyingCompletion(characterState, agentRecord, missionRecord, {
  completedAtFileTime,
});
return cloneValue(missionRecord);   // ← milestone 结果被丢弃！
```

结果: `pendingOffersByAgentID` 永远为 `{}` → 剧情标签页永远无数据。

#### 根因 3: 运行时门控收紧（加重因素）

`missionAuthority.js` 引入 deny-by-default 策略（`isOrdinarySecurityAgent`），普通安全代理仅能白名单提供 4 个 golden 任务 (1182/2504/2925/13735)。

#### 根因 4: 退休模板前缀过滤（第三重过滤）

`productionMissionPolicy.json` 中 `retiredTemplatePrefixes: ["eve-survival:"]` 会过滤掉几乎所有剧情任务模板。

### 已执行的修复（commit 12264b5 + 80c4b81）

| 操作 | 结果 |
|------|------|
| 恢复 fc00f8d 的 agentAuthority 数据（640 模板） | ✅ 静态表已恢复 |
| 恢复 dungeonAuthority / missionAuthority 数据 | ✅ 静态表已恢复 |
| 添加剧情行 fallback 到 getJournalDetails | ✅ 代码已添加（三重兜底逻辑） |
| 添加 `buildSingleStorylineAgentJournalRow` | ✅ 提供无 pending offers 时的 fallback |
| 添加 `findStorylineMissionForAgent` | ✅ 为剧情代理匹配真实任务 |
| 添加 `findStorylineAgentForCharacter` | ✅ 按 faction 筛选剧情代理 |
| 添加 `getPreferredMissionID` 导入 | ✅ 支持任务匹配 |
| 添加 `--keep-community-content` 参数 | ✅ 可关闭清洗保留 eve-survival |
| 运行时数据重建 | ❌ **待执行** |

### getJournalDetails 三重兜底逻辑（已实现）

```javascript
// 第一重：显示 pending storyline offers（正常路径，但目前永远为空）
let storylineTabRows = buildPendingStorylineOfferJournalRows(...);

// 第二重：如果有活跃的剧情任务，显示它
if (storylineTabRows.length === 0) {
  const activeStorylineMission = allMissions.find((m) =>
    m && (m.isStoryline === true || m.missionFlavor === "storyline" || ...));
  if (activeStorylineMission) { /* 构建剧情行 */ }
}

// 第三重：找到任意剧情代理，显示对话行
if (storylineTabRows.length === 0 && pendingStorylineRows.length === 0) {
  storylineTabRows = buildSingleStorylineAgentJournalRow(characterID, activeAgentIDs);
}
```

### 待完成的修复

| 步骤 | 命令/操作 | 状态 |
|------|----------|------|
| 1. 重建运行时数据 | `CreateDatabase.bat --force --keep-community-content` | ❌ 待执行 |
| 2. 验证运行时 agentAuthority 有 640 模板 | 检查 `_local/gameStore/data/agentAuthority/data.json` | ❌ 待验证 |
| 3. 验证剧情标签页显示 | 客户端 F11 → Storyline | ❌ 待验证 |
| 4. 验证与剧情代理对话 | Sister Alitura (agentID 3019356) | ❌ 待验证 |

### 后续修复方向（管线修复）

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 修复剧情 offer 管线** | 在任务完成时调用 `recordPendingStorylineOffer` 生成剧情 offer | 高 |
| **B. 通过机遇系统注入** | 将剧情任务注入到 freelance project API 的广播列表中 | 中 |
| **C. 实现剧情专属 RPC** | 创建 `GetStorylineOffers` 等 RPC，返回剧情代理独立列表 | 中 |

**推荐方案 A** — 修复 `recordStorylineQualifyingCompletion` 返回值被丢弃的问题，让 milestone 触发时正确调用 `recordPendingStorylineOffer`。
当前已验证，虽然服务器提供了数据，但客户端渲染逻辑未正确处理，可能需要继续调查。
客户端机遇系统能显示剧情任务（显示规则不同），不确定数据格式是否一致，可以参考机遇系统的实现以及相邻的代理人任务界面来测试剧情界面的显示。
CCP 和 EveJS 的界面对比视频在 `Movie/` 目录，可以参考。

### 服务端数据 vs 客户端渲染

已验证服务端返回正确数据（通过注入测试）:
```
getJournalDetails 返回:
  row[0]: {state:1, imp:true, typeLabel:"Encounter", agent:3019356}  ← 正常显示
  row[1]: {state:1, imp:true, typeLabel:"Storyline", agent:3017107}  ← 客户端不渲染
```

**结论**: 客户端不用 `getJournalDetails` 的数据来填充剧情标签页。剧情标签页可能有独立的数据源或需要特定的 RPC 触发。

> **更新 (2026-07-22)**: 添加了三重兜底逻辑后，服务端现在会返回剧情行数据。但客户端是否渲染仍需验证。

### Sister Alitura（血色星辰起点）

**agentID: 3019356** | agentTypeID: 10 | 派系: Mordu Legion (500016)

| 序号 | Mission ID | 名称 | 类型 |
|------|-----------|------|------|
| 1 | 14117 | A Beacon Beckons | encounter |
| 2 | 14118 | Agent Inquiry | talkToAgent |
| 3 | 14122 | Jet-Canning a Janitor | encounter |
| ... | ... | ... | ... |

### 相关文档

- [Doc/Mission_Agent_System_Analysis.md](../Doc/Mission_Agent_System_Analysis.md) — 任务/代理系统分析
- [CLAUDE.md](../../CLAUDE.md) — 项目总览
- `Movie/` — CCP vs EveJS 界面对比视频
- [Issue/001-wreck-loot-not-pickable.md](001-wreck-loot-not-pickable.md) — 另一个已知问题
