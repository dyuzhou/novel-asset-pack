# 安装

Skill 可通过 Agent 的 Skill 机制加载，也可直接要求 Agent 阅读仓库根目录 `SKILL.md`。兼容性取决于 Agent 能否读取 Markdown、运行 Node.js 脚本并调用所需图片/视频/音频工具。

要求 Node.js 18 或更高版本。脚本仅用 Node.js 标准库，没有 npm 运行依赖。项目数据应放在用户明确指定的制作目录，不应在 Skill 仓库内制作。
