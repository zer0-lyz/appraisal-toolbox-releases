export const mapSettingsTemplate = `
  <div class="page-heading">
    <div>
      <h2>地图基础配置</h2>
      <p>管理土地、司法拍卖等结果地图的底图来源</p>
    </div>
    <button id="backFromMapSettings" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section map-settings-notice">
    <div class="inline-feedback" data-kind="warn">
      默认使用现有公共底图并自动切换；只有默认底图全部无法加载时，才需要在这里启用官方高德 API。
    </div>
  </section>

  <section class="section map-settings-panel">
    <div class="section-title-row">
      <div>
        <h2>官方高德地图</h2>
        <p class="section-description">配置后，新生成的地图会把高德 API 作为备用底图。配置只保存在本机，不会上传或写入 GitHub。</p>
      </div>
      <span id="mapSettingsConfiguredStatus" class="badge">未配置</span>
    </div>
    <div class="map-settings-provider-guide">
      <p class="section-description">还没有 Key？请先打开高德开放平台，登录后创建“Web 端（JS API）”应用和 Key：</p>
      <a id="mapSettingsAmapConsoleLink" class="external-link" href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener noreferrer">打开高德 API 配置页面</a>
      <ol>
        <li>登录或注册高德开放平台，进入“应用管理 → 我的应用”。</li>
        <li>创建应用后新增“Web 端（JS API）”Key；如控制台提供安全密钥（securityJsCode），一并复制。</li>
        <li>回到这里启用官方高德底图，填写 Key 和安全密钥，点击“保存地图配置”。</li>
      </ol>
    </div>
    <label class="check-row map-settings-enable-row">
      <input id="mapSettingsEnableAmap" type="checkbox">
      <span>启用官方高德底图备用源</span>
    </label>
    <label class="field-block">
      <span>高德 Web 端（JS API）Key</span>
      <input id="mapSettingsAmapKey" type="password" maxlength="256" autocomplete="off" placeholder="启用时填写；已配置则留空表示保留原 Key">
    </label>
    <label class="field-block">
      <span>安全密钥（可选）</span>
      <input id="mapSettingsAmapSecurityCode" type="password" maxlength="256" autocomplete="off" placeholder="如高德控制台要求则填写">
    </label>
    <p id="mapSettingsLocalStatus" class="section-description map-settings-status" role="status">正在读取本机配置…</p>
    <div class="button-row">
      <button id="saveMapSettings" type="button">保存地图配置</button>
      <button id="clearMapSettings" type="button" class="secondary">恢复默认底图</button>
    </div>
    <div id="mapSettingsMessage" class="inline-feedback">未修改本机地图配置。</div>
  </section>

  <section class="section map-settings-help">
    <div class="section-title-row"><div><h2>配置说明</h2></div></div>
    <ol>
      <li>在高德控制台创建“Web 端（JS API）”Key，不要把 Key 或安全密钥发送到聊天或提交到仓库。</li>
      <li>启用后保存配置，再重新生成土地或司法拍卖地图；已经打开的旧 HTML 不会自动更新。</li>
      <li>如果未启用或清除了配置，系统会继续使用现有公共底图和自动降级逻辑。</li>
    </ol>
  </section>
`;
