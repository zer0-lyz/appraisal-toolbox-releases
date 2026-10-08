import { alibabaAuctionTemplate } from "./template.js";
// 区划目录已下沉到共享数据层，供阿里司法拍卖与阿里资产租赁两个模块复用。
import { ALIBABA_REGION_CATALOG } from "../../data/china-regions.js";

const PROPERTY_TYPE_CATEGORY = {
  residential: "50025969",
  commercial: "200782003",
};
// 阿里列表页的城市路径使用 GBK 百分号编码，不能用 encodeURIComponent 代替。
// 全部条目由 china-regions.js 的 ALIBABA_REGION_CATALOG 生成：城市短名（去掉末尾“市”）
// 逐字节 GBK 大写百分号编码；直辖市仅保留省级选择，故无城市条目。
const ALIBABA_CITY_PATH_SUFFIX = {
  "130100": "%CA%AF%BC%D2%D7%AF",
  "130200": "%CC%C6%C9%BD",
  "130300": "%C7%D8%BB%CA%B5%BA",
  "130400": "%BA%AA%B5%A6",
  "130500": "%D0%CF%CC%A8",
  "130600": "%B1%A3%B6%A8",
  "130700": "%D5%C5%BC%D2%BF%DA",
  "130800": "%B3%D0%B5%C2",
  "130900": "%B2%D7%D6%DD",
  "131000": "%C0%C8%B7%BB",
  "131100": "%BA%E2%CB%AE",
  "140100": "%CC%AB%D4%AD",
  "140200": "%B4%F3%CD%AC",
  "140300": "%D1%F4%C8%AA",
  "140400": "%B3%A4%D6%CE",
  "140500": "%BD%FA%B3%C7",
  "140600": "%CB%B7%D6%DD",
  "140700": "%BD%FA%D6%D0",
  "140800": "%D4%CB%B3%C7",
  "140900": "%D0%C3%D6%DD",
  "141000": "%C1%D9%B7%DA",
  "141100": "%C2%C0%C1%BA",
  "150100": "%BA%F4%BA%CD%BA%C6%CC%D8",
  "150200": "%B0%FC%CD%B7",
  "150300": "%CE%DA%BA%A3",
  "150400": "%B3%E0%B7%E5",
  "150500": "%CD%A8%C1%C9",
  "150600": "%B6%F5%B6%FB%B6%E0%CB%B9",
  "150700": "%BA%F4%C2%D7%B1%B4%B6%FB",
  "150800": "%B0%CD%D1%E5%C4%D7%B6%FB",
  "150900": "%CE%DA%C0%BC%B2%EC%B2%BC",
  "152200": "%D0%CB%B0%B2%C3%CB",
  "152500": "%CE%FD%C1%D6%B9%F9%C0%D5%C3%CB",
  "152900": "%B0%A2%C0%AD%C9%C6%C3%CB",
  "210100": "%C9%F2%D1%F4",
  "210200": "%B4%F3%C1%AC",
  "210300": "%B0%B0%C9%BD",
  "210400": "%B8%A7%CB%B3",
  "210500": "%B1%BE%CF%AA",
  "210600": "%B5%A4%B6%AB",
  "210700": "%BD%F5%D6%DD",
  "210800": "%D3%AA%BF%DA",
  "210900": "%B8%B7%D0%C2",
  "211000": "%C1%C9%D1%F4",
  "211100": "%C5%CC%BD%F5",
  "211200": "%CC%FA%C1%EB",
  "211300": "%B3%AF%D1%F4",
  "211400": "%BA%F9%C2%AB%B5%BA",
  "220100": "%B3%A4%B4%BA",
  "220200": "%BC%AA%C1%D6",
  "220300": "%CB%C4%C6%BD",
  "220400": "%C1%C9%D4%B4",
  "220500": "%CD%A8%BB%AF",
  "220600": "%B0%D7%C9%BD",
  "220700": "%CB%C9%D4%AD",
  "220800": "%B0%D7%B3%C7",
  "222400": "%D1%D3%B1%DF%B3%AF%CF%CA%D7%E5%D7%D4%D6%CE%D6%DD",
  "230100": "%B9%FE%B6%FB%B1%F5",
  "230200": "%C6%EB%C6%EB%B9%FE%B6%FB",
  "230300": "%BC%A6%CE%F7",
  "230400": "%BA%D7%B8%DA",
  "230500": "%CB%AB%D1%BC%C9%BD",
  "230600": "%B4%F3%C7%EC",
  "230700": "%D2%C1%B4%BA",
  "230800": "%BC%D1%C4%BE%CB%B9",
  "230900": "%C6%DF%CC%A8%BA%D3",
  "231000": "%C4%B5%B5%A4%BD%AD",
  "231100": "%BA%DA%BA%D3",
  "231200": "%CB%E7%BB%AF",
  "232700": "%B4%F3%D0%CB%B0%B2%C1%EB%B5%D8%C7%F8",
  "320100": "%C4%CF%BE%A9",
  "320200": "%CE%DE%CE%FD",
  "320300": "%D0%EC%D6%DD",
  "320400": "%B3%A3%D6%DD",
  "320500": "%CB%D5%D6%DD",
  "320600": "%C4%CF%CD%A8",
  "320700": "%C1%AC%D4%C6%B8%DB",
  "320800": "%BB%B4%B0%B2",
  "320900": "%D1%CE%B3%C7",
  "321000": "%D1%EF%D6%DD",
  "321100": "%D5%F2%BD%AD",
  "321200": "%CC%A9%D6%DD",
  "321300": "%CB%DE%C7%A8",
  "330100": "%BA%BC%D6%DD",
  "330200": "%C4%FE%B2%A8",
  "330300": "%CE%C2%D6%DD",
  "330400": "%BC%CE%D0%CB",
  "330500": "%BA%FE%D6%DD",
  "330600": "%C9%DC%D0%CB",
  "330700": "%BD%F0%BB%AA",
  "330800": "%E1%E9%D6%DD",
  "330900": "%D6%DB%C9%BD",
  "331000": "%CC%A8%D6%DD",
  "331100": "%C0%F6%CB%AE",
  "340100": "%BA%CF%B7%CA",
  "340200": "%CE%DF%BA%FE",
  "340300": "%B0%F6%B2%BA",
  "340400": "%BB%B4%C4%CF",
  "340500": "%C2%ED%B0%B0%C9%BD",
  "340600": "%BB%B4%B1%B1",
  "340700": "%CD%AD%C1%EA",
  "340800": "%B0%B2%C7%EC",
  "341000": "%BB%C6%C9%BD",
  "341100": "%B3%FC%D6%DD",
  "341200": "%B8%B7%D1%F4",
  "341300": "%CB%DE%D6%DD",
  "341500": "%C1%F9%B0%B2",
  "341600": "%D9%F1%D6%DD",
  "341700": "%B3%D8%D6%DD",
  "341800": "%D0%FB%B3%C7",
  "350100": "%B8%A3%D6%DD",
  "350200": "%CF%C3%C3%C5",
  "350300": "%C6%CE%CC%EF",
  "350400": "%C8%FD%C3%F7",
  "350500": "%C8%AA%D6%DD",
  "350600": "%D5%C4%D6%DD",
  "350700": "%C4%CF%C6%BD",
  "350800": "%C1%FA%D1%D2",
  "350900": "%C4%FE%B5%C2",
  "360100": "%C4%CF%B2%FD",
  "360200": "%BE%B0%B5%C2%D5%F2",
  "360300": "%C6%BC%CF%E7",
  "360400": "%BE%C5%BD%AD",
  "360500": "%D0%C2%D3%E0",
  "360600": "%D3%A5%CC%B6",
  "360700": "%B8%D3%D6%DD",
  "360800": "%BC%AA%B0%B2",
  "360900": "%D2%CB%B4%BA",
  "361000": "%B8%A7%D6%DD",
  "361100": "%C9%CF%C8%C4",
  "370100": "%BC%C3%C4%CF",
  "370200": "%C7%E0%B5%BA",
  "370300": "%D7%CD%B2%A9",
  "370400": "%D4%E6%D7%AF",
  "370500": "%B6%AB%D3%AA",
  "370600": "%D1%CC%CC%A8",
  "370700": "%CE%AB%B7%BB",
  "370800": "%BC%C3%C4%FE",
  "370900": "%CC%A9%B0%B2",
  "371000": "%CD%FE%BA%A3",
  "371100": "%C8%D5%D5%D5",
  "371300": "%C1%D9%D2%CA",
  "371400": "%B5%C2%D6%DD",
  "371500": "%C1%C4%B3%C7",
  "371600": "%B1%F5%D6%DD",
  "371700": "%BA%CA%D4%F3",
  "410100": "%D6%A3%D6%DD",
  "410200": "%BF%AA%B7%E2",
  "410300": "%C2%E5%D1%F4",
  "410400": "%C6%BD%B6%A5%C9%BD",
  "410500": "%B0%B2%D1%F4",
  "410600": "%BA%D7%B1%DA",
  "410700": "%D0%C2%CF%E7",
  "410800": "%BD%B9%D7%F7",
  "410900": "%E5%A7%D1%F4",
  "411000": "%D0%ED%B2%FD",
  "411100": "%E4%F0%BA%D3",
  "411200": "%C8%FD%C3%C5%CF%BF",
  "411300": "%C4%CF%D1%F4",
  "411400": "%C9%CC%C7%F0",
  "411500": "%D0%C5%D1%F4",
  "411600": "%D6%DC%BF%DA",
  "411700": "%D7%A4%C2%ED%B5%EA",
  "420100": "%CE%E4%BA%BA",
  "420200": "%BB%C6%CA%AF",
  "420300": "%CA%AE%D1%DF",
  "420500": "%D2%CB%B2%FD",
  "420600": "%CF%E5%D1%F4",
  "420700": "%B6%F5%D6%DD",
  "420800": "%BE%A3%C3%C5",
  "420900": "%D0%A2%B8%D0",
  "421000": "%BE%A3%D6%DD",
  "421100": "%BB%C6%B8%D4",
  "421200": "%CF%CC%C4%FE",
  "421300": "%CB%E6%D6%DD",
  "422800": "%B6%F7%CA%A9%CD%C1%BC%D2%D7%E5%C3%E7%D7%E5%D7%D4%D6%CE%D6%DD",
  "430100": "%B3%A4%C9%B3",
  "430200": "%D6%EA%D6%DE",
  "430300": "%CF%E6%CC%B6",
  "430400": "%BA%E2%D1%F4",
  "430500": "%C9%DB%D1%F4",
  "430600": "%D4%C0%D1%F4",
  "430700": "%B3%A3%B5%C2",
  "430800": "%D5%C5%BC%D2%BD%E7",
  "430900": "%D2%E6%D1%F4",
  "431000": "%B3%BB%D6%DD",
  "431100": "%D3%C0%D6%DD",
  "431200": "%BB%B3%BB%AF",
  "431300": "%C2%A6%B5%D7",
  "433100": "%CF%E6%CE%F7%CD%C1%BC%D2%D7%E5%C3%E7%D7%E5%D7%D4%D6%CE%D6%DD",
  "440100": "%B9%E3%D6%DD",
  "440200": "%C9%D8%B9%D8",
  "440300": "%C9%EE%DB%DA",
  "440400": "%D6%E9%BA%A3",
  "440500": "%C9%C7%CD%B7",
  "440600": "%B7%F0%C9%BD",
  "440700": "%BD%AD%C3%C5",
  "440800": "%D5%BF%BD%AD",
  "440900": "%C3%AF%C3%FB",
  "441200": "%D5%D8%C7%EC",
  "441300": "%BB%DD%D6%DD",
  "441400": "%C3%B7%D6%DD",
  "441500": "%C9%C7%CE%B2",
  "441600": "%BA%D3%D4%B4",
  "441700": "%D1%F4%BD%AD",
  "441800": "%C7%E5%D4%B6",
  "441900": "%B6%AB%DD%B8",
  "442000": "%D6%D0%C9%BD",
  "445100": "%B3%B1%D6%DD",
  "445200": "%BD%D2%D1%F4",
  "445300": "%D4%C6%B8%A1",
  "450100": "%C4%CF%C4%FE",
  "450200": "%C1%F8%D6%DD",
  "450300": "%B9%F0%C1%D6",
  "450400": "%CE%E0%D6%DD",
  "450500": "%B1%B1%BA%A3",
  "450600": "%B7%C0%B3%C7%B8%DB",
  "450700": "%C7%D5%D6%DD",
  "450800": "%B9%F3%B8%DB",
  "450900": "%D3%F1%C1%D6",
  "451000": "%B0%D9%C9%AB",
  "451100": "%BA%D8%D6%DD",
  "451200": "%BA%D3%B3%D8",
  "451300": "%C0%B4%B1%F6",
  "451400": "%B3%E7%D7%F3",
  "460100": "%BA%A3%BF%DA",
  "460200": "%C8%FD%D1%C7",
  "460300": "%C8%FD%C9%B3",
  "460400": "%D9%D9%D6%DD",
  "510100": "%B3%C9%B6%BC",
  "510300": "%D7%D4%B9%B1",
  "510400": "%C5%CA%D6%A6%BB%A8",
  "510500": "%E3%F2%D6%DD",
  "510600": "%B5%C2%D1%F4",
  "510700": "%C3%E0%D1%F4",
  "510800": "%B9%E3%D4%AA",
  "510900": "%CB%EC%C4%FE",
  "511000": "%C4%DA%BD%AD",
  "511100": "%C0%D6%C9%BD",
  "511300": "%C4%CF%B3%E4",
  "511400": "%C3%BC%C9%BD",
  "511500": "%D2%CB%B1%F6",
  "511600": "%B9%E3%B0%B2",
  "511700": "%B4%EF%D6%DD",
  "511800": "%D1%C5%B0%B2",
  "511900": "%B0%CD%D6%D0",
  "512000": "%D7%CA%D1%F4",
  "513200": "%B0%A2%B0%D3%B2%D8%D7%E5%C7%BC%D7%E5%D7%D4%D6%CE%D6%DD",
  "513300": "%B8%CA%D7%CE%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "513400": "%C1%B9%C9%BD%D2%CD%D7%E5%D7%D4%D6%CE%D6%DD",
  "520100": "%B9%F3%D1%F4",
  "520200": "%C1%F9%C5%CC%CB%AE",
  "520300": "%D7%F1%D2%E5",
  "520400": "%B0%B2%CB%B3",
  "520500": "%B1%CF%BD%DA",
  "520600": "%CD%AD%C8%CA",
  "522300": "%C7%AD%CE%F7%C4%CF%B2%BC%D2%C0%D7%E5%C3%E7%D7%E5%D7%D4%D6%CE%D6%DD",
  "522600": "%C7%AD%B6%AB%C4%CF%C3%E7%D7%E5%B6%B1%D7%E5%D7%D4%D6%CE%D6%DD",
  "522700": "%C7%AD%C4%CF%B2%BC%D2%C0%D7%E5%C3%E7%D7%E5%D7%D4%D6%CE%D6%DD",
  "530100": "%C0%A5%C3%F7",
  "530300": "%C7%FA%BE%B8",
  "530400": "%D3%F1%CF%AA",
  "530500": "%B1%A3%C9%BD",
  "530600": "%D5%D1%CD%A8",
  "530700": "%C0%F6%BD%AD",
  "530800": "%C6%D5%B6%FD",
  "530900": "%C1%D9%B2%D7",
  "532300": "%B3%FE%D0%DB%D2%CD%D7%E5%D7%D4%D6%CE%D6%DD",
  "532500": "%BA%EC%BA%D3%B9%FE%C4%E1%D7%E5%D2%CD%D7%E5%D7%D4%D6%CE%D6%DD",
  "532600": "%CE%C4%C9%BD%D7%B3%D7%E5%C3%E7%D7%E5%D7%D4%D6%CE%D6%DD",
  "532800": "%CE%F7%CB%AB%B0%E6%C4%C9%B4%F6%D7%E5%D7%D4%D6%CE%D6%DD",
  "532900": "%B4%F3%C0%ED%B0%D7%D7%E5%D7%D4%D6%CE%D6%DD",
  "533100": "%B5%C2%BA%EA%B4%F6%D7%E5%BE%B0%C6%C4%D7%E5%D7%D4%D6%CE%D6%DD",
  "533300": "%C5%AD%BD%AD%C0%FC%CB%DB%D7%E5%D7%D4%D6%CE%D6%DD",
  "533400": "%B5%CF%C7%EC%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "540100": "%C0%AD%C8%F8",
  "540200": "%C8%D5%BF%A6%D4%F2",
  "540300": "%B2%FD%B6%BC",
  "540400": "%C1%D6%D6%A5",
  "540500": "%C9%BD%C4%CF",
  "540600": "%C4%C7%C7%FA",
  "542500": "%B0%A2%C0%EF%B5%D8%C7%F8",
  "610100": "%CE%F7%B0%B2",
  "610200": "%CD%AD%B4%A8",
  "610300": "%B1%A6%BC%A6",
  "610400": "%CF%CC%D1%F4",
  "610500": "%CE%BC%C4%CF",
  "610600": "%D1%D3%B0%B2",
  "610700": "%BA%BA%D6%D0",
  "610800": "%D3%DC%C1%D6",
  "610900": "%B0%B2%BF%B5",
  "611000": "%C9%CC%C2%E5",
  "620100": "%C0%BC%D6%DD",
  "620200": "%BC%CE%D3%F8%B9%D8",
  "620300": "%BD%F0%B2%FD",
  "620400": "%B0%D7%D2%F8",
  "620500": "%CC%EC%CB%AE",
  "620600": "%CE%E4%CD%FE",
  "620700": "%D5%C5%D2%B4",
  "620800": "%C6%BD%C1%B9",
  "620900": "%BE%C6%C8%AA",
  "621000": "%C7%EC%D1%F4",
  "621100": "%B6%A8%CE%F7",
  "621200": "%C2%A4%C4%CF",
  "622900": "%C1%D9%CF%C4%BB%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "623000": "%B8%CA%C4%CF%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "630100": "%CE%F7%C4%FE",
  "630200": "%BA%A3%B6%AB",
  "632200": "%BA%A3%B1%B1%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "632300": "%BB%C6%C4%CF%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "632500": "%BA%A3%C4%CF%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "632600": "%B9%FB%C2%E5%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "632700": "%D3%F1%CA%F7%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "632800": "%BA%A3%CE%F7%C3%C9%B9%C5%D7%E5%B2%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "640100": "%D2%F8%B4%A8",
  "640200": "%CA%AF%D7%EC%C9%BD",
  "640300": "%CE%E2%D6%D2",
  "640400": "%B9%CC%D4%AD",
  "640500": "%D6%D0%CE%C0",
  "650100": "%CE%DA%C2%B3%C4%BE%C6%EB",
  "650200": "%BF%CB%C0%AD%C2%EA%D2%C0",
  "650400": "%CD%C2%C2%B3%B7%AC",
  "650500": "%B9%FE%C3%DC",
  "652300": "%B2%FD%BC%AA%BB%D8%D7%E5%D7%D4%D6%CE%D6%DD",
  "652700": "%B2%A9%B6%FB%CB%FE%C0%AD%C3%C9%B9%C5%D7%D4%D6%CE%D6%DD",
  "652800": "%B0%CD%D2%F4%B9%F9%C0%E3%C3%C9%B9%C5%D7%D4%D6%CE%D6%DD",
  "652900": "%B0%A2%BF%CB%CB%D5%B5%D8%C7%F8",
  "653000": "%BF%CB%D7%CE%C0%D5%CB%D5%BF%C2%B6%FB%BF%CB%D7%CE%D7%D4%D6%CE%D6%DD",
  "653100": "%BF%A6%CA%B2%B5%D8%C7%F8",
  "653200": "%BA%CD%CC%EF%B5%D8%C7%F8",
  "654000": "%D2%C1%C0%E7%B9%FE%C8%F8%BF%CB%D7%D4%D6%CE%D6%DD",
  "654200": "%CB%FE%B3%C7%B5%D8%C7%F8",
  "654300": "%B0%A2%C0%D5%CC%A9%B5%D8%C7%F8",
  "710100": "%CC%A8%B1%B1",
  "710200": "%B8%DF%D0%DB",
  "710300": "%BB%F9%C2%A1",
  "710400": "%CC%A8%D6%D0",
  "710500": "%CC%A8%C4%CF",
  "710600": "%D0%C2%D6%F1",
  "710700": "%BC%CE%D2%E5",
  "810001": "%D6%D0%CE%F7%85%5E",
  "810002": "%9E%B3%D7%D0%85%5E",
  "810003": "%96%7C%85%5E",
  "810004": "%C4%CF%85%5E",
  "810005": "%D3%CD%BC%E2%CD%FA%85%5E",
  "810006": "%C9%EE%CB%AE%88%B6%85%5E",
  "810007": "%BE%C5%FD%88%B3%C7%85%5E",
  "810008": "%FC%53%B4%F3%CF%C9%85%5E",
  "810009": "%D3%5E%CC%C1%85%5E",
  "810010": "%DC%F5%9E%B3%85%5E",
  "810011": "%CD%CD%E9%54%85%5E",
  "810012": "%D4%AA%C0%CA%85%5E",
  "810013": "%B1%B1%85%5E",
  "810014": "%B4%F3%C6%D2%85%5E",
  "810015": "%CE%F7%D8%95%85%5E",
  "810016": "%C9%B3%CC%EF%85%5E",
  "810017": "%BF%FB%C7%E0%85%5E",
  "810018": "%EB%78%8D%75%85%5E",
  "820001": "%BB%A8%B5%D8%AC%94%CC%C3%85%5E",
  "820002": "%BB%A8%CD%F5%CC%C3%85%5E",
  "820003": "%CD%FB%B5%C2%CC%C3%85%5E",
  "820004": "%B4%F3%CC%C3%85%5E",
  "820005": "%EF%4C%ED%98%CC%C3%85%5E",
  "820006": "%BC%CE%C4%A3%CC%C3%85%5E",
  "820007": "%C2%B7%9A%EB%CC%EE%BA%A3%85%5E",
  "820008": "%C2%7D%B7%BD%9D%FA%B8%F7%CC%C3%85%5E",
};
const DEFAULT_SOURCE_URL = "https://sf.taobao.com/list/50025969__2.htm";
// 阿里资产搜索入口（zc-paimai）：出售交易方式即司法拍卖标的（实测 40/40 为 sf-item），
// 列表候选转成 sf_item 链接后复用既有详情核验与产物链路。
const ZC_SEARCH_PATH = "/wow/pm/default/pc/zichansearch";
const ZC_CATEGORY = {
  residential: "206060601",
  commercial: "206057102",
};
const ZC_MODE_SALE = "[1]";
const DEFAULT_CONFIG = {
  province: "浙江省",
  provinceCode: "330000",
  city: "杭州市",
  cityCode: "330100",
  district: "",
  districtCode: "",
  propertyType: "residential",
  status: "finished",
  entry: "sf",
  keyword: "",
  startDate: "",
  endDate: "",
  outputDirectory: "",
  generateMap: true,
  historyDirectory: "",
  historyPath: "",
  historyRefresh: true,
};

