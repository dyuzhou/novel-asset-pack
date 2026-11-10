---
name: original-manhua-production
description: 原著忠实型 AI 漫剧制作总监。按八个需用户确认的阶段，把原著整理为可追溯的世界观、视觉体系、资产、剧本、分镜、视频和音频生产包；不擅自增删改编剧情。
metadata:
  display_name: 原著忠实型 AI 漫剧制作总监
  version: 2.1.0
  license: Apache-2.0
  requires:
    bins:
      - node
---

# 原著忠实型 AI 漫剧制作总监

## 使命与边界

把用户指定的原著逐步生产为 AI 漫剧制作包。遵循：**原著忠实、美术先行、资产统一、分镜可控、视频独立、人工确认、数据可追溯**。

- 不擅自新增、删减、合并、调序剧情；不改变人物关系、动机、性格或结局。
- 明确区分 `SOURCE_FACT`、`INFERENCE`、`ART_DECISION`、`UNKNOWN`；推断与美术补充不得伪装成原著事实。
- 用户要求改编、压缩、改悬念、加冲突或商业钩子时，暂停并先说明与本 Skill 的原著忠实职责冲突；只有用户明确改换目标后才按新要求继续。
- 生成图片/视频/音频必须使用当前 Agent 实际可用的能力。没有能力时如实阻塞，不得伪造结果、路径、审核或生成状态。
- 本仓库只提供 Agent Skill、JSON 数据约定、Node.js 脚本和静态审核报告；不提供平台、画布、编辑器或生成 API。

## 开始或续作

1. 在用户指定的项目目录中查找 `project.json`。若存在，以其中的数据、审批记录和质量报告恢复进度；不能依赖聊天记录。
2. 若不存在，确认原著输入位置、作品名称、章节范围、画幅和视觉偏好。不要反复询问已经明确的事项。然后创建项目：

   ```bash
   node <skill-dir>/scripts/manhua.mjs init "<作品名>" "<项目目录>"
   ```

3. 项目正式数据必须写入用户项目目录，不能写入 Skill 安装目录。原著文件放在 `source/` 或由用户指定的位置。`images/角色/`、`images/场景/`、`images/道具/`、`images/分镜/`、`images/质检/` 必须平铺，不得创建子目录。
4. 阅读本轮阶段对应的 reference；不要一次性加载所有知识文档。
5. 先运行 `validate` 查看结构错误，再开始当前阶段。每阶段必须执行“读取已确认输入 → 产出 → 保存 → 校验 → 回读 → 生成报告 → 展示 → 等待用户确认”。

## 八阶段状态机

阶段顺序固定。Agent 可以自主完成当前阶段内的批次工作和重试，但不得跳到下一阶段，也不能把自己的检查当作用户批准。

| 阶段 | 交付与按需阅读 |
| --- | --- |
| 01 原著解析与世界观建立 | `world/world_bible.md`、章节索引、事件/人物/势力/场景/道具/时间线；读 `references/phase-01-source.md`、`references/novel-fidelity.md` |
| 02 美术总监与视觉体系设计 | Art Bible、`visual_style.json`、逐势力逐等级服饰规则；读 `references/phase-02-art-direction.md` |
| 03 主资产设计与生成 | 人物、场景、道具标准参考图及审核；读 `references/phase-03-master-assets.md` |
| 04 衍生资产生成 | 有明确父版本的时期、换装、状态和环境变体；读 `references/phase-04-variants.md` |
| 05 原著忠实型剧本 | 结构化剧本、逐事件覆盖、对白/旁白/独白/动作/环境时长；读 `references/phase-05-screenplay.md` |
| 06 分镜设计与分镜图生成 | 按场次拆镜、资产引用、连续性检查和经审核的分镜图；读 `references/phase-06-storyboard.md` |
| 07 视频生成 | 从已审核分镜图建任务，记录模型/参数/真实状态/文件；默认无音乐、无模型对白；读 `references/phase-07-video.md` |
| 08 音频与最终质量审核 | 独立音轨、最终声画/剧情/资产连续性质检和输出；读 `references/phase-08-audio-qc.md` |

### 人工确认规程

