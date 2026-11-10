# 兼容性与限制

- 使用跨平台 Node.js ESM，目标 Node.js 18+；通过 `npm ci` 安装 AJV 和 `ajv-formats`。
- Skill 不依赖 Toonflow、shuohao-skills、浏览器服务端、MCP 或特定模型。
- 媒体生成由调用方 Agent 当前实际可用工具负责；Skill 只保存可追溯任务与文件状态。
- HTML 是只读项目数据的静态审核辅助。审核按钮本地导出决定，不直接修改项目 JSON。
- 项目内相对路径统一为 POSIX 风格；报告 URL 使用 `/` 并逐段编码 UTF-8 文件名。自测在 Linux 上覆盖 Windows 反斜线、macOS POSIX 路径和中文/空格/特殊字符；这不等同于原生 Windows/macOS 系统验收。
- 图片检查验证 PNG 块/CRC/像素数据，并识别 JPEG/WebP；安装 FFprobe 时验证视频/音频流、分辨率及时长，未安装时仅进行基础签名检查并记录 `BASIC`，不宣称已验证媒体流。
- 文件系统校验可确认路径存在、媒体格式和引用关系，不能判定人物长相一致、画面美观、剧情语义正确或音频主观品质。
- 阶段批准命令由 Agent 在用户明确表达批准之后调用；脚本不会判断自然语言对话中是否真的授权。
- 原有 `scripts/asset-pack.mjs`、旧版 references 和既有示例均保留，不属于新八阶段流程的数据契约；新流程使用 `scripts/manhua.mjs` 和新项目目录。旧资产包脚本的工作区修改未纳入本次重构。
