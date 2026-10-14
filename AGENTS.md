# Agent 操作说明

这是「没走的路 / Road Not Taken」项目仓库。后续 Agent 在本目录完成代码、文档或素材修改后，按本文件把改动上传到 GitHub。

## 仓库信息

- GitHub 仓库：`https://github.com/hahaha-hubhubhub/road-not-taken`
- Git SSH 远程：`git@github.com:hahaha-hubhubhub/road-not-taken.git`
- 默认分支：`main`
- 本地项目目录：以当前 Git checkout 的仓库根目录为准（`git rev-parse --show-toplevel`）。不要依赖其他协作者的电脑路径。

## 上传流程

在仓库根目录执行：

```bash
git status
git diff
git add <本次修改的文件>
git commit -m "<简短说明本次修改>"
git push origin main
```

如果本次任务已经明确要求“完成后上传”，Agent 应在验证修改后直接执行上述流程，不要只停留在本地文件修改。

## 提交前检查

- 不要提交 `.env`、API Key、Token、个人隐私或本地缓存。
- 先阅读并保留其他协作者已有的修改，不要使用 `git reset --hard` 或覆盖式 checkout。
- 提交前确认 `git diff` 只包含本次任务相关内容。
- 文档、代码或硬件协议有变化时，同时更新相关 README 或 `docs/` 文档。
- 能运行的测试、构建或演示命令应在提交前运行；无法运行时在最终说明中写明原因。

## 推送失败时

先同步远程分支并重新检查冲突：

```bash
git fetch origin
git rebase origin/main
git push origin main
```

不要使用 `git push --force`。如果遇到权限或认证问题，保留本地提交，并在最终说明中报告失败原因和待执行命令。

## 当前项目文档

- 产品说明：[README.md](README.md)
- 产品需求：[docs/PRD.md](docs/PRD.md)


## 后悔药网页原型

- 源码位于 `web/regret-remedy/`，唯一主入口为 `/`，旧地址 `/regret-remedy/` 跳转至主入口。
- 药丸页使用 `/api/sessions`，统一文字、生图、翻转、打印、封装和分享；`/api/stories/preview` 仅保留为兼容 API。区分模型生成、关怀回应和预写演示；降级不能冒充个性化结果。
- 生成逻辑修改后运行 `cd server && npm run test:story-quality`；测试替身通过不代表真实模型文案质量已验证。
- 页面修改后执行 `node --check web/regret-remedy/app.js`，并验证取药、输入、三幕、拆信和重新开始。
- ZIP 解压目录没有 Git 历史，不能直接上传。先将本次变更应用到已认证的 Git clone；不要创建无关历史覆盖远程。
- 上传认证只在本机 Git 凭据管理工具中设置，不要将凭据写入项目或聊天。
