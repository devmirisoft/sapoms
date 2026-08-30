// Lets plain node import the app's TS/TSX sources (and "@/" aliases) so the
// invoice PDF can be rendered outside the browser. Used by
// verify-invoice-layout.mjs; not part of the app build.
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.PROJ_ROOT;
const EXTS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.js'];

const firstExisting = (base) => {
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  // a ".js" specifier that really points at a ".ts" source
  if (base.endsWith('.js') && existsSync(`${base.slice(0, -3)}.ts`)) return `${base.slice(0, -3)}.ts`;
  return null;
};

export function resolve(specifier, context, next) {
  const base = specifier.startsWith('@/')
    ? `${ROOT}/src/${specifier.slice(2)}`
    : specifier.startsWith('.') && context.parentURL?.startsWith('file:')
      ? fileURLToPath(new URL('.', context.parentURL)) + specifier
      : null;
  const hit = base && firstExisting(base);
  return hit ? { url: pathToFileURL(hit).href, shortCircuit: true } : next(specifier, context);
}

export function load(url, context, next) {
  if (!/\.(ts|tsx)$/.test(url)) return next(url, context);
  const path = fileURLToPath(url);
  // jspdf ships CJS; outside the bundler the default import needs unwrapping.
  const src = readFileSync(path, 'utf8')
    .replace('import jsPDF from "jspdf";',
      'import * as _jspdf from "jspdf"; const jsPDF = _jspdf.jsPDF ?? _jspdf.default?.jsPDF ?? _jspdf.default;')
    .replace('import autoTable from "jspdf-autotable";',
      'import * as _at from "jspdf-autotable"; const autoTable = _at.default ?? _at.autoTable ?? _at;');
  const { outputText } = ts.transpileModule(src, {
    fileName: path,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
