# assets.json 数据结构（字段级规范）

`<剧名>-assets.json` 是本 skill 的唯一工作数据。所有字段的填写规则都写在这里；
质量门（`validate`）按这份规范逐条检查，写错就打回。

顶层结构：

```json
{
  "meta":     { "drama": "剧名", "source": "原著/章节范围", "created": "YYYY-MM-DD" },
  "project":  { "aspect_ratio": "16:9", "style_anchor": "…", "faithful": true,
                "quality_common": "…", "negative_common": "…" },
  "source_analysis": { "scope": "开篇若干章", "chapters_read": 12,
                        "total_chapters": 12, "statistics": { "势力": 4 }, "notes": "…" },
  "world":    { "background": "…", "power_system": "…", "social_structure": "…",
                "architecture": "…", "costume_rules": "…", "color_system": "…" },
  "races":      [ …种族… ],
  "factions":   [ …势力… ],
  "characters": [ …角色（含 periods）… ],
  "scenes":     [ …场景… ],
  "props":      [ …道具… ],
  "art_plans":  [ …美工设计及审核… ],
  "image_reviews": [ …资产图审核… ],
  "audio_assets": [ …音频… ],
  "production": { "scripts": [ …剧本… ], "shots": [ …分镜与镜头图… ] },
  "prompt_library": { "note": "由 render 自动拼装，此字段仅供人读备注" },
  "pipeline": { "steps": [ …按固定顺序的 12 个阶段… ] }
}
```

Agent 为当前作品新增的转换、批处理或校验等工具脚本，统一放在作品目录 `./script/`，不得散落在其他位置。本 skill 自带的 CLI 则仍位于 `{baseDir}/scripts/`。

**职责划分**：风格锚点、质量词、负面词、图生图前缀由脚本在 render 时注入每条提示词；
你（模型）只写各资产的 `prompt_body` 五段。往 `prompt_body` 里写风格词/质量词/负面词会被 E3 门打回。

---

## project — 项目配置

| 字段 | 规则 | 质量门 |
| --- | --- | --- |
| `aspect_ratio` | 画幅，默认 `"16:9"`，格式 `数字:数字` | P2 |
| `style_anchor` | 全局风格锚点，≥16 字，与用户确认后锁死 | P1 |
| `faithful` | 必须为 `true`。`false` 说明是改编需求，本 skill 拒绝继续（改用 shuohao novel-outline） | P4 |
| `quality_common` | 统一质量词，默认 `"8K 超清，超高细节，稳定构图，无畸形肢体"` | P3 |
| `negative_common` | 统一负面词，默认 `"畸形、多指、模糊、水印、画风突变、比例失调、Q 版、卡通渲染、过度美颜"` | P3 |

风格锚点写法（默认方向，用户换风格时按同结构重组）：

```
3D 写实国风仙侠，UE5 引擎质感，PBR 材质，电影级光影，低饱和厚重色调，
人物比例写实，服饰符合门派阶级设定，画面稳定统一，禁止 Q 版、卡通渲染、过度美颜
```

结构 = 画风 + 引擎/渲染 + 色调 + 人物比例 + 稳定性声明 + 负面风格。
锚点一旦确认就不再改动——它会被注入每一条提示词，中途改锚点等于全部资产重做。

## source_analysis — 原著阅读记录

`scope` 写明实际阅读范围，`chapters_read` 是已完整阅读的章节数，`total_chapters` 可为 `null`（原文没有明确总章数），`statistics` 保存可核对的资产/势力/体系等统计，`notes` 记录来源缺漏或待确认项。只有真实完整阅读后才将 `fulltext` 标为 `done`；该状态要求 scope、正数章节数和非空统计。

## races — 种族

每项使用 `id`、`name`、`description`、`prompt_body` 与 `image`；外观特征必须与世界观和原著一致。种族设定图可归档到 `images/美工设计/`，并列入美工规划与审核记录。

## world — 世界观（六项全必填，W1）

| 字段 | 内容 | 来源 |
| --- | --- | --- |
| `background` | 世界背景：时代、地理格局、仙凡关系 | 原文归纳 |
| `power_system` | 修炼/武功/社会等级体系，境界与代价 | 原文归纳 |
| `social_structure` | 社会结构：王朝、门派、宗门、散修的层级 | 原文归纳 |
| `architecture` | 建筑风格：材质、形制、装饰母题 | 原文归纳 |
| `costume_rules` | 服饰规则总纲：阶级如何体现在衣料/颜色/配饰上 | 原文归纳 |
| `color_system` | 色彩体系：整体色偏、主色、点缀色 | 原文归纳 |

