import {it,expect} from "vitest";
import {filterWatchlistTitles} from "./watchlistSearch";
it("matches Chinese, case and full-width text while preserving items and order",()=>{const a=[{title:"海賊王"},{title:"DUNE"},{title:"Dune 2"}];expect(filterWatchlistTitles(a," 海賊 ")).toEqual([a[0]]);expect(filterWatchlistTitles(a,"ｄｕｎｅ")).toEqual([a[1],a[2]]);expect(filterWatchlistTitles(a,"  ")).toBe(a);expect(filterWatchlistTitles(a,"missing")).toEqual([]);expect(a).toHaveLength(3);});
