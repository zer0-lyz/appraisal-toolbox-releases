# 下次 Windows 安装包防回归关卡

范围：本轮吸收自 build 16 的共享修复和 Windows 专属修复。目标是让下一包从已审查源码、锁定运行时和可追踪证据构建，并阻止已知同类错误再次静默进入包；最终 GUI 仍需 Windows 实机验证。

| 问题类别 | 本轮已设关卡 | 下次 Windows 包必须补做 |
|---|---|---|
| 高德相机/缩放 | 唯一SDK相机、光标投影锚点、wheel归一化/合并、有限值保护、同引用解绑、Shift/UI/Ctrl过滤纳入组件回归 | 在包内使用真实高德Key由验收人执行拖拽、滚轮、触控板、marker/cluster定位；提供录屏或逐项结果。当前模拟SDK不代替实机。 |
| 更新UI与状态机 | 能力协商、phase/progress/terminal、忙态、中文诊断、无phase收尾、同版本防降级纳入source-checks | Windows x64包验证平台能力为true；真实下载/安装/失败/重试/取消链与GUI日志；确认版本不降级。Mac保持手动下载。 |
| Python runtime/import | Mac打包Host以锁定runtime验证7个入口，无PATH覆盖；源检查阻断遗漏 | 用Windows包内锁定Python独立运行7个入口和依赖诊断；不得以系统PATH偶然导入成功。 |
| workbook队列/锁与报告 | 共享协议保留队列/锁；三个工具注册allowlist；新报告名不覆盖已有报告；三种表格动作有组件回归 | Windows包内Excel文件复制/覆盖/新目录三模式读回；同时运行验证busy/锁；真实Office GUI单独验收。 |
| Windows专属安装 | 保留Windows `.7` installer、注册表/extension deployment；文件选择exit 1失败、exit 2取消 | 普通桌面首装、覆盖安装、数据保留升级、注册失败回滚及Chrome/Edge真实注册路径全部对实际ZIP/EXE SHA核验。 |
| 土地/拍卖/租赁业务 | 固定日期边界、成交判据、坐标来源与人工验证；不绕验证码；修复只增严格HTTP夹具，不放宽生产判据 | 仅用脱敏fixture/API合同回归；真实站点验证码与人工环节照常；记录输入样例、结果和错误，不以模拟成功冒充网络验收。 |
| 源码/依赖/产物 | 统一入口和旧Windows builder都强制source-checks；clean tree、输入锁、source inventory、产物摘要 | 同一冻结commit分别Mac/Windows构建；记录source SHA、Node/Python/SEA工具版本、ZIP/EXE SHA及签名；ZIP与EXE必须来自此次记录。 |

发布检查必须分开标注：自动静态/组件、包内隔离测试、普通桌面安装、真实浏览器/地图、真实业务网络。缺证据一律“未覆盖”；`.16`的`fullAcceptancePassed=false`及旧包报告不混用。
