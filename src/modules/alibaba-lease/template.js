// 省/市/区县下拉的静态 option 只做占位，initialize/activate 时 renderRegionOptions
// 会用共享 china-regions.js 目录整体重建；默认值与用户参考网址（杭州上城区）一致。
export const alibabaLeaseTemplate = `
  <div class="page-heading alibaba-lease-heading">
    <div>
      <h2>阿里资产租赁</h2>
      <p>在当前浏览器标签页登录后，由固定脚本自动读取租赁/使用权列表并核验成交详情</p>
    </div>
    <button id="backFromAlibabaLease" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section alibaba-lease-params">
    <div class="section-title-row">
      <div>
        <h2>检索参数</h2>
        <p class="section-description">按本栏参数生成阿里资产搜索网址（租赁/使用权，支持住宅与商业），再读取并核验详情。</p>
      </div>
      <span id="alibabaLeaseParameterState" class="badge" data-kind="pending">待确认参数</span>
    </div>
    <div class="form-grid alibaba-lease-parameter-grid">
      <label><span>省份</span><select id="alibabaLeaseProvince" aria-label="省份"><option value="330000">浙江省</option></select></label>
      <label><span>城市</span><select id="alibabaLeaseCity" aria-label="城市"><option value="330100">杭州市</option></select></label>
      <label><span>区县</span><select id="alibabaLeaseDistrict" aria-label="区县"><option value="330102">上城区</option></select></label>
      <label><span>物业类型</span><select id="alibabaLeasePropertyType" aria-label="物业类型">
        <option value="residential">住宅用房</option>
        <option value="commercial">商业用房</option>
      </select></label>
      <label><span>标的状态</span><select id="alibabaLeaseStatus">
        <option value="finished">已结束</option>
        <option value="all">全部状态</option>
      </select></label>
      <label><span>抓取页数</span><select id="alibabaLeaseMaxPages" aria-label="抓取页数">
        <option value="1">当前 1 页</option>
        <option value="2">2 页</option>
        <option value="3">3 页</option>
        <option value="4">4 页</option>
        <option value="5">5 页</option>
      </select></label>
      <label class="alibaba-lease-keyword-field"><span>关键词（可选）</span><input id="alibabaLeaseKeyword" type="text" maxlength="100" placeholder="按标题或小区名过滤"></label>
      <label class="alibaba-lease-date-field"><span>结束时间起</span><input id="alibabaLeaseStartDate" type="date" aria-label="结束时间起"></label>
      <label class="alibaba-lease-date-field"><span>结束时间止</span><input id="alibabaLeaseEndDate" type="date" aria-label="结束时间止"></label>
    </div>
    <label class="alibaba-lease-source-row"><span>检索网址</span><input id="alibabaLeaseSourceUrl" type="text" readonly></label>
    <div class="button-row alibaba-lease-parameter-actions">
      <button id="saveAlibabaLeaseParams" type="button">确认并应用参数</button>
      <button id="resetAlibabaLeaseParams" type="button" class="secondary">恢复默认</button>
    </div>
    <div id="alibabaLeaseParameterMessage" class="inline-feedback">请调整参数后先点击“确认并应用参数”。</div>
  </section>

  <section class="section alibaba-lease-output">
    <div class="section-title-row">
      <div>
        <h2>输出位置</h2>
        <p class="section-description">网络抓取前先选择上级目录，系统会自动创建“阿里资产租赁”子文件夹保存结果。</p>
      </div>
    </div>
    <div class="alibaba-lease-output-row">
      <input id="alibabaLeaseOutputDirectory" type="text" readonly placeholder="请选择本机输出目录">
      <button id="chooseAlibabaLeaseOutput" type="button" class="secondary">选择目录</button>
    </div>
    <label class="alibaba-lease-map-option"><input id="alibabaLeaseGenerateMap" type="checkbox" checked> 生成独立地图 HTML（使用详情页明确坐标）</label>
  </section>

  <section class="section alibaba-lease-network-action">
    <div class="section-title-row">
      <div><h2>网络抓取</h2><p class="section-description">确认参数并选定输出位置后，只访问当前阿里资产搜索列表和详情页；不会读取历史文件。</p></div>
      <span class="badge">访问网络</span>
    </div>
    <div class="button-row"><button id="openAlibabaLeaseSource" type="button" class="secondary">打开并登录</button><button id="runAlibabaLease" type="button">开始网络抓取</button></div>
  </section>

  <section class="section alibaba-lease-results">
    <div class="section-title-row">
      <div>
        <h2>抓取结果</h2>
        <p class="section-description">结果会生成独立 HTML 和 Excel；地图只使用详情页明确返回的坐标。</p>
      </div>
      <span id="alibabaLeaseResultCount" class="badge">0 条</span>
    </div>
    <div class="alibaba-lease-result-toolbar">
      <span id="alibabaLeaseResultStatus" class="section-description">尚未读取结果</span>
      <div class="button-row">
        <button id="openAlibabaLeaseResult" type="button" class="secondary" disabled>打开结果页</button>
        <button id="exportAlibabaLeaseExcel" type="button" class="secondary" disabled>导出 Excel</button>
        <button id="openAlibabaLeaseExcel" type="button" class="secondary" disabled>打开 Excel</button>
        <button id="openAlibabaLeaseMap" type="button" class="secondary" disabled>查看地图</button>
        <button id="pauseAlibabaLease" type="button" class="secondary" disabled>暂停抓取</button>
        <button id="stopAlibabaLease" type="button" class="secondary danger-button" disabled>终止抓取</button>
        <button id="clearAlibabaLeaseResults" type="button" class="tiny secondary" disabled>清空结果</button>
      </div>
    </div>
    <div class="alibaba-lease-progress" aria-live="polite">
      <div class="alibaba-lease-progress-heading">
        <span id="alibabaLeaseProgressPhase">等待开始</span>
        <strong id="alibabaLeaseProgressPercent">0%</strong>
      </div>
      <div class="alibaba-lease-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="阿里资产租赁抓取进度">
        <div id="alibabaLeaseProgressBar" class="alibaba-lease-progress-value" style="width:0%"></div>
      </div>
      <div class="alibaba-lease-progress-counts">
        <span>页面记录 <strong id="alibabaLeaseProgressFetched">0</strong></span>
        <span>有效 <strong id="alibabaLeaseProgressVerified">0</strong></span>
        <span>跳过 <strong id="alibabaLeaseProgressSkipped">0</strong></span>
      </div>
    </div>
    <div id="alibabaLeaseResultMessage" class="inline-feedback">先选择本机输出目录，再点击“确认并应用参数”；抓取会逐页读取租赁列表并核验详情，流拍与进行中记录会被跳过并记录原因。</div>
  </section>
`;
