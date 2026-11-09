# report-style — HTML 报告规范

`render --html` 产出的单页报告是本 skill 的最终用户界面。双击离线可开，零外部依赖
（无 CDN、无网络字体、无构建）。改渲染逻辑时遵守以下约定：

## 数据注入

页面数据经 `window.__ASSET_REPORT__` 注入（`schema.md` 里用户要求的形式）：

```html
<script>window.__ASSET_REPORT__ = { generatedAt, doc, counts, assembled: { fullById } };</script>
```

- `doc`：assets.json 原样。
- `counts`：Node 端算好的计数（characters/periods/factions/scenes/props/stepsDone/stepsTotal），页面不重复实现业务逻辑。
- `assembled.fullById`：拼装完成的完整提示词表，键为 `faction:<id>` / `scene:<id>` / `prop:<id>` / `period:<charId>:<index>`，值 `{ full, img, reference }`。**提示词拼装只发生在 Node 端**（`assemblePrompt`），页面只负责展示与复制——保证报告里的提示词与 validate 通过的内容逐字一致。
- JSON 注入需转义 `</script>`（实现为把所有 `<` 转成 `\u003c`）。

## 页面结构

左侧固定导航 + 右侧内容面板，九个区块（导航带计数徽标，支持 `#锚点` 深链）：

1. **进度总览 PROGRESS**：七步 pipeline 状态列表（完成/进行中/待开始 徽标 + note）+ 总进度条 + 资产计数卡
2. **项目配置 PROJECT**：画幅、忠实原著徽标、风格锚点（金框高亮块）、统一质量词、统一负面词（红框）
3. **世界观 WORLD**：六项定义列表
4. **势力与阶级 FACTIONS**：卡片（主色色块、阶级徽标、服饰规则、纹样、提示词）
5. **角色资产 CHARACTERS**：角色卡（性别/年龄/势力/阶级徽标，身份、性格、固定主体锚点朱红高亮，固定特征红框警示）+ 每个时期子卡（模式徽标：基准期·首图 / 衍生期·图生图 / 原著幻化重开）
6. **角色时期变化 PERIODS**：每角色一张时期对照表（时期/生成方式/外貌/服饰/变化依据/参考图）
7. **场景资产 SCENES** / 8. **道具资产 PROPS**：卡片 + 提示词
9. **提示词库 PROMPT LIBRARY**：通用段（锚点+质量词、负面词）+ 按类别分组的全部完整提示词

## 交互约定

- **每个提示词块带复制按钮**（clipboard API + execCommand 回退，点击后 1.4s "已复制"）。
- **导出 JSON** 按钮：左栏底部，下载 `doc` 原样（改完可喂回 validate/render）。
- 图片：`img` 存在渲染 `<img>`（相对路径，随目录整体搬移不断链）；不存在渲染虚线占位框"出图后放入 images/ 目录即可显示"。
- 视觉：宣纸底色 + 墨绿侧栏 + 朱砂强调的浅色国风主题；打印时隐藏侧栏（`@media print`）。

## Markdown 报告

`render --md` 输出同构内容的纯文本版：小节顺序与 HTML 一致，每条提示词以引用行
（`> 完整提示词：…`）给出拼装后的全文。给需要贴进文档/聊天的用户用。

## 维护纪律

- 报告只展示，不计算：改拼装规则去改 `assemblePrompt`，改展示去改页面脚本。
- 页面脚本不用模板字符串（外层已是 Node 模板字面量），统一字符串拼接。
- 改动后必须跑 `scripts/selftest.mjs`（渲染冒烟会检查九个面板、注入安全、图片逻辑、MD 结构）。
