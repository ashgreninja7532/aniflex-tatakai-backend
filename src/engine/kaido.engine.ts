import axios from "axios";
import * as cheerio from "cheerio";
import CryptoJS from "crypto-js";

const BASE_URL = "https://kaido.to";
const AJAX_URL = "https://kaido.to/ajax";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class KaidoScraper {
    private client = axios.create({
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Referer": BASE_URL,
            "X-Requested-With": "XMLHttpRequest"
        }
    });

 // ==========================================
    // 1. SEARCH & ADVANCED SEARCH (Combined)
    // ==========================================
    async search(query: string, page: number = 1, filters: any = {}) {
        const res = { animes: [] as any[], hasNextPage: false };
        try {
            // Build the base URL
            let url = `${BASE_URL}/search?keyword=${encodeURIComponent(query)}&page=${page}`;

            // 🛠️ FIX: Add the advanced filters (like genre) to the URL
            if (filters.genres) {
                url += `&genre=${filters.genres}`;
            }

            const { data } = await this.client.get(url);
            const $ = cheerio.load(data);
            
            res.hasNextPage = $(".pagination > li").last().hasClass("active") ? false : ($(".pagination > li").length > 0);

            $(".film_list-wrap .flw-item").each((_, el) => {
                const id = $(el).find(".film-detail .film-name .dynamic-name").attr("href")?.slice(1).split("?")[0] || "";
                const name = $(el).find(".film-detail .film-name .dynamic-name").text().trim();
                const poster = $(el).find(".film-poster .film-poster-img").attr("data-src")?.trim() || "";
                const type = $(el).find(".film-detail .fd-infor .fdi-item:nth-of-type(1)").text().trim();
                
                const sub = Number($(el).find(".film-poster .tick-sub").text().trim().split(" ").pop()) || 0;
                const dub = Number($(el).find(".film-poster .tick-dub").text().trim().split(" ").pop()) || 0;
                
                if (id && name) res.animes.push({ id, name, poster, type, sub, dub });
            });
            return res;
        } catch (err) { throw err; }
    }
    
    // ==========================================
    // 2. EPISODES LIST (Updated URL logic)
    // ==========================================
    async getEpisodes(animeId: string) {
        const res = { episodes: [] as any[] };
        try {
            const internalId = animeId.split("-").pop();
            const { data } = await this.client.get(`${AJAX_URL}/episode/list/${internalId}`);
            const $ = cheerio.load(data.html);
            
            $(".detail-infor-content .ss-list a").each((_, el) => {
                res.episodes.push({
                    episodeId: $(el).attr("href")?.split("/").pop() || "",
                    number: Number($(el).attr("data-number")),
                    title: $(el).attr("title")?.trim() || `Episode ${$(el).attr("data-number")}`,
                    isFiller: $(el).hasClass("ssl-item-filler")
                });
            });
            return res;
        } catch (err) { throw err; }
    }

    // ==========================================
    // 3. SERVERS LIST
    // ==========================================
    async getEpisodeServers(episodeId: string) {
        const res = { sub: [] as any[], dub: [] as any[] };
        try {
            const epId = episodeId.split("?ep=")[1];
            const { data } = await this.client.get(`${AJAX_URL}/episode/servers?episodeId=${epId}`);
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
    // 4. SOURCES & DECRYPTION (Updated URL logic)
    // ==========================================
    async getEpisodeSources(episodeId: string, serverName: string, category: string) {
        try {
            const servers = await this.getEpisodeServers(episodeId);
            const targetList = category === "dub" ? servers.dub : servers.sub;
            
            // Normalize server names (App says 'vidstreaming', site might say 'hd-1')
            const normalizedTarget = serverName === 'vidstreaming' ? 'hd-1' : serverName;
            const server = targetList.find(s => s.serverName === normalizedTarget || s.serverName === serverName) || targetList[0];
            
            if (!server) throw new Error(`Server ${serverName} not found in ${category}`);

            // Fetch the Megacloud/RapidCloud link
            const { data } = await this.client.get(`${AJAX_URL}/episode/sources?id=${server.serverId}`);
            return await this.extractMegacloud(data.link);
        } catch (err) { throw err; }
    }

// --- MEGACLOUD AES DECRYPTOR ---
    private async extractMegacloud(url: string) {
        try {
            const parsedUrl = new URL(url);
            const host = parsedUrl.host;
            const sourceId = parsedUrl.pathname.split("/").pop()?.split("?")[0];
            
            if (!sourceId) throw new Error("Could not find Source ID in URL.");

            let rawSourceData;

            // 🛠️ FIX: We try the /v2/ URL you found first!
            try {
                const { data } = await axios.get(`https://${host}/embed-2/v2/e-1/getSources?id=${sourceId}`, {
                    headers: { "X-Requested-With": "XMLHttpRequest", Referer: url }
                });
                rawSourceData = data;
            } catch (e) {
                // If /v2/ throws a 404, we automatically fallback to /ajax/
                const { data } = await axios.get(`https://${host}/embed-2/ajax/e-1/getSources?id=${sourceId}`, {
                    headers: { "X-Requested-With": "XMLHttpRequest", Referer: url }
                });
                rawSourceData = data;
            }

            const extractedData = {
                sources: [] as any[], tracks: [] as any[],
                intro: rawSourceData.intro, outro: rawSourceData.outro,
                headers: { "Referer": `https://${host}/` }
            };

            extractedData.tracks = rawSourceData.tracks?.map((track: any) => ({
                url: track.file, lang: track.label || track.kind
            })) || [];

            // 2. If it's NOT encrypted, return immediately
            if (!rawSourceData.encrypted && Array.isArray(rawSourceData.sources)) {
                extractedData.sources = rawSourceData.sources.map((s: any) => ({ url: s.file, type: s.type }));
                return extractedData;
            }

            // 3. If it IS encrypted, fetch the master key from GitHub
            const { data: keyData } = await axios.get("https://raw.githubusercontent.com/itzzzme/megacloud-keys/refs/heads/main/key.txt");
            
            // 4. Decrypt the string using AES!
            const decrypted = CryptoJS.AES.decrypt(rawSourceData.sources, keyData.trim()).toString(CryptoJS.enc.Utf8);
            const decryptedSources = JSON.parse(decrypted);

            extractedData.sources = decryptedSources.map((s: any) => ({ url: s.file, type: s.type }));
            return extractedData;

        } catch (err) { throw new Error(`Decryption failed: ${err}`); }
    }

 // ==========================================
    // 5. HOME PAGE DATA
    // ==========================================
    async getHomePage() {
        const res = { spotlightAnimes: [] as any[], trendingAnimes: [] as any[], topMovies: [] as any[], latestEpisodeAnimes: [] as any[], mostPopularAnimes: [] as any[] };
        try {
            const { data } = await this.client.get(`${BASE_URL}/home`);
            const $ = cheerio.load(data);

            $("#slider .swiper-wrapper .swiper-slide").each((_, el) => {
                res.spotlightAnimes.push({
                    id: $(el).find(".desi-buttons a").last().attr("href")?.slice(1)?.trim() || "",
                    name: $(el).find(".desi-head-title.dynamic-name").text().trim(),
                    description: $(el).find(".desi-description").text().split("[").shift()?.trim() || "",
                    poster: $(el).find(".film-poster-img").attr("data-src")?.trim() || "",
                    sub: Number($(el).find(".sc-detail .scd-item .tick-item.tick-sub").text().trim()) || 0,
                    dub: Number($(el).find(".sc-detail .scd-item .tick-item.tick-dub").text().trim()) || 0,
                });
            });

            $("#trending-home .swiper-wrapper .swiper-slide").each((_, el) => {
                res.trendingAnimes.push({
                    id: $(el).find(".film-poster").attr("href")?.slice(1)?.trim() || "",
                    name: $(el).find(".film-title.dynamic-name").text().trim(),
                    poster: $(el).find(".film-poster-img").attr("data-src")?.trim() || ""
                });
            });

            $("#main-content .block_area_home:nth-of-type(1) .tab-content .film_list-wrap .flw-item").each((_, el) => {
                res.latestEpisodeAnimes.push(this._extractAnimeCard($, el));
            });

             $("#main-sidebar .block_area.block_area_sidebar.block_area-realtime:nth-of-type(2) .anif-block-ul ul li").each((_, el) => {
                res.mostPopularAnimes.push(this._extractTrendingCard($, el));
            });

            // 🛠️ FIX: Fetch Top Movies
            // We do a quick, silent second fetch to the /movie page to grab the top movies!
            const movieRes = await this.client.get(`${BASE_URL}/movie`);
            const $m = cheerio.load(movieRes.data);
            $m("#main-content .tab-content .film_list-wrap .flw-item").slice(0, 10).each((_, el) => {
                res.topMovies.push(this._extractAnimeCard($m, el));
            });

            return res;
        } catch (err) { throw err; }
    }

    // ==========================================
    // 6. ANIME INFO (Details Screen)
    // ==========================================
    async getAnimeInfo(animeId: string) {
        const res = { info: {} as any, seasons: [] as any[], relatedAnimes: [] as any[] };
        try {
            const { data } = await this.client.get(`${BASE_URL}/${animeId}`);
            const $ = cheerio.load(data);
            const selector = "#ani_detail .container .anis-content";

            res.info.id = animeId;
            res.info.name = $(selector).find(".anisc-detail .film-name.dynamic-name").text().trim() || "";
            res.info.description = $(selector).find(".anisc-detail .film-description .text").text().split("[").shift()?.trim() || "";
            res.info.poster = $(selector).find(".film-poster-img").attr("src")?.trim() || "";
            res.info.quality = $(`${selector} .film-stats .tick .tick-quality`).text().trim() || "HD";
            res.info.sub = Number($(`${selector} .film-stats .tick .tick-sub`).text().trim()) || 0;
            res.info.dub = Number($(`${selector} .film-stats .tick .tick-dub`).text().trim()) || 0;
            res.info.type = $(`${selector} .film-stats .tick`).text().trim().replace(/[\s\n]+/g, " ").split(" ").at(-2) || "TV";
            
            // 🛠️ FIX: Proper loop for Genres, Studios, Status, Aired
            res.info.genres = [];
            res.info.studios = [];
            $(`${selector} .anisc-info-wrap .anisc-info .item:not(.w-hide)`).each((_, el) => {
                let key = $(el).find(".item-head").text().toLowerCase().replace(":", "").trim();
                if (key === "genres") {
                    res.info.genres = $(el).find("a").map((_2, el2) => $(el2).text().trim()).get();
                } else if (key === "studios") {
                    res.info.studios = $(el).find("a").map((_2, el2) => $(el2).text().trim()).get();
                } else if (key === "status") {
                    res.info.status = $(el).find(".name").text().trim();
                } else if (key === "aired") {
                    res.info.aired = $(el).find(".name").text().trim();
                }
            });

            // Seasons
            $("#main-content .os-list a.os-item").each((_, el) => {
                res.seasons.push({
                    id: $(el).attr("href")?.slice(1)?.trim() || "",
                    name: $(el).attr("title")?.trim() || "",
                    poster: $(el).find(".season-poster").attr("style")?.split(" ")?.pop()?.split("(")?.pop()?.split(")")[0] || "",
                    isCurrent: $(el).hasClass("active")
                });
            });

            // 🛠️ FIX: Related Anime selector from hianime.ts
            $("#main-sidebar .block_area.block_area_sidebar.block_area-realtime:nth-of-type(1) .anif-block-ul ul li").each((_, el) => {
                res.relatedAnimes.push(this._extractTrendingCard($, el));
            });

            return res;
        } catch (err) { throw err; }
    }

     // ==========================================
    // 7. ESTIMATED SCHEDULE
    // ==========================================
    async getEstimatedSchedule(date: string) {
        const res = { scheduledAnimes: [] as any[] };
        try {
            const { data } = await this.client.get(`${AJAX_URL}/schedule/list?tzOffset=-330&date=${date}`);
            const $ = cheerio.load(data.html);

            $("li").each((_, el) => {
                res.scheduledAnimes.push({
                    id: $(el).find("a").attr("href")?.slice(1)?.trim() || "",
                    time: $(el).find("a .time").text().trim() || "",
                    name: $(el).find("a .film-name.dynamic-name").text().trim() || "",
                    episode: Number($(el).find("a .fd-play button").text().trim().split(" ")[1]) || 0
                });
            });
            return res;
        } catch (err) { throw err; }
    }

    // --- INTERNAL UI SCRAPING HELPERS ---
    private _extractAnimeCard($: any, el: any) {
        return {
            id: $(el).find(".dynamic-name").attr("href")?.slice(1).split("?")[0] || "",
            name: $(el).find(".dynamic-name").text().trim(),
            poster: $(el).find(".film-poster-img").attr("data-src")?.trim() || "",
                        sub: Number($(el).find(".tick-sub").text().trim().split(" ").pop()) || 0,
            dub: Number($(el).find(".tick-dub").text().trim().split(" ").pop()) || 0,
            episodes: Number($(el).find(".tick-sub").text().trim().split(" ").pop()) || 0,
            type: $(el).find(".fdi-item:nth-of-type(1)").text().trim()
        };
    }

    private _extractTrendingCard($: any, el: any) {
        return {
            id: $(el).find(".dynamic-name").attr("href")?.slice(1).trim() || "",
            name: $(el).find(".dynamic-name").text().trim(),
            poster: $(el).find(".film-poster-img").attr("data-src")?.trim() || "",
            episodes: Number($(el).find(".tick-sub").text().trim()) || 0,
            sub: Number($(el).find(".tick-sub").text().trim()) || 0,
            dub: Number($(el).find(".tick-dub").text().trim()) || 0
        };
    }

    
}
