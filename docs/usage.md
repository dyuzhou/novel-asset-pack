# 使用指南

## 创建项目

```bash
node scripts/manhua.mjs init "示例作品" /path/to/AI-Manhua
```

空目录或不存在的目录均可。非空目标会被拒绝，避免覆盖既有项目。初始化会创建 `project.json`、`data/*.json`、世界观文档骨架和固定平铺素材目录。

首次运行脚本前，在 Skill 仓库安装锁定依赖：`npm ci`。质量门会通过 AJV 统一校验 JSON Schema。

## 制作与确认

`SKILL.md` 是 Agent 执行约定。脚本只做数据校验、状态持久化和报告，不调用媒体模型。

```bash
node scripts/manhua.mjs validate /path/to/AI-Manhua
node scripts/manhua.mjs status /path/to/AI-Manhua
node scripts/manhua.mjs begin /path/to/AI-Manhua 01-source-analysis
node scripts/manhua.mjs validate /path/to/AI-Manhua --stage 01-source-analysis
node scripts/manhua.mjs report /path/to/AI-Manhua
node scripts/manhua.mjs submit /path/to/AI-Manhua 01-source-analysis
```

Agent 必须将报告和结论展示给用户并等待明确确认。用户确认后：

```bash
node scripts/manhua.mjs approve /path/to/AI-Manhua 01-source-analysis --by "用户" --note "确认第一阶段"
```

驳回用 `reject`，修订后重新 `submit`。项目数据修改后 `validate` 会检查审批快照；`refresh-stale` 将变更阶段和其后续阶段标为 `STALE`，需要逐阶段复核。

只在用户明确授权时才能跳过当前阶段，授权人和原因会写入不可变决定记录：

```bash
node scripts/manhua.mjs skip /path/to/AI-Manhua 01-source-analysis --by "用户" --note "用户明确授权跳过的原因"
```

使用 `impact` 追踪资产版本变更影响到的衍生资产、分镜和视频任务。使用 `prompt` 读取项目内的提示词片段 JSON，并结合项目视觉风格输出图片提示词；它仅组装文本，不会启动生成服务：

```bash
node scripts/manhua.mjs impact /path/to/AI-Manhua character-001-v001
node scripts/manhua.mjs prompt /path/to/AI-Manhua ASSET prompts/character-001.json
```

## 报告与检查

`report` 生成离线单页 HTML，展示进度、资产版本/提示词/图片、原著事件覆盖、分镜、质量门和确认记录。图片审核选择可导出 JSON，但不会自动改项目文件，也不能替代阶段确认。

质量门失败输出规则 ID、文件、对象、问题和建议。图像视觉判断、原著语义判断仍需人工审核。运行确定性自测：

```bash
node scripts/selftest.mjs
```
