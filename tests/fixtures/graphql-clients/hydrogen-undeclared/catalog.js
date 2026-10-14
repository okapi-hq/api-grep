// Not Hydrogen: the project's own `storefront` object, in a project that does not declare it.
const storefront = {
  query: (sql) => sql.trim(),
};

export function teas(context) {
  return context.storefront.query("select * from teas");
}

export const herbal = () => storefront.query("select * from teas where kind = 'herbal'");