const ALIBABA_PARAMETER_SNAPSHOT_FIELDS = [
  "province", "provinceCode", "city", "cityCode", "district", "districtCode",
  "propertyType", "status", "entry", "keyword", "startDate", "endDate", "outputDirectory", "generateMap",
];

function parameterSnapshotMatches(config, snapshot) {
  if (!config || !snapshot) return false;
  const current = normalizeConfig(config);
  const confirmed = normalizeConfig(snapshot);
  return ALIBABA_PARAMETER_SNAPSHOT_FIELDS.every((field) => current[field] === confirmed[field]);
}

const RESULT_FIELDS = [
  "title", "province", "city", "district", "propertyType", "address", "coordinateStatus", "longitude", "latitude", "transactionTime",
  "transactionAmount", "valuationAmount", "buildingArea", "unitPrice", "floor",
  "totalFloors", "decoration", "leaseStatus", "platform", "bidCount", "verificationStatus", "url",
];

function elementMap(documentRef) {
  const ids = [
    "openAlibabaAuction", "page-alibaba-auction", "backFromAlibabaAuction",
    "alibabaAuctionProvince", "alibabaAuctionCity", "alibabaAuctionDistrict", "alibabaAuctionEntry", "alibabaAuctionPropertyType",
    "alibabaAuctionStatus", "alibabaAuctionKeyword", "alibabaAuctionStartDate",
    "alibabaAuctionEndDate", "alibabaAuctionSourceUrl", "openAlibabaAuctionSource", "runAlibabaAuction",
    "saveAlibabaAuctionParams", "resetAlibabaAuctionParams", "alibabaAuctionParameterState", "alibabaAuctionParameterMessage",
    "alibabaAuctionOutputDirectory", "chooseAlibabaAuctionOutput", "alibabaAuctionGenerateMap",
    "alibabaAuctionHistoryDirectory", "chooseAlibabaAuctionHistoryDirectory", "loadAlibabaAuctionHistoryCatalog", "alibabaAuctionHistorySelect", "loadAlibabaAuctionHistory", "alibabaAuctionRefreshHistory", "alibabaAuctionHistoryStatus", "runAlibabaAuctionHistory",
    "alibabaAuctionResultCount", "alibabaAuctionResultStatus", "openAlibabaAuctionResult", "exportAlibabaAuctionExcel", "openAlibabaAuctionExcel", "openAlibabaAuctionMap", "pauseAlibabaAuction", "stopAlibabaAuction",
    "clearAlibabaAuctionResults", "alibabaAuctionResultMessage", "alibabaAuctionProgressPhase",
    "alibabaAuctionProgressPercent", "alibabaAuctionProgressBar", "alibabaAuctionProgressFetched",
    "alibabaAuctionProgressVerified", "alibabaAuctionProgressSkipped",
  ];
  return Object.fromEntries(ids.map((id) => [id, documentRef.getElementById(id)]));
}

function setMessage(element, text, kind = "") {
  if (!element) return;
  element.textContent = text;
  element.dataset.kind = kind;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function usableDistricts(cityRegion) {
  return (cityRegion?.children || []).filter((item) => !["全市", "市辖区"].includes(item?.name));
}

function normalizeConfig(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  // 省份必须先按代码匹配，再退回按名称匹配：省份切换处理器会把切换前的旧
  // 省份名随 { ...config } 一起传入，若代码与名称在同一次 find 里按目录顺序
  // 竞争，目录中排在浙江省之后的省份（如广东、新疆）会被旧名称抢先匹配，
  // 造成“切到外省后省份回退成浙江省、城市被清空”的缺陷。
  const provinceCodeText = String(source.provinceCode || "");
  let province = ALIBABA_REGION_CATALOG.find((item) => item.code === provinceCodeText)
    || ALIBABA_REGION_CATALOG.find((item) => item.name === String(source.province || ""));
  if (!province && provinceCodeText) {
    // 防御：传入区域目录中不存在的省份代码时直接抛错，绝不静默回退成
    // 浙江省——静默回退会把配置数据缺陷掩盖成“选择总是弹回浙江”。
    throw new Error(`ALIBABA_PROVINCE_CODE_UNKNOWN:${provinceCodeText}`);
  }
  if (!province) province = ALIBABA_REGION_CATALOG.find((item) => item.code === DEFAULT_CONFIG.provinceCode);
  const hasCitySelection = Object.hasOwn(source, "cityCode") || Object.hasOwn(source, "city");
  const city = province?.children?.find((item) => item.code === String(source.cityCode || "") || item.name === String(source.city || ""))
    || (!hasCitySelection && province?.code === DEFAULT_CONFIG.provinceCode ? province.children.find((item) => item.code === DEFAULT_CONFIG.cityCode) : null);
  const district = usableDistricts(city).find((item) => item.code === String(source.districtCode || "") || item.name === String(source.district || "")) || null;
  return {
    ...DEFAULT_CONFIG,
    province: province?.name || DEFAULT_CONFIG.province,
    provinceCode: province?.code || DEFAULT_CONFIG.provinceCode,
    city: city?.name || "",
    cityCode: city?.code || "",
    district: district?.name || "",
    districtCode: district?.code || "",
    propertyType: ["residential", "commercial"].includes(source.propertyType)
      ? source.propertyType
      : DEFAULT_CONFIG.propertyType,
    status: ["finished", "all"].includes(source.status) ? source.status : DEFAULT_CONFIG.status,
    entry: ["sf", "zc"].includes(source.entry) ? source.entry : DEFAULT_CONFIG.entry,
    keyword: String(source.keyword || "").trim().slice(0, 100),
    startDate: String(source.startDate || "").trim(),
    endDate: String(source.endDate || "").trim(),
    outputDirectory: String(source.outputDirectory || "").trim(),
    generateMap: source.generateMap !== false,
    historyDirectory: String(source.historyDirectory || "").trim(),
    historyPath: String(source.historyPath || "").trim(),
    historyRefresh: source.historyRefresh !== false,
  };
}

function buildZcAuctionSourceUrl(config, page = 1) {
  const url = new URL(`https://zc-paimai.taobao.com${ZC_SEARCH_PATH}`);
  url.searchParams.set("disableNav", "YES");
  url.searchParams.set("page", String(Math.max(1, Number(page) || 1)));
  url.searchParams.set("fcatV4Ids", JSON.stringify([ZC_CATEGORY[config.propertyType] || ZC_CATEGORY.residential]));
  url.searchParams.set("h_t_mode", ZC_MODE_SALE);
  url.searchParams.set("structFieldMap", JSON.stringify({ h_t_mode: ZC_MODE_SALE }));
  if ((config.status || "finished") === "finished") url.searchParams.set("statusOrders", '["2"]');
  const locationCode = String(config.districtCode || config.cityCode || config.provinceCode || "").trim();
  if (locationCode) url.searchParams.set("locationCodes", JSON.stringify([locationCode]));
  return url.href;
}

function buildSourceUrl(config, page = 1) {
  if (config.entry === "zc") return buildZcAuctionSourceUrl(config, page);
  const category = PROPERTY_TYPE_CATEGORY[config.propertyType] || PROPERTY_TYPE_CATEGORY.residential;
  const citySuffix = ALIBABA_CITY_PATH_SUFFIX[String(config.cityCode || "")] || "";
  // The numeric segment is part of Alibaba's real list path as well as the
  // query-string state.  Keeping it in the first navigation prevents the
  // page from loading a generic list and then racing a second navigation
  // triggered by the status control.
  const status = config.status === "all" ? "all" : "finished";
  const statusPathSegment = status === "finished" ? "2" : "-1";
  const listPath = citySuffix
    ? `${category}__${statusPathSegment}___${citySuffix}.htm`
    : `${category}__${statusPathSegment}.htm`;
  const url = new URL(`https://sf.taobao.com/list/${listPath}`);
  const selectedProvince = ALIBABA_REGION_CATALOG.find((item) => item.code === String(config.provinceCode || ""));
  const selectedCity = selectedProvince?.children?.find((item) => item.code === String(config.cityCode || ""));
  const cityScopeCode = selectedCity?.children?.find((item) => item.name === "市辖区")?.code || "";
  const locationCode = String(citySuffix
    ? config.districtCode || ""
    : config.districtCode || cityScopeCode || config.cityCode || config.provinceCode || "").trim();
  if (locationCode) url.searchParams.set("location_code", locationCode);
  url.searchParams.set("auction_source", "0");
  url.searchParams.set("st_param", "-1");
  // 阿里列表页的时间筛选对应“开拍时间”。插件中的“成交时间起/止”作为
  // 页面筛选的起止边界传入；正式抓取时仍优先复用用户当前已加载的列表页。
  if (config.startDate) url.searchParams.set("auction_start_from", config.startDate);
  if (config.endDate) url.searchParams.set("auction_start_to", config.endDate);
  // 阿里页面用 auction_start_seg=0 表示已结束，-1 表示不限制状态。
  // 不能固定写 -1，否则侧栏选择“已结束”只会显示在结果元数据里，实际列表仍可能包含进行中案例。
  url.searchParams.set("auction_start_seg", status === "finished" ? "0" : "-1");
  return url.href;
}

function propertyTypeLabel(value) {
  return {
    residential: "住宅用房",
    commercial: "商业房",
  }[value] || value || "";
}

// 用户在阿里页面完成筛选后，插件只读取当前已经加载的这一页，不擅自继续翻页。
const MAX_DIRECT_PAGES = 1;
const MANUAL_VERIFICATION_TIMEOUT_MS = 5 * 60 * 1000;

async function waitForRunResume(control, emit) {
  if (control?.stopped) throw new Error("ALIBABA_SCRAPE_STOPPED");
  if (!control?.paused) return;
  emit({
    phase: "paused",
    percent: control.percent || 0,
    message: "抓取已暂停；点击“继续抓取”后会从当前进度继续。",
  });
  await new Promise((resolve) => control.resumeResolvers.push(resolve));
  if (control?.stopped) throw new Error("ALIBABA_SCRAPE_STOPPED");
}

function extractAlibabaListPage() {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : element.getClientRects?.().length > 0;
  };
  const items = [];
  const seen = new Set();
  const isRecommended = (element) => {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const marker = `${current.id || ""} ${current.className || ""} ${current.getAttribute?.("aria-label") || ""}`;
      if (/recommend|guess|猜你喜欢|为您推荐|推荐更多/i.test(marker)) return true;
    }
    return false;
  };
  for (const anchor of [...document.querySelectorAll('a[href*="/sf_item/"]')].filter((item) => isVisible(item) && !isRecommended(item))) {
    const href = anchor.href || "";
    if (!href || seen.has(href)) continue;
    let text = clean(anchor.innerText || anchor.textContent || "");
    let parent = anchor.parentElement;
    for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
      const parentText = clean(parent.innerText || parent.textContent || "");
      if (parentText.length > text.length && parentText.length <= 1200) text = parentText;
      if (parentText.length <= 1200 && /\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|距开始|距结束|成交价|起拍价/.test(parentText)) break;
    }
    if (!text) continue;
    seen.add(href);
    const listedAmount = text.match(/(?:成交价|拍下价|最终成交价|成交金额|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*[\d,]+(?:\.\d+)?\s*(?:万|亿|元)?/i)?.[0] || "";
    const listedBidCount = Number(text.match(/(\d+)\s*次出价/i)?.[1] || 0);
    items.push({ href, text, listedAmount, listedBidCount, listedHasEndedText: /已结束/.test(text), listedHasExplicitSoldPrice: /(?:成交价|拍下价|最终成交价|成交金额)/.test(text) });
  }
  const body = document.body?.innerText || "";
  const totalMatch = body.match(/共找到\s*([\d,]+)\s*条/);
  const verificationRequired = [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
    || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body);
  return {
    url: location.href,
    title: document.title,
    total: totalMatch ? totalMatch[1] : "",
    items,
    pageText: clean(body.slice(0, 1200)),
    verificationRequired,
  };
}

