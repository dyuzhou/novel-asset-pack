# JSON Schema 与数据契约

Schema 是项目 JSON 的正式结构约定，由 `scripts/manhua.mjs validate` 通过 AJV 8 Draft 2020-12 统一加载。Schema 负责必需字段、数据类型、枚举和格式；脚本另行执行外键、原著证据、版本依赖、媒体有效性和阶段状态等业务校验。Schema 通过不代表内容语义正确，也不代替用户审核。

## 校验与错误

```bash
npm ci
node scripts/manhua.mjs validate /path/to/AI-Manhua
node scripts/manhua.mjs validate /path/to/AI-Manhua --stage 01-source-analysis
npm test
```

Schema 错误包含规则 `SCHEMA-VALIDATION`、JSON 文件路径、对象/数组 JSON Pointer 和 AJV 原因。初始化生成的空模板、仓库示例和测试数据都由同一 Schema 校验入口检查。

## Schema 清单

| Schema | 数据文件 | 主要约束 |
| --- | --- | --- |
| `project.schema.json` | `project.json` | 固定八阶段、项目来源文件及 SHA-256、阶段状态 |
| `source-index.schema.json` | `data/source_index.json` | 章节 ID、来源文件和文件哈希 |
| `continuity.schema.json` | `data/continuity.json` | 已读/未读章节、确认事件、人物当前状态和未解决问题 |
| `source-evidence.schema.json` | `data/source_evidence.json` | 章节/段落、字符偏移、短摘录及双重哈希 |
| `story-events.schema.json` | `data/story_events.json` | 稳定事件、章节和出处 |
| `event-beats.schema.json` | `data/event_beats.json` | 事件事实单元及剧本场次、片段、镜头映射 |
| `character.schema.json` | `data/characters.json` | 人物身份锚点、必需视角、主张来源 |
| `factions.schema.json` | `data/factions.json` | 势力和等级视觉设定 |
| `scene.schema.json` | `data/scenes.json` | 场景及来源主张 |
| `props.schema.json` | `data/props.json` | 道具及来源主张 |
| `timeline.schema.json` | `data/timeline.json` | 事件时间线 |
| `asset.schema.json` | `data/asset_registry.json` | 资产版本、参考图、身份时期、变体及审核状态 |
| `visual-style.schema.json` | `data/visual_style.json` | 画风、时代允许/禁用元素、质量与负面约束 |
| `costume-rules.schema.json` | `data/costume_rules.json` | 势力等级、材料/工艺/标识/配饰、场景和例外 |
| `screenplay.schema.json` | `data/screenplay.json` | 结构化剧本和各类片段 |
| `story-coverage.schema.json` | `data/story_coverage.json` | 事件到剧本的覆盖状态 |
| `storyboard.schema.json` | `data/storyboard.json` | 镜头内容、实体和资产版本引用 |
| `production-tasks.schema.json` | `data/production_tasks.json` | 媒体任务状态、输出验证等级和时长 |
| `audio-timeline.schema.json` | `data/audio_timeline.json` | 独立音轨、状态、类型及时间 |
| `quality-reports.schema.json` | `data/quality_reports.json` | 自动与人工质量报告 |
| `approvals.schema.json` | `data/approvals.json` | 用户阶段决定和快照 |

## 来源证据

每条 `source_evidence` 至少记录：

- `source_id`、`chapter_id`、`paragraph_id`
- `start_offset`、`end_offset`：原文 UTF-16 字符偏移，左闭右开
- `evidence_text`、`evidence_hash`
- `source_file`、`source_file_hash`

原文完整内容留在项目目录中，证据只保存不超过 1000 字符的必要短摘录。校验会比较当前原文、偏移、摘录、段落 ID 和 SHA-256；原著修改后需重新核对证据。`SOURCE_FACT` 必须引用有效证据，`INFERENCE` 必须提供 `basis`，`ART_DECISION` 必须提供 `reason`，`UNKNOWN` 应显式等待用户决定。

## 资产、服饰与覆盖

人物 `required_views` 可按重要度选择 `FRONT`、`SIDE`、`BACK`、`FACE`、`EXPRESSION`、`COSTUME_DETAIL`；只有配置的视角必须齐全。人物衍生资产保存 `identity_anchor_id`、`appearance_period`、`costume_variant`、父资产版本及参考版本。易容、幻化、变身等身份变化需要明确授权标志和证据。

服饰等级使用 `rank_order`、材料/工艺/身份标识/配饰等级、`ornament_score`、正式度和场景共同表达，不得仅靠颜色或华丽度。特殊等级反转必须有 `exception_reason`，并关联有效原著证据或明确的用户批准人；原著未说明的等级可用 `UNKNOWN`，并请求用户确认。

重要事件需要拆为 `CAUSE`、`PROCESS`、`KEY_ACTION`、`REACTION`、`RESULT`、`CONSEQUENCE`；事件标记 `dialogue_required` 时还必须有 `DIALOGUE`。每项需关联有效原文证据、剧本场次、剧本片段和镜头。事件摘要覆盖不能替代逐项映射。

进入新章节剧本前，连续性记录必须标记章节已读、逐角色记录时期/服装/伤势/持有道具/所在场景，且继承上一已确认章节状态；未解决问题应继续保留。

## 文件与兼容性

项目 JSON 内路径统一使用 POSIX `/` 相对路径。脚本会拒绝绝对路径、越界路径和越界符号链接。报告资源 URL 按段编码中文、空格及 URL 特殊字符。原生 Windows/macOS 集成验收需在相应系统单独运行；Linux 自测的路径模拟不冒充原生验收。

视频/音频有 FFprobe 时验证实际流、时长和可用的媒体参数；没有 FFprobe 时仅做基础格式检查，必须标记 `BASIC`，无法确认的流信息不作推断。
