import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');
const sourceFile = path.resolve(apiRoot, '..', '..', 'packages', 'shared', 'src', 'index.ts');
const vendorDir = path.join(apiRoot, 'node_modules', '@exam', 'shared');
const outJs = path.join(vendorDir, 'src', 'index.js');

const source = fs.readFileSync(sourceFile, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'index.ts',
});

fs.mkdirSync(path.join(vendorDir, 'src'), { recursive: true });
fs.writeFileSync(outJs, outputText);
fs.copyFileSync(sourceFile, path.join(vendorDir, 'src', 'index.ts'));
fs.writeFileSync(
  path.join(vendorDir, 'package.json'),
  `${JSON.stringify(
    {
      name: '@exam/shared',
      version: '0.1.0',
      private: true,
      type: 'module',
      main: './src/index.js',
      types: './src/index.ts',
      exports: {
        '.': {
          types: './src/index.ts',
          default: './src/index.js',
        },
      },
    },
    null,
    2,
  )}\n`,
);

console.log(`vendored @exam/shared -> ${outJs} (${outputText.length} bytes)`);
