export const updatesTemplate = `
  <div class="page-heading">
    <div>
      <h2>版本更新</h2>
      <p>从评估工具箱专属发布源检查新版本</p>
    </div>
    <button id="backFromUpdates" type="button" class="secondary">返回首页</button>
  </div>
  <section class="section update-panel">
    <div class="section-title-row">
      <div>
        <h2 id="updateHeadline">正在读取当前版本</h2>
        <p id="updateDescription" class="section-description">检查不使用任何凭据；工具箱更新经发布页下载安装，不在页内覆盖组件。</p>
      </div>
      <span id="updateBadge" class="badge">未检查</span>
    </div>
    <dl class="kv compact-kv update-version-grid">
      <div><dt>当前版本</dt><dd id="updateCurrentVersion">-</dd></div>
      <div><dt>最新版本</dt><dd id="updateLatestVersion">-</dd></div>
      <div><dt>发布通道</dt><dd id="updateChannel">stable</dd></div>
      <div><dt>当前构建</dt><dd id="updateBuildNumber">-</dd></div>
      <div><dt>目标平台</dt><dd id="updatePlatform">-</dd></div>
      <div><dt>最后检查</dt><dd id="updateCheckedAt">-</dd></div>
    </dl>
    <div id="updateFeedback" class="inline-feedback" role="status" aria-live="polite">尚未检查工具箱专属发布源</div>
    <div id="updateProgressPanel" class="update-progress hidden" role="status" aria-live="polite">
      <progress id="updateProgressBar" max="100" value="0"></progress>
      <span id="updateProgressText">等待开始</span>
    </div>
    <div class="button-row update-primary-actions">
      <button id="updatePrimaryAction" type="button">检查更新</button>
    </div>
    <details id="updateMoreActions" class="update-more-actions">
      <summary>更多操作</summary>
      <div class="button-row">
        <button id="downloadUpdate" type="button" class="secondary" disabled>手动下载安装包</button>
        <button id="openReleasePage" type="button" class="secondary" disabled>打开发布页</button>
        <button id="copyUpdateDiagnostics" type="button" class="secondary">复制诊断摘要</button>
      </div>
    </details>
  </section>
  <section class="section update-notes-panel">
    <div class="section-title-row">
      <div>
        <h2>更新内容</h2>
        <p class="section-description">更新只涉及评估工具箱扩展本体；共享运行组件与主工作台不受影响。</p>
      </div>
    </div>
    <details id="updateNotesDetails" open>
      <summary>本次更新说明</summary>
      <ul id="updateNotes" class="update-notes">
        <li>等待检查更新</li>
      </ul>
    </details>
    <details id="updateNotesRemainingDetails" hidden>
      <summary>查看其余更新说明</summary>
      <ul id="updateNotesRemaining" class="update-notes"></ul>
    </details>
    <details id="updateTechnicalDetails">
      <summary>技术详情</summary>
      <dl class="kv compact-kv">
        <div><dt>安装包</dt><dd id="updateAssetName">-</dd></div>
        <div><dt>文件大小</dt><dd id="updateAssetSize">-</dd></div>
        <div><dt>SHA-256</dt><dd id="updateAssetSha">-</dd></div>
      </dl>
    </details>
  </section>
`;
