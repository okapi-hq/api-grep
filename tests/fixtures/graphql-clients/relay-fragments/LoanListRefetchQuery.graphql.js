/**
 * @generated SignedSource<<00000000000000000000000000000000>>
 * @flow
 */

"use strict";

var node = (function () {
  var v0 = [{ defaultValue: null, kind: "LocalArgument", name: "id" }];
  return {
    fragment: { argumentDefinitions: v0, kind: "Fragment", metadata: null, name: "LoanListRefetchQuery", selections: [], type: "Query", abstractKey: null },
    kind: "Request",
    operation: { argumentDefinitions: v0, kind: "Operation", name: "LoanListRefetchQuery", selections: [] },
    params: {
      cacheID: "0000",
      id: null,
      metadata: {},
      name: "LoanListRefetchQuery",
      operationKind: "query",
      text: "query LoanListRefetchQuery(\n  $id: ID!\n) {\n  node(id: $id) {\n    __typename\n    ...LoanList_member\n    id\n  }\n}\n\nfragment LoanList_member on Member {\n  loans {\n    dueDate\n  }\n  id\n}\n",
    },
  };
})();

node.hash = "0000";

module.exports = node;