async function extractAlibabaDetailPage() {
  const clean = (value) => String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : element.getClientRects?.().length > 0;
  };
  const coordinate = (value, minimum, maximum) => {
    const number = Number(String(value || "").replace(/,/g, "").trim());
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  };
  const coordinatePair = (longitude, latitude, source) => {
    const lng = coordinate(longitude, 70, 140);
    const lat = coordinate(latitude, 3, 55);
    return lng !== null && lat !== null ? { longitude: lng, latitude: lat, coordinateSource: source } : null;
  };
  const coordinateFromText = (value, source) => {
    const text = String(value || "");
    const patterns = [
      /(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?["'\s,;，；\]}]{0,80}(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /(?:latitude|lat|纬度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)["']?["'\s,;，；\]}]{0,80}(?:longitude|lng|lon|经度)\s*["']?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    ];
    for (const [index, pattern] of patterns.entries()) {
      const match = text.match(pattern);
      if (!match) continue;
      const pair = index === 1
        ? coordinatePair(match[2], match[1], source)
        : coordinatePair(match[1], match[2], source);
      if (pair) return pair;
    }
    return null;
  };
  const extractBuildingArea = (value) => {
    const text = clean(value).replace(/[，]/g, ",").replace(/[：]/g, ":")
      .replace(/建\s*筑\s*面\s*积/g, "建筑面积")
      .replace(/房\s*屋\s*面\s*积/g, "房屋面积");
    const patterns = [
      /(?:房屋|房产|不动产|建筑物)?(?:总)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:房屋|房产|不动产|建筑物)?(?:总)?建筑面积\s*[（(]\s*(?:平方米|平米|㎡|m²|m2|平方公尺)\s*[）)]\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)/i,
      /(?:房屋|房产|不动产|建筑物)?(?:建筑|房屋|房产|产权)面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
      /(?:登记建筑面积|登记面积|证载建筑面积|证载面积|产权证载面积|产权证建筑面积|房产证建筑面积|不动产权证书?建筑面积|建筑面积|房屋建筑面积|房屋面积)\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|为|是|等于|合计|共计|登记为)?\s*[:=：-]?\s*([\d][\d,\s]*(?:\.\s*\d+)?)(?=\s*(?:平方米|平米|㎡|m²|m2|平方公尺)?(?:\s|$|[,，。；;]))/i,
      /(?:房屋|房产|不动产|建筑物)?(?:总)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约|合计|共计)\s*)?(?:为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?=$|[,。；;])/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[1].replace(/\s+/g, " ").trim();
    }
    return "";
  };
  let coordinates = null;
  const elementsWithCoordinates = document.querySelectorAll(
    "[data-lng], [data-lat], [data-longitude], [data-latitude], [longitude], [latitude], [经度], [纬度]",
  );
  for (const element of elementsWithCoordinates) {
    coordinates = coordinatePair(
      element.getAttribute("data-lng") || element.getAttribute("data-longitude") || element.getAttribute("longitude") || element.getAttribute("经度"),
      element.getAttribute("data-lat") || element.getAttribute("data-latitude") || element.getAttribute("latitude") || element.getAttribute("纬度"),
      "detail-dom",
    );
    if (coordinates) break;
  }
  if (!coordinates) {
    for (const element of document.querySelectorAll("iframe[src], a[href]")) {
      coordinates = coordinateFromText(element.getAttribute("src") || element.getAttribute("href"), "detail-url");
      if (coordinates) break;
    }
  }
  if (!coordinates) {
    for (const script of document.scripts) {
      coordinates = coordinateFromText(script.textContent, "detail-script");
      if (coordinates) break;
    }
  }
  const detailRoot = document.querySelector("#J_desc") || document.querySelector("#J_ItemDetailContent");
  const detailContentText = clean(detailRoot?.innerText || detailRoot?.textContent || "");
  const detailContentReady = !detailRoot
    || (detailContentText.length > 0 && !/(?:加载中|loading)/i.test(detailContentText));
  const loadSupplementalSection = async (selector, linkSelector) => {
    const section = document.querySelector(selector);
    if (!section) return "";
    let text = clean(section.innerText || section.textContent || "");
    if (!/(?:加载中|loading)/i.test(text)) return text;
    section.scrollIntoView?.({ block: "center" });
    const link = document.querySelector(linkSelector);
    link?.scrollIntoView?.({ block: "center" });
    link?.click?.();
    const startedAt = Date.now();
    while (Date.now() - startedAt < 12000) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      text = clean(section.innerText || section.textContent || "");
      if (text && !/(?:加载中|loading)/i.test(text)) break;
    }
    return text;
  };
  const noticeText = await loadSupplementalSection("#NoticeDetail", '#J_DetailTabMenu a[href="#NoticeDetail"]');
  const noticeHasFields = /(?:建筑面积|房屋面积|房产证|证载面积)/.test(`${detailContentText}\n${noticeText}`)
    && /(?:所在楼层|楼层|总层数)/.test(`${detailContentText}\n${noticeText}`);
  const itemNoticeText = noticeHasFields ? "" : await loadSupplementalSection("#ItemNotice", '#J_DetailTabMenu a[href="#ItemNotice"]');
  const body = document.body?.innerText || "";
  const scriptText = [...document.scripts].map((script) => script.textContent || "").join("\n");
  const detailText = `${detailContentText}\n${noticeText}\n${itemNoticeText}\n${body}\n${scriptText}`;
  const verificationRequired = [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
    || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body);
  const attachments = [];
  const attachmentSeen = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.href || "";
    const name = clean(anchor.innerText || anchor.textContent || "评估报告附件");
    if (!href || (!/download_attach\.do/i.test(href) && !/\.pdf(?:$|[?#])/i.test(href))) continue;
    if (attachmentSeen.has(href)) continue;
    attachmentSeen.add(href);
    attachments.push({ name: name.slice(0, 120), href });
  }
  const normalizeFloorValue = (value) => {
    const normalized = clean(value).replace(/第/g, "").trim();
    if (/^(顶|底|中|高|低)(层)?$/.test(normalized)) return normalized.endsWith("层") ? normalized : normalized + "层";
    return normalized.replace(/([\d一二三四五六七八九十百零])\s*[层楼]$/, "$1").trim();
  };
  const readLabeledValue = (labels) => {
    const wanted = labels.map((label) => String(label));
    const valueFromText = (value) => {
      const text = clean(value);
      if (!text || text.length > 120) return "";
      const label = wanted.find((item) => text === item || text.startsWith(item));
      if (!label || text === label) return "";
      return text.slice(label.length).replace(/^[\s:：-]*(?:为|是)?\s*/, "").trim();
    };
    const valueFromNode = (node) => valueFromText(node?.innerText || node?.textContent || "");
    for (const node of document.querySelectorAll("th,td,dt,dd,label,span,div,p")) {
      const text = clean(node.innerText || node.textContent || "");
      if (!text || text.length > 120) continue;
      const inline = valueFromText(text);
      if (inline) return inline;
      if (!wanted.includes(text)) continue;
      const row = node.closest("tr");
      const cells = row ? [...row.children] : [];
      const cellIndex = cells.indexOf(node.closest("th,td"));
      const candidates = [
        cellIndex >= 0 ? cells[cellIndex + 1] : null,
        node.nextElementSibling,
        node.parentElement?.nextElementSibling,
        ...(node.parentElement ? [...node.parentElement.children].slice([...node.parentElement.children].indexOf(node) + 1) : []),
      ];
      for (const candidate of candidates) {
        const value = valueFromNode(candidate);
        if (value && !wanted.includes(value)) return value;
      }
    }
    const lines = body.split(/\r?\n/).map(clean).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const inline = valueFromText(line);
      if (inline) return inline;
      if (wanted.includes(line) && lines[index + 1] && !wanted.includes(lines[index + 1])) return lines[index + 1];
    }
    return "";
  };
  const heading = document.querySelector("h1")?.innerText || "";
  const statusText = detailText.match(/(?:本场|拍卖)?已结束|本场已流拍|本场已撤回|本场已中止|报名截止|预计[^\n]{0,30}结束/gi) || [];
  const locationMatch = body.match(/标的物位置\s*[：:]?\s*([\s\S]{0,180}?)(?:地图标注仅供参考|标的物介绍|房屋用途)/);
  const usageMatch = body.match(/房屋用途及?\s*土地性质\s*[：:]?\s*([\s\S]{0,140}?)(?:钥匙|使用情况|拍卖权利限制情况|建筑面积)/);
  const areaValue = readLabeledValue(["建筑面积", "房屋建筑面积", "房屋面积", "登记建筑面积", "登记面积", "证载建筑面积", "证载面积", "产权证载面积", "产权证建筑面积", "房产证建筑面积", "不动产权证书建筑面积"]);
  const buildingArea = extractBuildingArea(detailText) || extractBuildingArea(`建筑面积 ${areaValue}平方米`);
  const decorationMatch = detailText.match(/(?:装修及其他介绍|装修情况|装修)\s*[：:\s]+([^\n\r|；;]{1,40})/i);
  const leaseMatch = detailText.match(/(?:租赁情况|租赁状态|是否有租赁|租赁)\s*[：:\s]+([^\n\r|；;]{1,60})/i);
  const floorValue = readLabeledValue(["所在楼层", "所在楼层（层）", "所在楼层(层)", "房屋所在楼层", "所在层", "房屋楼层", "楼层"]);
  const totalFloorsValue = readLabeledValue(["房屋建筑总楼层", "建筑总层数", "房屋总层数", "总层数", "总楼层", "楼层数"]);
  const floorMatch = detailText.match(/(?:位于第|所在楼层|所在层|房屋所在楼层|房屋楼层|楼层)\s*(?:为|是|位于|在|：|:|=)?\s*([^，。；;()（）\n]{1,30}?)\s*层/);
  const totalFloorMatch = detailText.match(/(?:建筑总层数|房屋总层数|总层数|总楼层|楼层数|共)\s*(?:为|是|约|共|：|:|=)?\s*(\d+)\s*层?/);
  const floorPair = String(floorValue || floorMatch?.[1] || "").match(/^(.+?)\s*[\/／]\s*(\d+)$/);
  const transactionMatch = body.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const soldPriceMatch = body.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const valuationMatch = body.match(/(?:评估价|评估总价|议价价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(?:元)?/);
  const timeMatch = body.match(/(?:结束时间|成交时间|交易时间)\s*[：:]?\s*([0-9]{4}(?:[\/-][0-9]{1,2}[\/-][0-9]{1,2}|\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日?)(?:\s+[0-9:]{4,8})?)/);
  const bidMatch = [
    body.match(/(?:竞买记录|应买记录|出价次数|出价记录|竞价记录|竞价次数|应价次数)[^\n]{0,80}?[（(]?\s*(\d+)\s*(?:次出价|次竞价|次应价|次|条)?\s*[）)]?/i),
    body.match(/(?:共|累计|合计)\s*(\d+)\s*(?:次出价|次竞价|次应价|条出价记录|条竞买记录)/i),
    body.match(/(\d+)\s*次(?:出价|竞价|应价)/i),
    detailText.match(/(?:bidCount|bid_count|biddingCount|offerCount)\D{0,20}(\d+)/i),
  ].find(Boolean) || null;
  const hasEndedText = /(?:本场|拍卖)?已结束|成交价|竞价结果确认书/.test(detailText);
  const hasExplicitSoldPrice = Boolean(soldPriceMatch?.[1])
    || Boolean(transactionMatch?.[1] && /(?:当前价|最终价)/.test(transactionMatch[0]) && hasEndedText);
  const hasBidEvidence = Number(bidMatch?.[1] || 0) > 0;
  return {
    url: location.href,
    title: clean(heading),
    statusText: statusText.map(clean).slice(0, 5),
    location: clean(locationMatch?.[1] || body.match(/标的物位置\s*[：:]?\s*([^\n]{1,180})/)?.[1] || ""),
    usage: clean(usageMatch?.[1] || body.match(/房屋用途[^\n]{0,80}/)?.[0] || ""),
    buildingArea,
    floor: normalizeFloorValue(floorPair?.[1] || floorValue || floorMatch?.[1] || ""),
    totalFloors: clean(totalFloorsValue || totalFloorMatch?.[1] || floorPair?.[2] || ""),
    transactionAmount: transactionMatch?.[0] || "",
    valuationAmount: valuationMatch?.[1] || "",
    transactionTime: timeMatch?.[1] || "",
    bidCount: bidMatch?.[1] || "",
    longitude: coordinates?.longitude ?? null,
    latitude: coordinates?.latitude ?? null,
    coordinateSource: coordinates?.coordinateSource || "",
    hasSoldText: hasExplicitSoldPrice
      || /竞价结果确认书|已成交|成交状态\s*[：:]?\s*(?:成交|已成交)/.test(detailText)
      || (hasBidEvidence && /(?:已结束|成交时间|结束时间)/.test(detailText)),
    hasExplicitSoldPrice,
    hasInvalidStatus: statusText.some((value) => /流拍|撤回|中止/.test(value)),
    hasEndedText,
    decoration: clean(decorationMatch?.[1] || ""),
    leaseStatus: clean(leaseMatch?.[1] || ""),
    detailContentText: detailContentText.slice(0, 12000),
    detailContentReady,
    pageText: body.slice(0, 12000),
    attachments: attachments.slice(0, 8),
    verificationRequired,
  };
}

// 阿里资产搜索入口的列表提取：卡片结构是 Rax SPA（.pc-search-list--area），
// 出售条目链接为 sf_item 详情页，字段映射成与 sf 列表提取器一致的形状后
// 走同一条候选/详情/核验管线。
function extractZcAuctionListPage() {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element) return false;
    for (let current = element; current; current = current.parentElement) {
      if (current.hasAttribute?.("hidden") || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = window.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    }
    const rect = element.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : element.getClientRects?.().length > 0;
  };
  const isRecommended = (element) => {
    let current = element;
    for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
      const marker = `${current.id || ""} ${current.className || ""} ${current.getAttribute?.("aria-label") || ""}`;
      if (/recommend|guess|猜你喜欢|为您推荐|推荐更多/i.test(marker)) return true;
    }
    return false;
  };
  const parseCardAmount = (text, labels) => {
    // 数字后禁止紧跟“年”，且与标签间隔有限，防止把“结束 2026年…”读成金额。
    const pattern = new RegExp(`(?:${labels.join("|")})[^\\d¥￥]{0,6}[¥￥]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(万|亿|元)?(?!\\s*年)`);
    const match = text.match(pattern);
    if (!match) return "";
    const number = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(number)) return "";
    const scale = match[2] === "万" ? 10000 : match[2] === "亿" ? 100000000 : 1;
    return String(Math.round(number * scale * 100) / 100);
  };
  const items = [];
  const seen = new Set();
  const root = document.querySelector('[class*="pc-search-list--area"]');
  const cards = root ? [...root.children] : [];
  for (const card of cards) {
    // 出售入口只接受 sf-item 详情链接（实测 40/40）；zc-item 详情是另一套 DOM，不混入。
    const anchor = card.querySelector('a[href*="sf-item.taobao.com/sf_item/"]');
    if (!anchor || !isVisible(anchor) || isRecommended(anchor)) continue;
    const href = anchor.href || "";
    if (!href || seen.has(href)) continue;
    const text = clean(card.innerText || card.textContent || "");
    if (!text) continue;
    seen.add(href);
    // 出售卡片首行常是“支持贷款/放心付/低于评估价X%”徽标；标题取首个像地址的长行。
    const lines = String(card.innerText || "").split("\n").map(clean).filter(Boolean);
    const cardTitle = lines.find((line) => line.length >= 12 || /室|房|号|大厦|公寓|小区|厂房|车间|土地|转让/.test(line))
      || lines.reduce((longest, line) => (line.length > longest.length ? line : longest), "");
    items.push({
      href,
      text,
      title: cardTitle || clean(anchor.innerText || anchor.textContent || "").split("\n")[0],
      listedAmount: parseCardAmount(text, ["当前价", "拍下价", "成交价", "起拍价", "起始价"]),
      listedBidCount: Number(text.match(/(\d+)\s*次出价/i)?.[1] || 0),
      listedHasEndedText: /已结束/.test(text),
      listedHasExplicitSoldPrice: /拍下价|成交价/.test(text),
    });
  }
  const body = document.body?.innerText || "";
  const totalMatch = body.match(/共\s*([\d,]+)\s*(条|个|件)/);
  const verificationRequired = [...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[class*="slider"],[id*="slider"],[class*="verify"],[id*="verify"]')].some(isVisible)
    || /验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证/.test(body);
  return {
    url: location.href,
    title: document.title,
    total: totalMatch ? totalMatch[1] : "",
    items,
    pageText: clean(body.slice(0, 1200)),
    verificationRequired,
  };
}

function directCanonicalUrl(value) {
  try {
    const url = new URL(String(value || ""));
    url.searchParams.delete("track_id");
    return url.href;
  } catch {
    return String(value || "").trim();
  }
}

function directParseAmount(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function directParseAuctionAmount(value) {
  const text = String(value || "");
  const number = directParseAmount(text);
  if (!number) return null;
  if (/亿/.test(text)) return number * 100000000;
  if (/万/.test(text)) return number * 10000;
  return number;
}

function directParseCoordinate(value, minimum, maximum) {
  const number = Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

function directChineseFloorNumber(value) {
  const text = String(value || "").trim();
  if (!text || /^\d+$/.test(text)) return text;
  const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (/^[一二两三四五六七八九十百零]+$/.test(text)) {
    if (text === "十") return "10";
    const tenIndex = text.indexOf("十");
    if (tenIndex >= 0) {
      const tens = tenIndex === 0 ? 1 : digits[text[tenIndex - 1]];
      const ones = tenIndex === text.length - 1 ? 0 : digits[text[tenIndex + 1]];
      if (Number.isInteger(tens) && Number.isInteger(ones)) return String(tens * 10 + ones);
    }
    if (text.length === 1 && Number.isInteger(digits[text])) return String(digits[text]);
  }
  return text;
}

function directNormalizeFloorValue(value) {
  let normalized = String(value || "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/第/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:为|是|位于|在)\s*/, "")
    .trim();
  if (!normalized || /^(?:总|共|建筑|层数|楼层|总层数|总楼层|所在|数|全部楼层)$/.test(normalized)) return "";
  if (/^\s*[\/／]/.test(normalized)) return "";
  normalized = normalized.replace(/\s*(?:总|共)\s*(?:计)?\s*(?:层数|楼层|层|楼)?\s*$/, "").trim();
  normalized = normalized.replace(/(地下|地上|负)\s+(?=[\d一二两三四五六七八九十百零])/g, "$1");
  normalized = normalized.replace(/(地下|地上|负)?([一二两三四五六七八九十百零]+)/g, (match, prefix, number) => `${prefix || ""}${directChineseFloorNumber(number)}`);
  if (/^(顶|底|中|高|低)(层)?$/.test(normalized)) return normalized.endsWith("层") ? normalized : `${normalized}层`;
  normalized = normalized.replace(/[层楼]\s*$/, "").replace(/\s+/g, "").trim();
  return /^(?:地上|地下|负)?\d+(?:[至\-—~～](?:地上|地下|负)?\d+)?$/.test(normalized) ? normalized : "";
}

function directNormalizeTotalFloorValue(value) {
  const original = String(value || "").replace(/[（(][^）)]*[）)]/g, "").replace(/\s+/g, " ").trim();
  if (!original) return "";
  const hasUnit = /[层楼]/.test(original);
  const numberText = original.match(/(?:\d+|[一二两三四五六七八九十百零]+)/)?.[0] || "";
  const number = directChineseFloorNumber(numberText);
  return /^\d+$/.test(number) ? `${number}${hasUnit ? "层" : ""}` : "";
}

function directFloorWithinTotal(floor, totalFloors) {
  const total = directParseAmount(totalFloors);
  if (!total) return true;
  const values = String(floor || "").match(/\d+/g);
  return !values || values.every((value) => Number(value) <= total);
}

function directExtractBuildingAreaFromText(value) {
  const text = String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[，]/g, ",")
    .replace(/[：]/g, ":")
    .replace(/\s+/g, " ")
    .replace(/建\s*筑\s*面\s*积/g, "建筑面积")
    .replace(/房\s*屋\s*面\s*积/g, "房屋面积")
    .replace(/(?:专有|分摊|套内|共有|使用权)建筑面积/g, (match) => match.replace("建筑", ""))
    .trim();
  const patterns = [
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*[（(]\s*(?:平方米|平米|㎡|m²|m2|平方公尺)\s*[）)]\s*(?:(?:约|大约)\s*)?(?:为|是|等于|合计|共计)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!项目)(?<!总)(?:房产证|证载|房屋|房产|不动产|建筑物|产权)?建筑面积\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:(?:约|大约|合计|共计)\s*)?(?:为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?=$|[,。；;])/i,
    /(?:房屋|房产|不动产|建筑物)?(?:建筑|房屋|房产|产权)面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:合计建筑面积|建筑总面积|房屋建筑总面积|标的物建筑面积|证载建筑面积|房产证建筑面积|不动产建筑面积)\s*(?:[:=：]\s*)?(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:标的物|拍卖标的|房屋|房地产|不动产)\s*面积\s*(?:为|是|[:：])?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:登记建筑面积|登记面积|证载建筑面积|证载面积|产权证载面积|产权证建筑面积|房产证建筑面积|不动产权证书?建筑面积|建筑面积|房屋建筑面积|房屋面积)\s*(?:[（(][^）)]{0,20}[）)])?\s*(?:约|大约|为|是|等于|合计|共计|登记为)?\s*[:=：-]?\s*([\d][\d,\s]*(?:\.\s*\d+)?)(?=\s*(?:平方米|平米|㎡|m²|m2|平方公尺)?(?:\s|$|[,，。；;]))/i,
    /(?:房屋|房地产|不动产)\s*[，,]\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:^|[；;。\n（(]|\d[、.])\s*面积\s*(?:约|大约|合计|共计|为|是|等于)?\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?:^|[；;。\n]|\d[、.])\s*面积\s*[:=\-]?\s*([\d][\d,，\s]*(?:\.\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
    /(?<!总)(?:房屋)?建筑面积\s*[^。；;\n]{0,120}?([\d][\d,，\s]*(?:\.\s*\d+)?)\s*(?:平方米|平米|㎡|m²|m2|平方公尺)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return directParseAmount(match[1]);
  }
  return null;
}

