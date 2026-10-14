import { gql } from "graphql-tag";

const ENDPOINT = "https://api.example-warehouse.dev/graphql";

// selection sets nested 40 deep, past the nesting bound
const DEEP = gql`query DeepShelf { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { a { id } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } } }`;

// each fragment spreads the one below twice: 2^15 selection sets to inline
const EXPANDED = gql`
  query ExpandedShelf { shelf { ...Level15 } }
  fragment Level0 on Shelf { bin { id } }
  fragment Level1 on Shelf { ...Level0 ...Level0 }
  fragment Level2 on Shelf { ...Level1 ...Level1 }
  fragment Level3 on Shelf { ...Level2 ...Level2 }
  fragment Level4 on Shelf { ...Level3 ...Level3 }
  fragment Level5 on Shelf { ...Level4 ...Level4 }
  fragment Level6 on Shelf { ...Level5 ...Level5 }
  fragment Level7 on Shelf { ...Level6 ...Level6 }
  fragment Level8 on Shelf { ...Level7 ...Level7 }
  fragment Level9 on Shelf { ...Level8 ...Level8 }
  fragment Level10 on Shelf { ...Level9 ...Level9 }
  fragment Level11 on Shelf { ...Level10 ...Level10 }
  fragment Level12 on Shelf { ...Level11 ...Level11 }
  fragment Level13 on Shelf { ...Level12 ...Level12 }
  fragment Level14 on Shelf { ...Level13 ...Level13 }
  fragment Level15 on Shelf { ...Level14 ...Level14 }
`;

// more than 50 operations sent together
const COUNTS = `
  query Count0 { count0 } query Count1 { count1 } query Count2 { count2 } query Count3 { count3 } query Count4 { count4 } query Count5 { count5 }
  query Count6 { count6 } query Count7 { count7 } query Count8 { count8 } query Count9 { count9 } query Count10 { count10 } query Count11 { count11 }
  query Count12 { count12 } query Count13 { count13 } query Count14 { count14 } query Count15 { count15 } query Count16 { count16 } query Count17 { count17 }
  query Count18 { count18 } query Count19 { count19 } query Count20 { count20 } query Count21 { count21 } query Count22 { count22 } query Count23 { count23 }
  query Count24 { count24 } query Count25 { count25 } query Count26 { count26 } query Count27 { count27 } query Count28 { count28 } query Count29 { count29 }
  query Count30 { count30 } query Count31 { count31 } query Count32 { count32 } query Count33 { count33 } query Count34 { count34 } query Count35 { count35 }
  query Count36 { count36 } query Count37 { count37 } query Count38 { count38 } query Count39 { count39 } query Count40 { count40 } query Count41 { count41 }
  query Count42 { count42 } query Count43 { count43 } query Count44 { count44 } query Count45 { count45 } query Count46 { count46 } query Count47 { count47 }
  query Count48 { count48 } query Count49 { count49 } query Count50 { count50 }
`;

const SMALL = gql`query SmallShelf { shelf { id } }`;

export const deepShelf = () => fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ query: DEEP }) });
export const expandedShelf = () => fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ query: EXPANDED }) });
export const counts = () => fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ query: COUNTS }) });
export const smallShelf = () => fetch(ENDPOINT, { method: "POST", body: JSON.stringify({ query: SMALL }) });
