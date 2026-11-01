import { userErrorMessage, showUserErrorDiagnostics } from "../../core/user-errors.js";
import { equipmentClassLifeTemplate } from "./template.js";

const MODULE_ID = "equipment-class-life";
const PAGE_SIZE = 25;
const ALLOWED_LARGE_CATEGORIES = [
  "家具", "文教、工美、体育和娱乐用品", "塑料制品", "通用设备", "专用设备",
  "电气机械及器材", "通信设备、计算机及其他电子设备", "仪器仪表",
];
const SOURCES = [
  "《常用评估参数2012v1（初稿）》设备参考年限表",
  "《资产评估报告编写模块常用语参考（2024版）》机器设备经济寿命参考年限表",
  "网络查询：《通用与专用设备经济寿命参考年限表》",
  "网络查询及行业惯例",
  "网络查询：《GB/T 7723-2017》电子汽车衡耐用年限10-15年",
];
const DEFAULT_CONFIG = { workbookPath: "", outputDirectory: "", sessionId: "", offset: 0 };
const ELEMENT_IDS = [
  "page-equipment-class-life", "openEquipmentClassLife", "backFromEquipmentClassLife",
  "equipmentClassLifeWorkbook", "chooseEquipmentClassLifeWorkbook", "equipmentClassLifeOutputDirectory",
  "chooseEquipmentClassLifeOutput", "equipmentClassLifePathFeedback", "startEquipmentClassLifeReview", "saveEquipmentClassLifePage",
  "equipmentClassLifeGate", "equipmentClassLifeLookupQuery", "lookupEquipmentClassLifeReference",
  "equipmentClassLifeLookupResults", "equipmentClassLifePageSummary", "equipmentClassLifeCount",
  "equipmentClassLifeFilter", "equipmentClassLifeRows", "equipmentClassLifePrevious",
  "equipmentClassLifeNext", "equipmentClassLifePageLabel", "validateEquipmentClassLife",
  "exportEquipmentClassLife", "clearEquipmentClassLifeDraft", "equipmentClassLifeOutput",
];

function option(value, text) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = String(text || "");
  element.dataset.kind = kind;
}

