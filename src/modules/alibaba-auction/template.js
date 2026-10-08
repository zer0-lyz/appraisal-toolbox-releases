// 说明：下面的省/市/区县下拉只保留与 DEFAULT_CONFIG 一致的静态占位 option，
// 模块 initialize/activate 时 renderRegionOptions 总会用全国区域目录整体重建，
// 占位项不会残留到交互阶段；区县空选项文案与重建后的“不限定区县”保持一致。
export const alibabaAuctionTemplate = `
  <div class="page-heading alibaba-auction-heading">
    <div>
      <h2>阿里司法拍卖</h2>
      <p>登录后由固定脚本读取列表并核验成交详情；可选阿里资产搜索入口抓出售案例</p>
    </div>
    <button id="backFromAlibabaAuction" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section alibaba-auction-params">
    <div class="section-title-row">
      <div>
        <h2>检索参数</h2>
        <p class="section-description">运行时按本栏参数同步当前浏览器列表页，再读取并核验详情。</p>
      </div>
      <span id="alibabaAuctionParameterState" class="badge" data-kind="pending">待确认参数</span>
    </div>
    <div class="form-grid alibaba-auction-parameter-grid">
      <label><span>省份</span><select id="alibabaAuctionProvince" aria-label="省份"><option value="330000">浙江省</option></select></label>
      <label><span>城市</span><select id="alibabaAuctionCity" aria-label="城市"><option value="330100">杭州市</option></select></label>
      <label><span>区县</span><select id="alibabaAuctionDistrict" aria-label="区县" disabled><option value="">不限定区县</option></select></label>
      <label><span>列表入口</span><select id="alibabaAuctionEntry" aria-label="列表入口">
        <option value="sf">司法拍卖列表</option>
        <option value="zc">阿里资产搜索（出售）</option>
      </select></label>
      <label><span>物业类型</span><select id="alibabaAuctionPropertyType">
        <option value="residential">住宅用房</option>
        <option value="commercial">商业房</option>
      </select></label>
      <label><span>交易状态</span><select id="alibabaAuctionStatus">
        <option value="finished">已结束</option>
        <option value="all">全部状态</option>
      </select></label>
      <label class="alibaba-auction-keyword-field"><span>关键词（可选）</span><input id="alibabaAuctionKeyword" type="text" maxlength="100" placeholder="标的名称、地址或法院"></label>
      <label class="alibaba-auction-date-field"><span>成交时间起</span><input id="alibabaAuctionStartDate" type="date" aria-label="成交时间起"></label>
      <label class="alibaba-auction-date-field"><span>成交时间止</span><input id="alibabaAuctionEndDate" type="date" aria-label="成交时间止"></label>
    </div>
    <label class="alibaba-auction-source-row"><span>检索网址</span><input id="alibabaAuctionSourceUrl" type="text" readonly></label>
    <div class="button-row alibaba-auction-parameter-actions">
      <button id="saveAlibabaAuctionParams" type="button">确认并应用参数</button>
      <button id="resetAlibabaAuctionParams" type="button" class="secondary">恢复默认</button>
    </div>
    <div id="alibabaAuctionParameterMessage" class="inline-feedback">请调整参数后先点击“确认并应用参数”。</div>
  </section>

  <section class="section alibaba-auction-output">
    <div class="section-title-row">
      <div>
        <h2>输出位置</h2>
        <p class="section-description">网络抓取前先选择上级目录，系统会自动创建专用子文件夹保存结果。</p>
      </div>
    </div>
    <div class="alibaba-auction-output-row">
      <input id="alibabaAuctionOutputDirectory" type="text" readonly placeholder="请选择本机输出目录">
      <button id="chooseAlibabaAuctionOutput" type="button" class="secondary">选择目录</button>
    </div>
    <label class="alibaba-auction-map-option"><input id="alibabaAuctionGenerateMap" type="checkbox" checked> 生成独立地图 HTML</label>
  </section>

  <section class="section alibaba-auction-network-action">
    <div class="section-title-row">
      <div><h2>网络抓取</h2><p class="section-description">确认参数并选定输出位置后，只访问当前阿里拍卖列表和详情页；不会读取历史文件。</p></div>
      <span class="badge">访问网络</span>
    </div>
    <div class="button-row"><button id="openAlibabaAuctionSource" type="button" class="secondary">打开并登录</button><button id="runAlibabaAuction" type="button">开始网络抓取</button><button id="clearAlibabaAuctionResults" type="button" class="tiny secondary" disabled>清空当前结果</button></div>
  </section>

  <section class="section alibaba-auction-history">
    <div class="section-title-row">
      <div><h2>历史抓取数据</h2><p class="section-description">从所选文件夹加载历史清单和结果；仅点击“重新抓取详情”时访问网络。</p></div>
      <span class="badge">本地优先</span>
    </div>
    <div class="alibaba-auction-output-row"><input id="alibabaAuctionHistoryDirectory" type="text" readonly placeholder="请选择历史数据目录"><button id="chooseAlibabaAuctionHistoryDirectory" type="button" class="secondary">选择历史目录</button><button id="loadAlibabaAuctionHistoryCatalog" type="button" class="secondary">加载历史清单</button></div>
    <div class="alibaba-auction-history-controls"><select id="alibabaAuctionHistorySelect"><option value="">请选择历史抓取清单</option></select><button id="loadAlibabaAuctionHistory" type="button" class="secondary">仅加载历史结果</button></div>
    <div class="alibaba-auction-history-refresh"><label><input id="alibabaAuctionRefreshHistory" type="checkbox" checked> 允许访问网络重新读取历史详情</label><button id="runAlibabaAuctionHistory" type="button" class="secondary" disabled>重新抓取历史详情</button></div>
    <p id="alibabaAuctionHistoryStatus" class="section-description" role="status">选择目录后可加载历史清单。</p>
  </section>

  <section class="section alibaba-auction-results">
    <div class="section-title-row">
      <div>
        <h2>抓取结果</h2>
        <p class="section-description">结果会生成独立 HTML；可选生成地图，Excel 可随时导出到同一目录。</p>
      </div>
      <span id="alibabaAuctionResultCount" class="badge">0 条</span>
    </div>
    <div class="alibaba-auction-result-toolbar">
      <span id="alibabaAuctionResultStatus" class="section-description">尚未读取结果</span>
      <div class="button-row">
        <button id="openAlibabaAuctionResult" type="button" class="secondary" disabled>打开结果页</button>
        <button id="exportAlibabaAuctionExcel" type="button" class="secondary" disabled>导出 Excel</button>
        <button id="openAlibabaAuctionExcel" type="button" class="secondary" disabled>打开 Excel</button>
        <button id="openAlibabaAuctionMap" type="button" class="secondary" disabled>查看地图</button>
        <button id="pauseAlibabaAuction" type="button" class="secondary" disabled>暂停抓取</button>
        <button id="stopAlibabaAuction" type="button" class="secondary danger-button" disabled>终止抓取</button>
        <button id="clearAlibabaAuctionResults" type="button" class="tiny secondary" disabled>清空结果</button>
      </div>
    </div>
    <div class="alibaba-auction-progress" aria-live="polite">
      <div class="alibaba-auction-progress-heading">
        <span id="alibabaAuctionProgressPhase">等待开始</span>
        <strong id="alibabaAuctionProgressPercent">0%</strong>
      </div>
      <div class="alibaba-auction-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="阿里拍卖抓取进度">
        <div id="alibabaAuctionProgressBar" class="alibaba-auction-progress-value" style="width:0%"></div>
      </div>
      <div class="alibaba-auction-progress-counts">
        <span>页面记录 <strong id="alibabaAuctionProgressFetched">0</strong></span>
        <span>有效 <strong id="alibabaAuctionProgressVerified">0</strong></span>
        <span>跳过 <strong id="alibabaAuctionProgressSkipped">0</strong></span>
      </div>
    </div>
    <div id="alibabaAuctionResultMessage" class="inline-feedback">先选择本机输出目录，再在阿里拍卖列表页设置筛选并等待加载完成。地图只使用详情页明确返回的坐标，未定位记录不会被自动猜测位置。</div>
  </section>
`;
