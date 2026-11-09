# novel-asset-pack

把小说/原著文本整理成 **AI 漫剧资产包**：世界观、势力与阶级、角色（含多时期）、场景、道具、提示词库，产出可离线双击打开的 HTML 单页报告。

流程与工程约定继承 [shuohao-skills](https://github.com/eternityspring/shuohao-skills)（seed / validate / render、零依赖、selftest 必备、质量门全脚本检查），需求差异（默认 3D 写实国风仙侠、忠实原著、时期图生图一致性、HTML 进度面板）以本 skill 为准。

## 特性

- **忠实原著**：不改写、不删减、不合并人物、不加短剧钩子；原文没写的设定标注"暂定"等用户确认
- **风格锚点锁死**：开局与用户确认一次，脚本自动注入每条提示词——"风格统一"是结构保证，不是口头约定
- **角色一致性**：固定主体锚点 + 原著硬特征（断臂/刀疤）逐时期延续；衍生时期默认参考图生图（脸型只微调），仅原著明确描写的幻化/易容才重开新图
- **统一提示词结构**：风格 + 视角 + 主体 + 背景 + 细节 + 光影 + 质量词 + 统一负面词
- **质量门 18 组全脚本检查**：锚点、五段结构、视角词、禁注入词、势力服饰区分、基准期唯一、衍生期参考图、固定特征延续、id 唯一……
- **HTML 报告**：进度总览（总进度条 + 七步状态）/ 项目配置 / 世界观 / 势力与阶级 / 角色资产 / 角色时期对照 / 场景 / 道具 / 提示词库，全部提示词带复制按钮，可导出 JSON 回流

## 用法（Agent 视角）

主工作流、命令、质量门清单见 [SKILL.md](SKILL.md)；字段规范见 [references/schema.md](references/schema.md)。

```bash
node scripts/asset-pack.mjs init <剧名>                     # 空骨架
node scripts/asset-pack.mjs seed outline.json <剧名>        # 从 shuohao novel-outline 搬运事实
node scripts/asset-pack.mjs validate <剧名>-assets.json     # 质量门（违规则 exit 1）
node scripts/asset-pack.mjs checkup <剧名>-assets.json      # 逐门明细
node scripts/asset-pack.mjs render <剧名>-assets.json --html > <剧名>-assets-report.html
node scripts/asset-pack.mjs render <剧名>-assets.json --md   > <剧名>-assets.md
```

示例见 [examples/](examples/)：[凡人修仙传-开篇-assets.json](examples/凡人修仙传-开篇-assets.json) 与 [已渲染的报告](examples/凡人修仙传-开篇-assets-report.html)（双击可直接预览最终效果）。

## 要求

- Node ≥ 18，零 npm 依赖
- 任何能读 `SKILL.md` 并运行 Node 脚本的 Agent（Claude Code / Codex 等）
- 本 skill 不出图；图片由下游生成后放入 `images/` 目录，重跑 `render` 自动嵌入报告

## 自测

```bash
node scripts/selftest.mjs   # 37 项断言，不调模型、不耗额度
```

## License

Apache-2.0
