import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";

type TvItem = {
  id: number;
  name: string;
  first_air_date?: string;
  poster_path?: string | null;
};

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

const fetchAnime = async () => {
  if (!process.env.TMDB_API_KEY) return null;

  const url = new URL(`${TMDB_BASE_URL}/discover/tv`);
  url.searchParams.set("api_key", process.env.TMDB_API_KEY);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("sort_by", "popularity.desc");
  url.searchParams.set("with_genres", "16");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) return null;

  const data = await response.json();
  return (data.results ?? []) as TvItem[];
};

const getYear = (dateValue?: string) =>
  dateValue ? dateValue.slice(0, 4) : null;

export default async function AnimePage() {
  const results = await fetchAnime();

  return (
    <div className="min-h-screen bg-[#0b0b0c] text-[#e6e6e6]">
      <SiteHeader />
      <main className="min-h-screen px-6 pb-16 pt-24">
        <div className="mx-auto max-w-7xl">
          <div id="search-results-slot" className="mb-6" />
          <div className="page-content">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold">動畫</h1>
              <p className="mt-2 text-sm text-white/60">影集中的動畫類型。</p>
            </div>
            {!results && (
              <p className="text-sm text-white/60">
                目前無法取得資料，請確認 TMDB API Key。
              </p>
            )}
            {results && (
              <ul className="grid gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {results.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col items-start gap-2 rounded-lg border border-white/10 bg-white/5 p-2"
                  >
                    <div className="aspect-[2/3] w-full overflow-hidden rounded-lg border border-white/10 bg-white/5">
                      {item.poster_path ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold text-white/90">
                      {item.name}
                    </p>
                    <p className="text-xs text-white/50">
                      {getYear(item.first_air_date) ?? "未提供"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
