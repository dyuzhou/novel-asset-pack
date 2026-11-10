# 八阶段工作流与断点续作

所有项目以用户指定目录中的 `project.json` 和 `data/` 为事实来源。阶段固定为 `PHASES` 中的八项；阶段 ID 不可重排或重命名。Agent 在阶段边界停下等待用户确认，不从对话历史猜测确认状态。

## 阶段门

每阶段按序执行：读取已批准输入 → 产出阶段数据 → 保存 → 调用 `validate --stage <id>` → 回读落盘结果 → 生成 `reports/review.html` → 汇总待确认项 → 等待明确回复。`submit` 会写入 `PENDING_REVIEW` 或 `FAILED`；只有用户明确确认后才能 `approve`。

驳回回到当前阶段。脚本不自动执行下游生产。修订已批准文件后，先运行 `refresh-stale`，再检查并重新审核受影响的下游。

## 状态

| 状态 | 用途 |
| --- | --- |
| `NOT_STARTED` | 尚未开始 |
| `IN_PROGRESS` | 正在制作 |
| `VALIDATING` | 正在跑确定性质量门 |
| `PENDING_REVIEW` | 检查通过，等待用户审核 |
| `APPROVED` | 用户明确批准并写入快照 |
| `REJECTED` | 用户驳回，需修改当前阶段 |
| `FAILED` | 质量门失败，修复后重新提交 |
| `BLOCKED` | 缺输入、权限或媒体生成能力，记录原因 |
| `STALE` | 已确认内容的依赖发生变更，需要复核 |
| `SKIPPED` | 仅用户明确授权，必须记录人和原因 |

## 恢复与变更

新会话开始先读取 `project.json`、`approvals.json`、最新质量报告和项目文件，再 `validate` 与生成报告。确认快照保存阶段数据 SHA-256；发现确认后内容变化时，`validate` 给出 `PHASE-APPROVAL-STALE`，`refresh-stale` 标记对应阶段及其后续阶段。不会自动覆写审批历史或生成任何资产。

参考项目仅借鉴“知识分阶段加载、交付后检查、显式确认、基于持久化项目状态续作”的工作法；不要求画布、节点或平台运行环境。
