# 所有地图拖动/位置关系/缩放修复（2026-10-12）

## 反馈与范围

用户补充：所有带地图模块均受影响，松开鼠标仍错位，定位显示不准，放大缩小按钮无效。提供的实机报告仍为安装前阶段，不将其中未覆盖改写成通过；此次地图故障依据用户新增实测反馈。

代码证据：原高德DOM固定在地图容器，Leaflet点位随mapPane移动，每次move/zoom单独更新SDK相机；SDK像素原点/分辨率未经校准。原脚本没有对SDK子元素输入及浮动面板覆盖作约束。具体哪项在用户浏览器触发需真实GUI复验，不能把合成回归当作该机根因完全证实。

## 修法（路径相对source）

| 文件:行 | 改动 |
|---|---|
| native-helper/map-assets/amap-only.js:55 | 高德背景放入同一个Leaflet mapPane，与点位/矢量共用拖动变换；拖动期间冻结SDK相机 |
| native-helper/map-assets/amap-only.js:107 | 用SDK的坐标↔像素API校准原点及X/Y缩放，避免默认两个引擎的同名zoom必然同分辨率；GCJ与内部坐标原有转换保留 |
| native-helper/map-assets/amap-only.js:169 | 隐藏替换帧准备好再切换，最多两个SDK实例；缓冲边界和窗口尺寸按实际投影调整；尺寸变化重建后台帧 |
| native-helper/map-assets/amap-only.js:242 | SDK背景子元素不抢输入，缩放控制高于浮动面板；默认控制移到右下 |
| native-helper/map-assets/amap-only.js:256 | 缩放按钮直接更新Leaflet唯一逻辑视图，阻止重复/被SDK接管；保留上下限、Shift步进 |
| skills/map-shared/update_map_page.py:27、windows/installer/修复已有地图.cmd:1 | 已有HTML先备份，只替换已知共享组件；坐标/配置/数据作为不解析不打印的原始字节保留，前后摘要校验 |
| version.json:8 | product仍0.2.1，buildNumber=2026101202，扩展名称与ID不变 |
| windows/build-windows-fix2.cjs:8 | Node构建入口加入mapsync、installerBuild自动从源读取，避免旧.5硬编码；PS包装入口旧默认仍待后续统一 |

本轮不调整原始经纬度或将点位统一加减某个偏移，不改Excel/history、不读取真实地图Key。对于实际地址匹配是否正确，仍需具体公开案例/地面参照，不能据投影修复保证每条地理编码准确。

## 产物与验证

完整包：appraisal-toolbox-v0.2.1-windows-x64-full-20261012-2.zip，ZIP SHA256：e4f220a11ae8e44431d59e0a8bd2c9aa4052a3f103b86f23a3c71e24177e5373。
Native EXE SHA256：2b31db5cca6e97a1aad8954e74bd68ded3718decb855b46e49edfc613cce8454，未重新编译：17个编译入口/依赖JS未改，bundle SHA与已验包匹配；map-assets是运行时读入的外部资源。
业务build windows-amap-shared-pane.12，map client amap-shared-pane-20261012.1，installer windows-context-attested.6，Node24.18.1/esbuild0.25.12/postject alpha.6，unsigned SEA。

- 通过（组件/合成）：共享pane；原点与1×/2×SDK像素比例；拖动/缩放/换帧后同一坐标的两引擎像素一致；缩放±按钮；缺配置/鉴权失败/超时；8内联脚本语法。evidence/map-client-delivery/client-summary.json。
- 通过（合成生成）：土地基础地图、安居客、拍卖和租赁页面生成；不读取真实配置。evidence/generators/。
- 通过（维护工具样例）：人工旧网页组件替换，前后数据字节不变、备份通过；实际用户旧网页修复未执行。
- 通过：构建4技能self-test，Native bundle/EXE复用校验；785ZIP条目/784文件清单及原ID、名称一致。evidence/package-delivery/、release-delivery/compiled-self-test.json。
- 未覆盖：真实高德联网拖动/滚轮/连续按钮/窗口调整与位置参照；真实客户地址地理编码准确性。本轮没有新浏览器GUI通过结论。既有Z2/新机/回滚等状态保留。

## 使用

安装新完整包，沿用原插件ID/加载目录并刷新原插件；无需切换到另一插件。
新生成地图使用新组件。旧地图HTML内嵌旧组件，单纯F5不会升级。可将真正地图文件（如latest_map.html或xxx_map.html，非外层结果页）拖到解压目录的“修复已有地图.cmd”，先备份再原位替换；然后在原浏览器刷新。工具不自动打开默认浏览器，不重新抓取，不解析/展示Key。也可正常重新生成地图，使用新的测试输出目录。

## GitHub

修复以独立分支/PR交Mac审核，不直接合并main或覆盖旧发布资产；新的Windows修复包可用于复测，正式发布标签不代表上述未覆盖项目通过。协调Issue #1、多人反馈Issue #3。