function directExtractFloorFieldsFromText(value) {
  const lines = String(value || "")
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const floorLabels = ["所在楼层（层）", "所在楼层(层)", "房屋所在楼层", "所在楼层", "所在层次", "所在层数", "房屋楼层", "所在层", "楼层"];
  const totalLabels = ["房屋建筑总楼层", "建筑总层数", "房屋总层数", "总层数", "总楼层", "楼层数"];
  const read = (labels) => {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const orderedLabels = [...labels].sort((left, right) => right.length - left.length);
      const label = orderedLabels.find((item) => line === item || line.startsWith(`${item}：`) || line.startsWith(`${item}:`) || line.startsWith(`${item}为`) || line.startsWith(`${item}是`) || line.startsWith(`${item} `));
      if (!label) continue;
      const inline = line.slice(label.length).replace(/^[\s:：-]*(?:为|是)?\s*/, "").trim();
      if (inline) return inline;
      if (lines[index + 1] && !orderedLabels.includes(lines[index + 1])) return lines[index + 1];
    }
    return "";
  };
  const text = lines.join(" ");
  const floorLabel = "(?:所在楼层（层）|所在楼层\\(层\\)|房屋所在楼层|所在楼层|所在层次|所在层数|房屋楼层|所在层|(?<!总)楼层)";
  const floorToken = "(?:地上|地下|负)?\\s*(?:第\\s*)?[\\d一二两三四五六七八九十百零]+(?:\\s*[至\\-—~～]\\s*(?:地上|地下|负)?\\s*(?:第\\s*)?[\\d一二两三四五六七八九十百零]+)?";
  const pair = text.match(new RegExp(`${floorLabel}(?:\\s*[\\/／]\\s*(?:建筑)?(?:总层数|总楼层|共计|共|总))?\\s*(?:为|是|位于|在)?\\s*[:=：]?\\s*(${floorToken})\\s*层?\\s*[\\/／|｜]\\s*(?:(?:建筑)?(?:总层数|总楼层|共计|共)\\s*[:=：]?\\s*)?(${floorToken})\\s*层?`));
  const floorFromSentence = text.match(new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层`));
  const floorFromBareLabel = text.match(new RegExp(`(?:所在层次|所在层数)\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})(?!\\s*层)`));
  const floorFromContext = text.match(new RegExp(`(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)\\s*(?:为|是)\\s*(?:第\\s*)?(${floorToken})\\s*层`))
    || text.match(new RegExp(`(?:拍卖对象|估价对象|拍卖标的|标的物|该房屋|该房产|本次拍卖房屋|本次估价对象)[^。；;()（）\\n]{0,60}?(?:位于|处于)[^。；;()（）\\n]{0,40}?(?:第\\s*)?(${floorToken})\\s*层`))
    || text.match(new RegExp(`(?:位于|处于)\\s*第\\s*(${floorToken})\\s*层`));
  const floorFromLocated = text.match(/(?:^|[。；;，,])[^。；;\n]{0,160}?所在\s*(?:为|是|第\s*)?((?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+(?:\s*[至\-—~～]\s*(?:地上|地下|负)?\s*(?:第\s*)?[\d一二两三四五六七八九十百零]+)?)\s*层/);
  const totalFromSentence = text.match(/(?:房屋建筑|建筑物|建筑|房屋)?(?:地上|地下)?总(?:层数|楼层)\s*(?:为|是|约|共|[:=：])?\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/)
    || text.match(/共\s*([\d一二两三四五六七八九十百零]+)\s*(层)?/);
  const orphanTotal = text.match(/(?:楼层|层数)\s*[:：]?\s*[\/／]\s*总(?:楼层|层数)?\s*([\d一二两三四五六七八九十百零]+)/);
  const floorTotalPairPattern = new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层?[\\s,，、;；|｜/／]*?(?:共(?:计)?|总(?:层数|楼层)?|全部楼层)\\s*[:=：]?\\s*(${floorToken})\\s*层?`, "gi");
  const floorTotalPairLoosePattern = new RegExp(`${floorLabel}\\s*(?:为|是|位于|在|[:=：])?\\s*(${floorToken})\\s*层?[\\s\\S]{0,80}?(?:共(?:计)?|总(?:层数|楼层)?|全部楼层)\\s*[:=：]?\\s*(${floorToken})\\s*层?`, "gi");
  const floorTotalPairs = [];
  for (const pattern of [floorTotalPairPattern, floorTotalPairLoosePattern]) {
    for (const match of text.matchAll(pattern)) {
      const suffix = String(match[0]).slice(String(match[0]).lastIndexOf(String(match[2])) + String(match[2]).length);
      floorTotalPairs.push({ floor: match[1], totalFloors: match[2], hasUnit: /层\s*$/.test(suffix) });
    }
  }
  const pairedFloorTotal = floorTotalPairs
    .map((candidate) => ({ floor: directNormalizeFloorValue(candidate.floor), totalFloors: directNormalizeTotalFloorValue(`${candidate.totalFloors}${candidate.hasUnit ? "层" : ""}`) }))
    .find((candidate) => candidate.floor && candidate.totalFloors && directFloorWithinTotal(candidate.floor, candidate.totalFloors));
  const floor = directNormalizeFloorValue(pair?.[1] || pairedFloorTotal?.floor || floorFromSentence?.[1] || floorFromLocated?.[1] || floorFromContext?.[1] || floorFromBareLabel?.[1] || read(floorLabels));
  const floorFallback = floor || directNormalizeFloorValue(read(floorLabels));
  const totalRaw = pair?.[2] ? pair[2] : (pairedFloorTotal?.totalFloors || (totalFromSentence?.[1] ? `${totalFromSentence[1]}${totalFromSentence[2] || ""}` : orphanTotal?.[1] ? `${orphanTotal[1]}层` : read(totalLabels)));
  const totalFloors = directNormalizeTotalFloorValue(totalRaw);
  return { floor: floorFallback, totalFloors };
}

function directNormalizeDate(value) {
  const match = String(value || "").match(/(\d{4})\s*(?:年\s*|[\/-])(\d{1,2})\s*(?:月\s*|[\/-])(\d{1,2})\s*日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return String(value || "").trim();
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function directFirstCity(value) {
  const match = String(value || "").match(/(?:浙江省)?\s*([^省市县区]{1,16})市/);
  return match?.[1] ? `${match[1]}市` : "";
}

function directFirstDistrict(value, request = {}) {
  const text = String(value || "");
  if (request.district && text.includes(request.district)) return request.district;
  const province = ALIBABA_REGION_CATALOG.find((item) => item.name === request.province);
  const city = province?.children?.find((item) => item.name === request.city);
  return usableDistricts(city)
    .sort((left, right) => String(right.name || "").length - String(left.name || "").length)
    .find((item) => text.includes(item.name))?.name || "";
}

function stripLocationPrefixes(value, prefixes) {
  const original = String(value || "").replace(/\s+/g, " ").trim();
  let result = original;
  const names = [...new Set(prefixes.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  for (let index = 0; index < 6; index += 1) {
    const prefix = names.find((name) => result.startsWith(name));
    if (!prefix) break;
    result = result.slice(prefix.length).replace(/^[\s,，、;；:：-]+/, "").trim();
  }
  return result || original;
}

function directNormalizeLease(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/无租赁|未出租|空置|无承租/.test(text)) return "空置";
  if (/带租|出租|租赁期限|租期|租金/.test(text)) return "出租中";
  if (/占有|占用|未腾空/.test(text)) return "占用";
  return text;
}

function directFirstPropertyType(value) {
  const text = String(value || "");
  if (text.includes("住宅用房") || text.includes("住宅房") || text.includes("住宅")) return "住宅用房";
  if (text.includes("商业房") || text.includes("商业用房") || text.includes("商业")) return "商业房";
  return "";
}

function directParseDetail(detail, request) {
  const pageText = [detail.detailContentText, detail.pageText].filter(Boolean).join("\n");
  const attachmentText = String(detail.attachmentText || "");
  const pageTransactionMatch = pageText.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款|当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageSoldPriceMatch = pageText.match(/(?:成交价|拍下价|最终成交价|成交金额|成交价款)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageCurrentPriceMatch = pageText.match(/(?:当前价|最终价)\s*[：:]?\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)\s*(万|亿|元)?/);
  const pageHasEndedText = /(?:本场|拍卖)?已结束|竞价结果确认书/.test(pageText);
  const pageTimeMatch = pageText.match(/(?:结束时间|成交时间|交易时间)\s*[：:]?\s*([0-9]{4}(?:[\/-][0-9]{1,2}[\/-][0-9]{1,2}|\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日?)(?:\s+[0-9:]{4,8})?)/);
  const pageBidMatch = pageText.match(/(?:竞买记录|应买记录|出价次数|出价记录|竞价记录|竞价次数|应价次数)[^\n]{0,80}?[（(]?\s*(\d+)\s*(?:次出价|次竞价|次应价|次|条)?\s*[）)]?/i)
    || pageText.match(/(\d+)\s*次(?:出价|竞价|应价)/i);
  const hasExplicitSoldPrice = detail.hasExplicitSoldPrice === true || Boolean(pageSoldPriceMatch?.[1])
    || Boolean(pageCurrentPriceMatch?.[1] && pageHasEndedText);
  const hasEndedText = detail.hasEndedText === true || pageHasEndedText;
  const hasSoldText = detail.hasSoldText === true || hasExplicitSoldPrice || Boolean(pageBidMatch && hasEndedText);
  const transactionAmount = directParseAuctionAmount(detail.transactionAmount || pageTransactionMatch?.[0]);
  const valuationAmount = directParseAuctionAmount(detail.valuationAmount);
  const pageFields = directExtractFloorFieldsFromText(pageText);
  const attachmentFields = directExtractFloorFieldsFromText(attachmentText);
  const pageArea = directExtractBuildingAreaFromText(pageText);
  const attachmentArea = directExtractBuildingAreaFromText(attachmentText);
  const rawArea = directParseAmount(detail.buildingArea);
  const structuredArea = detail.fieldSources?.buildingArea === "structured" ? rawArea : null;
  const structuredFloor = detail.fieldSources?.floor === "structured" ? directNormalizeFloorValue(detail.floor) : "";
  const structuredTotal = detail.fieldSources?.totalFloors === "structured" ? directNormalizeTotalFloorValue(detail.totalFloors) : "";
  const hasTextEvidence = Boolean(pageText.trim() || attachmentText.trim());
  const buildingArea = structuredArea || attachmentArea || pageArea || (!hasTextEvidence ? rawArea : null);
  const floorFields = {
    floor: structuredFloor || attachmentFields.floor || pageFields.floor || (!hasTextEvidence ? directNormalizeFloorValue(detail.floor) : ""),
    totalFloors: structuredTotal || attachmentFields.totalFloors || pageFields.totalFloors || (!hasTextEvidence ? directNormalizeTotalFloorValue(detail.totalFloors) : ""),
  };
  const normalizedFloor = directNormalizeFloorValue(floorFields.floor);
  const normalizedTotalFloors = directNormalizeTotalFloorValue(floorFields.totalFloors);
  const bidCount = Number.isInteger(Number(detail.bidCount || pageBidMatch?.[1])) ? Number(detail.bidCount || pageBidMatch?.[1]) : 0;
  const hasTransactionEvidence = Boolean(transactionAmount) && (hasExplicitSoldPrice || hasSoldText);
  const finished = hasSoldText && detail.hasInvalidStatus !== true
    && (request.status !== "finished" || hasEndedText)
    && hasTransactionEvidence && (bidCount > 0 || hasExplicitSoldPrice);
  const rawLocation = String(detail.location || "").trim();
  const city = directFirstCity(rawLocation) || request.city || "";
  const district = directFirstDistrict(rawLocation, request);
  const location = stripLocationPrefixes(rawLocation, [request.province, city, district]);
  const propertyType = directFirstPropertyType(detail.usage) || propertyTypeLabel(request.propertyType);
  return {
    title: String(detail.title || "").trim(),
    province: request.province || "浙江省",
    city,
    district,
    propertyType,
    address: location,
    coordinateStatus: directParseCoordinate(detail.longitude, 70, 140) !== null && directParseCoordinate(detail.latitude, 3, 55) !== null ? "已定位（详情页坐标）" : "未定位（详情页未返回坐标）",
    coordinateSource: detail.coordinateSource || "",
    longitude: directParseCoordinate(detail.longitude, 70, 140),
    latitude: directParseCoordinate(detail.latitude, 3, 55),
    transactionTime: directNormalizeDate(detail.transactionTime || pageTimeMatch?.[1] || ""),
    transactionAmount,
    valuationAmount,
    buildingArea,
    unitPrice: transactionAmount && buildingArea ? Math.round((transactionAmount / buildingArea) * 100) / 100 : null,
    floor: directFloorWithinTotal(normalizedFloor, normalizedTotalFloors) ? normalizedFloor : "",
    totalFloors: directParseAmount(normalizedTotalFloors),
    decoration: String(detail.decoration || "").trim(),
    leaseStatus: directNormalizeLease(detail.leaseStatus),
    platform: "阿里拍卖",
    bidCount,
    verificationStatus: finished ? "详情核验通过" : "未通过成交核验",
    url: directCanonicalUrl(detail.url),
    valid: finished,
  };
}

function directMergeListingEvidence(detail = {}, candidate = {}) {
  return {
    ...detail,
    transactionAmount: detail.transactionAmount || candidate.listedAmount,
    bidCount: detail.bidCount || String(candidate.listedBidCount || ""),
    hasExplicitSoldPrice: detail.hasExplicitSoldPrice === true || candidate.listedHasExplicitSoldPrice === true,
    hasSoldText: detail.hasSoldText === true || (candidate.listedBidCount > 0 && candidate.listedHasEndedText === true),
    hasEndedText: detail.hasEndedText === true || candidate.listedHasEndedText === true,
  };
}

function directMatchesRequest(record, request) {
  const keyword = String(request.keyword || "").trim();
  const searchable = `${record.title || ""} ${record.province || ""} ${record.city || ""} ${record.district || ""} ${record.address || ""}`;
  if (keyword && !searchable.includes(keyword)) return false;
  const expectedProperty = propertyTypeLabel(request.propertyType);
  if (expectedProperty && record.propertyType && record.propertyType !== expectedProperty) return false;
  const date = String(record.transactionTime || "").slice(0, 10);
  if (request.startDate && (!date || date < request.startDate)) return false;
  if (request.endDate && (!date || date > request.endDate)) return false;
  return true;
}

function directSkipReason(detail, record, request) {
  const pageText = String(detail?.pageText || "");
  if (!record?.transactionAmount) return "未识别成交价或拍下价";
  if (detail?.hasInvalidStatus === true) return "页面标记为流拍、撤回或中止";
  if (request.status === "finished" && !detail?.hasEndedText && !/(?:本场|拍卖)?已结束/.test(pageText)) return "未识别已结束状态";
  if (!detail?.hasSoldText) return "未识别成交状态";
  if (!(Number(record?.bidCount || detail?.bidCount || 0) > 0 || detail?.hasExplicitSoldPrice === true)) return "未识别出价次数或明确成交价";
  const keyword = String(request.keyword || "").trim();
  const searchable = `${record?.title || ""} ${record?.province || ""} ${record?.city || ""} ${record?.district || ""} ${record?.address || ""}`;
  if (keyword && !searchable.includes(keyword)) return "不符合关键词范围";
  const expectedProperty = propertyTypeLabel(request.propertyType);
  if (expectedProperty && record?.propertyType && record.propertyType !== expectedProperty) return "不符合物业类型范围";
  const date = String(record?.transactionTime || "").slice(0, 10);
  if (request.startDate && (!date || date < request.startDate)) return "成交日期早于起始日期";
  if (request.endDate && (!date || date > request.endDate)) return "成交日期晚于结束日期";
  return "详情核验条件未满足";
}

function directPageLooksBlocked(value) {
  const text = `${value?.title || ""} ${value?.pageText || ""} ${value?.url || ""}`;
  if (value?.verificationRequired === true) return "ALIBABA_VERIFICATION_REQUIRED";
  if (/验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证|拖动.{0,8}(?:滑块|拼图)|captcha|punish|security\s*check/i.test(text)) return "ALIBABA_VERIFICATION_REQUIRED";
  if (/登录淘宝|请登录|会员登录|扫码登录|登录页面|login\.taobao|\/login(?:[/?]|$)|login_jump/i.test(text)) return "ALIBABA_LOGIN_REQUIRED";
  return "";
}

function pageWaitState(value, expectedUrl, pageKind = "detail") {
  const blocked = directPageLooksBlocked(value);
  if (blocked === "ALIBABA_LOGIN_REQUIRED") return "login";
  if (blocked === "ALIBABA_VERIFICATION_REQUIRED" || isAlibabaVerificationUrl(value?.url)) return "verification";
  if (expectedUrl && !alibabaUrlsReferToSamePage(value?.url, expectedUrl)) return "navigation";
  if (pageKind === "detail" && Object.prototype.hasOwnProperty.call(value || {}, "detailContentReady") && value.detailContentReady !== true) return "detail_loading";
  return "page_loading";
}

function verificationWaitMessage(state, pageKind, description, elapsedSeconds) {
  const pageLabel = pageKind === "detail" ? "详情页" : "列表页";
  if (state === "verification") return `检测到阿里拍卖验证，请在当前标签页完成滑块验证；完成后会等待原${pageLabel}重新加载，再继续${description}。已等待 ${elapsedSeconds} 秒。`;
  if (state === "detail_loading") return `当前${pageLabel}没有验证码，正在等待详情内容加载完成后继续${description}。已等待 ${elapsedSeconds} 秒。`;
  if (state === "navigation") return `正在等待阿里拍卖${pageLabel}返回目标页面后继续${description}。已等待 ${elapsedSeconds} 秒。`;
  return `正在等待阿里拍卖${pageLabel}和关键字段加载完成后继续${description}。已等待 ${elapsedSeconds} 秒。`;
}

function isAlibabaVerificationUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    if (host !== "taobao.com" && !host.endsWith(".taobao.com")) return false;
    const state = `${url.pathname} ${url.search} ${url.hash}`;
    return /^(?:sec|login|passport|safe|verify|captcha|err|anti)\./.test(host)
      || /captcha|verify|validate|punish|security|login|error/i.test(state);
  } catch {
    return false;
  }
}

function directListPageUrl(sourceUrl, page) {
  const url = new URL(sourceUrl);
  if (page <= 1) url.searchParams.delete("page");
  else url.searchParams.set("page", String(page));
  return url.href;
}

function isAlibabaListPage(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.hostname === "sf.taobao.com" && /^\/list\//.test(url.pathname)) return true;
    return url.hostname === "zc-paimai.taobao.com" && url.pathname === ZC_SEARCH_PATH;
  } catch {
    return false;
  }
}

