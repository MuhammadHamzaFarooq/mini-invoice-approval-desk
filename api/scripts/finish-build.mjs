import { writeFileSync } from 'node:fs';

/**
 * Stamps dist/ as ESM.
 *
 * The source is ESM ("type": "module" in api/package.json) and tsc emits ESM,
 * but a platform that bundles dist/ into its own directory does not necessarily
 * bring that package.json along. Node then falls back to CommonJS and the first
 * `import` statement throws:
 *
 *   SyntaxError: Cannot use import statement outside a module
 *   Warning: ... set "type": "module" in the nearest package.json file
 *
 * Writing a minimal package.json inside dist/ makes it the nearest one, so the
 * output is read as ESM wherever it ends up. This is the fix the error message
 * itself asks for.
 */
writeFileSync(new URL('../dist/package.json', import.meta.url), JSON.stringify({ type: 'module' }) + '\n');
console.log('stamped dist/package.json with { "type": "module" }');
