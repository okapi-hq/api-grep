import { SHARED_EXCLUDES } from "../files.js";
import type { IrSource } from "../ir/language.js";
import { lowerJava } from "./lower.js";

export const JAVA_EXCLUDES = [
  ...SHARED_EXCLUDES,
  // Maven and Gradle build output, generated sources, build logic and test source sets
  "**/target/**",
  "**/.gradle/**",
  "**/buildSrc/**",
  "**/build-logic/**",
  "**/src/test*/**",
  "**/src/androidTest*/**",
  "**/src/*Test/**",
  "**/test/**",
  "**/tests/**",
  "**/*Test.java",
  "**/*Tests.java",
  "**/*IT.java",
];

/**
 * Java, read by the Kotlin front end into the same modules and `ProjectIndex` (`alsoReads`): the JVM HTTP clients,
 * Retrofit and Feign declarations and SDK registries apply to it as they are, and names resolve across both languages.
 */
export const javaSource: IrSource = {
  id: "java",
  grammar: "java",
  extensions: [".java"],
  excludes: JAVA_EXCLUDES,
  lower: lowerJava,
};