只整理原文给出的设定；原文没写的，写"原文未明示，按同类设定暂定"并在 `pipeline` 对应步骤的 `note` 里标出来，等用户确认。

## factions — 势力

| 字段 | 规则 | 质量门 |
| --- | --- | --- |
| `id` | 全局唯一，建议 `faction_<拼音或英文>` | G1 |
| `name` | 势力名 | — |
| `positioning` | 定位：江湖门派/修仙宗门/王朝/魔道…，与谁对立 | F1 |
| `class_system` | 阶级体系数组，从低到高，如 `["杂役","记名弟子","外门弟子","内门弟子","堂主","门主"]` | F1 |
| `costume_rule` | 服饰规则：**每个阶级**穿什么——颜色、材质、纹样、配饰 | F1 |
| `main_color` | 主色（用于报告色块与服饰区分） | F1 |
| `pattern` | 标志纹样 | F1 |
| `prompt_body` | 五段提示词，主体写该势力的代表性空间/人群形象 | F1 + E1–E3 |

**F2 门**：两个势力的 `main_color` 与 `pattern` 不得完全相同——跨势力同框时观众要一眼分清。

## characters — 角色（核心）

```json
{
  "id": "char_hanli",
  "name": "韩立",
  "gender": "男", "age": "16 岁入七玄门",
  "identity": "贫家少年，七玄门杂役弟子",
  "class": "记名弟子",
  "faction_id": "faction_qixuanmen",
  "personality": "谨慎坚韧，藏拙内敛",
  "identity_anchor": "相貌普通，肤色微黑，鼻梁挺直，中等身形偏瘦",
  "fixed_features": "左脸刀疤，右臂齐肩而断",
  "periods": [ …一个或多个时期，见下… ]
}
```

| 字段 | 规则 | 质量门 |
| --- | --- | --- |
| `identity_anchor` | **固定主体描述**：客观、可画的面部+体型特征短语。全角色、全时期、全镜头复用这一段，≥8 字 | C2 |
| `fixed_features` | 原著硬特征（断臂/刀疤/跛足/独眼…），逗号分隔短语。**每个时期的 prompt_body 都必须原样带进主体段**；原著剧情真的消除了该特征（幻化/断肢重生），也要在新时期 `variation_reason` 里写明 | C6 |
| `personality` | 从原文行为归纳，不脑补 | C1 |

### periods — 时期（一致性核心）

```json
{
  "period_name": "黄枫谷弟子期",
  "is_base": false,
  "generation_mode": "reference_img2img",
  "reference_image": "han_li/period-01.png",
  "variation_reason": "加入黄枫谷：服饰换米黄道袍，年龄由少年长为青年；脸型五官以基准期参考图为准只做微调",
  "source_described": null,
  "appearance": "青年，相貌不变，肤色仍微黑",
  "costume": "米黄色道袍，同色腰带，腰系玉牌",
  "image": "han_li/period-02.png",
  "prompt_body": "中景平视；…；…；…；…；"
}
```

规则（对应质量门 C3–C6）：

1. **每个角色恰好一个基准期**（`is_base: true`，`generation_mode: "fresh_generation"`）。基准期是全角色参考图的源头，其余一切时期都从它派生。
2. **衍生时期默认 `reference_img2img`**，必须给 `reference_image`（指向基准期或任一已生成时期的图，路径相对 `images/` 目录）和 `variation_reason`。生图方式：拿参考图生图，**脸型与五官只能微调，禁止重新生成一张新脸**。
3. **只有原著明确描写的变化**才允许 `generation_mode: "fresh_generation"`，且必须置 `source_described: true`（幻化、易容、夺舍、变形等情节），`variation_reason` 写清原著依据。Agent 不得自行判断"变化太大所以重开"。
4. 即使重开新图，`identity_anchor` 与 `fixed_features` 中未被剧情消除的特征仍须保留并写进 prompt_body。
5. 换时期 = 新建时期条目，**禁止改动旧时期的 `prompt_body`**（旧图可能已经生成，改文本等于让已出图的资产作废）。
6. `image` 字段是该时期自己的成图路径（下游出完图后填），render 会嵌进报告。

