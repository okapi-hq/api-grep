import { Node, SyntaxKind, type ClassDeclaration, type ClassExpression, type Expression, type ParameterDeclaration } from "ts-morph";

export type ClassLike = ClassDeclaration | ClassExpression;

/** The class declaration or expression `at` is written in. */
export function enclosingClass(at: Node): ClassLike | undefined {
  return at.getFirstAncestorByKind(SyntaxKind.ClassDeclaration) ?? at.getFirstAncestorByKind(SyntaxKind.ClassExpression);
}

/** `constructor(private baseUrl = "...")`: the constructor parameter that declares property `propName`. */
export function parameterProperty(cls: ClassLike, propName: string): ParameterDeclaration | undefined {
  return cls
    .getConstructors()
    .flatMap((c) => c.getParameters())
    .find((p) => p.getName() === propName && p.isParameterProperty());
}

/** Right side of the first `this.<propName> = ...` in a constructor. */
export function constructorAssignment(cls: ClassLike, propName: string): Expression | undefined {
  for (const ctor of cls.getConstructors()) {
    for (const bin of ctor.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
      const left = bin.getLeft();
      if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
      if (Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) && left.getName() === propName) {
        return bin.getRight();
      }
    }
  }
  return undefined;
}

/** Values assigned to `this.<propName>`: in the constructor first, then in the other methods. */
export function fieldAssignments(cls: ClassLike, propName: string): Expression[] {
  const bodies = [...cls.getConstructors(), ...cls.getMethods(), ...cls.getSetAccessors()];
  return bodies.flatMap((b) =>
    b.getDescendantsOfKind(SyntaxKind.BinaryExpression).flatMap((bin) => {
      const left = bin.getLeft();
      const isField = bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken && Node.isPropertyAccessExpression(left) && Node.isThisExpression(left.getExpression()) && left.getName() === propName;
      return isField ? [bin.getRight()] : [];
    }),
  );
}

/** Initializer of `this.<prop>`: property initializer or `this.prop = ...` in the constructor. */
export function classPropertyInitializer(at: Node, propName: string): Expression | undefined {
  const cls = enclosingClass(at);
  if (!cls) return undefined;
  const init = cls.getProperty(propName)?.getInitializer();
  if (init) return init;
  const param = parameterProperty(cls, propName);
  // `constructor(private baseUrl = "https://api.gladia.io")`: the default, unless the constructor reassigns it
  if (param) return constructorAssignment(cls, propName) ?? param.getInitializer();
  return constructorAssignment(cls, propName);
}
