# EveJS 调试命令与使用说明

> 本文档整理了 EveJS 项目的所有可用调试命令、启动脚本、验证工具及其使用方法。

---

## 一、启动与运行命令

### 1.1 原生 Windows 启动

#### 启动服务器

```bash
cd Code
npm --prefix server ci        # 首次安装依赖
```

```bash
# 方式一：使用启动器（推荐）
Code/StartServer.bat
# 选项 [1] Server only - 仅启动服务器
# 选项 [2] Server + Play - 启动服务器并自动启动客户端

# 方式二：直接启动
cd Code/server
npm start

# 方式三：调试模式（Chrome DevTools）
cd Code/server
node --inspect server/index.js
```

#### 仅启动客户端

```bash
Code/Play.bat
```

#### 启动市场服务器

```bash
Code/StartMarketServer.bat
```

### 1.2 Docker 启动

```bash
# 构建镜像
docker compose build init

# 启动后端
docker compose up --detach

# 查看日志
docker compose logs --follow init market server

# 停止后端（保留数据）
docker compose down

# 停止后端（删除所有数据）⚠️
docker compose down --volumes
```

### 1.3 数据库操作

```bash
# 创建/重建数据库
Code/tools/DatabaseCreator/CreateDatabase.bat

# 强制重建
Code/tools/DatabaseCreator/CreateDatabase.bat /force

# 数据库迁移（JSON → SQLite）
cd Code/server
node src/gameStore/migrateJsonToSqlite.js <table_name>

# 数据库迁移（旧版 newDatabase → gameStore）
cd Code/server
node src/gameStore/migrateLegacyNewDatabase.js
```

### 1.4 市场操作

```bash
# 构建市场种子
Code/BuildMarketSeed.bat

# Docker 市场操作
docker compose run --rm --no-deps market-tools engines                    # 列出引擎
docker compose run --rm --no-deps market-tools rebuild v1 --preset jita_new_caldari  # v1 合成市场
docker compose run --rm --no-deps market-tools rebuild v2 --order-filter market-scope-with-npc --market-solar-system-id 30000142  # v2 快照市场
docker compose run --rm --no-deps market-tools status                     # 市场状态
docker compose run --rm --no-deps market-tools doctor                      # 市场诊断
docker compose run --rm --no-deps market-tools backup <name>              # 备份市场
docker compose run --rm --no-deps market-tools restore latest             # 恢复市场
```

---

## 二、游戏内 GM 命令（斜杠命令）

在游戏中按回车打开聊天框，输入 `/` 开头的命令。完整帮助输入 `/help`。

### 2.1 角色与技能

| 命令 | 功能 | 示例 |
|------|------|------|
| `/allskills` | 学习所有技能到 L5 | `/allskills` |
| `/giveskill <target> <skill\|all\|super> [level]` | 授予技能 | `/giveskill me all 5` |
| `/removeskill <target> <skill\|all>` | 移除技能 | `/removeskill me all` |
| `/gmskills` | 获取 GM 技能包 | `/gmskills` |
| `/allskins [me\|characterID\|name]` | 解锁所有皮肤 | `/allskins` |
| `/backintime [me\|characterID\|name]` | 重置角色到初始状态 | `/backintime` |
| `/secstatus [status]` | 设置安全状态 | `/secstatus -5.0` |

### 2.2 货币与积分

| 命令 | 功能 | 示例 |
|------|------|------|
| `/addisk <amount>` | 增加 ISK | `/addisk 1000000000` |
| `/setisk <amount>` | 设置 ISK 金额 | `/setisk 5000000000` |
| `/wallet` | 查看钱包余额 | `/wallet` |
| `/addlp <amount> <corp>` | 增加忠诚点 | `/addlp 100000 "Caldari Navy"` |
| `/setlp <amount> <corp>` | 设置忠诚点 | `/setlp 50000 "Caldari Navy"` |
| `/lp [corp]` | 查看忠诚点 | `/lp "Caldari Navy"` |
| `/addevermarks <amount>` | 增加 Evermarks | `/addevermarks 1000` |
| `/setevermarks <amount>` | 设置 Evermarks | `/setevermarks 5000` |
| `/evermarks` | 查看 Evermarks | `/evermarks` |
| `/addplex <amount>` | 增加 PLEX | `/addplex 100` |
| `/setplex <amount>` | 设置 PLEX | `/setplex 500` |

