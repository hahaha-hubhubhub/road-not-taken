# Agent 操作说明

这是「没走的路 / Road Not Taken」项目仓库。后续 Agent 在本目录完成代码、文档或素材修改后，按本文件把改动上传到 GitHub。

## 仓库信息

- GitHub 仓库：`https://github.com/hahaha-hubhubhub/road-not-taken`
- Git SSH 远程：`git@github.com:hahaha-hubhubhub/road-not-taken.git`
- 默认分支：`main`
- 本地项目目录：`/Users/jyxc-dz-0100172/Documents/road-not-taken`

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

