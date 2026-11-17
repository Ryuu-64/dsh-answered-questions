# 开发与验证

在仓库根目录运行 `npm run build` 和 `npm run check`。构建产物 `lib/client.js` 是插件发布所需的文件，必须与源码一起提交。

## 浏览器回归

准备已安装的官方 DSH 运行目录、Playwright、Chrome 和 `dsh-choice`，然后运行：

```text
node scripts/e2e.mjs --runtime <包含node_modules的DSH目录> --playwright <playwright/index.mjs> --choice <dsh-choice目录> --chrome <Chrome可执行文件>
```

测试使用空配置档和本地确定性模型。日志、配置档、截图与报告保存在系统临时目录下的 `dsh-answered-questions-qa`，命令结束时输出实际路径，不写入仓库。

- `--mode parity` 检查原生字段转换、文本显示、长答案、长题目和翻页行为。
- `--restart true` 检查隔离宿主重启后的选择卡恢复。
- `--base-port <端口>` 指定连续三个环回端口，便于分别运行不同版本。
- 单元测试可通过 `DSH_NATIVE_CONTRACT_RUNTIMES` 接收现有 DSH 安装根目录的 JSON 数组，额外执行官方工具合同检查。

这些检查不等同于完整桌面外壳或无障碍审计。兼容范围与边界见[兼容说明](compatibility.md)。

## 打包

先创建仓库外的输出目录，再运行 `npm pack --pack-destination <外部目录>`。过程报告与诊断文件不随 npm 包发布；正式功能截图位于 `docs/screenshots/`。
