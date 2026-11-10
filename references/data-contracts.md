# 项目数据契约

项目根目录由 `scripts/manhua.mjs init` 建立；项目数据写入用户指定的制作目录，与 Skill 仓库分离。JSON Schema 是字段/类型/枚举契约，`validate` 还会执行外键、证据、版本、媒体及八阶段业务质量门。

| 文件 | 职责 |
| --- | --- |
| `project.json` | 固定八阶段、来源文件统一登记及 SHA-256、数据路径、审批快照 |
| `data/source_index.json` | 章节 ID、原文文件、阅读状态和文件哈希 |
| `data/continuity.json` | 已读范围、已确认事件、人物当前状态、跨章继承和未解决问题 |
| `data/source_evidence.json` | 精确段落定位、短摘录、偏移和摘录/原文哈希 |
| `data/story_events.json` | 原著事件、重要度、原文证据 |
| `data/event_beats.json` | 事件关键事实单元与剧本场次/片段/分镜映射 |
| `data/characters.json`、`factions.json`、`scenes.json`、`props.json` | 实体稳定 ID、来源主张、身份锚点和势力等级体系 |
| `data/timeline.json` | 事件时间顺序与关系 |
| `data/asset_registry.json` | 资产版本、文件、完整提示词、父/参考版本、身份/视角和人工审核 |
| `data/visual_style.json` | 全局画风、时代允许/禁用元素、灯光、质量和负面约束 |
| `data/costume_rules.json` | 势力/身份等级下多维服饰规范、场景和特殊例外 |
| `data/screenplay.json`、`story_coverage.json` | 结构化剧本和事件覆盖 |
| `data/storyboard.json` | 镜头、场次/事件、实体与审核资产版本引用 |
| `data/production_tasks.json` | 图片/视频/最终渲染任务、真实输出状态和验证等级 |
| `data/audio_timeline.json` | 独立音轨、时长、审核及 `NOT_APPLICABLE` 原因 |
| `data/quality_reports.json`、`approvals.json` | 自动/人工质量记录及用户阶段决定 |

稳定 ID 必须唯一，外键必须指向现存记录。路径使用 POSIX 风格项目内相对路径；图片直接存放在 `images/角色/`、`images/场景/`、`images/道具/`、`images/分镜/` 或 `images/质检/`，不可嵌套子目录。

## 来源与主张

项目所有原著文件必须登记在 `project.source_files`，保存 SHA-256；来源章节和段落证据还应记录当前哈希。`source_refs` 章节 ID 不能代替精确证据。

- `SOURCE_FACT`：必须具有有效 `evidence_refs`，并保证证据章节与声明一致。
- `INFERENCE`：记录 `basis`，明确推断依据，不可混写成原著事实。
- `ART_DECISION`：记录 `reason`，必要时等待用户确认。
- `UNKNOWN`：明确未知并提出待确认事项，不得强行补设定。

证据摘录长度有限；完整原著只保存在用户项目目录。重新加载/校验时重算文件 SHA-256，变化会报告来源及证据失效。用户确认历史不会被覆盖；仅对实际依赖变更来源的结果重新检查。

## 资产、服饰与提示词

人物用 `identity_anchor_id` 固定核心身份；衍生资产记录 `appearance_period`、`costume_variant`、`transformation_type`、`identity_change_allowed`、变化证据和已批准父版本。普通换装保持身份。`required_views` 按人物重要程度配置，资产版本通过 `view_type` 标记对应视角。

新章节剧本须有已读的 continuity 记录，非首章需声明 `inherited_from_chapter_id`；场次中的每位人物都要有当前时期、服装、伤势、持有道具和场景状态。保存已确认事件和开放问题，以便新会话续作时不重设人物。

服饰等级按势力分别配置 `rank_order`，并检查材料、工艺、身份标识、配饰、华丽度、正式度与日常/战斗/仪式等场景。例外记录理由及原著证据或用户批准；`UNKNOWN` 等级需等待用户决定。HTML 报告含服饰等级对照表。

提示词由 `scripts/prompt-builder.mjs` 单一实现，按全局画风、时代、势力等级、身份锚点、时期服装、场景/道具、任务、视角、光影、质量、负面约束组装。任务数据要保存完整提示词、`prompt_version` 和实际参考图版本。资产图不带剧情背景；标准场景图不带剧情人物；分镜必须引用已审核资产。

## 媒体和审批

媒体任务只有实际文件存在且对应检查通过后才可标为 `COMPLETED`。FFprobe 可用时验证真实音视频流、时长和视频分辨率等信息；不可用时只做基础格式检查并声明 `BASIC`，绝不虚构流信息。无适用音轨的项目可使用 `NOT_APPLICABLE` 并记录原因。

JSON Schema 定义在 `schemas/`，空模板由 `scripts/manhua.mjs init` 写入。静态 HTML 报告离线运行；按钮仅导出浏览器本地决定，不会更新 JSON，也不代表用户已确认。
