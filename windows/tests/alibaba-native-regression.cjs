const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { probe } = require('./nm-probe.cjs');

const [rootArg, evidenceArg] = process.argv.slice(2);
const root = path.resolve(rootArg);
const evidence = path.resolve(evidenceArg);
if (fs.existsSync(evidence)) throw new Error('Use a new evidence directory');
fs.mkdirSync(evidence, { recursive: true });
const python = path.join(root, 'runtime', 'python-portable', 'python.exe');
assert(fs.existsSync(path.join(root, 'native-helper', 'native_host.exe')));
assert(fs.existsSync(python));

async function run(name, message) {
  const result = await probe(root, message, { timeout: 180000 });
  fs.writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(result, null, 2), 'utf8');
  assert.equal(result.exitCode, 0, `${name} Native host process exit`);
  assert(result.final, `${name} must return a Native Messaging result`);
  return result.final;
}

async function verifyWorkbook(name, filePath, expectedSheet, expectedTitle) {
  assert(fs.existsSync(filePath), `${name} Excel file is missing`);
  assert(fs.statSync(filePath).size > 0, `${name} Excel file is empty`);
  const readback = execFileSync(python, [
    '-X', 'utf8', '-c',
    'import json,sys,zipfile;from openpyxl import load_workbook;p=sys.argv[1];z=zipfile.ZipFile(p);assert z.testzip() is None;w=load_workbook(p,read_only=True,data_only=False);s=w[sys.argv[2]];rows=list(s.iter_rows(values_only=True));assert len(rows)==2;assert sys.argv[3] in rows[1];print(json.dumps({"ok":True,"sheet":s.title,"rows":len(rows)},ensure_ascii=False));w.close()',
    filePath, expectedSheet, expectedTitle,
  ], { encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(evidence, `${name}-excel-readback.json`), readback, 'utf8');
  return JSON.parse(readback);
}

async function main() {
  const auctionDirectory = path.join(evidence, 'auction');
  const leaseDirectory = path.join(evidence, 'lease');
  fs.mkdirSync(auctionDirectory);
  fs.mkdirSync(leaseDirectory);

  const auctionRequest = {
    sourceUrl: 'https://sf.taobao.com/list/50025969__2__%BA%BC%D6%DD.htm?local=330109',
    outputDirectory: auctionDirectory,
    propertyType: 'residential',
    status: 'finished',
    province: '浙江省',
    city: '杭州市',
    district: '萧山区',
    startDate: '2026-06-01',
    endDate: '2026-10-09',
    generateMap: false,
  };
  const auctionRows = [{
    title: '合成司法拍卖住宅案例', province: '浙江省', city: '杭州市', district: '萧山区',
    propertyType: '住宅用房', address: '合成路 1 号', transactionTime: '2026-08-01',
    transactionAmount: 1000000, buildingArea: 100, unitPrice: 10000, bidCount: 3,
    url: 'https://sf-item.taobao.com/sf_item/100000001.htm',
  }];
  const auctionResult = await run('auction-result', {
    action: 'write_alibaba_auction_result', request: auctionRequest,
    results: auctionRows, candidates: 1, skipped: 0,
  });
  assert.equal(auctionResult.ok, true, JSON.stringify(auctionResult));
  assert(fs.statSync(auctionResult.htmlPath).size > 0);
  const auctionHistory = JSON.parse(fs.readFileSync(auctionResult.historyPath, 'utf8'));
  assert.equal(auctionHistory.type, 'alibaba-auction-history');
  const auctionExcel = await run('auction-excel', {
    action: 'write_alibaba_auction_excel', request: auctionRequest,
    results: auctionRows, candidates: 1, skipped: 0,
  });
  assert.equal(auctionExcel.ok, true, JSON.stringify(auctionExcel));
  const auctionReadback = await verifyWorkbook('auction', auctionExcel.excelPath, '成交案例', '合成司法拍卖住宅案例');

  const leaseRequest = {
    sourceUrl: 'https://zc-paimai.taobao.com/auction/search.htm?spm=synthetic',
    outputDirectory: leaseDirectory,
    province: '浙江省', provinceCode: '330000', city: '杭州市', cityCode: '330100',
    district: '萧山区', districtCode: '330109', status: 'finished', startDate: '2026-06-01',
    endDate: '2026-10-09', maxPages: 1, generateMap: false,
  };
  const leaseRows = [{
    title: '合成阿里资产租赁案例', province: '浙江省', city: '杭州市', district: '萧山区',
    location: '合成路 2 号', houseUsage: '住宅', buildingArea: 80,
    transactionAmount: 24000, monthlyUnitPrice: 25, leaseTermYears: 1,
    endTime: '2026-08-02', resultStatus: '成交', bidCount: 2,
    url: 'https://zc-item.taobao.com/auction/100000002.htm',
  }];
  const leaseResult = await run('lease-result', {
    action: 'write_alibaba_lease_result', request: leaseRequest,
    results: leaseRows, candidates: 1, skipped: 0,
  });
  assert.equal(leaseResult.ok, true, JSON.stringify(leaseResult));
  assert(fs.statSync(leaseResult.htmlPath).size > 0);
  assert(fs.statSync(leaseResult.jsonPath).size > 0);
  const leaseHistory = JSON.parse(fs.readFileSync(leaseResult.historyPath, 'utf8'));
  assert.equal(leaseHistory.type, 'alibaba-lease-history');
  const leaseExcel = await run('lease-excel', {
    action: 'write_alibaba_lease_excel', request: leaseRequest,
    results: leaseRows, candidates: 1, skipped: 0,
  });
  assert.equal(leaseExcel.ok, true, JSON.stringify(leaseExcel));
  const leaseReadback = await verifyWorkbook('lease', leaseExcel.excelPath, '租赁案例', '合成阿里资产租赁案例');

  const summary = {
    ok: true,
    syntheticOnly: true,
    realAlibabaNetworkCovered: false,
    mapGenerationCovered: false,
    outputs: {
      auction: { htmlPath: auctionResult.htmlPath, historyPath: auctionResult.historyPath, excelPath: auctionExcel.excelPath, readback: auctionReadback },
      lease: { htmlPath: leaseResult.htmlPath, jsonPath: leaseResult.jsonPath, historyPath: leaseResult.historyPath, excelPath: leaseExcel.excelPath, readback: leaseReadback },
    },
  };
  fs.writeFileSync(path.join(evidence, 'native-artifact-regression.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`Alibaba Native synthetic artifact regressions passed. Evidence: ${evidence}`);
}

main().catch(error => {
  fs.writeFileSync(path.join(evidence, 'native-artifact-regression-error.txt'), error.stack || String(error), 'utf8');
  console.error(error);
  process.exitCode = 1;
});