export const equipmentClassLifeModule = {
  manifest: {
    id: MODULE_ID,
    type: "feature",
    stage: "development",
    route: MODULE_ID,
    displayName: "设备分类与年限判定",
    messageNamespace: MODULE_ID,
    entryElementId: "openEquipmentClassLife",
    pageElementId: "page-equipment-class-life",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements = {};
    let config = { ...DEFAULT_CONFIG };
    let rows = [];
    let totalRows = 0;
    let offset = 0;
    let sheetName = "AI设备分类与年限";
    let safety = null;
    let busy = false;

    function renderGate() {
      const hasWorkbook = Boolean(config.workbookPath);
      const hasOutput = Boolean(config.outputDirectory);
      const hasSession = Boolean(config.sessionId);
      const tableReady = hasSession && rows.length > 0;
      elements.startEquipmentClassLifeReview.disabled = busy || !hasWorkbook || !hasOutput;
      elements.saveEquipmentClassLifePage.disabled = busy || !tableReady;
      elements.equipmentClassLifePrevious.disabled = busy || !tableReady || offset <= 0;
      elements.equipmentClassLifeNext.disabled = busy || !tableReady || offset + PAGE_SIZE >= totalRows;
      elements.validateEquipmentClassLife.disabled = busy || !hasSession;
      elements.exportEquipmentClassLife.disabled = busy || !hasSession || !hasOutput;
      elements.clearEquipmentClassLifeDraft.disabled = busy || !hasSession;
      elements.chooseEquipmentClassLifeWorkbook.disabled = busy;
      elements.chooseEquipmentClassLifeOutput.disabled = busy;
      elements.lookupEquipmentClassLifeReference.disabled = busy;
      elements.equipmentClassLifeGate.textContent = !hasWorkbook
        ? "先选择设备工作簿。原始文件只读；复核值仅暂存在本机临时目录。"
        : !hasOutput
          ? "工作簿已选。再选择成果目录，然后读取并复核；最终输出是新文件副本。"
          : safety?.requiresNativeEditor
            ? "工作簿含公式、外部链接或宏。导出会尝试使用 WPS/Excel 原生编辑保留结构；不可用时将停止且不输出文件。"
            : "工作簿与成果目录已就绪。请逐页复核；技能不会自动猜测不确定设备的分类。";
      elements.equipmentClassLifeGate.dataset.kind = hasWorkbook && hasOutput ? "ok" : "warn";
    }

    async function persist() {
      await context.storage.save({ ...config, offset });
    }

    function output(text, kind = "") {
      setMessage(elements.equipmentClassLifeOutput, text, kind);
    }

    function operationError(error, fallback) {
      showUserErrorDiagnostics(error, context.document);
      return userErrorMessage(error, fallback);
    }

    async function nativeAction(payload) {
      const result = await context.sendNativeMessage({ action: "equipment_class_life", ...payload }, 10 * 60 * 1000);
      if (!result) throw new Error("本机助手没有返回设备分类结果。");
      return result;
    }

    function setBusy(value) {
      busy = value;
      renderGate();
    }

    async function closeSession() {
      if (!config.sessionId) return;
      try { await nativeAction({ operation: "close", sessionId: config.sessionId }); } catch { /* Expired temp sessions are harmless. */ }
      config.sessionId = "";
      rows = [];
      totalRows = 0;
      offset = 0;
      safety = null;
      await persist();
    }

    async function chooseWorkbook() {
      if (busy) return;
      setMessage(elements.equipmentClassLifePathFeedback, "正在打开系统文件选择窗口…");
      setBusy(true);
      try {
        const selected = await context.sendNativeMessage({ action: "select_equipment_class_life_workbook" }, 130000);
        if (selected?.cancelled) {
          setMessage(elements.equipmentClassLifePathFeedback, "已取消选择工作簿，原文件选择保持不变。", "warn");
          return;
        }
        if (!selected?.ok || !selected.path) {
          const detail = userErrorMessage(selected?.message || selected?.reason || "", "未能选择工作簿。请重试；当前文件选择保持不变。");
          setMessage(elements.equipmentClassLifePathFeedback, detail, "error");
          return;
        }
        await closeSession();
        config.workbookPath = selected.path;
        elements.equipmentClassLifeWorkbook.value = config.workbookPath;
        await persist();
        renderRows();
        setMessage(elements.equipmentClassLifePathFeedback, "已选择工作簿。读取时会检查目标工作表与七列结构。", "ok");
      } catch (error) {
        setMessage(elements.equipmentClassLifePathFeedback, `选择工作簿失败：${operationError(error, "请检查本机助手和文件选择权限后重试。")}`, "error");
      } finally {
        setBusy(false);
      }
    }

    async function chooseOutput() {
      if (busy) return;
      setMessage(elements.equipmentClassLifePathFeedback, "正在打开系统文件夹选择窗口…");
      setBusy(true);
      try {
        const selected = await context.sendNativeMessage({ action: "select_equipment_class_life_output_directory" }, 130000);
        if (selected?.cancelled) {
          setMessage(elements.equipmentClassLifePathFeedback, "已取消选择成果目录，原目录保持不变。", "warn");
          return;
        }
        const directory = selected?.outputDirectory || selected?.path || "";
        if (!selected?.ok || !directory) {
          setMessage(elements.equipmentClassLifePathFeedback, "未能设置成果目录。请重试；当前目录选择保持不变。", "error");
          return;
        }
        config.outputDirectory = directory;
        elements.equipmentClassLifeOutputDirectory.value = directory;
        await persist();
        const label = selected.directoryName || "设备分类与年限结果";
        setMessage(elements.equipmentClassLifePathFeedback, `${selected.createdDirectory === false ? "已选择" : "已创建并选择"}专用成果子目录：${label}`, "ok");
      } catch (error) {
        setMessage(elements.equipmentClassLifePathFeedback, `选择成果目录失败：${operationError(error, "请检查本机助手和目录后重试。")}`, "error");
      } finally {
        setBusy(false);
      }
    }

    function serializeRows() {
      return rows.map((row) => ({
        rowNumber: row.rowNumber,
        classification: row.classification ?? "",
        largeCategory: row.largeCategory ?? "",
        economicLife: row.economicLife ?? "",
        lifeRange: row.lifeRange ?? "",
        source: row.source ?? "",
        note: row.note ?? "",
      }));
    }

    async function saveCurrentPage(showFeedback = true) {
      if (!config.sessionId || !rows.length) return true;
      const result = await nativeAction({ operation: "save_page", sessionId: config.sessionId, rows: serializeRows() });
      if (!result.ok) {
        output(result.message || "本页复核内容暂存失败。请重试。", "error");
        return false;
      }
      await persist();
      if (showFeedback) output(`本页已保存；当前暂存 ${Number(result.savedRows || 0)} 行。`, "ok");
      return true;
    }

    function selectControl(currentValue, allowed, placeholder) {
      const select = document.createElement("select");
      select.append(option("", placeholder));
      const current = String(currentValue ?? "");
      if (current && !allowed.includes(current)) select.append(option(current, current));
      for (const item of allowed) select.append(option(item, item));
      select.value = current;
      return select;
    }

    function textInput(value, placeholder, type = "text") {
      const input = document.createElement("input");
      input.type = type;
      input.value = value === null || value === undefined ? "" : String(value);
      input.placeholder = placeholder;
      if (type === "number") { input.min = "1"; input.max = "100"; input.step = "1"; }
      return input;
    }

    function renderRows() {
      const body = elements.equipmentClassLifeRows;
      body.replaceChildren();
      if (!rows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 7;
        td.textContent = "当前页没有设备行。";
        tr.append(td);
        body.append(tr);
      }
      for (const row of rows) {
        const tr = document.createElement("tr");
        tr.dataset.name = String(row.name || "").toLocaleLowerCase();
        const identity = document.createElement("td");
        const sequence = document.createElement("span");
        sequence.className = "equipment-class-row-sequence";
        sequence.textContent = `行 ${row.rowNumber} · 序号 ${row.sequence ?? "-"}`;
        const name = document.createElement("span");
        name.className = "equipment-class-row-name";
        name.textContent = row.name || "（设备名称为空）";
        identity.append(sequence, name);
        tr.append(identity);

        const controls = [
          textInput(row.classification, "填写设备分类"),
          selectControl(row.largeCategory, ALLOWED_LARGE_CATEGORIES, "选择固定大类"),
          textInput(row.economicLife, "整年", "number"),
          textInput(row.lifeRange, "如 8-12"),
          selectControl(row.source, SOURCES, "选择依据"),
          textInput(row.note, "特殊事项 / 复核理由"),
        ];
        const keys = ["classification", "largeCategory", "economicLife", "lifeRange", "source", "note"];
        controls.forEach((control, index) => {
          control.addEventListener("change", () => {
            row[keys[index]] = control.value;
          });
          if (control.type === "text" && index !== 0 && index !== 3 && index !== 5) {
            control.addEventListener("input", () => { row[keys[index]] = control.value; });
          }
          const td = document.createElement("td");
          td.append(control);
          tr.append(td);
        });
        body.append(tr);
      }
      const pageIndex = totalRows ? Math.floor(offset / PAGE_SIZE) + 1 : 0;
      const pageCount = totalRows ? Math.ceil(totalRows / PAGE_SIZE) : 0;
      elements.equipmentClassLifeCount.textContent = `${totalRows.toLocaleString("zh-CN")} 条`;
      elements.equipmentClassLifePageSummary.textContent = totalRows
        ? `工作表“${sheetName}” · 显示第 ${Math.min(offset + 1, totalRows).toLocaleString("zh-CN")}–${Math.min(offset + rows.length, totalRows).toLocaleString("zh-CN")} 条 · 每页 ${PAGE_SIZE} 条`
        : "尚未读取工作簿";
      elements.equipmentClassLifePageLabel.textContent = `第 ${pageIndex} / ${pageCount} 页`;
      renderGate();
      applyFilter();
    }

    function applyFilter() {
      const query = String(elements.equipmentClassLifeFilter.value || "").trim().toLocaleLowerCase();
      for (const row of elements.equipmentClassLifeRows.querySelectorAll("tr[data-name]")) {
        row.hidden = Boolean(query && !row.dataset.name.includes(query));
      }
    }

    async function loadPage(nextOffset, { manageBusy = true } = {}) {
      if (!config.sessionId) return;
      if (manageBusy) setBusy(true);
      try {
        const result = await nativeAction({ operation: "page", sessionId: config.sessionId, offset: nextOffset, limit: PAGE_SIZE });
        if (!result.ok) throw new Error(result.message || "工作簿页面读取失败。");
        rows = result.rows.map((row) => ({ ...row, note: row.note || "" }));
        totalRows = Number(result.totalRows || 0);
        offset = Number(result.offset || 0);
        sheetName = result.sheetName || sheetName;
        safety = result.safety || safety;
        await persist();
        renderRows();
        return true;
      } catch (error) {
        output(operationError(error, "工作簿页面读取失败，请重试或重新选择工作簿。"), "error");
        return false;
      } finally {
        if (manageBusy) setBusy(false);
      }
    }

    async function startReview() {
      if (busy || !config.workbookPath || !config.outputDirectory) {
        output("请先选择设备工作簿和成果目录。", "warn");
        return;
      }
      setBusy(true);
      try {
        if (!config.sessionId) {
          const created = await nativeAction({ operation: "create", workbookPath: config.workbookPath, sheetName: "AI设备分类与年限" });
          if (!created.ok) throw new Error(created.message || "无法读取设备分类工作簿。");
          config.sessionId = created.sessionId;
          rows = created.rows.map((row) => ({ ...row, note: "" }));
          totalRows = Number(created.totalRows || 0);
          offset = 0;
          sheetName = created.sheetName || sheetName;
          safety = created.safety || null;
          await persist();
          renderRows();
        } else {
          if (!(await loadPage(0, { manageBusy: false }))) return;
        }
        output(`已读取 ${totalRows.toLocaleString("zh-CN")} 条设备记录。现有分类可编辑，未匹配项需要人工查证。`, "ok");
      } catch (error) {
        output(operationError(error, "无法读取设备分类工作簿，请检查文件和本机组件。"), "error");
      } finally {
        setBusy(false);
      }
    }

    async function lookupReference() {
      if (busy) return;
      const query = String(elements.equipmentClassLifeLookupQuery.value || "").trim();
      if (query.length < 2) {
        setMessage(elements.equipmentClassLifeLookupResults, "请输入至少两个字符。", "warn");
        return;
      }
      setBusy(true);
      try {
        const result = await nativeAction({ operation: "lookup", query });
        const container = elements.equipmentClassLifeLookupResults;
        container.replaceChildren();
        const summary = document.createElement("div");
        summary.textContent = result.message || "本地参考检索完成。";
        container.append(summary);
        for (const item of result.results || []) {
          const entry = document.createElement("div");
          entry.className = "equipment-class-reference-item";
          const title = document.createElement("strong");
          title.textContent = `${item.file}:${item.line}`;
          const text = document.createElement("span");
          text.textContent = item.text;
          entry.append(title, text);
          container.append(entry);
        }
      } catch (error) {
        setMessage(elements.equipmentClassLifeLookupResults, operationError(error, "本地参考检索未完成。"), "error");
      } finally {
        setBusy(false);
      }
    }

    async function validate() {
      if (busy || !config.sessionId) return;
      setBusy(true);
      try {
        if (!(await saveCurrentPage(false))) return;
        const result = await nativeAction({ operation: "validate", sessionId: config.sessionId });
        const validation = result.validation;
        const message = validation?.output || result.message || "一致性检查完成。";
        output(message, result.ok ? "ok" : "error");
      } catch (error) {
        output(operationError(error, "一致性检查未完成，请查看诊断信息。"), "error");
      } finally {
        setBusy(false);
      }
    }

    async function exportResult() {
      if (busy || !config.sessionId || !config.outputDirectory) return;
      setBusy(true);
      try {
        if (!(await saveCurrentPage(false))) return;
        const result = await nativeAction({ operation: "export", sessionId: config.sessionId, outputDirectory: config.outputDirectory });
        if (!result.ok) {
          const details = result.validation?.output || result.message || "一致性检查未通过。";
          output(`${details}\n\n未生成最终文件。请修正问题后重试。`, "error");
          return;
        }
        output(`${result.message}\n\n工作簿：${result.workbookPath}\n报告：${result.reportPath}\n一致性检查：通过\n写入方式：${result.writeMode}`, "ok");
      } catch (error) {
        output(operationError(error, "结果副本或报告生成失败；请检查工作簿、输出目录和本机组件。"), "error");
      } finally {
        setBusy(false);
      }
    }

    async function clearDraft() {
      if (busy || !config.sessionId || !window.confirm("清除本次设备分类复核暂存？尚未导出的内容将丢失。")) return;
      setBusy(true);
      try {
        await closeSession();
        output("本次复核暂存已清除。原始工作簿没有改动。", "ok");
        renderRows();
      } catch (error) {
        output(`清除本次复核暂存失败：${operationError(error, "请重试。")}`, "error");
      } finally {
        setBusy(false);
      }
    }

    return {
      async initialize(moduleContext) {
        context = moduleContext;
        const page = moduleContext.document.getElementById("page-equipment-class-life");
        page.innerHTML = equipmentClassLifeTemplate;
        page.dataset.moduleId = MODULE_ID;
        elements = Object.fromEntries(ELEMENT_IDS.map((id) => [id, moduleContext.document.getElementById(id)]));
        config = { ...DEFAULT_CONFIG, ...(await context.storage.load({}) || {}) };
        offset = Number(config.offset || 0);
        elements.equipmentClassLifeWorkbook.value = config.workbookPath;
        elements.equipmentClassLifeOutputDirectory.value = config.outputDirectory;
        elements.chooseEquipmentClassLifeWorkbook.addEventListener("click", chooseWorkbook);
        elements.chooseEquipmentClassLifeOutput.addEventListener("click", chooseOutput);
        elements.startEquipmentClassLifeReview.addEventListener("click", startReview);
        elements.saveEquipmentClassLifePage.addEventListener("click", () => saveCurrentPage());
        elements.equipmentClassLifePrevious.addEventListener("click", async () => {
          if (offset <= 0 || !(await saveCurrentPage(false))) return;
          await loadPage(Math.max(0, offset - PAGE_SIZE));
        });
        elements.equipmentClassLifeNext.addEventListener("click", async () => {
          if (offset + PAGE_SIZE >= totalRows || !(await saveCurrentPage(false))) return;
          await loadPage(offset + PAGE_SIZE);
        });
        elements.lookupEquipmentClassLifeReference.addEventListener("click", lookupReference);
        elements.equipmentClassLifeLookupQuery.addEventListener("keydown", (event) => { if (event.key === "Enter") void lookupReference(); });
        elements.equipmentClassLifeFilter.addEventListener("input", applyFilter);
        elements.validateEquipmentClassLife.addEventListener("click", validate);
        elements.exportEquipmentClassLife.addEventListener("click", exportResult);
        elements.clearEquipmentClassLifeDraft.addEventListener("click", clearDraft);
        elements.backFromEquipmentClassLife.addEventListener("click", () => context.navigate("home"));
        elements.openEquipmentClassLife.addEventListener("click", () => context.navigate(MODULE_ID));
        renderGate();
      },
      async activate() {
        if (config.sessionId && !rows.length) await loadPage(offset);
        renderGate();
      },
      deactivate() {},
      dispose() {},
    };
  },
};
