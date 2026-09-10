import { Node, Project, type Expression, type SourceFile } from "ts-morph";

export function memProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: 99, lib: ["lib.es2022.d.ts", "lib.dom.d.ts"], strict: true, skipLibCheck: true },
  });
}

export function sourceOf(code: string, name = "a.ts", project = memProject()): SourceFile {
  return project.createSourceFile(name, code, { overwrite: true });
}

/** Initializer expression of `const <name> = ...` in the given source. */
export function initializerOf(sf: SourceFile, name: string): Expression {
  const decl = sf.getVariableDeclarationOrThrow(name);
  const init = decl.getInitializer();
  if (!init || !Node.isExpression(init)) throw new Error(`no initializer for ${name}`);
  return init;
}

export function exprOf(code: string, name: string): Expression {
  return initializerOf(sourceOf(code), name);
}