## scenes — 场景

| 字段 | 规则 |
| --- | --- |
| `id` / `name` | 全局唯一 / 场景名 |
| `era` | 时代/时期（同一地点不同时期可建多条） |
| `location` | 具体地点 |
| `atmosphere` | 氛围（可画可核对："肃穆清冷"可以，"很有氛围感"不行） |
| `lighting` | 光照方案（时段+方向+色温） |
| `key_elements` | 关键元素数组 ≥2，观众靠这些认出场景 |
| `image` | 成图路径（可选，下游填） |
| `prompt_body` | 五段，主体写空间本身，**不含人物** |

## props — 道具

| 字段 | 规则 |
| --- | --- |
| `id` / `name` | 全局唯一 / 道具名 |
| `owner` | 归属（哪个势力/阶级/角色） |
| `material` | 材质与做工 |
| `usage` | 用途/戏剧功能 |
| `source_ref` | `{ "chapter": 3, "quote": "原文短引" }`，可空 |
| `image` | 成图路径（可选） |
| `prompt_body` | 五段，特写视角，主体写道具本身，**不含手、不含人** |

道具只收叙事道具：有特写、跨章节出现、承载剧情的（信物、法器、身份凭证），一般 3–10 件。

## 美工规划与审核

`art_plans` 每项描述类别、目标对象、阶级/时期、设计说明、`prompt_body`、`image` 与 `review`。设计覆盖势力的阶级服饰差异、种族视觉特征以及主要角色/场景规范。

进入 `art_review: done` 前，每份方案的 `review` 必须有 `status: "approved"`，并将 `worldview`、`anachronism`、`language` 设为 `true`。重点排除与世界观冲突的现代物件/标识/英文字符；除非原著明确允许。审核说明记入 `notes`。

`image_reviews` 按资产图记录 `asset_id`、`image`、`status` 与 `notes`。进入 `asset_review: done` 前，所有已生成资产图都必须有 `status: "approved"` 的记录。

## audio_assets — 音频

每项记录 `id`、`title`、`type`、`description` 和相对项目根目录的 `file`，文件保存在 `audio/`。只有每项均有实际文件路径才可将音频阶段标为完成。

## production — 剧本、分镜与镜头

`scripts` 记录 `id`、`episode`/`title`、`summary`、`file`；`shots` 记录 `id`、`episode`、`scene`、镜头描述、`asset_refs`、`reuse_note`、`prompt_body` 与 `image`。镜头图放在 `images/镜头/<剧集>/`；批量生成需尽量复用资产参考图并记录复用方式，便于控制重复出图成本。

## pipeline — 进度

`steps` 必须完整且按顺序：`config / fulltext / inventory / art_plan / art_review / asset_images / asset_review / audio / script_storyboard / shot_images / validate / report`。每步 `status ∈ pending | in_progress | done`；只能有一个 `in_progress`，且不得将尚未轮到的后续步骤标记为完成。

`done` 必须有对应交付物：全文统计、设计方案与审核、资产图与逐图审核、音频文件、剧本和分镜、镜头图；最终 HTML 路径记在 `report.note`。每步状态变化后立即重渲染 HTML。`render` 可输出未完成草稿并列出质量门警示。

## images — 图片目录约定

```text
<工作目录>/
├── <剧名>-assets.json
├── <剧名>-assets-report.html
├── script/                   ← 本作品新增的全部辅助/转换/批处理/校验脚本
├── images/
│   ├── 角色/han_li/
│   │   ├── period-01.png     ← 基准期锚点图
│   │   └── period-02.png     ← 衍生期（以 period-01 为参考图生图）
│   ├── 场景/
│   ├── 美工设计/
│   ├── 道具/
│   └── 镜头/
└── audio/
```

- 图片使用相对 `images/` 的路径，如 `角色/han_li/period-01.png`；也兼容带 `images/` 前缀的项目内相对路径。
- Agent 为当前作品新增的任何工具脚本必须放在项目 `script/`，不得散落于项目根目录或素材目录；skill 自带 CLI 位于 `{baseDir}/scripts/`。
- `image` 字段指向的文件放好后，重跑 `render` 即嵌进报告。
- 文件不存在时报告渲染占位框，并在时期变化表里显示 `reference_image` 路径。
- `reference_image` 与 `image` 都相对 `images/` 目录。
