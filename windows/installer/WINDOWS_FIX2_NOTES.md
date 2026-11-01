# 评估工具箱 v0.2.1 Windows 修复包

fix3补充：土地、拍卖、租赁、安居客的结果页与地图统一由扩展在当前浏览器窗口新标签页打开；Native只校验HTML并返回file URL，不通过系统默认浏览器打开。自动打开结果同规则。Excel与证据目录继续按文件/目录类型打开。

这是 Windows 修复候选包。解压后在普通 Windows 用户的命令提示符或 PowerShell 中运行 `install.cmd`。安装器会拒绝 AppContainer/MSIX 包身份及 LocalAppData 重定向上下文；不要在被虚拟化的宿主中运行。安装成功后按报告中的 extensionPath 在 Chrome/Edge 加载已解压扩展，预期 ID 为 `aamfmhcbjgofhmannejoiilkkpchfkgm`。

## 修复

- 土地入口在同目录导入前自举 sys.path；Native self-test 用同一便携 Python 独立导入四入口。
- 安装器独立子进程逐键核验 Chrome/Edge 注册表及 manifest/exe 存在、清单内容；失败非零退出并回滚，失败报告存于安装根旁。
- 四类 runner 失败响应保留脱敏、有界的 stderr 尾部20行和退出码；界面提供中文摘要及复制诊断。
- 折旧工作簿操作由 MV3 后台排队，跨进程工作簿锁及文件替换重试；文件占用有中文提示。
- 中文错误映射、健康标签换行/title、独立产品工作簿路径。
- Windows 隔离 Python 显式 UTF-8，折旧内层 engine 同样自举模块路径。

## 升级数据

旧安装目录完整保留在 installation-report.txt 的 previousInstallBackup 路径。请核对用户数据后再手动清理；不要自动删除。旧天源路径记录不会自动访问或迁移；需要时由用户选择副本导入到评估工具箱工作区。

## 验收边界

自动协议、组件与隔离安装回归有证据；真实 Chrome/Edge GUI、进入折旧页3秒内实际点击、页面 console、桌面打开产物、真实 MSIX 安装上下文与登录态业务仍需补验。杭州近3日抓取的匹配记录为0，只能证明流程与文件产出，不能据此证明所有业务字段抽取正确。不得将此包标为全面验收通过。

EXE 为 Node SEA 重建，未签名。完整报告、构建来源与 Mac 交接说明保存在本次交付目录。此轮没有向 GitHub 上传。
