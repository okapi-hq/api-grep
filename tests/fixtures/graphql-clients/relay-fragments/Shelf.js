import { graphql, usePaginationFragment, usePreloadedQuery, useQueryLoader, useRefetchableFragment } from "react-relay";
import ShelfQuery from "./ShelfQuery.graphql";

export function BookList({ shelf }) {
  const { data, loadNext, hasNext } = usePaginationFragment(
    graphql`
      fragment BookList_shelf on Shelf
      @argumentDefinitions(count: { type: "Int", defaultValue: 10 }, cursor: { type: "String" })
      @refetchable(queryName: "BookListPaginationQuery") {
        books(first: $count, after: $cursor) @connection(key: "BookList_books") {
          edges { node { id title ...BookCard_book } }
        }
      }
    `,
    shelf,
  );
  return { books: data.books.edges, more: hasNext ? () => loadNext(10) : null };
}

export function ReaderBadge({ viewer }) {
  const [data, refetch] = useRefetchableFragment(
    graphql`
      fragment ReaderBadge_viewer on Viewer @refetchable(queryName: "ReaderBadgeRefetchQuery") {
        reader { name booksRead }
      }
    `,
    viewer,
  );
  return { name: data.reader.name, reload: () => refetch({}, { fetchPolicy: "network-only" }) };
}

export function LoanList({ member }) {
  const [data, refetch] = useRefetchableFragment(
    graphql`
      fragment LoanList_member on Member @refetchable(queryName: "LoanListRefetchQuery") {
        loans { dueDate }
      }
    `,
    member,
  );
  return { loans: data.loans, reload: refetch };
}

/** Reads the fragment and never paginates: no request. */
export function ShelfTitle({ shelf }) {
  const { data } = usePaginationFragment(
    graphql`
      fragment ShelfTitle_shelf on Shelf @refetchable(queryName: "ShelfTitlePaginationQuery") {
        title
        books(first: 1) @connection(key: "ShelfTitle_books") { edges { node { id } } }
      }
    `,
    shelf,
  );
  return data.title;
}

export function ShelfPage() {
  const [queryRef, loadShelf] = useQueryLoader(ShelfQuery);
  return { queryRef, open: (id) => loadShelf({ id }) };
}

export function ShelfView({ queryRef }) {
  return usePreloadedQuery(ShelfQuery, queryRef);
}
