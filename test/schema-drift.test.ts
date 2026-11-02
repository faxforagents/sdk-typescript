import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it('declares every property in the saved live OpenAPI schemas', () => {
  const spec = parse(readFileSync(new URL('../spec/openapi.yaml', import.meta.url), 'utf8')) as {
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
  };
  const filename = fileURLToPath(new URL('../src/schema.d.ts', import.meta.url));
  const program = ts.createProgram([filename], { strict: true, noEmit: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(filename)!;
  const components = source.statements.find(
    (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'components',
  );
  expect(components).toBeDefined();
  const root = checker.getTypeAtLocation(components!);
  const schemas = checker.getTypeOfSymbolAtLocation(root.getProperty('schemas')!, source);
  const missing: string[] = [];
  for (const [name, schema] of Object.entries(spec.components.schemas)) {
    const model = schemas.getProperty(name);
    if (!model) {
      missing.push(name);
      continue;
    }
    const type = checker.getTypeOfSymbolAtLocation(model, source);
    for (const property of Object.keys(schema.properties ?? {})) {
      // An index signature must not count as a declared property.
      if (!type.getProperty(property)) missing.push(`${name}.${property}`);
    }
  }
  expect(missing, 'Undeclared schema properties or models').toEqual([]);
});