### 2.3 物品与装备

| 命令 | 功能 | 示例 |
|------|------|------|
| `/item <name\|typeID> [amount]` | 获取物品 | `/item "Tritanium" 10000` |
| `/giveitem <name\|typeID> [amount]` | 获取物品（同 /item） | `/giveitem 1244 5` |
| `/create <name\|typeID> [amount]` | 创建物品 | `/create "Veldspar" 5000` |
| `/createitem <name\|typeID> [amount]` | 创建物品 | `/createitem 20 1000` |
| `/iteminfo <itemID>` | 查看物品信息 | `/iteminfo 123456` |
| `/typeinfo <name\|typeID>` | 查看类型信息 | `/typeinfo "Rifter"` |
| `/minerals` | 获取矿物包 | `/minerals` |
| `/gmweapons` | 获取 GM 武器包 | `/gmweapons` |
| `/gmships` | 获取 GM 飞船包 | `/gmships` |
| `/hangar` | 查看机库内容 | `/hangar` |
| `/blue` | 获取蓝图包 | `/blue` |
| `/container [type] [count]` | 生成集装箱 | `/container 3` |
| `/jetcan <name\|typeID> [amount]` | 生成集装箱（含物品） | `/jetcan "Tritanium" 5000` |

### 2.4 飞船

| 命令 | 功能 | 示例 |
|------|------|------|
| `/ship <name\|typeID>` | 更换飞船 | `/ship "Rifter"` |
| `/giveme <name\|typeID>` | 获取飞船（放入机库） | `/giveme "Drake"` |
| `/fire [name\|typeID]` | 发射一艘 NPC 飞船 | `/fire "Rifter"` |
| `/fire2 [count]` | 发射多艘飞船 | `/fire2 5` |
| `/suicide` | 自杀（销毁当前飞船） | `/suicide` |
| `/deathtest [name\|typeID] [count]` | 死亡测试 | `/deathtest` |
| `/dirt <0.0-1.0> [shipID]` | 设置飞船脏污程度 | `/dirt 0.5` |
| `/killmarks <count> [shipID]` | 设置击杀标记数 | `/killmarks 10` |

### 2.5 NPC 生成

| 命令 | 功能 | 示例 |
|------|------|------|
| `/npc [amount] [faction\|profile\|pool]` | 生成 NPC | `/npc 5 guristas` |
| `/mnpc [amount] [faction\|profile\|pool]` | 生成可攻击 NPC | `/mnpc 3 serpentis` |
| `/npcw [amount] [profile\|pool]` | 生成 NPC（环绕玩家） | `/npcw 5 blood` |
| `/concord [amount] [profile\|pool]` | 生成 CONCORD | `/concord 3` |
| `/trig [hull\|family]` | 生成 Triglavian | `/trig hull` |
| `/guardian` | 生成 Guardian | `/guardian` |
| `/basilisk` | 生成 Basilisk | `/basilisk` |
| `/ewar` | 生成电子战舰船 | `/ewar` |
| `/miner` | 生成采矿船 | `/miner` |
| `/orca` | 生成 Orca | `/orca` |
| `/probe` | 生成 Probe | `/probe` |
| `/probe2` | 生成 Probe2 | `/probe2` |
| `/laser` | 生成激光战舰 | `/laser` |
| `/lasers` | 生成多艘激光战舰 | `/lasers` |
| `/hybrids` | 生成混合炮战舰 | `/hybrids` |
| `/railgun` | 生成磁轨炮战舰 | `/railgun` |
| `/projectiles` | 生成射弹炮战舰 | `/projectiles` |
| `/autocannon` | 生成自动加农炮战舰 | `/autocannon` |
| `/rocket` | 生成火箭战舰 | `/rocket` |
| `/light` | 生成轻型导弹战舰 | `/light` |
| `/heavy` | 生成重型导弹战舰 | `/heavy` |
| `/torp` | 生成鱼雷战舰 | `/torp` |
| `/lesmis` | 生成特定 NPC | `/lesmis` |
| `/wreck [type] [count]` | 生成残骸 | `/wreck 3` |
| `/spawncontainer [type] [count]` | 生成集装箱 | `/spawncontainer 2` |
| `/spawnwreck` | 生成残骸 | `/spawnwreck` |
| `/spawnsite` | 生成站点 | `/spawnsite` |

