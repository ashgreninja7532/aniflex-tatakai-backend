import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://anikototv.to";
const AJAX_URL = "https://anikototv.to/ajax";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class AnikotoScraper {
    // 🛠️ FIX 1: Removed the global XMLHttpRequest header so normal pages load properly
    private client = axios.create({
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Referer": BASE_URL + "/",
        }
    });

    // ==========================================
    // 1. SEARCH & FILTER
    // ==========================================
    async search(query: string, page: number = 1, filters: any = {}) {
        const res = { animes: [] as any[], totalPages: 1, hasNextPage: false };
        try {
            const hasFilters = Object.keys(filters).some(k => filters[k] !== "" && filters[k] !== undefined);
            const routePath = hasFilters || query.trim() === "" ? "/filter" : "/search";
            const urlObj = new URL(`${BASE_URL}${routePath}`);

            if (query.trim() !== "") urlObj.searchParams.set("keyword", query);
            urlObj.searchParams.set("page", page.toString());

            if (filters.genres) urlObj.searchParams.set("genres", filters.genres); 
            if (filters.type) urlObj.searchParams.set("type", filters.type);
            if (filters.status) urlObj.searchParams.set("status", filters.status);
            
            if (filters.sort) urlObj.searchParams.set("sort", filters.sort);
            else if (routePath === "/filter") urlObj.searchParams.set("sort", "default");

            const { data } = await this.client.get(urlObj.href);
            const $ = cheerio.load(data);

            const totalPagesStr = $('.pagination > .page-item a[title="Last"]')?.attr("href")?.split("=").pop() 
                ?? $('.pagination > .page-item a[title="Next"]')?.attr("href")?.split("=").pop() 
                ?? $(".pagination > .page-item.active a")?.text()?.trim() 
                ?? "1";
            
            res.totalPages = Number(totalPagesStr) || 1;
            res.hasNextPage = page < res.totalPages;

            $(".film_list-wrap .flw-item").each((_, el) => {
                const card = this._extractAnimeCard($, el);
                if (card.id && card.name) res.animes.push(card);
            });
            return res;
        } catch (err: any) { throw err; }
    }

    // ==========================================
    // 2. HOME PAGE
    // ==========================================
    async getHomePage() {
        const res = { spotlightAnimes: [] as any[], latestEpisodeAnimes: [] as any[], trendingAnimes: [] as any[], topMovies: [] as any[], mostPopularAnimes: [] as any[] };
        try {
            // 🛠️ FIX 2: Hit /home explicitly
            const { data } = await this.client.get(`${BASE_URL}/home`);
            const $ = cheerio.load(data);

            // SPOTLIGHT
            $("#slider .swiper-wrapper .swiper-slide").each((_, el) => {
                const aTag = $(el).find(".desi-buttons a").last();
                const href = aTag.attr("href") || "";
                const id = href.split('/').pop()?.split('?')[0] || "";
                const imgTag = $(el).find(".film-poster-img");

                if (id) {
                    res.spotlightAnimes.push({
                        id: id,
                        name: $(el).find(".desi-head-title, .dynamic-name").text().trim(),
                        description: $(el).find(".desi-description").text().split("[").shift()?.trim() || "",
                        poster: imgTag.attr("data-src") || imgTag.attr("src") || "",
                        episodes: Number($(el).find(".sc-detail .tick-eps").text().trim()) || 0,
                        sub: Number($(el).find(".sc-detail .tick-sub").text().trim()) || 0,
                        dub: Number($(el).find(".sc-detail .tick-dub").text().trim()) || 0,
                    });
                }
            });

            // LATEST EPISODES
            $("#main-content .block_area_home:nth-of-type(1) .flw-item").each((_, el) => {
                const card = this._extractAnimeCard($, el);
                if (card.id) res.latestEpisodeAnimes.push(card);
            });

            // TRENDING
            $("#trending-home .swiper-wrapper .swiper-slide").each((_, el) => {
                const href = $(el).find(".film-poster").attr("href") || "";
                const imgTag = $(el).find(".film-poster-img");
                if (href) {
                    res.trendingAnimes.push({
                        id: href.split('/').pop()?.split('?')[0] || "",
                        name: $(el).find(".film-title, .dynamic-name").text().trim(),
                        poster: imgTag.attr("data-src") || imgTag.attr("src") || "",
                        episodes: 0, sub: 0, dub: 0
                    });
                }
            });

            // MOST POPULAR
            $("#main-sidebar .block_area-realtime:nth-of-type(2) .anif-block-ul ul li").each((_, el) => {
                const card = this._extractTrendingCard($, el);
                if (card.id) res.mostPopularAnimes.push(card);
            });

            return res;
        } catch (err) { throw err; }
    }
    
    // ==========================================
    // 3. ANIME INFO & ANILIST ID
    // ==========================================
    async getAnimeInfo(animeId: string) {
        const res = { info: {} as any, seasons: [] as any[], relatedAnimes: [] as any[] };
        try {
            const { data } = await this.client.get(`${BASE_URL}/${animeId}`);
            const $ = cheerio.load(data);
            const selector = "#ani_detail .container .anis-content";

            // 🛠️ THE GOLDMINE: Grab AniList ID directly from the page
            try {
                const syncData = JSON.parse($("body").find("#syncData").text() || "{}");
                res.info.anilistId = Number(syncData.anilist_id) || null;
                res.info.malId = Number(syncData.mal_id) || null;
            } catch (err) { res.info.anilistId = null; res.info.malId = null; }

            res.info.id = animeId;
            res.info.name = $(selector).find(".anisc-detail .film-name.dynamic-name").text().trim() || "";
            res.info.description = $(selector).find(".anisc-detail .film-description .text").text().split("[").shift()?.trim() || "";
            res.info.poster = $(selector).find(".film-poster-img").attr("src")?.trim() || "";
            res.info.quality = $(`${selector} .film-stats .tick .tick-quality`).text().trim() || "HD";
            res.info.sub = Number($(`${selector} .film-stats .tick .tick-sub`).text().trim()) || 0;
            res.info.dub = Number($(`${selector} .film-stats .tick .tick-dub`).text().trim()) || 0;
            res.info.type = $(`${selector} .film-stats .tick`).text().trim().replace(/[\s\n]+/g, " ").split(" ").at(-2) || "TV";
            res.info.episodes = res.info.sub || res.info.dub || 0;
            
            res.info.genres = [];
            res.info.studios = [];
            $(`${selector} .anisc-info-wrap .anisc-info .item:not(.w-hide)`).each((_, el) => {
                let key = $(el).find(".item-head").text().toLowerCase().replace(":", "").trim();
                if (key === "genres") res.info.genres = $(el).find("a").map((_2: any, el2: any) => $(el2).text().trim()).get();
                else if (key === "studios") res.info.studios = $(el).find("a").map((_2: any, el2: any) => $(el2).text().trim()).get();
                else if (key === "status") res.info.status = $(el).find(".name").text().trim();
                else if (key === "aired") res.info.aired = $(el).find(".name").text().trim();
            });

            $("#main-sidebar .block_area_sidebar .anif-block-ul ul li").each((_, el) => {
                res.relatedAnimes.push({ ...this._extractTrendingCard($, el), relationType: "Related" });
            });

            return res;
        } catch (err) { throw err; }
    }

    // ==========================================
    // 4. EPISODES LIST
    // ==========================================
    async getEpisodes(animeId: string) {
        const res = { episodes: [] as any[] };
        try {
            const internalId = animeId.split("-").pop();
            const { data } = await this.client.get(`${AJAX_URL}/episode/list/${internalId}`, {
                headers: { "X-Requested-With": "XMLHttpRequest" } // Only needed for AJAX!
            });
            const $ = cheerio.load(data.html);
            
            $(".detail-infor-content .ss-list a").each((_, el) => {
                res.episodes.push({
                    episodeId: $(el).attr("data-id") || "", 
                    number: Number($(el).attr("data-number")),
                    title: $(el).attr("title")?.trim() || `Episode ${$(el).attr("data-number")}`,
                    isFiller: $(el).hasClass("ssl-item-filler")
                });
            });
            return res;
        } catch (err) { throw err; }
    }

    // ==========================================
    // 5. SERVERS
    // ==========================================
    async getEpisodeServers(episodeId: string) {
        const res = { sub: [] as any[], dub: [] as any[] };
        try {
            const { data } = await this.client.get(`${AJAX_URL}/server/list?servers=${episodeId}`, {
                headers: { "X-Requested-With": "XMLHttpRequest" }
            });
            const $ = cheerio.load(data.html);
            
            $(`.ps_-block.ps_-block-sub.servers-sub .ps__-list .server-item`).each((_, el) => {
                res.sub.push({ serverName: $(el).find("a").text().toLowerCase().trim(), serverId: $(el).attr("data-id") });
            });
            $(`.ps_-block.ps_-block-sub.servers-dub .ps__-list .server-item`).each((_, el) => {
                res.dub.push({ serverName: $(el).find("a").text().toLowerCase().trim(), serverId: $(el).attr("data-id") });
            });
            return res;
        } catch (err) { throw err; }
    }

    // ==========================================
    // 6. 🚀 THE PRO WAY: SOURCES DELEGATION
    // ==========================================
    async getEpisodeSources(episodeId: string, serverName: string, category: string) {
        try {
            const servers = await this.getEpisodeServers(episodeId);
            const targetList = category === "dub" ? servers.dub : servers.sub;
            
            const normalizedTarget = serverName === 'vidstreaming' ? 'hd-1' : (serverName === 'megacloud' ? 'hd-2' : serverName);
            const server = targetList.find(s => s.serverName.includes(normalizedTarget)) || targetList[0];
            
            if (!server) throw new Error(`Server ${serverName} not found in ${category}`);

            // Fetch the Megacloud/Megaplay Link
            const { data } = await this.client.get(`${AJAX_URL}/server?get=${server.serverId}`, {
                headers: { "X-Requested-With": "XMLHttpRequest" }
            });

            // 🛠️ We DO NOT decrypt the link here anymore.
            // We tell your Flutter App to open this iframeUrl in a hidden WebView!
            return {
                requiresClientFetch: true,
                iframeUrl: data.link 
            };
        } catch (err) { throw err; }
    }

    // --- INTERNAL SCRAPING HELPERS ---
    private _extractAnimeCard($: any, el: any) {
        const aTag = $(el).find(".film-name a, .dynamic-name").first();
        const href = aTag.attr("href") || $(el).find("a.film-poster").attr("href") || "";
        const id = href.split('/').pop()?.split('?')[0] || "";
        const imgTag = $(el).find(".film-poster-img");

        const sub = Number($(el).find(".tick-sub").text().trim().split(" ").pop()) || 0;
        const dub = Number($(el).find(".tick-dub").text().trim().split(" ").pop()) || 0;

        return {
            id: id,
            name: aTag.text().trim() || imgTag.attr("alt") || "",
            poster: imgTag.attr("data-src") || imgTag.attr("src") || "",
            type: $(el).find(".fdi-item").first().text().trim() || "TV",
            episodes: Number($(el).find(".tick-eps").text().trim().split(" ").pop()) || Math.max(sub, dub) || 0, 
            sub, dub
        };
    }

    private _extractTrendingCard($: any, el: any) {
        const aTag = $(el).find(".film-name a, .dynamic-name").first();
        const href = aTag.attr("href") || $(el).find("a.film-poster").attr("href") || "";
        const id = href.split('/').pop()?.split('?')[0] || "";
        const imgTag = $(el).find(".film-poster-img");

        return {
            id: id,
            name: aTag.text().trim() || imgTag.attr("alt") || "",
            poster: imgTag.attr("data-src") || imgTag.attr("src") || "",
            episodes: Number($(el).find(".tick-eps").text().trim().split(" ").pop()) || 0,
            sub: Number($(el).find(".tick-sub").text().trim().split(" ").pop()) || 0,
            dub: Number($(el).find(".tick-dub").text().trim().split(" ").pop()) || 0
        };
    }
}
