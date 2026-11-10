# 参考方法研究说明

研究范围：

- [Toonflow v118workflow](https://github.com/HBAI-Ltd/Toonflow-app/tree/master/packages/skills/v118workflow)：对照其总工作流、项目初始化、原著事件、基础资产、资产衍生、分镜面板和视频生产知识，参考阶段式知识组织、阶段交付/检查、用户确认与续作。
- [shuohao-skills](https://github.com/eternityspring/shuohao-skills)：对照 novel-outline、novel-characters、novel-art、novel-script、novel-storyboard、character-refs 和 novel-staging 等 Skill，参考结构化项目数据、脚本质量门、HTML 审核报告和无模型自测的工程实践。

| 分类 | 本项目处理 |
| --- | --- |
| 借鉴 | 阶段边界、阶段交付物、显式确认、持久化续作、稳定 JSON ID、确定性校验、问题级报告、自测 |
| 不采用 | Toonflow 的制作平台、画布/节点运行环境；短剧商业节奏、固定时长/钩子/删减策略；特定生成模型提示词协议 |
| 新增 | 严格事件覆盖、SOURCE_FACT/INFERENCE/ART_DECISION/UNKNOWN、世界观动态禁用元素、资产版本快照和 STALE 影响、音视频分离 |
| 冲突处理 | 任何商业化改编惯例均服从用户的原著忠实要求；Agent 自评不得代替用户批准；生成任务不得伪装成媒体成功 |

本文只记录研究到的主题与本项目的取舍，不表示对参考项目全部代码或知识文档作了穷尽审计。本文为原创摘要，未复制参考仓库实现代码或大段文档。参考项目分别按其仓库公布的许可证管理；本项目没有将其作为依赖或重新分发其源文件。