function listPageMatchesRequest(value, request) {
  if (!isAlibabaListPage(value)) return false;
  try {
    const current = new URL(value);
    const expected = new URL(buildSourceUrl(request));
    if (current.pathname !== expected.pathname) return false;
    const comparedKeys = request.entry === "zc"
      ? ["locationCodes", "fcatV4Ids", "h_t_mode", "statusOrders"]
      : ["location_code", "auction_start_from", "auction_start_to", "auction_start_seg"];
    for (const key of comparedKeys) {
      if ((current.searchParams.get(key) || "") !== (expected.searchParams.get(key) || "")) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function statusFilterLabels(status) {
  return status === "finished" ? ["已结束"] : ["不限", "全部", "全部状态"];
}

function statusFilterMatchesRequest(value, status) {
  const text = String(value || "").replace(/\s+/g, "").trim();
  return statusFilterLabels(status).some((label) => text === label || text.includes(label));
}

function directCandidateInScope(item, request) {
  // 列表卡片的“距结束”和日期可能描述开拍、结束或更新时间，不能替代详情页成交证据。
  // 交易状态、成交金额和日期统一在详情页解析后判断，避免误杀最终已成交案例。
  return true;
}

function directPageBeforeRequestedRange(items, request) {
  // 不能用列表卡片日期推断分页边界；详情页才有可靠成交日期。
  return false;
}

function hasDirectCoordinates(item) {
  const longitude = Number(String(item?.longitude ?? "").replace(/,/g, "").trim());
  const latitude = Number(String(item?.latitude ?? "").replace(/,/g, "").trim());
  return Number.isFinite(longitude) && longitude >= 70 && longitude <= 140
    && Number.isFinite(latitude) && latitude >= 3 && latitude <= 55;
}

function resultGenerationProgress(results, request = {}, counts = {}) {
  const missingCoordinateCount = request.generateMap === false
    ? 0
    : (Array.isArray(results) ? results : []).filter((item) => !hasDirectCoordinates(item)).length;
  return {
    phase: request.generateMap === false ? "generating_results" : "locating_coordinates",
    percent: 99,
    message: request.generateMap === false
      ? "正在生成结果页"
      : `详情核验完成，正在定位 ${missingCoordinateCount} 条缺失坐标并生成结果页/地图…`,
    ...counts,
  };
}

function waitForCurrentTab(chromeRef, tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      chromeRef.tabs.onUpdated.removeListener(onUpdated);
      window.setTimeout(resolve, 900);
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    chromeRef.tabs.onUpdated.addListener(onUpdated);
  });
}

async function navigateCurrentTab(chromeRef, tab, url) {
  if (!tab?.id) throw new Error("ALIBABA_CURRENT_TAB_UNAVAILABLE");
  if (tab.url === url) {
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    return await chromeRef.tabs.get(tab.id);
  }
  const loaded = waitForCurrentTab(chromeRef, tab.id);
  await chromeRef.tabs.update(tab.id, { active: true, url });
  await loaded;
  return await chromeRef.tabs.get(tab.id);
}

async function executeCurrentTab(chromeRef, tabId, func, args = []) {
  let output;
  try {
    output = await chromeRef.scripting.executeScript({ target: { tabId }, func, args });
  } catch (error) {
    if (error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
    const failure = new Error(`ALIBABA_SCRIPT_EXECUTION_FAILED: ${String(error?.message || error).slice(0, 240)}`);
    failure.code = "ALIBABA_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  if (!Array.isArray(output) || !output.length || output[0]?.result === undefined || output[0]?.result === null) {
    const failure = new Error("ALIBABA_SCRIPT_EXECUTION_FAILED: executeScript 未返回页面结果。");
    failure.code = "ALIBABA_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  return output[0].result;
}

async function fetchAlibabaAttachmentBuffers(attachments) {
  const allowed = (value) => {
    try {
      const url = new URL(String(value || ""));
      const hostname = url.hostname.toLowerCase();
      return /^https?:$/.test(url.protocol)
        && (hostname === "sf.taobao.com" || hostname.endsWith(".taobao.com")
          || hostname.endsWith(".alicdn.com") || hostname.endsWith(".alibaba-inc.com"));
    } catch {
      return false;
    }
  };
  const output = [];
  for (const attachment of (Array.isArray(attachments) ? attachments : []).slice(0, 3)) {
    const href = String(attachment?.href || "").trim();
    if (!href || !allowed(href)) continue;
    try {
      const response = await fetch(href, { credentials: "include" });
      if (!response.ok) {
        output.push({ name: attachment?.name || "PDF", href, error: `HTTP_${response.status}` });
        continue;
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length <= 0 || bytes.length > 20 * 1024 * 1024) {
        output.push({ name: attachment?.name || "PDF", href, error: "ALIBABA_ATTACHMENT_TOO_LARGE" });
        continue;
      }
      const header = String.fromCharCode(...bytes.subarray(0, 4));
      if (header !== "%PDF") {
        output.push({ name: attachment?.name || "PDF", href, error: "ALIBABA_ATTACHMENT_NOT_PDF" });
        continue;
      }
      let binary = "";
      for (let index = 0; index < bytes.length; index += 32768) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
      }
      output.push({ name: attachment?.name || "PDF", href, base64: btoa(binary), size: bytes.length });
    } catch {
      output.push({ name: attachment?.name || "PDF", href, error: "ALIBABA_ATTACHMENT_FETCH_FAILED" });
    }
  }
  return output;
}

async function executeCurrentPageMain(chromeRef, tabId, func, args = []) {
  let output;
  try {
    output = await chromeRef.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func,
      args,
    });
  } catch (error) {
    if (error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
    const failure = new Error(`ALIBABA_SCRIPT_EXECUTION_FAILED: ${String(error?.message || error).slice(0, 240)}`);
    failure.code = "ALIBABA_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  if (!Array.isArray(output) || !output.length || output[0]?.result === undefined || output[0]?.result === null) {
    const failure = new Error("ALIBABA_SCRIPT_EXECUTION_FAILED: executeScript 未返回页面结果。");
    failure.code = "ALIBABA_SCRIPT_EXECUTION_FAILED";
    throw failure;
  }
  return output[0].result;
}

async function fetchAlibabaAttachmentBuffersFromBrowser(chromeRef, attachments) {
  const tab = await chromeRef.tabs.create({ url: "https://sf.taobao.com/", active: false });
  if (!tab?.id) throw new Error("ALIBABA_ATTACHMENT_TAB_UNAVAILABLE");
  try {
    await waitForCurrentTab(chromeRef, tab.id);
    return await executeCurrentPageMain(chromeRef, tab.id, fetchAlibabaAttachmentBuffers, [attachments]);
  } finally {
    try {
      await chromeRef.tabs.remove(tab.id);
    } catch {
      // The temporary same-origin attachment tab is best-effort cleaned up.
    }
  }
}

// 阿里列表页不会因为 URL 中带有 auction_start_seg 就把自定义下拉框回显出来。
// 真实控件是 li.auction-sort-select 内的隐藏 select#J_AuctionStatusSort、
// 动态 ID 的 [role=button][aria-haspopup] 触发器和同 ID 的 [role=menu] 弹层。
// 这里必须操作该组件本身并回读可见触发器与原生选项，不能用 URL/OCR 代替回读。
async function synchronizeAlibabaAuctionStatus(requestedStatus) {
  const desired = requestedStatus === "finished" ? "finished" : "all";
  const targetLabels = desired === "finished" ? ["已结束"] : ["不限", "全部", "全部状态"];
  const CONTROL_WAIT_TIMEOUT_MS = 8000;
  const CONTROL_POLL_INTERVAL_MS = 100;
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const compact = (value) => clean(value).replace(/\s+/g, "");
  const isTargetLabel = (value) => targetLabels.some((label) => compact(value) === compact(label));
  const pageText = () => clean(document.body?.innerText || document.body?.textContent || "");
  const pageHref = () => String(window.location?.href || "");
  const loginPage = () => /login\.taobao|\/login(?:[/?]|$)|登录淘宝|请登录|会员登录|扫码登录/i.test(`${pageHref()} ${pageText()}`);
  const verificationPage = () => /(?:^|[./_-])(captcha|verify|validate|punish|security|error)(?:[./?_-]|$)|验证码|滑块|安全验证|访问验证|人机验证|请完成.{0,8}验证|拖动.{0,8}(?:滑块|拼图)/i.test(`${pageHref()} ${pageText()}`);
  if (loginPage()) return { ok: false, changed: false, errorCode: "ALIBABA_LOGIN_REQUIRED", reason: "请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。" };
  if (verificationPage()) return { ok: false, changed: false, errorCode: "ALIBABA_VERIFICATION_REQUIRED", reason: "请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。" };
  const expectedAuctionStartSegment = desired === "finished" ? "0" : "-1";
  const isVisible = (element) => {
    if (!element || element.closest?.('[aria-hidden="true"]')) return false;
    if (element.getAttribute?.("aria-hidden") === "true") return false;
    const className = String(element.className || "");
    if (/\b(?:bf-popupmenu-hidden|bf-menu-hidden)\b/.test(className)) return false;
    const style = window.getComputedStyle ? window.getComputedStyle(element) : {};
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  };
  const textOf = (element) => clean(element?.innerText || element?.textContent || "");
  const triggerLabel = (trigger) => {
    if (!trigger) return "";
    const content = trigger.querySelector?.(".bf-select-content")
      || trigger.querySelector?.('[id^="ks-content-"]');
    return textOf(content) || textOf(trigger);
  };
  const selectedOptionLabel = (select) => {
    if (!select) return "";
    const selected = select.selectedOptions?.[0]
      || [...(select.options || [])].find((option) => option.selected);
    return textOf(selected) || clean(select.value);
  };
  const findMenu = (trigger) => {
    const menuId = trigger?.getAttribute?.("aria-haspopup");
    if (menuId) {
      const linked = document.getElementById(menuId);
      if (linked) return linked;
    }
    return [...document.querySelectorAll('[role="menu"]')].find((menu) => isVisible(menu)) || null;
  };
  const semanticText = (element) => clean([
    element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("title"),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(" "));
  const statusSemantic = [...document.querySelectorAll('[aria-label], [title], label, dt, th, span, div')]
    .find((element) => isVisible(element) && /拍卖状态/.test(compact(semanticText(element))) && semanticText(element).length <= 40);
  const statusRow = statusSemantic?.closest?.("li, form, fieldset, .form-item, .filter-item, .search-item")
    || statusSemantic?.parentElement
    || null;
  const findSelect = () => document.querySelector("#J_AuctionStatusSort")
    || [...(statusRow?.querySelectorAll?.("select") || [])][0]
    || [...document.querySelectorAll("select")].find((element) => /拍卖状态/.test(compact(semanticText(element.parentElement || element))));
  const triggerSelector = '[role="button"][aria-haspopup], [role="combobox"], button[aria-haspopup], [aria-haspopup]';
  const findTriggerIn = (root) => [...(root?.querySelectorAll?.(triggerSelector) || [])]
    .find((element) => isVisible(element));
  const findStatusControls = () => {
    const select = findSelect();
    const row = select?.closest?.("li") || statusRow || select?.parentElement || null;
    const rowTrigger = findTriggerIn(row);
    const fallbackTrigger = [...document.querySelectorAll(triggerSelector)]
      .find((element) => isVisible(element) && (
        /拍卖状态/.test(compact(semanticText(element)))
        || compact(triggerLabel(element)) === "拍卖状态"
        || isTargetLabel(triggerLabel(element))
      )) || null;
    const trigger = rowTrigger || fallbackTrigger;
    const menu = findMenu(trigger);
    const nativeOptions = [...(select?.options || [])];
    const nativeOption = nativeOptions.find((option) => targetLabels.some((label) => compact(textOf(option)) === compact(label)));
    return { select, row, trigger, menu, nativeOptions, nativeOption };
  };
  const waitForStatusControls = async () => {
    const startedAt = Date.now();
    let controls = findStatusControls();
    while ((!controls.select && !controls.trigger) || (controls.select && !controls.nativeOption)
      && Date.now() - startedAt < CONTROL_WAIT_TIMEOUT_MS) {
      await new Promise((resolve) => window.setTimeout(resolve, CONTROL_POLL_INTERVAL_MS));
      controls = findStatusControls();
    }
    return controls;
  };
  const state = (controls = findStatusControls()) => ({
    triggerLabel: triggerLabel(controls.trigger),
    selectLabel: selectedOptionLabel(controls.select),
    triggerExpanded: controls.trigger?.getAttribute?.("aria-expanded") || "",
    triggerId: controls.trigger?.id || "",
    selectId: controls.select?.id || "",
    menuId: controls.trigger?.getAttribute?.("aria-haspopup") || controls.menu?.id || "",
    hasTrigger: Boolean(controls.trigger),
    hasSelect: Boolean(controls.select),
  });
  const matchesTarget = (current) => {
    // The visible custom trigger is the authoritative page control. If the
    // hidden native select exists, it must agree with it as a second signal.
    // Alibaba intentionally keeps the custom trigger as the placeholder
    // “拍卖状态” when the native select is at “不限”; that is the real
    // representation of the all-status state. Finished still requires both
    // visible and native labels to be “已结束”.
    const triggerMatches = !current.hasTrigger
      || isTargetLabel(current.triggerLabel)
      || (desired === "all" && compact(current.triggerLabel) === "拍卖状态"
        && (!current.hasSelect || isTargetLabel(current.selectLabel)));
    const selectMatches = !current.hasSelect || isTargetLabel(current.selectLabel);
    return (current.hasTrigger || current.hasSelect) && triggerMatches && selectMatches;
  };
  const ensureStatusUrl = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("auction_start_seg", expectedAuctionStartSegment);
      window.history.replaceState(window.history.state, "", url.href);
      const finalUrl = new URL(window.location.href);
      const actual = finalUrl.searchParams.get("auction_start_seg") || "";
      if (actual !== expectedAuctionStartSegment) {
        return {
          ok: false,
          reason: `阿里页面状态已回读，但 URL 的 auction_start_seg 仍为“${actual || "空"}”，目标应为“${expectedAuctionStartSegment}”。`,
        };
      }
      return { ok: true, auctionStartSegment: actual, url: finalUrl.href };
    } catch (error) {
      return { ok: false, reason: `无法将阿里页面 URL 状态统一为“${expectedAuctionStartSegment}”：${error?.message || String(error)}` };
    }
  };
  const success = (changed, current, eventSequence = []) => ({
    ...(() => {
      const urlState = ensureStatusUrl();
      const base = {
        ok: urlState.ok,
        changed,
        state: desired,
        label: isTargetLabel(current.triggerLabel) ? current.triggerLabel : current.selectLabel || current.triggerLabel,
        controlFound: true,
        controlId: current.triggerId,
        selectId: current.selectId,
        menuId: current.menuId,
        readback: {
          triggerLabel: current.triggerLabel,
          selectLabel: current.selectLabel,
        },
        eventSequence,
        urlState,
      };
      return urlState.ok
        ? base
        : {
          ...base,
          errorCode: "ALIBABA_STATUS_URL_SYNC_FAILED",
          reason: urlState.reason,
        };
    })(),
  });
  const controls = await waitForStatusControls();
  if (!controls.select && !controls.trigger) {
    return { ok: false, changed: false, errorCode: "ALIBABA_STATUS_CONTROL_NOT_FOUND", reason: "未找到阿里页面的“拍卖状态”控件。请确认列表页已加载完成后重试。" };
  }
  if (controls.select && !controls.nativeOption) {
    return { ok: false, changed: false, errorCode: "ALIBABA_STATUS_OPTION_NOT_FOUND", reason: `阿里页面没有找到“${targetLabels[0]}”选项。` };
  }
  const before = state(controls);
  if (matchesTarget(before)) return success(false, before);

  const dispatched = [];
  const dispatchCompleteClick = (element, focus = false) => {
    if (!element?.dispatchEvent) return;
    const dispatch = (type, pointer = false) => {
      const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        detail: type === "click" || type === "mouseup" ? 1 : 0,
        button: 0,
        buttons: /down|move/.test(type) ? 1 : 0,
      };
      const EventConstructor = pointer && typeof window.PointerEvent === "function"
        ? window.PointerEvent
        : typeof window.MouseEvent === "function"
          ? window.MouseEvent
          : window.Event;
      element.dispatchEvent(new EventConstructor(type, init));
      dispatched.push(type);
    };
    dispatch("pointerdown", true);
    dispatch("mousedown");
    if (focus && typeof element.focus === "function") {
      element.focus();
      dispatched.push("focus");
    }
    dispatch("pointerup", true);
    dispatch("mouseup");
    dispatch("click");
  };
  let trigger = controls.trigger;
  let select = controls.select;
  let menu = controls.menu;
  const menuIsOpen = () => {
    const currentControls = findStatusControls();
    return currentControls.trigger?.getAttribute?.("aria-expanded") === "true"
      || Boolean(currentControls.menu && isVisible(currentControls.menu))
      || Boolean(menu && isVisible(menu));
  };
  if (!menuIsOpen()) {
    trigger = findStatusControls().trigger || trigger;
    dispatchCompleteClick(trigger, true);
  }

  const waitForOption = async (timeoutMs = 1600) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const currentControls = findStatusControls();
      const currentMenu = currentControls.menu || findMenu(currentControls.trigger || trigger) || menu;
      const option = [...(currentMenu?.querySelectorAll?.('[role="menuitem"], [role="option"], li, a, button') || [])]
        .find((item) => targetLabels.some((label) => compact(textOf(item)) === compact(label)));
      if (option && isVisible(currentMenu) && isVisible(option)) return option;
      await new Promise((resolve) => window.setTimeout(resolve, 80));
    }
    return null;
  };
  if (trigger) {
    const option = await waitForOption();
    if (!option) {
      return { ok: false, changed: false, errorCode: "ALIBABA_STATUS_OPTION_NOT_FOUND", reason: `阿里页面没有找到“${targetLabels[0]}”选项，或状态弹层未成功打开。` };
    }
    dispatchCompleteClick(option);
  } else {
    // Fallback for a future native-select variant. The real Alibaba page uses
    // the custom trigger branch above, so this path still requires readback.
    select.value = controls.nativeOption.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 1800) {
    const current = state();
    if (matchesTarget(current)) return success(true, current, dispatched);
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  const after = state();
  return {
    ok: false,
    changed: true,
    errorCode: "ALIBABA_STATUS_READBACK_FAILED",
    reason: `已操作阿里页面“拍卖状态”，但页面控件未回显目标值“${targetLabels[0]}”（触发器显示“${after.triggerLabel || "空"}”，原生选项显示“${after.selectLabel || "空"}”）。`,
    controlFound: true,
    controlId: after.triggerId,
    selectId: after.selectId,
    menuId: after.menuId,
    readback: {
      triggerLabel: after.triggerLabel,
      selectLabel: after.selectLabel,
    },
    eventSequence: dispatched,
  };
}

// 选择菜单项会按阿里原生 option 的 url 触发一次列表页导航。第一次
// executeScript 返回的是导航前的同步结果，因此在抓取/打开流程中再执行一次
// 页面回读，确保新页面的可见触发器已经显示目标值。
async function settleAlibabaAuctionStatus(chromeRef, tab, requestedStatus, statusSync) {
  if (!statusSync?.changed) return { tab, statusSync };
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 900 : 700));
    try {
      const refreshedTab = await chromeRef.tabs.get(tab.id);
      const readback = await executeCurrentTab(chromeRef, refreshedTab.id, synchronizeAlibabaAuctionStatus, [requestedStatus]);
      if (readback?.ok) return { tab: refreshedTab, statusSync: readback };
      const error = new Error(readback?.reason || "阿里页面拍卖状态回读失败");
      error.code = readback?.errorCode || "ALIBABA_STATUS_READBACK_FAILED";
      lastError = error;
    } catch (error) {
      if (error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
      lastError = error;
    }
  }
  throw lastError || new Error("ALIBABA_STATUS_READBACK_FAILED");
}

async function synchronizeAlibabaAuctionStatusOnTab(chromeRef, tab, requestedStatus) {
  let lastError = null;
  // Opening the current page can return before Alibaba mounts the second
  // status-control tree. Retry once in the same tab so the user does not
  // need to press “当前页打开并登录” a second time.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      let currentTab;
      try {
        currentTab = await chromeRef.tabs.get(tab.id);
      } catch {
        const failure = new Error("ALIBABA_TAB_REPLACED");
        failure.code = "ALIBABA_TAB_REPLACED";
        throw failure;
      }
      const currentUrl = String(currentTab?.url || tab?.url || "");
      if (/login\.taobao|\/login(?:[/?]|$)/i.test(currentUrl)) {
        const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
        failure.code = "ALIBABA_LOGIN_REQUIRED";
        throw failure;
      }
      if (isAlibabaVerificationUrl(currentUrl)) {
        const failure = new Error("请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。");
        failure.code = "ALIBABA_VERIFICATION_REQUIRED";
        throw failure;
      }
      if (currentUrl && !isAlibabaListPage(currentUrl)) {
        const failure = new Error("当前标签页不是目标阿里拍卖列表页。");
        failure.code = "ALIBABA_TARGET_MISMATCH";
        throw failure;
      }
      const statusSync = await executeCurrentTab(chromeRef, currentTab?.id || tab.id, synchronizeAlibabaAuctionStatus, [requestedStatus]);
      if (statusSync?.ok) return settleAlibabaAuctionStatus(chromeRef, tab, requestedStatus, statusSync);
      const failure = new Error(statusSync?.reason || "阿里页面拍卖状态同步失败");
      failure.code = statusSync?.errorCode || "ALIBABA_STATUS_READBACK_FAILED";
      lastError = failure;
    } catch (error) {
      if ([
        "ALIBABA_LOGIN_REQUIRED",
        "ALIBABA_VERIFICATION_REQUIRED",
        "ALIBABA_TAB_REPLACED",
        "ALIBABA_TARGET_MISMATCH",
        "ALIBABA_SCRIPT_EXECUTION_FAILED",
      ].includes(error?.code)) throw error;
      lastError = error;
    }
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
  throw lastError || new Error("ALIBABA_STATUS_READBACK_FAILED");
}

