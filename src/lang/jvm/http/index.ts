import type { ClientSpec, IrDeclarationDetector, IrDetector, IrLanguage } from "../../ir/language.js";
import { detectFeign } from "./feign.js";
import { detectKtor } from "./ktor.js";
import { detectJavaHttp, detectOkHttp } from "./okhttp.js";
import { detectRequestClients } from "./requests.js";
import { detectRestTemplate, detectSpringFluent } from "./spring.js";
import { detectRetrofit } from "./retrofit.js";
import { createdClass } from "./retrofit-link.js";
import { JVM } from "./tables.js";
import { detectUrlConnection } from "./url-connection.js";

/**
 * The HTTP clients of the JVM, as parts of an `IrLanguage`: they read the IR only, so Kotlin and Java (#43) share
 * them. Detectors run before the client tables; RestTemplate is a client table, its `HttpEntity` read by a detector.
 */
export const JVM_HTTP: Pick<IrLanguage, "clients" | "detectors" | "declarations" | "instanceOf" | "fluentMaps" | "constants" | "wildcardTypes"> = {
  clients: [JVM.restTemplate] as ClientSpec[],
  // the clients of `requests.json` (Apache HttpClient, JAX-RS, AsyncHttpClient, Unirest, Vert.x) come last: a call the
  // others read stays theirs
  detectors: [detectOkHttp, detectJavaHttp, detectUrlConnection, detectKtor, detectSpringFluent, detectRestTemplate, detectRequestClients] as IrDetector[],
  declarations: [detectFeign, detectRetrofit] as IrDeclarationDetector[],
  instanceOf: createdClass,
  fluentMaps: JVM.fluentMaps,
  constants: JVM.constants,
  wildcardTypes: new Set(JVM.wildcardTypes),
};
