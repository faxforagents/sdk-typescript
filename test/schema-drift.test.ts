import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { parse } from 'yaml';

it('declares every schema property and route in the saved live OpenAPI document', () => {
  const spec = parse(readFileSync(new URL('../spec/openapi.yaml', import.meta.url), 'utf8')) as {
    components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
    paths: Record<string, Record<string, { operationId: string }>>;
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

  const paths = source.statements.find(
    (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'paths',
  );
  const operations = source.statements.find(
    (node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === 'operations',
  );
  expect(paths).toBeDefined();
  expect(operations).toBeDefined();
  const pathTypes = checker.getTypeAtLocation(paths!);
  const operationTypes = checker.getTypeAtLocation(operations!);
  for (const [path, methods] of Object.entries(spec.paths)) {
    const route = pathTypes.getProperty(path);
    expect(route, path).toBeDefined();
    const routeType = checker.getTypeOfSymbolAtLocation(route!, source);
    for (const [method, { operationId }] of Object.entries(methods)) {
      const declaration = routeType.getProperty(method);
      const operation = operationTypes.getProperty(operationId);
      expect(declaration, `${method} ${path}`).toBeDefined();
      expect(operation, operationId).toBeDefined();
      const declaredType = checker.getTypeOfSymbolAtLocation(declaration!, source);
      const operationType = checker.getTypeOfSymbolAtLocation(operation!, source);
      expect(declaredType.flags & (ts.TypeFlags.Never | ts.TypeFlags.Any)).toBe(0);
      expect(checker.typeToString(declaredType)).toBe(checker.typeToString(operationType));
    }
  }
});