async function getCurrentBrowserTab(chromeRef) {
  const [tab] = await chromeRef.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("ALIBABA_CURRENT_TAB_UNAVAILABLE");
  return tab;
}

function alibabaUrlsReferToSamePage(actual, expected) {
  try {
    const current = new URL(String(actual || ""));
    const target = new URL(String(expected || ""));
    if (current.origin !== target.origin || current.pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, "")) return false;
    for (const [key, value] of target.searchParams.entries()) {
      if (key === "track_id") continue;
      if (current.searchParams.getAll(key).includes(value) === false) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function alibabaPageReady(value, expectedUrl, pageKind = "detail") {
  if (!value || directPageLooksBlocked(value)) return false;
  if (expectedUrl && !alibabaUrlsReferToSamePage(value.url, expectedUrl)) return false;
  const pageText = String(value.pageText || "").trim();
  if (!String(value.url || "").trim()) return false;
  if (pageKind === "list") return Array.isArray(value.items) && pageText.length >= 20;
  if (Object.prototype.hasOwnProperty.call(value, "detailContentReady") && value.detailContentReady !== true) return false;
  const detailIdentity = /阿里拍卖|拍卖标的|标的物|结束时间|成交价|拍下价|当前价|起拍价|本场已结束/.test(pageText);
  return Boolean(pageText.length >= 24 && detailIdentity);
}

async function resolveVerificationTab(chromeRef, tab, expectedUrl) {
  const isAlibabaTab = (candidate) => {
    try {
      return /(^|\.)taobao\.com$/i.test(new URL(candidate?.url || "").hostname);
    } catch {
      return false;
    }
  };
  const matchesExpectedOrVerification = (candidate) => candidate?.id && (
    alibabaUrlsReferToSamePage(candidate.url, expectedUrl)
    || isAlibabaVerificationUrl(candidate.url)
  );
  let activeTabs = [];
  try {
    activeTabs = await chromeRef.tabs.query({ active: true, lastFocusedWindow: true }) || [];
  } catch {
    activeTabs = [];
  }
  const activeMatch = activeTabs.find(matchesExpectedOrVerification);
  if (activeMatch) return activeMatch;
  let originalTab = null;
  if (tab?.id) {
    try {
      originalTab = await chromeRef.tabs.get(tab.id);
      if (matchesExpectedOrVerification(originalTab)) return originalTab;
      if (isAlibabaTab(originalTab)) return originalTab;
    } catch {
      // The original tab may have been replaced during verification.
    }
  }
  const activeAlibabaTab = activeTabs.find((candidate) => candidate?.id && isAlibabaTab(candidate));
  if (activeAlibabaTab) return activeAlibabaTab;
  try {
    const windowTabs = await chromeRef.tabs.query({ lastFocusedWindow: true }) || [];
    const windowMatch = windowTabs.find(matchesExpectedOrVerification);
    if (windowMatch) return windowMatch;
  } catch {
    // The caller will distinguish a destroyed tab from a target mismatch.
  }
  return null;
}

async function restoreAlibabaTargetTab(chromeRef, tab, expectedUrl) {
  if (!tab?.id || !expectedUrl || alibabaUrlsReferToSamePage(tab.url, expectedUrl)) return tab;
  try {
    await chromeRef.tabs.update(tab.id, { active: true, url: expectedUrl });
    return await chromeRef.tabs.get(tab.id);
  } catch {
    const failure = new Error("ALIBABA_TAB_REPLACED");
    failure.code = "ALIBABA_TAB_REPLACED";
    throw failure;
  }
}

async function waitForManualVerification(context, tab, extractor, emit, description, control, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, options.timeoutMs) : MANUAL_VERIFICATION_TIMEOUT_MS;
  const pollIntervalMs = Number.isFinite(options.pollIntervalMs) ? Math.max(1, options.pollIntervalMs) : 1200;
  const expectedUrl = String(options.expectedUrl || tab?.url || "");
  const pageKind = options.pageKind || "detail";
  let currentTab = tab;
  let waitState = isAlibabaVerificationUrl(currentTab?.url) ? "verification" : "page_loading";
  while (Date.now() - startedAt < timeoutMs) {
    await waitForRunResume(control, emit);
    const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    emit({
      phase: waitState === "verification" ? "verification_required" : waitState === "detail_loading" ? "loading_detail" : "opening",
      percent: 35,
      message: verificationWaitMessage(waitState, pageKind, description, elapsedSeconds),
    });
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    currentTab = await resolveVerificationTab(context.chrome, currentTab, expectedUrl);
    if (!currentTab?.id) {
      const failure = new Error("ALIBABA_TAB_REPLACED");
      failure.code = "ALIBABA_TAB_REPLACED";
      throw failure;
    }
    try {
      const current = await executeCurrentTab(context.chrome, currentTab.id, extractor);
      const blocked = directPageLooksBlocked(current);
      if (blocked === "ALIBABA_LOGIN_REQUIRED") {
        const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
        failure.code = blocked;
        throw failure;
      }
      if (blocked === "ALIBABA_VERIFICATION_REQUIRED") {
        waitState = "verification";
        continue;
      }
      if (!directPageLooksBlocked(current) && expectedUrl && !alibabaUrlsReferToSamePage(current.url, expectedUrl)) {
        waitState = "navigation";
        currentTab = await restoreAlibabaTargetTab(context.chrome, currentTab, expectedUrl);
        continue;
      }
      if (alibabaPageReady(current, expectedUrl, pageKind)) return { value: current, tab: currentTab };
      waitState = pageWaitState(current, expectedUrl, pageKind);
    } catch (error) {
      if (error?.code === "ALIBABA_LOGIN_REQUIRED" || error?.code === "ALIBABA_SCRIPT_EXECUTION_FAILED") throw error;
      throw error;
    }
  }
  const timeout = new Error("ALIBABA_VERIFICATION_TIMEOUT");
  timeout.code = "ALIBABA_VERIFICATION_TIMEOUT";
  throw timeout;
}

async function readAlibabaPageWithManualVerification(context, tab, extractor, emit, description, control, options = {}) {
  const expectedUrl = String(options.expectedUrl || tab?.url || "");
  const pageKind = options.pageKind || "detail";
  const currentTab = await resolveVerificationTab(context.chrome, tab, expectedUrl);
  if (!currentTab?.id) {
    const failure = new Error("ALIBABA_TAB_REPLACED");
    failure.code = "ALIBABA_TAB_REPLACED";
    throw failure;
  }
  if (/login\.taobao\.com|\/login(?:[/?]|$)/i.test(String(currentTab?.url || ""))) {
    const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
    failure.code = "ALIBABA_LOGIN_REQUIRED";
    throw failure;
  }
  if (isAlibabaVerificationUrl(currentTab?.url)) {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  let value;
  try {
    value = await executeCurrentTab(context.chrome, currentTab.id, extractor);
  } catch (error) {
    const latestTab = await resolveVerificationTab(context.chrome, currentTab, expectedUrl);
    if (latestTab && isAlibabaVerificationUrl(latestTab.url)) {
      return waitForManualVerification(context, latestTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
    }
    throw error;
  }
  const blocked = directPageLooksBlocked(value);
  if (blocked === "ALIBABA_LOGIN_REQUIRED") {
    const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
    failure.code = blocked;
    throw failure;
  }
  if (blocked === "ALIBABA_VERIFICATION_REQUIRED") {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  if (!alibabaPageReady(value, expectedUrl, pageKind)) {
    return waitForManualVerification(context, currentTab, extractor, emit, description, control, { ...options, expectedUrl, pageKind });
  }
  return { value, tab: currentTab };
}

async function runCurrentTabScrape(context, request, emit = () => {}, control = null) {
  const chromeRef = context.chrome;
  let tab = await getCurrentBrowserTab(chromeRef);
  let historyCandidates = [];
  if (request.historyPath) {
    try {
      const history = await context.sendNativeMessage({ action: "load_alibaba_auction_history", path: request.historyPath }, 30000);
      if (!history?.ok) throw new Error(history?.reason || "ALIBABA_HISTORY_LOAD_FAILED");
      historyCandidates = (Array.isArray(history.results) ? history.results : [])
        .map((item) => ({ url: directCanonicalUrl(item?.url), title: String(item?.title || "").trim() }))
        .filter((item) => item.url);
      if (!historyCandidates.length) throw new Error("ALIBABA_HISTORY_ITEMS_EMPTY");
    } catch (error) {
      return { ok: false, phase: "failed", errorCode: error?.code || "ALIBABA_HISTORY_LOAD_FAILED", reason: error?.message || String(error), candidates: 0, results: [], security: { credentialsReturned: false } };
    }
  }
  const currentListMatchesRequest = listPageMatchesRequest(tab.url, request);
  const zcEntry = request.entry === "zc";
  const listExtractor = zcEntry ? extractZcAuctionListPage : extractAlibabaListPage;
  let listSourceUrl = currentListMatchesRequest ? tab.url : directListPageUrl(request.sourceUrl, 1);
  let firstPage = 1;
  try {
    const currentPage = Number(new URL(listSourceUrl).searchParams.get("page"));
    if (Number.isInteger(currentPage) && currentPage > 0) firstPage = currentPage;
  } catch {
    // The fallback source URL is validated by the navigation path below.
  }
  const candidates = [];
  const seen = new Set();
  let prefiltered = 0;
  const progress = (payload) => emit({ security: { credentialsReturned: false }, ...payload });
  progress({ phase: "opening", percent: 2, message: isAlibabaListPage(tab.url) ? (zcEntry ? "正在读取当前阿里资产出售筛选结果…" : "正在读取当前阿里拍卖筛选结果…") : (zcEntry ? "正在当前浏览器打开阿里资产搜索列表页…" : "正在当前浏览器打开阿里拍卖列表页…"), fetched: 0, verified: 0, skipped: 0 });

  for (let page = firstPage; page < firstPage + MAX_DIRECT_PAGES && !historyCandidates.length; page += 1) {
    try {
      await waitForRunResume(control, progress);
      if (control) control.percent = Math.min(35, 5 + Math.round(((page - firstPage + 1) / MAX_DIRECT_PAGES) * 30));
      if (page !== firstPage || !listPageMatchesRequest(tab.url, request)) {
        tab = await navigateCurrentTab(chromeRef, tab, directListPageUrl(listSourceUrl, page));
      }
      const expectedListUrl = directListPageUrl(listSourceUrl, page);
      let listRead = await readAlibabaPageWithManualVerification(context, tab, listExtractor, progress, "读取列表", control, { expectedUrl: expectedListUrl, pageKind: "list" });
      tab = listRead.tab;
      let extracted = listRead.value;
      let blocked = directPageLooksBlocked(extracted);
      if (blocked) throw new Error(blocked);
      // 阿里资产入口的状态筛选走 URL（statusOrders），页面没有可同步的状态控件。
      if (!zcEntry) {
        progress({
          phase: "syncing_filters",
          percent: Math.min(35, 8 + Math.round(((page - firstPage + 1) / MAX_DIRECT_PAGES) * 27)),
          message: `正在同步阿里页面“拍卖状态”：${request.status === "finished" ? "已结束" : "全部状态"}…`,
          page,
          pages: MAX_DIRECT_PAGES,
          fetched: 0,
          verified: 0,
          skipped: prefiltered,
        });
        const settled = await synchronizeAlibabaAuctionStatusOnTab(chromeRef, tab, request.status);
        const statusSync = settled.statusSync;
        if (statusSync.changed) {
          tab = settled.tab;
          listRead = await readAlibabaPageWithManualVerification(context, tab, listExtractor, progress, "读取同步后的列表", control, { expectedUrl: tab.url, pageKind: "list" });
          tab = listRead.tab;
          extracted = listRead.value;
          blocked = directPageLooksBlocked(extracted);
          if (blocked) throw new Error(blocked);
        }
      }
      const pageItems = Array.isArray(extracted.items) ? extracted.items : [];
      let newItems = 0;
      for (const item of pageItems) {
        const url = directCanonicalUrl(item.href);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        newItems += 1;
        if (!directCandidateInScope(item, request)) {
          prefiltered += 1;
          continue;
        }
        candidates.push({
          url,
          title: String(item.text || "").split("\n")[0].trim(),
          listedAmount: String(item.listedAmount || ""),
          listedBidCount: Number(item.listedBidCount || 0),
          listedHasEndedText: item.listedHasEndedText === true,
          listedHasExplicitSoldPrice: item.listedHasExplicitSoldPrice === true,
        });
      }
      progress({
        phase: "listing",
        percent: Math.min(35, 5 + Math.round(((page - firstPage + 1) / MAX_DIRECT_PAGES) * 30)),
        message: `已读取当前筛选结果第 ${page} 页，共发现 ${candidates.length} 条页面记录，准备详情核验…`,
        page,
        pages: MAX_DIRECT_PAGES,
        fetched: candidates.length,
        verified: 0,
        skipped: prefiltered,
      });
      if (directPageBeforeRequestedRange(pageItems, request)) {
        progress({
          phase: "listing",
          percent: Math.min(35, 5 + Math.round(((page - firstPage + 1) / MAX_DIRECT_PAGES) * 30)),
          message: `第 ${page} 页日期已早于所选起始日，停止继续翻页。`,
          page,
          pages: MAX_DIRECT_PAGES,
          fetched: candidates.length,
          verified: 0,
          skipped: prefiltered,
        });
        break;
      }
      if (!pageItems.length || newItems === 0) break;
    } catch (error) {
      const reason = String(error?.message || error);
      const errorCode = String(error?.code || (reason === "ALIBABA_SCRAPE_STOPPED" ? reason : "ALIBABA_SCRAPE_FAILED"));
      return { ok: false, phase: reason === "ALIBABA_SCRAPE_STOPPED" ? "stopped" : "failed", errorCode, reason, stopped: reason === "ALIBABA_SCRAPE_STOPPED", candidates: candidates.length, results: [], security: { credentialsReturned: false } };
    }
  }

  if (historyCandidates.length) {
    candidates.push(...historyCandidates);
    progress({ phase: "history_loaded", percent: 12, message: `已加载历史清单 ${candidates.length} 条，准备重新读取详情…`, fetched: candidates.length, verified: 0, skipped: 0 });
  }

  if (!candidates.length) {
    return { ok: false, phase: "failed", errorCode: "ALIBABA_LIST_EMPTY", reason: prefiltered ? "当前列表记录均不在所选交易状态或日期范围内。" : "当前浏览器页面未读取到阿里拍卖候选记录。请确认已登录且没有出现验证页。", candidates: 0, results: [], skipped: prefiltered, security: { credentialsReturned: false } };
  }

  const results = [];
  const skippedReasons = [];
  let skipped = prefiltered;
  for (const [index, candidate] of candidates.entries()) {
    try {
      await waitForRunResume(control, progress);
      if (control) control.percent = Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63));
      tab = await navigateCurrentTab(chromeRef, tab, candidate.url);
      const detailRead = await readAlibabaPageWithManualVerification(context, tab, extractAlibabaDetailPage, progress, "核验当前详情", control, { expectedUrl: candidate.url, pageKind: "detail" });
      tab = detailRead.tab;
      let detail = detailRead.value;
      let blocked = directPageLooksBlocked(detail);
      if (blocked) throw new Error(blocked);
      const detailFloors = directExtractFloorFieldsFromText(detail.pageText);
      const hasLowConfidenceFields = detail.fieldSources?.buildingArea !== "structured"
        || detail.fieldSources?.floor !== "structured"
        || detail.fieldSources?.totalFloors !== "structured";
      const needsAttachmentFields = hasLowConfidenceFields
        || !directParseAmount(detail.buildingArea)
        || !detailFloors.floor
        || !detailFloors.totalFloors;
      if (needsAttachmentFields && Array.isArray(detail.attachments) && detail.attachments.length) {
        progress({
          phase: "reading_attachments",
          percent: Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63)),
          message: "详情页字段不完整，正在读取评估报告附件，必要时进行 OCR 补充建筑面积和楼层…",
          fetched: candidates.length,
          verified: results.length,
          skipped,
          current: detail.title || candidate.title,
        });
        try {
          const fetchedAttachments = await fetchAlibabaAttachmentBuffersFromBrowser(chromeRef, detail.attachments);
          const usableAttachments = (Array.isArray(fetchedAttachments) ? fetchedAttachments : [])
            .filter((item) => String(item?.base64 || "").trim())
            .slice(0, 3);
          if (usableAttachments.length) {
            const enriched = await context.sendNativeMessage({
              action: "enrich_alibaba_auction_detail",
              detail,
              attachments: usableAttachments,
            }, 180000);
            if (enriched?.ok && enriched.detail) detail = { ...detail, ...enriched.detail };
          }
        } catch {
          // Keep the detail-page result when an optional report/OCR read fails.
        }
      }
      const detailWithListingEvidence = directMergeListingEvidence(detail, candidate);
      const parsed = directParseDetail(detailWithListingEvidence, request);
      const accepted = parsed.valid && directMatchesRequest(parsed, request);
      if (accepted) results.push(parsed);
      else {
        skipped += 1;
        skippedReasons.push({
          title: parsed.title || candidate.title,
          url: candidate.url,
          reason: directSkipReason(detailWithListingEvidence, parsed, request),
          diagnostics: {
            transactionAmount: parsed.transactionAmount || null,
            transactionTime: parsed.transactionTime || "",
            bidCount: Number(parsed.bidCount || 0),
            hasExplicitSoldPrice: detailWithListingEvidence.hasExplicitSoldPrice === true,
            hasEndedText: detailWithListingEvidence.hasEndedText === true,
            valid: parsed.valid === true,
            matched: directMatchesRequest(parsed, request),
          },
        });
      }
      progress({
        phase: "verifying",
        percent: Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63)),
        message: accepted ? `已核验成交案例 ${results.length} 条。` : `已跳过记录 ${skipped} 条：${skippedReasons.at(-1)?.reason || "未通过核验"}。`,
        fetched: candidates.length,
        verified: results.length,
        skipped,
        current: parsed.title || candidate.title,
      });
    } catch (error) {
      const reason = String(error?.message || error);
      const errorCode = String(error?.code || reason);
      if (errorCode === "ALIBABA_SCRAPE_STOPPED") {
        return { ok: false, phase: "stopped", errorCode, reason, stopped: true, candidates: candidates.length, results, skipped, security: { credentialsReturned: false } };
      }
      if (["ALIBABA_LOGIN_REQUIRED", "ALIBABA_VERIFICATION_REQUIRED", "ALIBABA_VERIFICATION_TIMEOUT", "ALIBABA_TAB_REPLACED", "ALIBABA_TARGET_MISMATCH", "ALIBABA_SCRIPT_EXECUTION_FAILED"].includes(errorCode)) {
        const message = errorCode === "ALIBABA_LOGIN_REQUIRED"
          ? "请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。"
          : errorCode === "ALIBABA_VERIFICATION_REQUIRED" || errorCode === "ALIBABA_VERIFICATION_TIMEOUT"
            ? "请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。"
            : reason;
        return { ok: false, phase: "failed", errorCode, reason: message, candidates: candidates.length, results, skipped, security: { credentialsReturned: false } };
      }
      skipped += 1;
      progress({ phase: "verifying", percent: Math.min(98, 35 + Math.round(((index + 1) / candidates.length) * 63)), message: `详情读取失败，已跳过 ${skipped} 条。`, fetched: candidates.length, verified: results.length, skipped, current: candidate.title });
    }
  }

  if (control) control.percent = 99;
  progress(resultGenerationProgress(results, request, {
    fetched: candidates.length,
    verified: results.length,
    skipped,
  }));
  const saved = await context.sendNativeMessage({
    action: "write_alibaba_auction_result",
    request,
    results,
    candidates: candidates.length,
    skipped,
  }, 180000);
  const finalizedAfterStop = Boolean(control?.stopped);
  return {
    ok: !finalizedAfterStop && results.length > 0 && saved?.ok !== false,
    phase: finalizedAfterStop ? "stopped" : "completed",
    stopped: finalizedAfterStop,
    finalized: finalizedAfterStop,
    errorCode: results.length ? "" : "ALIBABA_NO_VALID_CASES",
    reason: finalizedAfterStop
      ? "本地结果写入完成，抓取已终止。"
      : results.length
        ? "阿里拍卖成交案例已完成详情核验。"
        : skippedReasons.length
          ? `候选记录中没有找到详情页可确认的成交案例。首条跳过原因：${skippedReasons[0].reason}。`
          : "候选记录中没有找到详情页可确认的成交案例。",
    candidates: candidates.length,
    results: Array.isArray(saved?.results) ? saved.results : results,
    htmlPath: String(saved?.htmlPath || ""),
    mapPath: String(saved?.mapPath || ""),
    historyPath: String(saved?.historyPath || ""),
    skipped,
    skippedReasons: skippedReasons.slice(-20),
    geocodeRequested: Number(saved?.geocodeRequested || 0),
    geocodeCacheHits: Number(saved?.geocodeCacheHits || 0),
    geocodeResolved: Number(saved?.geocodeResolved || 0),
    geocodeFailed: Number(saved?.geocodeFailed || 0),
    geocodeTimedOut: Number(saved?.geocodeTimedOut || 0),
    geocodeDurationMs: Number(saved?.geocodeDurationMs || 0),
    security: { credentialsReturned: false },
  };
}

