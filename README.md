# original-manhua-production

**原著忠实型 AI 漫剧制作总监**是一份跨 Agent、可续作的制作 Skill。它把原著转成可追溯的结构化制作数据，并以用户确认控制八阶段流程。

## 原则

- 原著事实不擅自增删、重排或改写。
- 先定美术体系，再生成/审核主资产，再生成衍生资产。
- 剧本事件逐条对账，分镜先行，视频和音频分离管理。
- 阶段确认必须来自用户；Agent 和脚本不能替用户批准。
- JSON、版本、真实文件和审批快照作为项目状态来源；聊天丢失后可从项目文件续作。
- 图片/视频/音频由 Agent 当前可用工具生成。本 Skill 不调用生成 API，也不伪造媒体。

## 安装与使用

将仓库作为 Agent Skill 安装，或让兼容 Agent 读取根目录 `SKILL.md`。需要 Node.js 18+，无 npm 运行依赖。

```bash
node scripts/manhua.mjs init "示例作品" /path/to/AI-Manhua
node scripts/manhua.mjs validate /path/to/AI-Manhua
node scripts/manhua.mjs report /path/to/AI-Manhua
node scripts/selftest.mjs
```

制作目录与本 Skill 仓库分开。虚构样例位于 [`examples/demo-project`](examples/demo-project/)，配套静态审核页为 [`review.html`](examples/demo-project/reports/review.html)；详细运行说明见 [`docs/usage.md`](docs/usage.md)，阶段流程见 [`references/workflow.md`](references/workflow.md)。

## 结构

```text
SKILL.md
scripts/manhua.mjs             # 初始化、质量门、阶段状态机、静态审核报告
scripts/selftest.mjs           # 无模型、无媒体生成的确定性自测
references/                    # 按需读取的阶段方法与数据约定
schemas/                       # JSON Schema
templates/                     # 空项目数据模板
examples/demo-project/         # 虚构原著的端到端结构样例
docs/                          # 安装、使用、兼容性与来源说明
```

## 参考方法与许可证

方法研究参考 [Toonflow v118workflow](https://github.com/HBAI-Ltd/Toonflow-app/tree/master/packages/skills/v118workflow) 的阶段化知识组织与确认续作思想，以及 [shuohao-skills](https://github.com/eternityspring/shuohao-skills) 的结构化数据、脚本质量门、报告和自测实践。只吸收通用工作方法，不复制应用、代码或大段文档；不采用与本 Skill 冲突的商业短剧改编约定。更多说明见 [`docs/research-notes.md`](docs/research-notes.md)。

本仓库使用 Apache-2.0 许可证。参考项目的许可证和著作权归其各自权利人；本项目不包含它们的运行时代码依赖。