### 2.6 采矿 NPC

| 命令 | 功能 | 示例 |
|------|------|------|
| `/npcminer [amount] [profile\|pool\|group]` | 生成采矿 NPC | `/npcminer 3` |
| `/npcmineraggro [amount]` | 生成攻击型采矿 NPC | `/npcmineraggro 2` |
| `/npcminerpanic [amount]` | 生成恐慌采矿 NPC | `/npcminerpanic 2` |
| `/npcminerretreat` | 采矿 NPC 撤退 | `/npcminerretreat` |
| `/npcminerresume` | 采矿 NPC 恢复 | `/npcminerresume` |
| `/npcminerhaul` | 采矿 NPC 运输 | `/npcminerhaul` |
| `/npcminerclear` | 清除采矿 NPC | `/npcminerclear` |
| `/npcminerstatus` | 查看采矿 NPC 状态 | `/npcminerstatus` |
| `/miningreset` | 重置采矿 | `/miningreset` |
| `/miningstatus` | 查看采矿状态 | `/miningstatus` |

### 2.7 移动与传送

| 命令 | 功能 | 示例 |
|------|------|------|
| `/dock` | 停靠空间站 | `/dock` |
| `/tele <name\|characterID>` | 传送到角色 | `/tele John` |
| `/tr <me\|charID\|entityID> <dest>` | 传送 | `/tr me Jita` |
| `/solar <system>` | 跳转到星系 | `/solar Jita` |
| `/loadsys` | 加载当前星系 | `/loadsys` |
| `/loadallsys` | 加载所有星系 | `/loadallsys` |
| `/deadwarp` | 死亡跃迁 | `/deadwarp` |
| `/keepstar` | 保持星门 | `/keepstar` |

### 2.8 战斗与效果

| 命令 | 功能 | 示例 |
|------|------|------|
| `/dmg [light\|medium\|heavy]` | 伤害测试 | `/dmg heavy` |
| `/heal` | 修复飞船 | `/heal` |
| `/effect <name>` | 激活效果 | `/effect microjump` |
| `/rr` | 快速修复 | `/rr` |
| `/cburst` | 指挥脉冲 | `/cburst` |
| `/fire2 [count]` | 发射多艘敌对飞船 | `/fire2 10` |
| `/supertitan` | 生成超级泰坦 | `/supertitan` |
| `/supertitanshow [count]` | 超级泰坦展示 | `/supertitanshow 3` |
| `/titansupershow [count]` | 泰坦超级展示 | `/titansupershow 2` |

### 2.9 声望与关系

| 命令 | 功能 | 示例 |
|------|------|------|
| `/setstanding <value> <owner> [target]` | 设置声望 | `/setstanding 5.0 "Caldari Navy"` |
| `/maxagentstandings [target]` | 最大化代理人声望 | `/maxagentstandings` |
| `/fullstandings [target]` | 最大化所有声望 | `/fullstandings` |

### 2.10 扫描与探索

| 命令 | 功能 | 示例 |
|------|------|------|
| `/sigs` | 显示签名 | `/sigs` |
| `/sigscan` | 扫描签名 | `/sigscan` |
| `/missioncomplete [agentID\|all]` | 完成任务 | `/missioncomplete all` |

### 2.11 专家系统

| 命令 | 功能 | 示例 |
|------|------|------|
| `/expertsystem <list\|inspect\|status\|add\|remove\|clear\|giveitem\|consume>` | 专家系统管理 | `/expertsystem list` |
| `/expertsystems` | 同 /expertsystem | `/expertsystems` |

### 2.12 结构与主权

