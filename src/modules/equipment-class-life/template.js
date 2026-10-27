export const equipmentClassLifeTemplate = `
  <div class="page-heading equipment-skill-heading">
    <div>
      <h2>设备分类与年限判定</h2>
      <p>逐行人工复核设备分类、指数大类、经济耐用年限、区间和依据，并运行一致性检查。</p>
    </div>
    <button id="backFromEquipmentClassLife" type="button" class="secondary">返回首页</button>
  </div>

  <section class="section equipment-skill-notice" role="note">
    <strong>人工复核要求</strong>
    <p>技能包没有自动分类程序。模块提供本地参考检索和规则校验；不会把相似名称直接当作结论。请逐项确认分类及真实来源，特殊设备备注会写入 Word 报告。输出始终是新副本，原工作簿不改动。</p>
  </section>

  <section class="section equipment-class-config">
    <label class="equipment-skill-path-row"><span>设备清单工作簿</span><div><input id="equipmentClassLifeWorkbook" type="text" readonly placeholder="选择含“AI设备分类与年限”工作表的 .xlsx 文件"><button id="chooseEquipmentClassLifeWorkbook" type="button" class="secondary">选择工作簿</button></div></label>
    <label class="equipment-skill-path-row"><span>成果目录</span><div><input id="equipmentClassLifeOutputDirectory" type="text" readonly placeholder="选择新成果保存位置"><button id="chooseEquipmentClassLifeOutput" type="button" class="secondary">选择目录</button></div></label>
    <div class="button-row"><button id="startEquipmentClassLifeReview" type="button">读取并开始复核</button><button id="saveEquipmentClassLifePage" type="button" class="secondary" disabled>保存本页复核</button></div>
    <p id="equipmentClassLifePathFeedback" class="inline-feedback" role="status">选择与取消都会在这里显示；取消时保留原有路径。</p>
    <p id="equipmentClassLifeGate" class="gate-reason" role="status">选择工作簿和成果目录后开始。每页 25 条，翻页时会保留已录入内容。</p>
  </section>

  <section class="section equipment-class-reference">
    <div class="section-title-row"><div><h3>本地口径检索</h3><p class="section-description">检索技能附带的 values.md、2012/2024 年限表和来源说明。</p></div></div>
    <div class="equipment-class-reference-search"><input id="equipmentClassLifeLookupQuery" type="search" placeholder="输入设备名称或关键字"><button id="lookupEquipmentClassLifeReference" type="button" class="secondary">查本地参考</button></div>
    <div id="equipmentClassLifeLookupResults" class="equipment-class-reference-results" aria-live="polite">本地命中仅作查证线索，仍需人工核对原文和适用性。</div>
  </section>

  <section class="section equipment-class-review">
    <div class="section-title-row"><div><h3>逐行复核</h3><p id="equipmentClassLifePageSummary" class="section-description">尚未读取工作簿</p></div><span id="equipmentClassLifeCount" class="badge">0 条</span></div>
    <label class="equipment-class-filter"><span>筛选本页设备</span><input id="equipmentClassLifeFilter" type="search" placeholder="输入设备名称关键字"></label>
    <div class="equipment-class-table-scroll"><table class="equipment-class-table"><thead><tr><th>序号 / 设备名称</th><th>设备分类</th><th>指数-设备大类</th><th>年限</th><th>年限区间</th><th>来源依据</th><th>复核备注</th></tr></thead><tbody id="equipmentClassLifeRows"><tr><td colspan="7">先读取工作簿。</td></tr></tbody></table></div>
    <div class="button-row equipment-class-paging"><button id="equipmentClassLifePrevious" type="button" class="secondary" disabled>上一页</button><span id="equipmentClassLifePageLabel">第 0 / 0 页</span><button id="equipmentClassLifeNext" type="button" class="secondary" disabled>下一页</button></div>
  </section>

  <section class="section equipment-class-finish">
    <div class="section-title-row"><div><h3>检查与输出</h3><p class="section-description">检查空值、大类白名单、年限区间、同种设备口径一致性；通过后生成工作簿副本和 Word 报告。</p></div></div>
    <div class="button-row"><button id="validateEquipmentClassLife" type="button" class="secondary" disabled>一致性检查</button><button id="exportEquipmentClassLife" type="button" disabled>生成结果副本和报告</button><button id="clearEquipmentClassLifeDraft" type="button" class="tiny secondary" disabled>清除本次复核</button></div>
    <pre id="equipmentClassLifeOutput" class="equipment-skill-output" aria-live="polite">结果尚未生成。</pre>
  </section>
`;
