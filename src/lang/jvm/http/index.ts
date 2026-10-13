import type { ClientSpec, IrDeclarationDetector, IrDetector, IrLanguage } from "../../ir/language.js";
import { detectFeign } from "./feign.js";
import { detectKtor } from "./ktor.js";
import { detectJavaHttp, detectOkHttp } from "./okhttp.js";
import { detectRestTemplate, detectSpringFluent } from "./spring.js";
import { JVM } from "./tables.js";
import { detectUrlConnection } from "./url-connection.js";

/**
 * The HTTP clients of the JVM, as parts of an `IrLanguage`: they read the IR only, so Kotlin and Java (#43) share
 * them. Detectors run before the client tables; RestTemplate is a client table, its `HttpEntity` read by a detector.
 */
export const JVM_HTTP: Pick<IrLanguage, "clients" | "detectors" | "declarations" | "fluentMaps" | "constants" | "wildcardTypes"> = {
  clients: [JVM.restTemplate] as ClientSpec[],
  detectors: [detectOkHttp, detectJavaHttp, detectUrlConnection, detectKtor, detectSpringFluent, detectRestTemplate] as IrDetector[],
  declarations: [detectFeign] as IrDeclarationDetector[],
  fluentMaps: JVM.fluentMaps,
  constants: JVM.constants,
  wildcardTypes: new Set(JVM.wildcardTypes),
};