| 命令 | 功能 | 示例 |
|------|------|------|
| `/upwell <subcommand>` |  Upwell 结构管理 | `/upwell` |
| `/upwellauto <type\|structureID>` | 自动生成结构 | `/upwellautoastrahus` |
| `/sov <subcommand>` | 主权管理 | `/sov` |
| `/sovauto <subcommand>` | 自动主权 | `/sovauto` |
| `/deathstructure <type> [count] [delay]` | 结构死亡测试 | `/deathstructure astrahus 1` |

### 2.13 蓝图与工业

| 命令 | 功能 | 示例 |
|------|------|------|
| `/bpauto <subcommand>` | 自动蓝图 | `/bpauto` |
| `/bp <subcommand>` | 蓝图管理 | `/bp` |
| `/bookmarkauto <subcommand>` | 自动书签 | `/bookmarkauto` |
| `/calauto <subcommand>` | 自动日历 | `/calauto` |
| `/reprocesssmoke <subcommand>` | 再处理烟雾 | `/reprocesssmoke` |

### 2.14 公司管理

| 命令 | 功能 | 示例 |
|------|------|------|
| `/corpcreate <name>` | 创建公司 | `/corpcreate "My Corp"` |
| `/setalliance <name>` | 设置联盟 | `/setalliance "My Alliance"` |
| `/joinalliance <name>` | 加入联盟 | `/joinalliance "My Alliance"` |
| `/grantshipemblem <corp\|alliance\|both>` | 授予飞船徽章 | `/grantshipemblem both` |
| `/grantcorplogo` | 授予公司标志 | `/grantcorplogo` |
| `/grantalliancelogo` | 授予联盟标志 | `/grantalliancelogo` |

### 2.15 安全系统

| 命令 | 功能 | 示例 |
|------|------|------|
| `/concord [amount]` | 生成 CONCORD | `/concord 5` |
| `/cwatch <subcommand>` | 安全监控 | `/cwatch status` |
| `/naughty` | 变成嫌疑人 | `/naughty` |
| `/gateconcord [on\|off]` | 星门 CONCORD 开关 | `/gateconcord on` |
| `/gaterats [on\|off]` | 星门海盗开关 | `/gaterats on` |
| `/invu [on\|off]` | 无敌模式 | `/invu on` |
| `/yellow` | 黄色状态 | `/yellow` |
| `/red` | 红色状态 | `/red` |

### 2.16 其他

| 命令 | 功能 | 示例 |
|------|------|------|
| `/help` | 显示帮助 | `/help` |
| `/motd` | 设置 MOTD | `/motd` |
| `/mailme` | 给自己发邮件 | `/mailme` |
| `/announce <msg>` | 全服公告 | `/announce Hello` |
| `/session` | 查看会话信息 | `/session` |
| `/where` | 查看位置 | `/where` |
| `/who` | 查看在线玩家 | `/who` |
| `/wallet` | 查看钱包 | `/wallet` |
| `/overlayrefresh` | 刷新界面 | `/overlayrefresh` |
| `/tidi [0.1-1.0]` | 设置时间膨胀 | `/tidi 0.5` |
| `/prop` | 属性查看 | `/prop` |
| `/teal` | Teal 效果 | `/teal` |
| `/deer_hunter` | Deer Hunter 特效 | `/deer_hunter` |
| `/npcclear <system\|radius>` | 清除 NPC | `/npcclear system npc` |
| `/sysjunkclear` | 清除星系垃圾 | `/sysjunkclear` |
| `/testclear` | 测试清除 | `/testclear` |
| `/blue` | 蓝图包 | `/blue` |

---

## 三、验证脚本（Parity/Replay Tests）

这些脚本位于 `Code/server/scripts/` 目录下，用于验证服务器行为与官方服务器的一致性。

### 3.1 运行方式

```bash
cd Code/server
node server/scripts/<script_name>.js
```

### 3.2 脚本分类

#### 命运权威（Destiny Authority）— 移动/位置验证

| 脚本 | 功能 |
|------|------|
| `verifyDestinyAuthorityCore.js` | 核心命运权威验证 |
| `verifyDestinyAuthorityDropAndFx.js` | 掉落和特效验证 |
| `verifyDestinyRewriteSweep.js` | 重写扫描验证 |

#### 移动（Movement）

