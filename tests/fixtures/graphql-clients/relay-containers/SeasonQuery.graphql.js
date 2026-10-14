/**
 * @generated SignedSource<<00000000000000000000000000000000>>
 * @flow
 */

"use strict";

var node = (function () {
  var v0 = [{ defaultValue: null, kind: "LocalArgument", name: "year" }];
  return {
    fragment: { argumentDefinitions: v0, kind: "Fragment", metadata: null, name: "SeasonQuery", selections: [], type: "Query", abstractKey: null },
    kind: "Request",
    operation: { argumentDefinitions: v0, kind: "Operation", name: "SeasonQuery", selections: [] },
    params: {
      cacheID: "0000",
      id: null,
      metadata: {},
      name: "SeasonQuery",
      operationKind: "query",
      text: "query SeasonQuery(\n  $year: Int!\n) {\n  season(year: $year) {\n    blossom\n  }\n}\n",
    },
  };
})();

node.hash = "0000";

module.exports = node;
