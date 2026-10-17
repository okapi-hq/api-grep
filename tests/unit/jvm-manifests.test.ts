import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildConfigValue } from "../../src/lang/jvm/build-config.js";
import { parseCatalog } from "../../src/lang/jvm/catalog.js";
import { buildConfigFields, gradleDependencies, stripComments } from "../../src/lang/jvm/gradle.js";
import { jvmManifests } from "../../src/lang/jvm/manifests.js";
import { parsePom } from "../../src/lang/jvm/maven.js";
import { jvmImportRoots } from "../../src/lang/jvm/packages.js";

function repo(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "api-grep-jvm-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

const declared = (dir: string, ...dirs: string[]): string[] => [...jvmManifests().declared(new Set([dir, ...dirs.map((d) => path.join(dir, d))]), dir)].sort();

describe("gradle build scripts", () => {
  it("reads the Kotlin DSL: strings, named arguments, platforms and catalog accessors, test configurations aside", () => {
    const deps = gradleDependencies(
      'dependencies {\n  implementation("com.squareup.okhttp3:okhttp:4.12.0")\n  api(group = "com.squareup.moshi", name = "moshi", version = "1.15.1")\n  implementation(platform("com.google.firebase:firebase-bom:33.5.1"))\n  debugImplementation(libs.chucker)\n  "kapt"("com.google.dagger:hilt-compiler:2.52")\n  implementation(project(":core"))\n  testImplementation("junit:junit:4.13.2")\n  androidTestImplementation(libs.espresso)\n  kaptTest("com.google.dagger:hilt-compiler:2.52")\n}\n',
    );
    expect(deps).toEqual([
      { group: "com.squareup.okhttp3", artifact: "okhttp", version: "4.12.0" },
      { group: "com.squareup.moshi", artifact: "moshi", version: "1.15.1" },
      { group: "com.google.firebase", artifact: "firebase-bom", version: "33.5.1" },
      { catalog: "chucker" },
      { group: "com.google.dagger", artifact: "hilt-compiler", version: "2.52" },
    ]);
  });

  it("reads the Groovy DSL, and leaves comments out without cutting URLs in strings", () => {
    const script = "dependencies {\n  implementation 'com.stripe:stripe-android:20.53.0'\n  implementation group: 'io.sentry', name: 'sentry', version: '7.16.0'\n  // implementation 'com.openai:openai-java:0.8.0'\n  /* api \"com.slack.api:bolt:1.44.0\" */\n  implementation libs.retrofit\n}\nrepositories { maven { url 'https://jitpack.io' } }\n";
    expect(gradleDependencies(script)).toEqual([
      { group: "com.stripe", artifact: "stripe-android", version: "20.53.0" },
      { group: "io.sentry", artifact: "sentry", version: "7.16.0" },
      { catalog: "retrofit" },
    ]);
    expect(stripComments("val u = \"https://x\" // note\n")).toBe('val u = "https://x"  \n');
  });

  it("reads literal buildConfigField values, not interpolated ones", () => {
    const fields = buildConfigFields(
      'buildConfigField("String", "API_URL", "\\"https://api.example.com/\\"")\nbuildConfigField "String", "CDN", \'"https://cdn.example.com"\'\nbuildConfigField("String", "API_URL", "\\"http://10.0.2.2/\\"")\nbuildConfigField("String", "KEY", "\\"${props["key"]}\\"")\nbuildConfigField("int", "TIMEOUT", "30")\n',
    );
    expect([...fields]).toEqual([
      ["API_URL", "https://api.example.com/"],
      ["CDN", "https://cdn.example.com"],
    ]);
  });
});

describe("gradle version catalogs", () => {
  it("reads module, group / name and string entries, version references and bundles by accessor", () => {
    const catalog = parseCatalog(
      '[versions]\nretrofit = "2.11.0"\nokhttp = { strictly = "4.12.0" }\n[libraries]\nretrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "retrofit" }\nokhttp-logging = { group = "com.squareup.okhttp3", name = "logging-interceptor", version.ref = "okhttp" }\nstripe_android = "com.stripe:stripe-android:20.53.0"\nbom = { module = "com.google.firebase:firebase-bom" }\n[bundles]\nnetwork = ["retrofit", "okhttp-logging"]\n',
    );
    expect([...catalog.libraries]).toEqual([
      ["retrofit", { group: "com.squareup.retrofit2", artifact: "retrofit", version: "2.11.0" }],
      ["okhttp.logging", { group: "com.squareup.okhttp3", artifact: "logging-interceptor", version: "4.12.0" }],
      ["stripe.android", { group: "com.stripe", artifact: "stripe-android", version: "20.53.0" }],
      ["bom", { group: "com.google.firebase", artifact: "firebase-bom" }],
    ]);
    expect(catalog.bundles.get("network")).toEqual(["retrofit", "okhttp.logging"]);
    expect(parseCatalog("[libraries\n").libraries.size).toBe(0);
  });
});

describe("maven poms", () => {
  it("reads dependencies with property versions, leaving test scope, plugins and managed versions out", () => {
    const pom = parsePom(
      "<project><properties><stripe.version>26.13.0</stripe.version></properties><dependencyManagement><dependencies><dependency><groupId>software.amazon.awssdk</groupId><artifactId>bom</artifactId><version>2.28.0</version></dependency></dependencies></dependencyManagement><dependencies><dependency><groupId>com.stripe</groupId><artifactId>stripe-java</artifactId><version>${stripe.version}</version></dependency><dependency><groupId>software.amazon.awssdk</groupId><artifactId>s3</artifactId></dependency><!-- <dependency><groupId>com.openai</groupId><artifactId>openai-java</artifactId></dependency> --><dependency><groupId>junit</groupId><artifactId>junit</artifactId><scope>test</scope></dependency></dependencies><build><plugins><plugin><dependencies><dependency><groupId>org.ow2.asm</groupId><artifactId>asm</artifactId></dependency></dependencies></plugin></plugins></build></project>",
    );
    expect(pom.dependencies).toEqual([
      { group: "com.stripe", artifact: "stripe-java", version: "${stripe.version}" },
      { group: "software.amazon.awssdk", artifact: "s3" },
    ]);
    expect(pom.managed).toEqual(new Map([["software.amazon.awssdk:bom", "2.28.0"]]));
    expect(pom.properties.get("stripe.version")).toBe("26.13.0");
  });
});

describe("jvm manifests", () => {
  it("declares Gradle and Maven dependencies per directory, with versions from variables, gradle.properties and parent poms", () => {
    const dir = repo({
      "gradle/libs.versions.toml": '[libraries]\nsentry = "io.sentry:sentry-android:7.16.0"\n',
      "gradle.properties": "posthogVersion=3.8.2\n",
      "app/build.gradle.kts": 'val okhttp = "4.12.0"\ndependencies {\n  implementation(libs.sentry)\n  implementation("com.squareup.okhttp3:okhttp:$okhttp")\n  implementation("com.posthog:posthog-android:${posthogVersion}")\n}\n',
      "core/build.gradle": "ext.slack_version = '1.44.0'\ndependencies { implementation \"com.slack.api:slack-api-client:$slack_version\" }\n",
      "pom.xml": "<project><properties><stripe.version>26.13.0</stripe.version></properties></project>",
      "server/pom.xml": "<project><dependencies><dependency><groupId>com.stripe</groupId><artifactId>stripe-java</artifactId><version>${stripe.version}</version></dependency></dependencies></project>",
    });
    expect(declared(dir, "app", "core", "server")).toEqual(["com.posthog:posthog-android", "com.slack.api:slack-api-client", "com.squareup.okhttp3:okhttp", "com.stripe:stripe-java", "io.sentry:sentry-android"]);
    const m = jvmManifests();
    expect(m.version(path.join(dir, "app/src/main/java/A.kt"), "com.squareup.okhttp3:okhttp", dir)).toBe("4.12.0");
    expect(m.version(path.join(dir, "app/src/main/java/A.kt"), "com.posthog:posthog-android", dir)).toBe("3.8.2");
    expect(m.version(path.join(dir, "app/src/main/java/A.kt"), "io.sentry:sentry-android", dir)).toBe("7.16.0");
    expect(m.version(path.join(dir, "core/src/B.kt"), "com.slack.api:slack-api-client", dir)).toBe("1.44.0");
    expect(m.version(path.join(dir, "server/src/C.kt"), "com.stripe:stripe-java", dir)).toBe("26.13.0");
    expect(declared(dir)).toEqual([]);
  });

  it("finds BuildConfig values in the build script of the module a source file belongs to", () => {
    const dir = repo({ "app/build.gradle.kts": 'buildConfigField("String", "API_URL", "\\"https://api.example.com/\\"")\n', "app/src/main/java/A.kt": "" });
    expect(buildConfigValue(path.join(dir, "app/src/main/java/A.kt"), dir, "API_URL")).toBe("https://api.example.com/");
    expect(buildConfigValue(path.join(dir, "app/src/main/java/A.kt"), dir, "OTHER")).toBeUndefined();
  });

  it("finds an artifact's package roots, else its group", () => {
    expect(jvmImportRoots("com.twilio.sdk:twilio")).toEqual(["com.twilio"]);
    expect(jvmImportRoots("com.stripe:stripe-java")).toEqual(["com.stripe"]);
    // the group's root is shared with Android Firebase: firebase-admin's only where it is declared
    expect(jvmImportRoots("com.google.firebase:firebase-admin")).not.toContain("com.google.firebase");
    expect(jvmImportRoots("com.google.firebase:firebase-admin", true)).toContain("com.google.firebase");
    // `com.facebook` is also React Native's (`com.facebook.react`): the Facebook SDK's only where it is declared
    expect(jvmImportRoots("com.facebook.android:facebook-android-sdk")).not.toContain("com.facebook");
    expect(jvmImportRoots("com.facebook.android:facebook-android-sdk", true)).toContain("com.facebook");
  });

  it("reads hostile manifests in linear time", () => {
    const started = Date.now();
    gradleDependencies(`implementation${"a".repeat(200_000)}Implementation`);
    gradleDependencies(`dependencies { ${"implementation(libs.".repeat(20_000)} }`);
    parsePom(`<project>${"<dependency><groupId>".repeat(50_000)}</project>`);
    parsePom(`<properties>${"<a".repeat(100_000)}</properties>`);
    buildConfigFields(`${'buildConfigField("String", "A", "'.repeat(20_000)}`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