| 脚本 | 功能 |
|------|------|
| `verifyMovementCommandExtraction.js` | 移动命令提取 |
| `verifyMovementContractDispatchExtraction.js` | 移动合同分发提取 |
| `verifyMovementDestinyDispatchExtraction.js` | 命运分发提取 |
| `verifyMovementDestinyLaneExtraction.js` | 命运航道提取 |
| `verifyMovementLanePolicyExtraction.js` | 航道策略提取 |
| `verifyMovementRemovalParity.js` | 移除一致性 |
| `verifyMovementWarpParity.js` | 跃迁一致性 |
| `verifyMovementWatcherCorrectionExtraction.js` | 观察者校正提取 |

#### 导弹（Missile）

| 脚本 | 功能 |
|------|------|
| `explainMissileLaneTrace.js` | 导弹航道轨迹解释 |
| `verifyBadjoltMissileRemovalParity.js` | 导弹移除一致性 |
| `verifyBadjoltingObserverOrbitParity.js` | 观察者轨道一致性 |
| `verifyFulldessync11OwnerMissileAcquireParity.js` | 所有者导弹获取一致性 |
| `verifyFulldesync9ObserverMissileParity.js` | 观察者导弹一致性 |
| `verifyNpcMissilePoolParity.js` | NPC 导弹池一致性 |
| `verifyObserverMissileLifecycleParity.js` | 观察者导弹生命周期一致性 |
| `verifyNpcjoltOwnerMissileParity.js` | NPC 所有者导弹一致性 |

#### NPC 战斗

| 脚本 | 功能 |
|------|------|
| `verifyNpcCombatJoltMitigations.js` | NPC 战斗抖动缓解 |
| `verifyNativeNpcWeaponReloadParity.js` | NPC 武器装填一致性 |
| `verifyNpcTurretReloadParity.js` | NPC 炮塔装填一致性 |
| `verifyNpcTestService.js` | NPC 测试服务 |

#### 战斗（Combat）

| 脚本 | 功能 |
|------|------|
| `verifyHereCombatParity.js` | 此处战斗一致性 |
| `verifyJolt00CombatParity.js` | Jolt00 战斗一致性 |
| `verifyJolting555CombatParity.js` | Jolting555 战斗一致性 |
| `verifyHere22JoltParity.js` | Here22 抖动一致性 |
| `verifyJolt858AuthorityParity.js` | Jolt858 权威一致性 |
| `verifyJolty324AuthorityParity.js` | Jolty324 权威一致性 |
| `verifyJolty33ObserverParity.js` | Jolty33 观察者一致性 |
| `verifyJolty99OwnerGotoParity.js` | Jolty99 所有者前往一致性 |

#### 所有者/观察者（Owner/Observer）

| 脚本 | 功能 |
|------|------|
| `verifyAwfulOwnerGotoParity.js` | 所有者前往一致性 |
| `verifyFunkyParity.js` | 异常一致性 |
| `verifyGlitchObserverMissileRemovalParity.js` | 观察者导弹移除故障 |
| `verifyLagQueuedOwnerGotoParity.js` | 延迟队列所有者前往 |
| `verifyMoreOwnerDamageParity.js` | 更多所有者伤害一致性 |
| `verifyOwnerDamageMovementParity.js` | 所有者伤害移动一致性 |
| `verifyOwnerPresentedParity.js` | 所有者呈现一致性 |

#### 合并/分解（Coalescing）

| 脚本 | 功能 |
|------|------|
| `verifyJolts22DirectCoalescing.js` | Jolts22 直接合并 |
| `verifyJolts2Parity.js` | Jolts2 一致性 |
| `verifyJoltsObserverParity.js` | Jolts 观察者一致性 |
| `verifyMorejoltsTeardownCoalescing.js` | 更多抖动分解合并 |
| `verifyRemainingJoltyParity.js` | 剩余 Jolty 一致性 |

#### 其他

