import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { defineConfig } from "tsup";
import { GRAMMARS } from "./src/lang/grammars.js";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["esm"],
  target: "node20",
  dts: { entry: "src/index.ts" },
  clean: true,
  sourcemap: true,
  banner: { js: "#!/usr/bin/env node" },
  splitting: false,
  onSuccess: () => {
    const require = createRequire(import.meta.url);
    mkdirSync("dist/grammars", { recursive: true });
    for (const [name, pkg] of Object.entries(GRAMMARS)) {
      const file = `tree-sitter-${name}.wasm`;
      copyFileSync(require.resolve(`${pkg}/${file}`), path.join("dist/grammars", file));
    }
  },
});
