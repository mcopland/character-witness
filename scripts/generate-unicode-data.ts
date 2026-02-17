#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";

const namesMap: Map<number, string> = require("@unicode/unicode-16.0.0/Names");

const UNICODE_VERSION = "16.0.0";

interface AlgorithmicRange {
  start: number;
  end: number;
  prefix: string;
}

const ALGORITHMIC_RANGES: AlgorithmicRange[] = [
  { start: 0x3400, end: 0x4dbf, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x4e00, end: 0x9fff, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x20000, end: 0x2a6df, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2a700, end: 0x2b739, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2b740, end: 0x2b81d, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2b820, end: 0x2cea1, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2ceb0, end: 0x2ebe0, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x2ebf0, end: 0x2ee5d, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x30000, end: 0x3134a, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0x31350, end: 0x323af, prefix: "CJK UNIFIED IDEOGRAPH-" },
  { start: 0xf900, end: 0xfa6d, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0xfa70, end: 0xfad9, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x2f800, end: 0x2fa1d, prefix: "CJK COMPATIBILITY IDEOGRAPH-" },
  { start: 0x17000, end: 0x187f7, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18d00, end: 0x18d7f, prefix: "TANGUT IDEOGRAPH-" },
  { start: 0x18b00, end: 0x18cd5, prefix: "KHITAN SMALL SCRIPT CHARACTER-" },
  { start: 0x1b170, end: 0x1b2fb, prefix: "NUSHU CHARACTER-" },
];

const HANGUL_RANGE = { start: 0xac00, end: 0xd7a3 };

function isInAlgorithmicRange(cp: number): boolean {
  if (cp >= HANGUL_RANGE.start && cp <= HANGUL_RANGE.end) return true;
  return ALGORITHMIC_RANGES.some((r) => cp >= r.start && cp <= r.end);
}

const nameLines: string[] = [];

for (const [cp, name] of namesMap) {
  if (cp <= 0x7f) continue;
  if (isInAlgorithmicRange(cp)) continue;
  if (name.startsWith("<")) continue;
  if (cp >= 0xd800 && cp <= 0xdfff) continue;   // Surrogates (not valid scalar values)
  if (cp >= 0xe000 && cp <= 0xf8ff) continue;    // BMP Private Use Area
  if (cp >= 0xf0000 && cp <= 0xffffd) continue;  // Plane 15 Private Use
  if (cp >= 0x100000 && cp <= 0x10fffd) continue; // Plane 16 Private Use

  const hex = cp.toString(16).toUpperCase().padStart(4, "0");
  nameLines.push(hex + " " + name);
}

nameLines.sort((a, b) => {
  const cpA = parseInt(a.slice(0, a.indexOf(" ")), 16);
  const cpB = parseInt(b.slice(0, b.indexOf(" ")), 16);
  return cpA - cpB;
});

const resourcesDir = path.resolve(__dirname, "..", "resources");
fs.mkdirSync(resourcesDir, { recursive: true });

const txtPath = path.join(resourcesDir, "unicode-names.txt");
fs.writeFileSync(txtPath, nameLines.join("\n") + "\n", "utf-8");

const txtStats = fs.statSync(txtPath);
console.log("Generated " + txtPath);
console.log("  Unicode version   : " + UNICODE_VERSION);
console.log("  Named characters  : " + nameLines.length.toLocaleString());
console.log("  File size         : " + (txtStats.size / 1024).toFixed(0) + " KB");
