/**
 * @generated SignedSource<<00000000000000000000000000000000>>
 * @lightSyntaxTransform
 * @nogrep
 */

/* tslint:disable */
/* eslint-disable */
// @ts-nocheck

import { ConcreteRequest } from "relay-runtime";
export type SeedListQuery$variables = { first: number };
export type SeedListQuery$data = { readonly seeds: ReadonlyArray<{ readonly id: string; readonly label: string }> };
export type SeedListQuery = { response: SeedListQuery$data; variables: SeedListQuery$variables };

const node: ConcreteRequest = (function(){
var v0 = [
  {
    "defaultValue": null,
    "kind": "LocalArgument",
    "name": "first"
  }
],
v1 = [
  {
    "alias": null,
    "args": null,
    "concreteType": "Seed",
    "kind": "LinkedField",
    "name": "seeds",
    "plural": true,
    "selections": []
  }
];
return {
  "fragment": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Fragment",
    "metadata": null,
    "name": "SeedListQuery",
    "selections": (v1/*: any*/),
    "type": "Query",
    "abstractKey": null
  },
  "kind": "Request",
  "operation": {
    "argumentDefinitions": (v0/*: any*/),
    "kind": "Operation",
    "name": "SeedListQuery",
    "selections": (v1/*: any*/)
  },
  "params": {
    "cacheID": "0123456789abcdef0123456789abcdef",
    "id": null,
    "metadata": {},
    "name": "SeedListQuery",
    "operationKind": "query",
    "text": "query SeedListQuery(\n  $first: Int!\n) {\n  seeds(first: $first) {\n    id\n    label\n  }\n}\n"
  }
};
})();

(node as any).hash = "fedcba9876543210fedcba9876543210";

export default node;