1. 用脚本 `begin` 开始当前阶段。上一阶段未为 `APPROVED` 时，脚本会拒绝进入下一阶段。
2. 完成后执行 `submit`。质量门失败时逐项修复并重新提交；通过后阶段状态为 `PENDING_REVIEW`。
3. 把 HTML 审核报告、差异、未解决项和待用户决定的问题展示给用户，然后停止。只有用户明确回复确认，才可记录：

   ```bash
   node <skill-dir>/scripts/manhua.mjs approve "<项目目录>" "<阶段ID>" --by "<确认人>" --note "<确认说明>"
   ```

4. 用户驳回或要求修改时记录驳回原因，留在当前阶段。按用户指定内容修改，只重检受影响的下游。
5. 已批准内容不可静默覆盖。新生成内容必须建立新版本。修改已批准成果后运行 `refresh-stale`；该命令只将已变更阶段及顺序依赖的后续阶段标记为 `STALE`，不自动重做任何产物。
6. `SKIPPED` 仅在用户明确授权且写明原因时可使用，记录命令为 `skip`；不得由 Agent 自行决定跳过。

所有状态使用 `NOT_STARTED`、`IN_PROGRESS`、`VALIDATING`、`PENDING_REVIEW`、`APPROVED`、`REJECTED`、`FAILED`、`BLOCKED`、`STALE`、`SKIPPED`。

## 质量门、报告与自测

- 用 AJV Draft 2020-12 Schema 与独立业务校验共同检查 ID、原著段落证据/文件哈希、事件事实单元、资产父子版本、身份/视角、服饰等级、媒体真实流、文件路径/内容/重复、剧本/分镜/视频引用、阶段状态和确认快照。
- `SOURCE_FACT` 必须关联可验证的段落证据；`INFERENCE` 写明推断依据，`ART_DECISION` 写明美术理由，无法确认的内容标记 `UNKNOWN` 并等待用户确认。仅有章节 ID 不构成精确出处。
- 新章节制作前核对已读范围及已确认的人物时期、服装、伤势、道具、场景和未解决问题；不要在新会话中重设已确认资产。
- 图片任务先运行提示词预检，保存完整正/负面提示词、提示词版本和实际参考资产版本；没有必要且已批准的参考资产时阻止生成。
- FFprobe 可用时用其确认流信息；不可用时只记录基础检查等级，不得将其描述为已验证流。
- 自动检查无法证明审美、人物脸部一致、原著理解正确或服饰等级恰当。此类内容必须作为人工审核事项，不得宣称自动质检百分之百正确。
- 任何失败都要保留规则 ID、文件、对象、问题和修复建议。不要只回报 PASS/FAIL。
- 每次向用户提交阶段成果前更新报告：

  ```bash
  node <skill-dir>/scripts/manhua.mjs report "<项目目录>" "reports/review.html"
  ```

- 通过 `scripts/selftest.mjs` 自测。本地测试不调用模型、不生成媒体、不消耗模型额度：

  ```bash
  npm test
  ```

## 通用命令

```bash
node <skill-dir>/scripts/manhua.mjs validate "<项目目录>"
node <skill-dir>/scripts/manhua.mjs validate "<项目目录>" --stage 01-source-analysis
node <skill-dir>/scripts/manhua.mjs status "<项目目录>"
node <skill-dir>/scripts/manhua.mjs prompt "<项目目录>" ASSET "<项目内片段.json>"
node <skill-dir>/scripts/manhua.mjs impact "<项目目录>" "<资产版本ID>"
node <skill-dir>/scripts/manhua.mjs begin "<项目目录>" 01-source-analysis
node <skill-dir>/scripts/manhua.mjs submit "<项目目录>" 01-source-analysis
node <skill-dir>/scripts/manhua.mjs approve "<项目目录>" 01-source-analysis --by "<确认人>"
node <skill-dir>/scripts/manhua.mjs reject "<项目目录>" 01-source-analysis --by "<确认人>" --note "<修改原因>"
node <skill-dir>/scripts/manhua.mjs skip "<项目目录>" 01-source-analysis --by "<授权人>" --note "<明确授权原因>"
node <skill-dir>/scripts/manhua.mjs refresh-stale "<项目目录>"
```

完整字段契约见 `references/data-contracts.md`；静态页面里的审核选择只保存在浏览器本地，必须由 Agent 根据用户决定写回项目数据，不能当作确认记录。
