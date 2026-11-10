# 图片提示词与生成记录

# 图片提示词与生图前预检

唯一实现位于 `scripts/prompt-builder.mjs`；`manhua.mjs` 的 `buildImagePrompt()` 和 CLI 都调用该实现。组装结果与图片模型/API 无关，不会连接或启动生成服务。

提示词固定分层为：全局画风、世界观/时代、势力视觉/服饰等级、人物身份锚点、人物时期/服装状态、场景/道具、当前任务、视图/构图、氛围光影、质量约束、负面提示词。世界观禁用元素和 `negative_constraints` 会注入完整提示词，也可以通过 `negative_prompt` 单独传递。

任务类型：

| 类型 | 约束 |
| --- | --- |
| `CHARACTER_ASSET` | 人物标准资产图 |
| `CHARACTER_VIEWS` | 多视角必须引用已批准人物主参考版本 |
| `CHARACTER_EXPRESSION` | 表情资产须保留身份锚点 |
| `CHARACTER_DERIVATIVE` | 换装/年龄/状态变化明确时期，普通换装不改变身份 |
| `SCENE_MASTER` | 场景标准图不能带入剧情人物或剧情背景 |
| `SCENE_VARIANT` | 引用已批准场景版本并描述状态变体 |
| `PROP_ASSET` | 道具标准资产图 |
| `STORYBOARD` | 必须引用已经审核的人物、场景和/或道具资产版本 |

生图前提供任务 ID、实体 ID、当前资产版本、参考图、人物锚点、时期、势力等级、服装状态、世界观约束、完整提示词和负面提示词。缺少要求的批准参考版本、身份变化证据或必要服饰规则时停止任务，不得绕过预检。

将返回的 `prompt`、`negative_prompt`、`prompt_version`、`reference_asset_version_ids` 和 `reference_files` 原样保存到资产/生成任务记录。多视角的每一幅图都标记 `view_type`；项目只需完成人物配置的 `required_views`，不应强迫路人生成完整三视图。

## 视觉错误案例

生成/审核前按需查看 [`visual-failure-cases.md`](visual-failure-cases.md)，其中列出等级反转、换装变脸、时代穿帮、背景串入、视角不一致、道具变形和空间连续性等常见错误及验收标准。
