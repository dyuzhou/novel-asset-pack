# novel-asset-pack

把小说/原著推进为 **AI 漫剧制作资产**：全文分析、世界观、势力与阶级、角色（含多时期）、种族、场景、道具、美工规划与检验、音频、剧本、分镜和镜头图，并产出可离线双击打开的 HTML 单页报告。

流程与工程约定继承 [shuohao-skills](https://github.com/eternityspring/shuohao-skills)（seed / validate / render、零依赖、selftest 必备、质量门全脚本检查），需求差异（默认 3D 写实国风仙侠、忠实原著、时期图生图一致性、HTML 进度面板）以本 skill 为准。

## 特性

- **忠实原著**：不改写、不删减、不合并人物、不加短剧钩子；原文没写的设定标注"暂定"等用户确认
- **风格锚点锁死**：开局与用户确认一次，脚本自动注入每条提示词——"风格统一"是结构保证，不是口头约定
- **角色一致性**：固定主体锚点 + 原著硬特征（断臂/刀疤）逐时期延续；衍生时期默认参考图生图（脸型只微调），仅原著明确描写的幻化/易容才重开新图
- **统一提示词结构**：风格 + 视角 + 主体 + 背景 + 细节 + 光影 + 质量词 + 统一负面词
- **质量门 18 组全脚本检查**：锚点、五段结构、视角词、禁注入词、势力服饰区分、基准期唯一、衍生期参考图、固定特征延续、id 唯一……
- **固定 12 步流程**：顺序校验禁止跳关；阶段交付物不全时不能标记完成
- **持续更新 HTML**：每一步都能输出草稿报告，显示进度、质量门警示、种族、美工审核、音频、剧本/分镜和镜头图
- **项目内素材目录**：`images/角色/`、`images/场景/`、`images/美工设计/`、`images/道具/`、`images/镜头/`，以及 `audio/`
- **工具脚本归档**：当前作品新增的辅助脚本全部放在该项目的 `./script/` 下

## 用法（Agent 视角）

主工作流、逐阶段更新纪律、生成工具不可用时的阻塞处理见 [SKILL.md](SKILL.md)；字段规范见 [references/schema.md](references/schema.md)。

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
- Node 脚本不直接调用生成 API；Agent 使用当前可用的图像/音频工具，产物放在项目目录对应文件夹。工具不可用时必须保留阶段为进行中并报告原因
- `render` 可在流程未完成时输出 HTML 草稿；最终交付前仍须通过 `validate`

## 自测

```bash
node scripts/selftest.mjs   # 39 项断言，不调模型、不耗额度
```

## License

Apache-2.0
