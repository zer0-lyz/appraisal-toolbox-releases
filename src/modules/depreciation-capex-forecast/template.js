export const STOCK_HEADERS = [
  "序号",
  "情形描述",
  "公司主体",
  "资产科目",
  "名称",
  "账面原值",
  "账面净值",
  "评估原值",
  "启用时间",
  "折旧年限",
  "经济耐用年限",
  "预计尚可使用年限",
  "更新后折旧年限",
  "更新后经济耐用年限",
  "残值率",
  "费用科目",
  "折旧摊销",
  "进项税率",
  "是否需要更新",
];

export const ADDED_HEADERS = [
  "序号",
  "情形描述",
  "公司主体",
  "资产科目",
  "名称",
  "在建工程账面价值",
  "总投资额（不含税）",
  "预计投入使用时间",
  "更新后折旧年限",
  "更新后经济耐用年限",
  "残值率",
  "费用科目",
  "折旧摊销",
  "进项税率",
  "是否需要更新",
];

export const PARAM_FIELDS = [
  { key: "valuationDate", label: "评估基准日", cell: "B4", inputType: "date" },
  { key: "endDate", label: "结束日期", cell: "B5", inputType: "date" },
  { key: "discountRate", label: "折现率", cell: "B6", inputType: "number" },
  { key: "minimumRemainingYears", label: "最低尚可使用年限", cell: "B7", inputType: "number" },
];

export const depreciationCapexTemplate = `
  <div class="page-heading depreciation-heading">
    <div>
      <h2>折旧摊销与资本性支出预测</h2>
      <p>参数严格对应模板“参数设定”B4:B7；资产输入、结果和长周期明细在独立页面打开。</p>
    </div>
    <button id="backFromDepreciation" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section depreciation-status-panel">
    <div class="section-title-row">
      <div>
        <h2>当前工作簿</h2>
        <p class="section-description">工作簿是唯一事实源。导入文件会先复制为本机安全工作副本，不覆盖用户源文件。</p>
      </div>
      <span id="depreciationRunBadge" class="badge">尚未运行</span>
    </div>
    <dl class="kv compact-kv depreciation-status-grid">
      <div><dt>文件</dt><dd id="depreciationWorkbookPath">正在准备...</dd></div>
      <div><dt>存量资产</dt><dd id="depreciationStockCount">-</dd></div>
      <div><dt>新增资产</dt><dd id="depreciationAddedCount">-</dd></div>
      <div><dt>最近运行</dt><dd id="depreciationLastRun">-</dd></div>
    </dl>
    <div id="depreciationStatusMessage" class="inline-feedback">正在读取工作簿状态...</div>
    <div class="button-row">
      <button id="importDepreciationWorkbook" type="button" class="secondary">导入 .xlsx 工作簿</button>
      <button id="refreshDepreciationStatus" type="button" class="secondary">刷新状态</button>
      <a id="downloadDepreciationTemplate" class="button-link secondary" download>下载 canonical 模板</a>
    </div>
  </section>

  <section class="section depreciation-parameters-panel">
    <div class="section-title-row">
      <div>
        <h2>参数设定</h2>
        <p class="section-description">保存时写入当前工作簿【参数设定】B4:B7；运行前仍会再次预检。</p>
      </div>
      <span class="badge">B4:B7</span>
    </div>
    <div class="form-grid depreciation-parameter-grid">
      <label><span>评估基准日（B4）</span><input id="depreciationValuationDate" type="date"></label>
      <label><span>结束日期（B5）</span><input id="depreciationEndDate" type="date"></label>
      <label><span>折现率（B6）</span><input id="depreciationDiscountRate" type="number" min="0" step="0.0001" placeholder="0.10"></label>
      <label><span>最低尚可使用年限（B7）</span><input id="depreciationMinimumYears" type="number" min="0" step="0.01" placeholder="1"></label>
    </div>
    <div id="depreciationParameterMessage" class="inline-feedback">等待读取参数</div>
    <div class="button-row">
      <button id="saveDepreciationParameters" type="button">保存参数</button>
      <button id="preflightDepreciation" type="button" class="secondary">预检输入</button>
    </div>
  </section>

  <section class="section depreciation-input-panel">
    <div class="section-title-row">
      <div>
        <h2>资产输入</h2>
        <p class="section-description">按钮会打开独立 Chrome 扩展大页面；支持直接粘贴 Excel/TSV，也支持下载模板后导入。</p>
      </div>
    </div>
    <div class="depreciation-input-cards">
      <button id="openDepreciationStock" type="button" class="depreciation-input-card">
        <strong>存量资产</strong>
        <span>固定 19 列必填表头；粘贴、导入、校验并保存到【存量资产输入】。</span>
      </button>
      <button id="openDepreciationAdded" type="button" class="depreciation-input-card">
        <strong>新增资产</strong>
        <span>固定 15 列必填表头；粘贴、导入、校验并保存到【新增资产输入】。</span>
      </button>
    </div>
  </section>

  <section class="section depreciation-run-panel">
    <div class="section-title-row">
      <div>
        <h2>预检、运行与结果</h2>
        <p class="section-description">先预检并展示问题；确认后调用 bundled Python skill。默认只写预测汇总和检查结果。</p>
      </div>
    </div>
    <label class="check-row">
      <input id="depreciationWithDetails" type="checkbox">
      <span>同时生成年度/月度详细数据（200 年月度时间轴，运行时间和文件体积会增加）</span>
    </label>
    <div id="depreciationPreflightMessage" class="inline-feedback">尚未预检</div>
    <div class="button-row">
      <button id="runDepreciation" type="button">运行预测</button>
      <button id="openDepreciationResults" type="button" class="secondary">查看结果</button>
      <button id="openDepreciationDetails" type="button" class="secondary">详细数据</button>
    </div>
  </section>
`;
