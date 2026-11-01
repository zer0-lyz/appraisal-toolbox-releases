# 评估工具箱 v0.2.1 — macOS Apple Silicon 完整安装包

本安装包是独立产品，不需要安装天源浏览器工作台、Connector、MCP 或天源 CLI。

系统要求：Apple Silicon（M1 或更新）且 macOS 13.5 或更新版本。

## 安装

1. 解压 ZIP，不要直接在压缩包预览中运行。
2. 双击 `安装.command`。
3. 如本机缺少 Python 3.14，安装器会请求 macOS 用户密码，安装 python.org 官方 Python。
4. 等待七步检查全部完成。
5. Chrome 打开 `chrome://extensions`，开启开发者模式，加载安装器显示的目录：
   `~/.appraisal-toolbox/extension`
6. 确认扩展名称“评估工具箱”、版本 `0.2.1`、ID `aamfmhcbjgofhmannejoiilkkpchfkgm`。
7. 首次使用需要登录的网站模块时，请由使用者本人在浏览器完成登录或验证码；安装包不包含账号状态。

Chrome 出于安全限制，不允许普通 ZIP 静默安装未上架扩展，因此第 5 步必须由用户或受控 Agent 完成。
除这一步外，Native Helper、Python、Node.js、离线依赖和浏览器 Native Messaging 注册均由安装器完成。

## 包含内容

- 评估工具箱扩展；
- 独立 Native Host `com.appraisal.toolbox.helper`；
- Node.js 24.14.0 Apple Silicon 运行时；
- Python 3.14.6 官方安装包和独立虚拟环境；
- openpyxl、python-docx、lxml、requests 等离线依赖；
- 土地、表格设置、安居客及折旧摊销运行脚本。

安装器不会写入或读取 Cookie、Authorization、密码、验证码、地图 Key 或其他账号凭据。
