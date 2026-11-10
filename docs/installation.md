# 安装

Skill 可通过 Agent 的 Skill 机制加载，也可直接要求 Agent 阅读仓库根目录 `SKILL.md`。兼容性取决于 Agent 能否读取 Markdown、运行 Node.js 脚本并调用所需图片/视频/音频工具。

要求 Node.js 18 或更高版本及 npm。首次安装在 Skill 仓库执行：

```bash
npm ci
npm test
```

运行时使用 AJV 8 和 `ajv-formats`，统一验证 Draft 2020-12 JSON Schema；媒体检查优先调用系统 `ffprobe`，未安装时降级为明确标记的基础格式检查。媒体生成仍由 Agent 外部实际可用工具负责。

项目数据应放在用户明确指定的制作目录，不应在 Skill 仓库内制作。制作目录与 Skill 仓库分离，更新 Skill 代码或依赖不会覆盖项目数据。
