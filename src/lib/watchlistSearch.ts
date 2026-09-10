export function filterWatchlistTitles<T extends { title: string }>(items: T[], query: string): T[] {
  const needle = query.normalize("NFKC").trim().toLocaleLowerCase();
  return needle ? items.filter(item => item.title.normalize("NFKC").toLocaleLowerCase().includes(needle)) : items;
}