export const alibabaAuctionModule = {
  manifest: {
    id: "alibaba-auction",
    type: "feature",
    stage: "stable",
    route: "alibaba-auction",
    displayName: "阿里司法拍卖",
    messageNamespace: "alibaba-auction",
    entryElementId: "openAlibabaAuction",
    pageElementId: "page-alibaba-auction",
    storageVersion: 1,
    usesLegacyScope: false,
    scope: { companies: false, subjects: false },
  },

  create() {
    let context;
    let elements;
    let config = { ...DEFAULT_CONFIG };
    let appliedConfig = null;
    let results = [];
    let htmlPath = "";
    let excelPath = "";
    let mapPath = "";
    let running = false;
    let opening = false;
    let exporting = false;
    let runControl = null;
    let historyCatalog = [];
    let historyCanRefresh = false;
    let progressState = { phase: "idle", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "等待开始" };

    function storageState() {
      return {
        ...config,
        parameterSnapshot: appliedConfig ? { ...appliedConfig } : null,
        results,
        htmlPath,
        excelPath,
        mapPath,
      };
    }

    function parametersApplied() {
      return Boolean(appliedConfig) && parameterSnapshotMatches(config, appliedConfig);
    }

    function renderParameterState() {
      const state = elements?.alibabaAuctionParameterState;
      if (!state) return;
      const applied = parametersApplied();
      state.textContent = applied ? "参数已应用" : "参数有改动，需重新应用";
      state.dataset.kind = applied ? "ok" : "warn";
    }

    function readConfig() {
      return normalizeConfig({
        provinceCode: elements.alibabaAuctionProvince.value,
        cityCode: elements.alibabaAuctionCity.value,
        districtCode: elements.alibabaAuctionDistrict.value,
        entry: elements.alibabaAuctionEntry.value,
        propertyType: elements.alibabaAuctionPropertyType.value,
        status: elements.alibabaAuctionStatus.value,
        keyword: elements.alibabaAuctionKeyword.value,
        startDate: elements.alibabaAuctionStartDate.value,
        endDate: elements.alibabaAuctionEndDate.value,
        outputDirectory: elements.alibabaAuctionOutputDirectory.value,
        generateMap: elements.alibabaAuctionGenerateMap.checked,
      });
    }

    function renderConfig() {
      renderRegionOptions();
      elements.alibabaAuctionEntry.value = config.entry;
      elements.alibabaAuctionPropertyType.value = config.propertyType;
      elements.alibabaAuctionStatus.value = config.status;
      elements.alibabaAuctionKeyword.value = config.keyword;
      elements.alibabaAuctionStartDate.value = config.startDate;
      elements.alibabaAuctionEndDate.value = config.endDate;
      elements.alibabaAuctionOutputDirectory.value = config.outputDirectory;
      elements.alibabaAuctionGenerateMap.checked = Boolean(config.generateMap);
      elements.alibabaAuctionSourceUrl.value = buildSourceUrl(config);
      elements.alibabaAuctionHistoryDirectory.value = config.historyDirectory || config.outputDirectory || "";
      elements.alibabaAuctionRefreshHistory.checked = config.historyRefresh !== false;
      renderHistoryOptions();
      if (!running) elements.runAlibabaAuctionHistory.disabled = !config.historyPath || !historyCanRefresh;
      renderParameterState();
    }

    function renderHistoryOptions() {
      const select = elements?.alibabaAuctionHistorySelect;
      if (!select) return;
      const selected = config.historyPath || "";
      select.innerHTML = `<option value="">请选择历史抓取清单</option>${historyCatalog.map((item) => `<option value="${escapeHtml(item.path)}">${escapeHtml(item.label || item.name || item.path)}</option>`).join("")}`;
      select.value = historyCatalog.some((item) => item.path === selected) ? selected : "";
    }

    function renderRegionOptions() {
      const province = elements.alibabaAuctionProvince;
      const city = elements.alibabaAuctionCity;
      const district = elements.alibabaAuctionDistrict;
      province.innerHTML = ALIBABA_REGION_CATALOG
        .map((item) => `<option value="${item.code}">${item.name}</option>`)
        .join("");
      province.value = config.provinceCode;
      const provinceRegion = ALIBABA_REGION_CATALOG.find((item) => item.code === config.provinceCode);
      const cities = provinceRegion?.children || [];
      city.innerHTML = `<option value="">全省</option>${cities.map((item) => `<option value="${item.code}">${item.name}</option>`).join("")}`;
      city.value = config.cityCode;
      const cityRegion = cities.find((item) => item.code === config.cityCode);
      const districts = usableDistricts(cityRegion);
      district.innerHTML = `<option value="">${cityRegion ? "不限定区县" : "请先选择城市"}</option>${districts.map((item) => `<option value="${item.code}">${item.name}</option>`).join("")}`;
      district.disabled = !cityRegion || !districts.length;
      district.value = config.districtCode;
    }

    function syncConfigFromInputs() {
      config = readConfig();
      renderConfig();
      if (!parametersApplied()) setMessage(elements.alibabaAuctionParameterMessage, "参数有改动，需重新应用。", "warn");
    }

    function markConfigDirtyFromInputs() {
      config = readConfig();
      renderParameterState();
      if (!parametersApplied()) setMessage(elements.alibabaAuctionParameterMessage, "参数有改动，需重新应用。", "warn");
    }

    function renderResults() {
      elements.alibabaAuctionResultCount.textContent = `${results.length} 条`;
      elements.clearAlibabaAuctionResults.disabled = !results.length;
      elements.openAlibabaAuctionResult.disabled = !htmlPath;
      elements.exportAlibabaAuctionExcel.disabled = !results.length || running || exporting;
      elements.openAlibabaAuctionExcel.disabled = !excelPath;
      elements.openAlibabaAuctionMap.disabled = !mapPath;
      if (!running) {
        elements.alibabaAuctionResultStatus.textContent = htmlPath && excelPath && mapPath
          ? "结果页、Excel 和地图已生成，可在普通应用中打开。"
          : htmlPath && excelPath
            ? "结果页和 Excel 已生成，可在普通应用中打开。"
          : htmlPath
            ? "结果页已生成，可在普通浏览器中打开；需要表格时点击“导出 Excel”。"
            : "尚未读取结果";
      }
    }

    function renderProgress(payload = {}) {
      progressState = { ...progressState, ...payload };
      const percent = Math.max(0, Math.min(100, Number(progressState.percent || 0)));
      const phaseLabels = {
        idle: "等待开始",
        opening: "正在打开页面",
        listing: "正在读取列表",
        syncing_filters: "正在同步页面筛选",
        verifying: "正在核验详情",
        generating_results: "正在生成结果页",
        locating_coordinates: "正在定位坐标并生成地图",
        loading_detail: "正在等待详情加载",
        verification_required: "等待人工验证",
        paused: "已暂停",
        stopped: "已终止",
        completed: "抓取完成",
        failed: "抓取失败",
      };
      elements.alibabaAuctionProgressPhase.textContent = phaseLabels[progressState.phase] || "正在处理";
      elements.alibabaAuctionProgressPercent.textContent = `${percent}%`;
      elements.alibabaAuctionProgressBar.style.width = `${percent}%`;
      elements.alibabaAuctionProgressBar.parentElement.setAttribute("aria-valuenow", String(percent));
      elements.alibabaAuctionProgressFetched.textContent = String(progressState.fetched ?? 0);
      elements.alibabaAuctionProgressVerified.textContent = String(progressState.verified ?? 0);
      elements.alibabaAuctionProgressSkipped.textContent = String(progressState.skipped ?? 0);
      if (progressState.message) elements.alibabaAuctionResultStatus.textContent = progressState.message;
      if (running && progressState.fetched !== undefined) {
        elements.alibabaAuctionResultCount.textContent = `${progressState.fetched} 条页面记录`;
      }
    }

    function localPathToFileUrl(value) {
      const normalized = String(value || "").trim().replace(/\\/g, "/");
      if (!normalized) return "";
      if (/^file:\/\//i.test(normalized)) return normalized;
      const encoded = normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/");
      return normalized.startsWith("/") ? `file://${encoded}` : `file:///${encoded}`;
    }

    async function openResultOrMapInCurrentBrowserTab(targetPath, label) {
      const result = await context.sendNativeMessage({
        action: "open_alibaba_auction_path",
        path: targetPath,
        outputDirectory: config.outputDirectory,
        openInCurrentBrowserTab: true,
      }, 15000);
      if (!result?.ok || !result.path) throw new Error(result?.reason || `${label}打开失败`);
      const url = localPathToFileUrl(result.path);
      if (!url) throw new Error(`${label}路径无效`);
      await context.chrome.tabs.create({ url, active: true });
    }

    async function openResultPage() {
      if (!htmlPath) return;
      try {
        await openResultOrMapInCurrentBrowserTab(htmlPath, "结果页");
        setMessage(elements.alibabaAuctionResultMessage, "已在当前浏览器新标签页打开结果页。", "ok");
        context.setStatus("阿里拍卖结果页已在当前浏览器打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `结果页打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里拍卖结果页打开失败", "error");
      }
    }

    async function openExcel() {
      if (!excelPath) return;
      try {
        const result = await context.sendNativeMessage({ action: "open_alibaba_auction_path", path: excelPath, outputDirectory: config.outputDirectory }, 15000);
        if (!result?.ok) throw new Error(result?.reason || "打开 Excel 失败");
        setMessage(elements.alibabaAuctionResultMessage, "已打开本机 Excel 导出文件。", "ok");
        context.setStatus("阿里拍卖 Excel 已打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `Excel 打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里拍卖 Excel 打开失败", "error");
      }
    }

    async function openMap() {
      if (!mapPath) return;
      try {
        await openResultOrMapInCurrentBrowserTab(mapPath, "地图");
        setMessage(elements.alibabaAuctionResultMessage, "已在当前浏览器新标签页打开地图。", "ok");
        context.setStatus("阿里拍卖地图已在当前浏览器打开", "ok");
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `地图打开失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里拍卖地图打开失败", "error");
      }
    }

    async function exportExcel() {
      if (exporting || running || !results.length) return;
      const requestConfig = requireAppliedParameters();
      if (!requestConfig) return;
      exporting = true;
      renderResults();
      setMessage(elements.alibabaAuctionResultMessage, "正在生成 Excel，并回读校验文件内容…", "warn");
      context.setStatus("正在导出阿里拍卖 Excel", "busy");
      try {
        const result = await context.sendNativeMessage({
          action: "write_alibaba_auction_excel",
          request: { ...requestConfig, sourceUrl: buildSourceUrl(requestConfig) },
          results,
          candidates: results.length,
        }, 180000);
        if (!result?.ok || !result.excelPath) throw new Error(result?.reason || "ALIBABA_EXCEL_EXPORT_FAILED");
        excelPath = String(result.excelPath).trim();
        await context.storage.save(storageState());
        renderResults();
        setMessage(elements.alibabaAuctionResultMessage, `Excel 已导出并完成校验，共 ${result.rowCount || results.length} 条；点击“打开 Excel”查看。`, "ok");
        context.setStatus("阿里拍卖 Excel 导出完成", "ok");
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `Excel 导出失败：${error?.message || String(error)}`, "error");
        context.setStatus("阿里拍卖 Excel 导出失败", "error");
      } finally {
        exporting = false;
        renderResults();
      }
    }

    function requireAppliedParameters(options = {}) {
      config = readConfig();
      renderParameterState();
      if (!parametersApplied()) {
        const reason = appliedConfig ? "参数有改动，需重新应用。" : "请先点击“确认并应用参数”，再继续。";
        setMessage(elements.alibabaAuctionParameterMessage, reason, "warn");
        context.setStatus("阿里司法拍卖参数尚未应用", "warn");
        return null;
      }
      const request = { ...appliedConfig };
      if (options.requireOutput !== false && !request.outputDirectory) {
        setMessage(elements.alibabaAuctionParameterMessage, "请先选择本机输出目录，再开始网络抓取。", "warn");
        context.setStatus("阿里司法拍卖尚未选择输出目录", "warn");
        return null;
      }
      return request;
    }

    async function applyParameters() {
      const nextConfig = readConfig();
      if (!nextConfig.outputDirectory) {
        setMessage(elements.alibabaAuctionParameterMessage, "请先选择本机输出目录。", "warn");
        return false;
      }
      if (nextConfig.startDate && nextConfig.endDate && nextConfig.startDate > nextConfig.endDate) {
        setMessage(elements.alibabaAuctionParameterMessage, "成交时间起不能晚于成交时间止。", "error");
        return false;
      }
      config = nextConfig;
      appliedConfig = { ...nextConfig };
      await context.storage.save(storageState());
      renderConfig();
      setMessage(elements.alibabaAuctionParameterMessage, "参数已应用。", "ok");
      context.setStatus("阿里司法拍卖参数已应用", "ok");
      return true;
    }

    async function chooseOutputDirectory() {
      try {
        const result = await context.sendNativeMessage({ action: "select_alibaba_auction_output_directory" }, 130000);
        const selected = result?.outputDirectory || result?.path || result?.paths?.[0] || "";
        if (!result?.ok || !selected) {
          if (!result?.cancelled) setMessage(elements.alibabaAuctionParameterMessage, result?.reason || "未选择输出目录", "warn");
          return;
        }
        config.outputDirectory = selected;
        if (!config.historyDirectory) config.historyDirectory = selected;
        elements.alibabaAuctionOutputDirectory.value = selected;
        renderConfig();
        await context.storage.save(storageState());
        const folderMessage = result.directoryName
          ? `${result.createdDirectory === false ? "已选择" : "已创建并选择"}专用子文件夹：${result.directoryName}`
          : "输出目录已选择";
        const parameterMessage = parametersApplied() ? "" : "参数有改动，需重新应用。";
        setMessage(elements.alibabaAuctionParameterMessage, `${folderMessage}，结果页、Excel 和地图会保存到这里。${parameterMessage}`, parametersApplied() ? "ok" : "warn");
      } catch (error) {
        setMessage(elements.alibabaAuctionParameterMessage, `选择目录失败：${error?.message || String(error)}`, "error");
      }
    }

    function pathDirectory(value) {
      const raw = String(value || "");
      const index = Math.max(raw.lastIndexOf("/"), raw.lastIndexOf("\\"));
      return index > 0 ? raw.slice(0, index) : raw;
    }

    async function chooseHistoryDirectory() {
      try {
        const result = await context.sendNativeMessage({ action: "select_alibaba_auction_history_directory" }, 130000);
        const selected = result?.path || result?.paths?.[0] || "";
        if (!result?.ok || !selected) {
          if (!result?.cancelled) setMessage(elements.alibabaAuctionResultMessage, result?.reason || "未选择历史数据目录", "warn");
          return;
        }
        config.historyDirectory = selected;
        config.historyPath = "";
        historyCatalog = [];
        historyCanRefresh = false;
        renderConfig();
        await context.storage.save(storageState());
        await loadHistoryCatalog();
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `选择历史目录失败：${error?.message || String(error)}`, "error");
      }
    }

    async function loadHistoryCatalog() {
      const directory = elements.alibabaAuctionHistoryDirectory.value.trim() || config.historyDirectory || config.outputDirectory;
      if (!directory) {
        setMessage(elements.alibabaAuctionResultMessage, "请先选择历史数据目录", "warn");
        return;
      }
      try {
        const result = await context.sendNativeMessage({ action: "list_alibaba_auction_history", directory }, 30000);
        if (!result?.ok) throw new Error(result?.reason || "ALIBABA_HISTORY_LIST_FAILED");
        historyCatalog = Array.isArray(result.items) ? result.items : [];
        config.historyDirectory = directory;
        const selected = historyCatalog.find((item) => item.path === config.historyPath);
        historyCanRefresh = Boolean(selected?.canRefresh);
        renderHistoryOptions();
        elements.alibabaAuctionHistoryStatus.textContent = historyCatalog.length ? `已找到 ${historyCatalog.length} 份历史数据，可选择后加载。` : "当前目录未找到历史清单或 Excel 结果。";
        elements.alibabaAuctionHistoryStatus.dataset.kind = historyCatalog.length ? "ok" : "warn";
        await context.storage.save(storageState());
      } catch (error) {
        historyCatalog = [];
        renderHistoryOptions();
        elements.alibabaAuctionHistoryStatus.textContent = `历史清单加载失败：${error?.message || String(error)}`;
        elements.alibabaAuctionHistoryStatus.dataset.kind = "error";
      }
    }

    async function loadHistorySelection() {
      const historyPath = elements.alibabaAuctionHistorySelect.value.trim();
      if (!historyPath) {
        setMessage(elements.alibabaAuctionResultMessage, "请先选择历史抓取清单", "warn");
        return;
      }
      try {
        const result = await context.sendNativeMessage({ action: "load_alibaba_auction_history", path: historyPath }, 30000);
        if (!result?.ok) throw new Error(result?.reason || "ALIBABA_HISTORY_LOAD_FAILED");
        results = Array.isArray(result.results) ? result.results : [];
        htmlPath = String(result.htmlPath || "").trim();
        excelPath = String(result.excelPath || "").trim();
        mapPath = String(result.mapPath || "").trim();
        historyCanRefresh = result.canRefresh === true;
        config = normalizeConfig({ ...config, ...(result.request || {}), outputDirectory: result.outputDirectory || config.outputDirectory, historyDirectory: pathDirectory(historyPath), historyPath, historyRefresh: historyCanRefresh && elements.alibabaAuctionRefreshHistory.checked });
        appliedConfig = { ...config };
        renderConfig();
        setResultButtons(result);
        renderProgress({ phase: "completed", percent: 100, fetched: result.recordCount || results.length, verified: results.length, skipped: 0, message: `已加载历史数据：${results.length} 条` });
        setMessage(elements.alibabaAuctionResultMessage, "已加载历史结果；当前操作不会访问网络。需要更新详情时，请在历史数据区勾选并点击“重新抓取历史详情”。", "ok");
        await context.storage.save(storageState());
      } catch (error) {
        setMessage(elements.alibabaAuctionResultMessage, `历史数据加载失败：${error?.message || String(error)}`, "error");
      }
    }

    async function openSource() {
      if (opening || running) return;
      opening = true;
      elements.openAlibabaAuctionSource.disabled = true;
      try {
        const requestConfig = requireAppliedParameters({ requireOutput: true });
        if (!requestConfig) return;
        let tab = await getCurrentBrowserTab(context.chrome);
        tab = await navigateCurrentTab(context.chrome, tab, buildSourceUrl(requestConfig));
        if (requestConfig.entry !== "zc") {
          const settled = await synchronizeAlibabaAuctionStatusOnTab(context.chrome, tab, requestConfig.status);
          tab = settled.tab;
        }
        setMessage(elements.alibabaAuctionParameterMessage, requestConfig.entry === "zc"
          ? "已打开阿里资产搜索列表页（出售）。等待结果加载完成后即可开始抓取。"
          : `已打开阿里拍卖列表页，并同步“拍卖状态”为${requestConfig.status === "finished" ? "已结束" : "全部状态"}。等待结果加载完成后即可开始抓取。`, "ok");
        context.setStatus("阿里拍卖检索页已在当前浏览器打开", "ok");
      } catch (error) {
        const errorCode = error?.code && error.code !== error?.message ? `${error.code}：` : "";
        setMessage(elements.alibabaAuctionParameterMessage, `当前浏览器打开失败：${errorCode}${error?.message || String(error)}`, "error");
        context.setStatus("阿里拍卖页面打开失败", "error");
      } finally {
        opening = false;
        elements.openAlibabaAuctionSource.disabled = running;
      }
    }

    async function syncStatusOnCurrentPage() {
      try {
        const requestConfig = requireAppliedParameters({ requireOutput: true });
        if (!requestConfig) return { ok: false, errorCode: "ALIBABA_PARAMETERS_NOT_APPLIED", reason: "参数有改动，需重新应用。" };
        let tab = await getCurrentBrowserTab(context.chrome);
        if (/login\.taobao|\/login(?:[/?]|$)/i.test(String(tab.url || ""))) {
          const failure = new Error("请在当前浏览器标签页完成阿里拍卖登录，完成后点击重试。");
          failure.code = "ALIBABA_LOGIN_REQUIRED";
          throw failure;
        }
        if (isAlibabaVerificationUrl(tab.url)) {
          const failure = new Error("请在当前浏览器标签页完成阿里拍卖验证，完成后点击重试。");
          failure.code = "ALIBABA_VERIFICATION_REQUIRED";
          throw failure;
        }
        if (!isAlibabaListPage(tab.url)) return { ok: false, skipped: true };
        if (requestConfig.entry === "zc") return { ok: false, skipped: true };
        const settled = await synchronizeAlibabaAuctionStatusOnTab(context.chrome, tab, requestConfig.status);
        tab = settled.tab;
        setMessage(elements.alibabaAuctionParameterMessage, `已同步阿里页面“拍卖状态”为${requestConfig.status === "finished" ? "已结束" : "全部状态"}。`, "ok");
        return settled.statusSync;
      } catch (error) {
        const errorCode = error?.code && error.code !== error?.message ? `${error.code}：` : "";
        setMessage(elements.alibabaAuctionParameterMessage, `网页状态同步失败：${errorCode}${error?.message || String(error)}`, "error");
        return { ok: false, errorCode: error?.code || "ALIBABA_STATUS_READBACK_FAILED", reason: error?.message || String(error) };
      }
    }

    async function runScrape(mode = "network") {
      if (running) return;
      const requestConfig = mode === "history" ? normalizeConfig(config) : requireAppliedParameters();
      if (!requestConfig) return;
      if (!requestConfig.outputDirectory) {
        setMessage(elements.alibabaAuctionResultMessage, "请先选择本机输出目录，再开始抓取。", "warn");
        context.setStatus("阿里司法拍卖尚未选择输出目录", "warn");
        return;
      }
      if (mode === "history" && !requestConfig.historyPath) {
        setMessage(elements.alibabaAuctionResultMessage, "请先加载一份历史抓取清单。", "warn");
        return;
      }
      if (mode === "history" && !elements.alibabaAuctionRefreshHistory.checked) {
        setMessage(elements.alibabaAuctionResultMessage, "请勾选“允许访问网络重新读取历史详情”后再执行。", "warn");
        return;
      }
      running = true;
      runControl = { paused: false, percent: 0, resumeResolvers: [] };
      renderProgress({ phase: "opening", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "正在准备抓取…" });
      elements.runAlibabaAuction.disabled = true;
      elements.openAlibabaAuctionSource.disabled = true;
      elements.pauseAlibabaAuction.disabled = false;
      elements.stopAlibabaAuction.disabled = false;
      elements.pauseAlibabaAuction.textContent = "暂停抓取";
      elements.clearAlibabaAuctionResults.disabled = true;
      renderResults();
      setMessage(elements.alibabaAuctionResultMessage, mode === "history" ? "正在按历史清单逐条重新读取详情；不会重新读取列表。" : "脚本正在通过浏览器读取列表并逐条核验详情；无需 AI 介入。", "warn");
      context.setStatus(mode === "history" ? "阿里拍卖历史详情正在重抓" : "阿里拍卖脚本正在运行", "busy");
      try {
        const result = await runCurrentTabScrape(context, {
          ...requestConfig,
          sourceUrl: buildSourceUrl(requestConfig),
          historyRefresh: mode === "history",
        }, (payload) => {
          renderProgress(payload);
          if (["generating_results", "locating_coordinates"].includes(payload.phase)) {
            elements.pauseAlibabaAuction.disabled = true;
          }
          elements.alibabaAuctionResultStatus.dataset.kind = "";
        }, runControl);
        if (result?.stopped && result?.finalized) {
          results = Array.isArray(result.results) ? result.results : [];
          htmlPath = String(result.htmlPath || "").trim();
          mapPath = String(result.mapPath || "").trim();
          excelPath = "";
          renderProgress({ phase: "stopped", percent: 100, fetched: result.candidates || 0, verified: results.length, skipped: result.skipped || 0, message: "本地结果写入完成，抓取已终止。" });
          await context.storage.save(storageState());
          renderResults();
          elements.alibabaAuctionResultStatus.textContent = htmlPath
            ? `本地结果写入完成，抓取已终止；已保留 ${results.length} 条有效成交案例。`
            : "本地结果写入完成，抓取已终止。";
          setMessage(elements.alibabaAuctionResultMessage, htmlPath
            ? `抓取已终止，但本次结果已写入本机；页面记录 ${result.candidates || 0} 条，核验通过 ${results.length} 条，跳过 ${result.skipped || 0} 条。`
            : "抓取已终止，未生成可打开的结果文件。", "warn");
          context.setStatus("阿里拍卖结果已写入，抓取已终止", "warn");
          return;
        }
        if (result?.stopped) {
          renderProgress({ phase: "stopped", message: "抓取已终止；未生成本次半成品结果。" });
          setMessage(elements.alibabaAuctionResultMessage, `抓取已终止，已读取 ${result.candidates || 0} 条页面记录。可以重新开始。`, "warn");
          elements.alibabaAuctionResultStatus.textContent = "抓取已终止";
          context.setStatus("阿里拍卖抓取已终止", "warn");
          return;
        }
        if (!result?.ok) {
          const failure = new Error(result?.reason || result?.errorCode || "ALIBABA_AUCTION_FAILED");
          failure.code = result?.errorCode || "ALIBABA_AUCTION_FAILED";
          throw failure;
        }
        results = Array.isArray(result.results) ? result.results : [];
        htmlPath = String(result.htmlPath || "").trim();
        mapPath = String(result.mapPath || "").trim();
        if (result.historyPath) {
          config.historyPath = String(result.historyPath).trim();
          config.historyDirectory = pathDirectory(config.historyPath);
          historyCanRefresh = true;
        }
        excelPath = "";
        renderProgress({ phase: "completed", percent: 100, fetched: result.candidates || 0, verified: results.length, skipped: result.skipped || 0, message: "抓取完成，结果页正在打开…" });
        await context.storage.save(storageState());
        renderConfig();
        renderResults();
        elements.alibabaAuctionResultStatus.textContent = `已完成详情核验：${results.length} 条有效成交案例`;
        const coordinateSummary = requestConfig.generateMap && (result.geocodeRequested || result.geocodeCacheHits || result.geocodeResolved || result.geocodeFailed || result.geocodeTimedOut)
          ? `坐标查询 ${result.geocodeRequested || 0} 次，缓存命中 ${result.geocodeCacheHits || 0} 条，定位 ${result.geocodeResolved || 0} 条。`
          : "";
        setMessage(elements.alibabaAuctionResultMessage, `${mode === "history" ? "历史详情重新抓取完成" : "抓取完成"}：页面记录 ${result.candidates || 0} 条，核验通过 ${results.length} 条，跳过 ${result.skipped || 0} 条。${coordinateSummary}`, "ok");
        await openResultPage();
        context.setStatus(`阿里拍卖抓取完成：${results.length} 条有效案例`, "ok");
      } catch (error) {
        renderProgress({ phase: "failed", message: "抓取失败，请按提示处理后重试" });
        const errorCode = error?.code && error.code !== error?.message ? `${error.code}：` : "";
        setMessage(elements.alibabaAuctionResultMessage, `抓取未完成：${errorCode}${error?.message || String(error)}`, "error");
        elements.alibabaAuctionResultStatus.textContent = "抓取失败，请按提示处理后重试";
        elements.alibabaAuctionResultStatus.dataset.kind = "error";
        context.setStatus("阿里拍卖抓取失败", "error");
      } finally {
        running = false;
        if (runControl) {
          runControl.paused = false;
          for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
        }
        runControl = null;
        elements.runAlibabaAuction.disabled = false;
        elements.openAlibabaAuctionSource.disabled = false;
        elements.pauseAlibabaAuction.disabled = true;
        elements.stopAlibabaAuction.disabled = true;
        elements.pauseAlibabaAuction.textContent = "暂停抓取";
        elements.clearAlibabaAuctionResults.disabled = !results.length;
        renderResults();
      }
    }

    function togglePause() {
      if (!running || !runControl) return;
      if (runControl.paused) {
        runControl.paused = false;
        elements.pauseAlibabaAuction.textContent = "暂停抓取";
        for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
        setMessage(elements.alibabaAuctionResultMessage, "已继续抓取，将从当前进度继续。", "ok");
        return;
      }
      runControl.paused = true;
      runControl.percent = Number(progressState.percent || 0);
      elements.pauseAlibabaAuction.textContent = "继续抓取";
      renderProgress({ phase: "paused", message: "抓取已暂停；点击“继续抓取”后会从当前进度继续。" });
      setMessage(elements.alibabaAuctionResultMessage, "抓取已暂停，当前标签页可以保留在原位置。", "warn");
    }

    function stopScrape() {
      if (!running || !runControl) return;
      const finalizationPhase = ["generating_results", "locating_coordinates"].includes(progressState.phase);
      runControl.stopped = true;
      runControl.paused = false;
      for (const resolve of runControl.resumeResolvers.splice(0)) resolve();
      elements.stopAlibabaAuction.disabled = true;
      elements.pauseAlibabaAuction.disabled = true;
      if (finalizationPhase) {
        renderProgress({ phase: progressState.phase, percent: 99, message: "正在完成本地结果写入，完成后终止" });
        setMessage(elements.alibabaAuctionResultMessage, "正在完成本地结果写入，完成后终止", "warn");
      } else {
        renderProgress({ phase: "stopped", message: "正在终止当前抓取，请稍候…" });
        setMessage(elements.alibabaAuctionResultMessage, "正在终止抓取，不会继续打开新的详情页。", "warn");
      }
    }

    return {
      async initialize(nextContext) {
        context = nextContext;
        const root = context.document.getElementById(context.manifest.pageElementId);
        if (!root) throw new Error("ALIBABA_AUCTION_PAGE_MISSING");
        root.dataset.moduleId = context.manifest.id;
        root.innerHTML = alibabaAuctionTemplate;
        const stylesheet = context.document.createElement("link");
        stylesheet.rel = "stylesheet";
        stylesheet.href = context.chrome.runtime.getURL("src/modules/alibaba-auction/styles.css");
        context.document.head.appendChild(stylesheet);
        context.scope.add(() => stylesheet.remove());
        elements = elementMap(context.document);
        const stored = await context.storage.load({});
        config = normalizeConfig(stored);
        appliedConfig = stored?.parameterSnapshot ? normalizeConfig(stored.parameterSnapshot) : null;
        results = Array.isArray(stored?.results) ? stored.results : [];
        htmlPath = String(stored?.htmlPath || "").trim();
        excelPath = String(stored?.excelPath || "").trim();
        mapPath = String(stored?.mapPath || "").trim();
        progressState = results.length
          ? { phase: "completed", percent: 100, fetched: results.length, verified: results.length, skipped: 0, message: `已保留上次结果：${results.length} 条有效案例` }
          : { phase: "idle", percent: 0, fetched: 0, verified: 0, skipped: 0, message: "等待开始" };
        context.scope.on(elements.openAlibabaAuction, "click", () => context.navigate("alibaba-auction"));
        context.scope.on(elements.backFromAlibabaAuction, "click", () => context.navigate("home"));
        context.scope.on(elements.openAlibabaAuctionSource, "click", openSource);
        context.scope.on(elements.openAlibabaAuctionResult, "click", openResultPage);
        context.scope.on(elements.exportAlibabaAuctionExcel, "click", exportExcel);
        context.scope.on(elements.openAlibabaAuctionExcel, "click", openExcel);
        context.scope.on(elements.openAlibabaAuctionMap, "click", openMap);
        context.scope.on(elements.chooseAlibabaAuctionOutput, "click", chooseOutputDirectory);
        context.scope.on(elements.chooseAlibabaAuctionHistoryDirectory, "click", chooseHistoryDirectory);
        context.scope.on(elements.loadAlibabaAuctionHistoryCatalog, "click", loadHistoryCatalog);
        context.scope.on(elements.loadAlibabaAuctionHistory, "click", loadHistorySelection);
        context.scope.on(elements.runAlibabaAuction, "click", () => runScrape("network"));
        context.scope.on(elements.runAlibabaAuctionHistory, "click", () => runScrape("history"));
        context.scope.on(elements.alibabaAuctionHistorySelect, "change", () => {
          config.historyPath = elements.alibabaAuctionHistorySelect.value.trim();
          historyCanRefresh = Boolean(historyCatalog.find((item) => item.path === config.historyPath)?.canRefresh);
          renderConfig();
        });
        context.scope.on(elements.alibabaAuctionRefreshHistory, "change", async () => {
          config.historyRefresh = elements.alibabaAuctionRefreshHistory.checked;
          await context.storage.save(storageState());
          renderConfig();
        });
        context.scope.on(elements.pauseAlibabaAuction, "click", togglePause);
        context.scope.on(elements.stopAlibabaAuction, "click", stopScrape);
        context.scope.on(elements.saveAlibabaAuctionParams, "click", applyParameters);
        context.scope.on(elements.resetAlibabaAuctionParams, "click", async () => {
          config = { ...DEFAULT_CONFIG, outputDirectory: config.outputDirectory };
          excelPath = "";
          mapPath = "";
          await context.storage.save(storageState());
          renderConfig();
          setMessage(elements.alibabaAuctionParameterMessage, "已恢复默认参数；请点击“确认并应用参数”。", "warn");
        });
        context.scope.on(elements.clearAlibabaAuctionResults, "click", async () => {
          results = [];
          htmlPath = "";
          excelPath = "";
          mapPath = "";
          await context.storage.save(storageState());
          renderResults();
          setMessage(elements.alibabaAuctionResultMessage, "已清空本地结果。", "");
        });
        for (const id of [
          "alibabaAuctionEntry", "alibabaAuctionPropertyType", "alibabaAuctionKeyword",
          "alibabaAuctionStartDate", "alibabaAuctionEndDate",
        ]) {
          context.scope.on(elements[id], "change", syncConfigFromInputs);
          if (["alibabaAuctionKeyword", "alibabaAuctionStartDate", "alibabaAuctionEndDate"].includes(id)) {
            context.scope.on(elements[id], "input", markConfigDirtyFromInputs);
          }
        }
        context.scope.on(elements.alibabaAuctionStatus, "change", syncConfigFromInputs);
        context.scope.on(elements.alibabaAuctionGenerateMap, "change", syncConfigFromInputs);
        context.scope.on(elements.alibabaAuctionProvince, "change", () => {
          config = normalizeConfig({ ...config, provinceCode: elements.alibabaAuctionProvince.value, city: "", cityCode: "", district: "", districtCode: "" });
          renderConfig();
          setMessage(elements.alibabaAuctionParameterMessage, "参数有改动，需重新应用。", "warn");
        });
        context.scope.on(elements.alibabaAuctionCity, "change", () => {
          config = normalizeConfig({ ...config, city: "", cityCode: elements.alibabaAuctionCity.value, district: "", districtCode: "" });
          renderConfig();
          setMessage(elements.alibabaAuctionParameterMessage, "参数有改动，需重新应用。", "warn");
        });
        context.scope.on(elements.alibabaAuctionDistrict, "change", syncConfigFromInputs);
        renderConfig();
        renderResults();
        renderProgress();
        if (config.historyDirectory || config.outputDirectory) void loadHistoryCatalog();
      },
      activate() {
        renderConfig();
        renderResults();
      },
      deactivate() {},
      dispose() {},
    };
  },
};

export {
  DEFAULT_CONFIG,
  RESULT_FIELDS,
  buildSourceUrl,
  directCandidateInScope,
  directPageBeforeRequestedRange,
  hasDirectCoordinates,
  resultGenerationProgress,
  directExtractBuildingAreaFromText,
  directExtractFloorFieldsFromText,
  directMergeListingEvidence,
  directParseDetail,
  directSkipReason,
  alibabaPageReady,
  alibabaUrlsReferToSamePage,
  readAlibabaPageWithManualVerification,
  waitForManualVerification,
  listPageMatchesRequest,
  statusFilterLabels,
  statusFilterMatchesRequest,
  isAlibabaListPage,
  isAlibabaVerificationUrl,
  normalizeConfig,
  parameterSnapshotMatches,
  propertyTypeLabel,
  buildZcAuctionSourceUrl,
  extractZcAuctionListPage,
  synchronizeAlibabaAuctionStatus,
  synchronizeAlibabaAuctionStatusOnTab,
  executeCurrentTab,
  executeCurrentPageMain,
  usableDistricts,
};
