# 项目数据契约

项目根目录由 `scripts/manhua.mjs init` 建立。`project.json` 定义固定阶段、来源范围、数据文件位置和审核快照；正式项目数据不存入 Skill 安装目录。

## 数据文件

| 文件 | 主要集合/职责 |
| --- | --- |
| `data/source_index.json` | `chapters`: `id`、章节标题、原文相对位置、阅读状态 |
| `data/story_events.json` | `events`: 稳定事件 ID、`chapter_id`、摘要、人物/地点、原文出处 |
| `data/characters.json` / `factions.json` / `scenes.json` / `props.json` | 实体稳定 ID、描述、来源和必要外键 |
| `data/timeline.json` | `events`: 事件时间顺序与关系 |
| `data/asset_registry.json` | `assets`: `asset_id`、`version_id`、正整数 `version`、`asset_type`、文件、提示词、父版本、变体/提示词版本、参考版本和审核状态 |
| `data/visual_style.json` | 全局画风/画幅/色盘/光线/质量约束/动态世界观禁用元素 |
| `data/costume_rules.json` | 每个势力每个等级一条颜色/材质/结构/纹样/配饰/武器/身份标识/华丽度规则 |
| `data/screenplay.json` | `scenes`: 章节/事件/场景/人物引用和结构化 `segments` |
| `data/story_coverage.json` | 每个原著事件一条覆盖状态和剧本场次引用 |
| `data/storyboard.json` | `shots`: 场次、事件、资产引用、镜头语言、时长、分镜图和审核状态 |
| `data/production_tasks.json` | 图片/视频任务真实状态、模型参数、分镜/资产引用、输出文件、失败原因 |
| `data/audio_timeline.json` | 分轨类型、时间范围、剧本引用、音频文件、审核记录 |
| `data/quality_reports.json` | 确定性/人工质量报告和问题处置 |
| `data/approvals.json` | 用户阶段确认/驳回、时间、人、说明和 SHA-256 快照 |

核心实体 ID 必须稳定且唯一；每个资产生成版本都有独立 `version_id`。外键必须引用现存记录。路径必须是项目内相对路径。资产图片直接保存在 `images/角色/`、`images/场景/`、`images/道具/`、`images/分镜/` 或 `images/质检/`，不得嵌套子目录。JSON 可以追加字段，但不应复用字段表达不同含义。

## 原著证据

`source_refs` 是章节 ID 字符串数组。声明 `SOURCE_FACT` 的 claim 必须提供有效章节引用。角色/场景/道具中原文未明确的内容须明确标注 `INFERENCE`、`ART_DECISION` 或 `UNKNOWN`。

## 资产版本

未批准主资产不可作为正式衍生资产的父版本。衍生条目记录 `parent_asset_version_id`、`reference_asset_version_ids`、`variant_type`、`source_version` 和 `prompt_version`。文件路径和文件内容均须真实；正式审核通过的文件不可覆盖，重新生成须增加版本。

## 审核状态与报告

机器能确定的关系由 `validate` 检查；外貌相似、剧情理解、美术质量、节奏等主观判断必须保存人工审核结论。HTML 页面离线展示数据，页面审核选项通过浏览器导出，不会自行写回项目；需由 Agent 在用户确认后记录。

JSON Schema 定义在 `schemas/`，初始化空结构见 `templates/`。
