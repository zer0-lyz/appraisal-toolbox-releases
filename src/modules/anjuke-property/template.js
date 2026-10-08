export const anjukePropertyTemplate = `
  <div class="page-heading anjuke-property-heading">
    <div>
      <h2>安居客数据</h2>
      <p>在当前浏览器标签页选好安居客范围并应用参数后，由插件逐条读取详情并归档证据。</p>
    </div>
    <button id="backFromAnjukeProperty" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section anjuke-property-params">
    <div class="section-title-row">
      <div>
        <h2>检索参数</h2>
        <p class="section-description">先在安居客网页中选好区域和筛选条件；参数修改后必须重新应用才能开始抓取。</p>
      </div>
      <span id="anjukePropertyParameterState" class="badge" data-kind="pending">未导入网址</span>
    </div>
    <label class="anjuke-property-current-url-row"><span>当前检索网址</span><input id="anjukePropertyCurrentUrl" type="url" readonly placeholder="请先在下方点击“导入当前网址”"></label>
    <div class="form-grid anjuke-property-parameter-grid">
      <label><span>案例类型</span><select id="anjukePropertyCaseType"><option value="auto">自动识别</option><option value="sale">出售</option><option value="rent">租赁</option></select></label>
      <label><span>最多案例数</span><input id="anjukePropertyMaxCases" type="number" min="1" max="100" value="10"></label>
      <label class="anjuke-property-keyword-field"><span>关键词（可选）</span><input id="anjukePropertyKeyword" type="text" maxlength="80" placeholder="按楼宇或小区名过滤候选案例"></label>
    </div>
    <div class="anjuke-property-options">
      <label><input id="anjukePropertyWaitVerification" type="checkbox" checked> 遇验证时等待人工完成</label>
      <label><input id="anjukePropertyScreenshot" type="checkbox" disabled> 保存全页截图（当前标签页模式暂不支持）</label>
    </div>
    <div class="button-row anjuke-property-parameter-actions">
      <button id="applyAnjukePropertyParams" type="button">确认并应用参数</button>
      <button id="resetAnjukePropertyParams" type="button" class="secondary">恢复默认</button>
    </div>
    <div id="anjukePropertyParameterMessage" class="inline-feedback">请先在安居客网页中选好范围，再点击“导入当前网址”。</div>
  </section>

  <section class="section anjuke-property-output">
    <div class="section-title-row">
      <div>
        <h2>输出位置</h2>
        <p class="section-description">选择上级目录后，系统自动创建“安居客物业案例”子文件夹保存结果和证据。</p>
      </div>
    </div>
    <div class="anjuke-property-output-row">
      <input id="anjukePropertyOutputDirectory" type="text" readonly placeholder="请选择本机输出目录">
      <button id="chooseAnjukePropertyOutput" type="button" class="secondary">选择目录</button>
    </div>
    <p id="anjukePropertyProfileHint" class="section-description">抓取运行在当前浏览器标签页中，不保存登录凭据到项目。</p>
  </section>

  <section class="section anjuke-property-network-action">
    <div class="section-title-row">
      <div>
        <h2>网络抓取</h2>
        <p class="section-description">应用参数后，抓取只访问当前安居客列表页及其详情页；遇到验证会等待人工完成。</p>
      </div>
      <span class="badge">访问网络</span>
    </div>
    <div class="button-row">
      <button id="openAnjukePropertySource" type="button" class="secondary">打开安居客</button>
      <button id="importAnjukePropertyCurrentUrl" type="button">导入当前网址</button>
      <button id="runAnjukeProperty" type="button">开始网络抓取</button>
    </div>
    <p id="anjukePropertyGate" class="gate-reason" data-kind="warn" role="status"></p>
  </section>

  <section class="section anjuke-property-results">
    <div class="section-title-row">
      <div>
        <h2>抓取结果</h2>
        <p class="section-description">成功、跳过与验证阻断都会写入证据索引；终止后保留已完成的部分结果。</p>
      </div>
      <span id="anjukePropertyResultCount" class="badge">0 条</span>
    </div>
    <div class="anjuke-property-result-toolbar">
      <span id="anjukePropertyResultStatus" class="section-description">尚未读取结果</span>
      <div class="button-row">
        <button id="openAnjukePropertyResult" type="button" class="secondary" disabled>打开结果页</button>
        <button id="openAnjukePropertyExcel" type="button" class="secondary" disabled>打开 Excel</button>
        <button id="openAnjukePropertyCsv" type="button" class="secondary" disabled>打开 CSV</button>
        <button id="openAnjukePropertyMap" type="button" class="secondary" disabled>查看地图</button>
        <button id="openAnjukePropertyHtml" type="button" class="secondary" disabled>打开证据目录</button>
        <button id="pauseAnjukeProperty" type="button" class="secondary" disabled>暂停抓取</button>
        <button id="stopAnjukeProperty" type="button" class="secondary danger-button" disabled>终止抓取</button>
        <button id="clearAnjukePropertyResults" type="button" class="tiny secondary" disabled>清空结果</button>
      </div>
    </div>
    <div class="anjuke-property-options">
      <label><input id="anjukePropertyAutoOpenResult" type="checkbox" checked> 完成后自动打开结果页</label>
    </div>
    <div class="anjuke-property-progress" aria-live="polite">
      <div class="anjuke-property-progress-heading">
        <span id="anjukePropertyProgressPhase">等待开始</span>
        <strong id="anjukePropertyProgressPercent">0%</strong>
      </div>
      <div class="anjuke-property-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="安居客抓取进度">
        <div id="anjukePropertyProgressBar" class="anjuke-property-progress-value" style="width:0%"></div>
      </div>
      <div class="anjuke-property-progress-counts">
        <span>候选 <strong id="anjukePropertyProgressFetched">0</strong></span>
        <span>有效 <strong id="anjukePropertyProgressWritten">0</strong></span>
        <span>跳过 <strong id="anjukePropertyProgressSkipped">0</strong></span>
        <span>验证阻断 <strong id="anjukePropertyProgressBlocked">0</strong></span>
      </div>
    </div>
    <div id="anjukePropertyResultMessage" class="inline-feedback">结果包含结果页、地图、cases.csv、cases.json、cases.xlsx、证据索引和原始 HTML；候选、跳过与验证阻断逐条留痕。</div>
  </section>
`;