| 脚本 | 功能 |
|------|------|
| `verifyJolt222OwnerMissileFreshAcquireParity.js` | 所有者导弹新鲜获取 |
| `verifyJolt222PropulsionParity.js` | 推进一致性 |
| `verifySuperTitanShowStaging.js` | 超级泰坦展示 |
| `verifyTargetKillModuleTeardown.js` | 目标击杀模块分解 |
| `verifyWarpDestinationHandoffLog.js` | 跃迁目的地交接日志 |

---

## 四、健康检查与诊断

### 4.1 服务端点

| 地址 | 用途 |
|------|------|
| `http://127.0.0.1:26002/health` | Node HTTP 健康检查 |
| `http://127.0.0.1:40110/health` | Rust 市场健康检查 |
| `http://127.0.0.1:40110/v1/manifest` | 市场清单 |
| `http://127.0.0.1:40110/v1/diagnostics` | 市场诊断 |

### 4.2 Docker 诊断

```bash
# 容器状态
docker compose ps --all

# 服务健康
docker compose ps

# 最近 200 行日志
docker compose logs --tail 200 init market server

# 进入 Node 容器
docker compose exec server sh

# 市场状态
docker compose run --rm --no-deps market-tools status

# 市场诊断（需先停止 server 和 market）
docker compose stop server market
docker compose run --rm --no-deps market-tools doctor
```

### 4.3 日志位置

| 日志 | 路径 |
|------|------|
| 服务器日志 | `Code/server/logs/` |
| Slash 命令调试日志 | `Code/server/logs/slash-debug.log` |
| Node 崩溃报告 | `Code/server/logs/node-reports/` |

---

## 五、常用调试场景

### 5.1 启动服务器并测试 NPC 生成

```bash
# 1. 启动服务器
cd Code/server
npm start

# 2. 在游戏中登录后
/npc 5 guristas        # 生成 5 个 Guristas 海盗
/mnpc 3 serpentis      # 生成 3 个可攻击的 Serpentis
/npcclear system npc   # 清除星系内所有 NPC
```

### 5.2 测试掉落系统

```bash
# 1. 获取一艘能打的船
/ship "Drake"
/gmweapons

# 2. 生成 NPC 并击杀
/npc 3 guristas

# 3. 击杀后打开残骸拾取物品
# 如果残骸为空，参考 Issue #001 进行排查
```

### 5.3 测试市场

```bash
# 1. 确保市场服务器已启动
Code/StartMarketServer.bat

# 2. 检查市场健康
curl.exe http://127.0.0.1:40110/health

# 3. 在游戏中打开市场面板
# 如果市场无数据，重新构建市场种子
Code/BuildMarketSeed.bat
```

### 5.4 数据库问题排查

```bash
# 1. 检查数据库是否存在
dir Code\_local\gameStore\data\

# 2. 如果数据库损坏，强制重建
Code/tools/DatabaseCreator/CreateDatabase.bat /force

# 3. 迁移特定表到 SQLite
cd Code/server
node src/gameStore/migrateJsonToSqlite.js npcLootTables
node src/gameStore/migrateJsonToSqlite.js npcProfiles
```

### 5.5 时间膨胀调试

```bash
# 设置时间膨胀为 50%
/tidi 0.5

# 恢复为正常速度
/tidi 1.0
```

---

## 六、环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `EVEJS_GAMESTORE_DATA_DIR` | 自定义游戏数据库路径 | `D:\EveJSData` |
| `EVEJS_DEV_AUTO_CREATE_ACCOUNTS` | 自动创建账户 | `true` |
| `EVEJS_DEV_SKIP_PASSWORD_VALIDATION` | 跳过密码验证 | `true` |
| `EVEJS_GAME_SERVER_BIND_HOST` | 服务器绑定地址 | `127.0.0.1` |
| `EVEJS_PROXY_LOCAL_INTERCEPT` | 本地代理拦截 | `1` |

---

## 七、配置文件

| 文件 | 说明 |
|------|------|
| `Code/evejs.config.local.json` | 本地配置（最高优先级） |
| `Code/evejs.config.json` | 共享配置 |
| `Code/server/package.json` | 服务器依赖 |
| `Code/compose.yaml` | Docker Compose 配置 |
| `Code/docker/market-server.toml` | 市场服务器配置 |
| `Code/docker/market-seed.toml` | 市场种子配置 |
