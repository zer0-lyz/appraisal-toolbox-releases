export const equipmentPpiTemplate = `
  <div class="page-heading equipment-skill-heading">
    <div>
      <h2>设备价格指数更新（PPI）</h2>
      <p>按“抓取—基线—核对—预览—回填”处理国家统计局月度数据。</p>
    </div>
    <button id="backFromEquipmentPpi" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section equipment-skill-notice" role="note">
    <strong>数据口径与保护说明</strong>
    <p>来源为国家统计局工业生产者出厂价格指数（上年同月=100），覆盖技能内的 10 个指标。默认只抓最近月份，历史数据由本地基线补齐；预览只生成副本，回填原底稿会先创建备份并再次确认。</p>
  </section>

  <section class="section equipment-skill-config">
    <h3>工作文件</h3>
    <label class="equipment-skill-path-row"><span>PPI 工作簿</span><div><input id="equipmentPpiWorkbook" type="text" readonly placeholder="选择含“全年(更新此表数据）”工作表的 .xlsx 或 .xlsm 底稿"><button id="chooseEquipmentPpiWorkbook" type="button" class="secondary">选择工作簿</button></div></label>
    <label class="equipment-skill-path-row"><span>独立工作目录</span><div><input id="equipmentPpiWorkspace" type="text" readonly placeholder="用于保存基线、抓取缓存和预览副本"><button id="chooseEquipmentPpiWorkspace" type="button" class="secondary">选择目录</button></div></label>
    <p id="equipmentPpiPathFeedback" class="inline-feedback" role="status">基线和抓取结果只写入所选工作目录；不会自动更改原始工作簿。</p>
  </section>

  <section class="section equipment-skill-workflow">
    <div class="section-title-row"><div><h3>运行步骤</h3><p class="section-description">先查看或初始化基线；增量抓取后再合并、核对和预览。</p></div><span id="equipmentPpiBusyBadge" class="badge">待运行</span></div>
    <div class="equipment-ppi-run-options">
      <label for="equipmentPpiRecentMonths">最近月份</label><input id="equipmentPpiRecentMonths" type="number" min="1" max="24" value="6">
      <span>包含当前月份，默认 6 期</span>
    </div>
    <div class="button-row equipment-skill-actions">
      <button id="equipmentPpiStatus" type="button" class="secondary">查看基线</button>
      <button id="equipmentPpiInitialize" type="button" class="secondary">初始化基线</button>
      <button id="equipmentPpiFetch" type="button">抓取最近月份</button>
      <button id="equipmentPpiMerge" type="button" class="secondary">合并增量</button>
      <button id="equipmentPpiVerify" type="button" class="secondary">核对底稿</button>
      <button id="equipmentPpiPreview" type="button" class="secondary">生成预览副本</button>
      <button id="equipmentPpiDryRun" type="button" class="secondary">预览回填计划</button>
      <button id="equipmentPpiApply" type="button" class="danger-button">回填原底稿</button>
    </div>
    <p id="equipmentPpiGate" class="gate-reason" role="status"></p>
    <div class="equipment-skill-progress" aria-live="polite"><span id="equipmentPpiProgress">等待操作</span><div class="equipment-skill-progress-track"><div id="equipmentPpiProgressBar"></div></div></div>
    <pre id="equipmentPpiOutput" class="equipment-skill-output" aria-live="polite">选择工作目录后，可以查看基线状态或开始增量抓取。</pre>
  </section>
`;
