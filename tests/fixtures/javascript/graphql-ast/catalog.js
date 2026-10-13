// gql documents compiled to objects at build time (babel-plugin-graphql-tag style output)
const { print } = require("graphql");
const { GraphQLClient } = require("graphql-request");

const PriceFields = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PriceFields" },
      typeCondition: { kind: "NamedType", name: { kind: "Name", value: "Product" } },
      directives: [],
      selectionSet: { kind: "SelectionSet", selections: [{ kind: "Field", alias: { kind: "Name", value: "cost" }, name: { kind: "Name", value: "price" }, arguments: [], directives: [] }] },
    },
  ],
  loc: { start: 0, end: 48 },
};

const GET_PRODUCT = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "GetProduct" },
      variableDefinitions: [],
      directives: [],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "product" },
            arguments: [{ kind: "Argument", name: { kind: "Name", value: "sku" }, value: { kind: "StringValue", value: "A-1", block: false } }],
            directives: [],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "title" }, arguments: [], directives: [] },
                { kind: "FragmentSpread", name: { kind: "Name", value: "PriceFields" }, directives: [] },
              ],
            },
          },
        ],
      },
    },
  ].concat(PriceFields.definitions),
  loc: { start: 0, end: 96, source: { body: "query GetProduct { product(sku: \"A-1\") { title ...PriceFields } }", name: "GraphQL request" } },
};

const STOCK = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Stock" },
      selectionSet: { kind: "SelectionSet", selections: [{ kind: "Field", name: { kind: "Name", value: "stock" }, selectionSet: { kind: "SelectionSet", selections: [{ kind: "Field", name: { kind: "Name", value: "count" } }] } }] },
    },
  ],
};

const store = new GraphQLClient("https://api.example-store.com/graphql");

function getProduct() {
  return fetch("https://api.example-store.com/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: print(GET_PRODUCT) }),
  });
}

function stock() {
  return store.request(STOCK);
}

module.exports = { getProduct, stock };
