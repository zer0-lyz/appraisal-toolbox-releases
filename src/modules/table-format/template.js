export const tableFormatTemplate = `
  <div class="page-heading table-format-page-heading">
    <div>
      <h2>表格设置</h2>
      <p>批量统一 Word 文档中的表格格式</p>
    </div>
    <button id="backFromTableFormat" type="button" class="secondary">功能中心</button>
  </div>

  <section class="section table-format-panel table-format-preset-panel">
    <div class="table-format-panel-header">
      <h2>格式预设</h2>
      <span class="badge">Word · 全部表格</span>
    </div>
    <p class="table-format-note">包含嵌套表格；仅在处理成功并校验通过后替换原文件。</p>
    <div class="table-format-preset" aria-label="表格格式预设">
      <div><strong>字体</strong><span>宋体文本 · Times New Roman 数字 · 10 号</span></div>
      <div><strong>文字</strong><span>统一黑色，覆盖原有主题色</span></div>
      <div><strong>布局</strong><span>按窗口调整 · 最小行高 0.6 厘米 · 重复标题</span></div>
      <div><strong>对齐</strong><span>单元格垂直居中 · 标题加粗居中 · 数字右对齐</span></div>
      <div><strong>行距</strong><span>表格段落统一单倍行距</span></div>
      <div><strong>边框</strong><span>上下线 1.5 磅 · 内部线 0.5 磅 · 左右无线</span></div>
      <div><strong>底纹</strong><span>清除表格底纹及交替行底纹</span></div>
    </div>
  </section>

  <section class="section table-format-panel">
    <div class="table-format-panel-header">
      <h2>选择 Word 文档</h2>
      <span id="tableFormatInputCount" class="badge">未选择</span>
    </div>
    <p class="table-format-note">支持多选 .docx；暂不处理旧式 .doc 文件。</p>
    <div class="button-row table-format-toolbar">
      <button id="chooseTableFormatFiles" type="button" class="secondary">选择 Word 文档</button>
      <button id="clearTableFormatFiles" type="button" class="tiny secondary" disabled>清空选择</button>
    </div>
    <ul id="tableFormatFileList" class="table-format-file-list" aria-live="polite">
      <li class="muted">尚未选择文件</li>
    </ul>
  </section>

  <section class="section table-format-panel">
    <div class="table-format-panel-header">
      <h2>输出方式</h2>
      <span class="table-format-note">覆盖前会先生成临时文件</span>
    </div>
    <label class="table-format-mode-row">
      <span>处理后文件</span>
      <select id="tableFormatOutputMode">
        <option value="copy_in_source">在原文件夹创建副本</option>
        <option value="overwrite">直接覆盖原文件</option>
        <option value="new_directory">保存到指定文件夹</option>
      </select>
    </label>
    <div id="tableFormatOutputDirectoryWrap" class="directory-field hidden">
      <span>目标文件夹</span>
      <div class="directory-row">
        <input id="tableFormatOutputDirectory" type="text" readonly placeholder="请选择本机文件夹">
        <button id="chooseTableFormatOutput" type="button" class="secondary">选择</button>
      </div>
    </div>
  </section>

  <section class="section table-format-panel table-format-run-panel">
    <div class="table-format-panel-header table-format-progress-header">
      <div>
        <h2>执行与进度</h2>
        <p id="tableFormatProgressText" class="table-format-note">等待选择文件</p>
      </div>
      <strong id="tableFormatProgressPercent" class="table-format-progress-percent">0%</strong>
    </div>
    <progress id="tableFormatProgressBar" max="100" value="0"></progress>
    <div class="table-format-counts" aria-live="polite">
      <span>总文件 <strong id="tableFormatTotalCount">0</strong></span>
      <span>已完成 <strong id="tableFormatSuccessCount">0</strong></span>
      <span>失败 <strong id="tableFormatFailedCount">0</strong></span>
    </div>
    <div class="table-format-run-footer">
      <div id="tableFormatResultMessage" class="inline-feedback">尚未执行</div>
      <div class="task-actions">
        <button id="runTableFormat" type="button">开始执行</button>
      </div>
      <p id="tableFormatGate" class="gate-reason" data-kind="warn" role="status"></p>
    </div>
    <ul id="tableFormatResultList" class="table-format-result-list" aria-live="polite"></ul>
  </section>
`;
