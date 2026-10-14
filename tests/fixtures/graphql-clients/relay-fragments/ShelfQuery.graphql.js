/**
 * @generated SignedSource<<00000000000000000000000000000000>>
 * @flow
 */

"use strict";

var node = (function () {
  var v0 = [{ defaultValue: null, kind: "LocalArgument", name: "id" }];
  return {
    fragment: { argumentDefinitions: v0, kind: "Fragment", metadata: null, name: "ShelfQuery", selections: [], type: "Query", abstractKey: null },
    kind: "Request",
    operation: { argumentDefinitions: v0, kind: "Operation", name: "ShelfQuery", selections: [] },
    params: {
      cacheID: "0000",
      id: null,
      metadata: {},
      name: "ShelfQuery",
      operationKind: "query",
      text: "query ShelfQuery(\n  $id: ID!\n) {\n  shelf(id: $id) {\n    title\n  }\n}\n",
    },
  };
})();

node.hash = "0000";

module.exports = node;
