import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://animekai.la";
const ENC_API = "https://enc-dec.app/api";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class AnimeKaiScraper {
    private client = axios.create({
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html, */*; q=0.01",
            "Referer": `${BASE_URL}/`,
            "Cookie": "__ddg1_=;__ddg2_=;" // DDoS-Guard Bypass
        }
    });

    // ==========================================
    // 1. BROWSING & SEARCH
    // ==========================================
    
    private async _scrapeCardPage(url: string) {
        const res = { animes: [] as any[], hasNextPage: false };
        try {
            const { data } = await this.client.get(url);
            const $ = cheerio.load(data);

            res.hasNextPage = $("ul.pagination .page-item.active").next().find("a.page-link").length > 0;

            $(".aitem").each((_, ele) => {
                const card = $(ele);
                const atag = card.find("div.inner > a");
                res.animes.push({
                    id: atag.attr("href")?.replace("/watch/", "") || "",
                    name: atag.text().trim(),
                    poster: card.find("img").attr("data-src") || card.find("img").attr("src") || "",
                    type: card.find(".info").children().last().text().trim(),
                    sub: parseInt(card.find(".info span.sub").text()) || 0,
                    dub: parseInt(card.find(".info span.dub").text()) || 0,
                    episodes: parseInt(card.find(".info").children().eq(-2).text().trim()) || 0,
                });
            });
            return res;
        } catch (err) {
            console.error(`[AnimeKai] Scrape Error for ${url}:`, err);
            return res;
        }
    }

    async search(query: string, page: number = 1) {
        return this._scrapeCardPage(`${BASE_URL}/browser?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}&page=${page}`);
    }

     async filter(queryParams: string, page: number = 1) {
        return this._scrapeCardPage(`${BASE_URL}/browser?${queryParams}&page=${page}`);
    }

    async recentlyUpdated(page: number = 1) { return this._scrapeCardPage(`${BASE_URL}/updates?page=${page}`); }
    async newReleases(page: number = 1) { return this._scrapeCardPage(`${BASE_URL}/new-releases?page=${page}`); }
    async movies(page: number = 1) { return this._scrapeCardPage(`${BASE_URL}/movie?page=${page}`); }
    async genreSearch(genre: string, page: number = 1) { return this._scrapeCardPage(`${BASE_URL}/genres/${genre}?page=${page}`); }

    async genres() {
        try {
            const { data } = await this.client.get(`${BASE_URL}/home`);
            const $ = cheerio.load(data);
            const results: string[] = [];
            $("#menu ul.c4 li a").each((_, ele) => {
                results.push($(ele).text().trim());
            });
            return results;
        } catch (err) { return []; }
    }

    // ==========================================
    // 2. SPOTLIGHT
    // ==========================================
    async getSpotlight() {
        try {
            const { data } = await this.client.get(`${BASE_URL}/home`);
            const $ = cheerio.load(data);
            const results: any[] = [];
            
            $("div.swiper-wrapper > div.swiper-slide").each((_, el) => {
                const card = $(el);
                const titleElement = card.find("div.detail > p.title");
                const style = card.attr("style") || "";
                const banner = style.match(/background-image:\s*url\(["']?(.+?)["']?\)/)?.[1] || "";

                results.push({
                    id: card.find("div.swiper-ctrl > a.btn").attr("href")?.replace("/watch/", "") || "",
                    name: titleElement.text().trim(),
                    poster: banner, // AnimeKai uses banners for spotlight!
                    description: card.find("div.detail > p.desc").text().trim(),
                    sub: parseInt(card.find("div.detail > div.info > span.sub").text().trim()) || 0,
                    dub: parseInt(card.find("div.detail > div.info > span.dub").text().trim()) || 0,
                });
            });
            return results;
        } catch (err) { return []; }
    }

   // ==========================================
    // 3. ANIME INFO & RELATIONS
    // ==========================================
    async getAnimeInfo(animeSlug: string) {
        try {
            const { data } = await this.client.get(`${BASE_URL}/watch/${animeSlug}`);
            const $ = cheerio.load(data);
            const infoBox = $(".entity-scroll");

            const info: any = {
                id: animeSlug,
                name: infoBox.find(".title").text().trim(),
                japaneseTitle: infoBox.find(".title").attr("data-jp")?.trim(),
                poster: $("div.poster > div > img").attr("src"),
                description: infoBox.find(".desc").text().trim(),
                type: infoBox.find(".info").children().last().text().toUpperCase().trim(),
                sub: parseInt(infoBox.find(".info > span.sub").text()) || 0,
                dub: parseInt(infoBox.find(".info > span.dub").text()) || 0,
                episodes: 0,
                genres: [], studios: [], producers: [],
                relations: []
            };

            // Fallback for episodes using badges on the poster
            info.episodes = Math.max(info.sub, info.dub);

            // 🛠️ FIX: Bulletproof Metadata Extraction (Uses raw string matching!)
            infoBox.find(".detail div").each((_, el) => {
                // Normalize spaces so "Date   aired:" becomes "Date aired:"
                const text = $(el).text().replace(/\s+/g, " ").trim(); 

                if (text.startsWith("Genres:")) {
                    info.genres = text.replace("Genres:", "").split(",").map(g => g.trim()).filter(g => g);
                } else if (text.startsWith("Studios:")) {
                    info.studios = text.replace("Studios:", "").split(",").map(s => s.trim()).filter(s => s);
                } else if (text.startsWith("Producers:")) {
                    info.producers = text.replace("Producers:", "").split(",").map(p => p.trim()).filter(p => p);
                } else if (text.startsWith("Status:")) {
                    info.status = text.replace("Status:", "").trim();
                } else if (text.startsWith("Date aired:")) {
                    info.aired = text.replace("Date aired:", "").trim();
                } else if (text.startsWith("Premiered:")) {
                    info.premiered = text.replace("Premiered:", "").trim();
                } else if (text.startsWith("Episodes:")) {
                    const epStr = text.replace("Episodes:", "").trim();
                    const epNum = parseInt(epStr);
                    if (!isNaN(epNum)) info.episodes = epNum;
                }
            });

            // 🛠️ FIX: Extract AniList and MAL IDs safely from the 'Links' section
            infoBox.find(".detail div").filter((_, el) => $(el).text().includes("Links:")).find("a").each((_, el) => {
                const href = $(el).attr("href") || "";
                if (href.includes("myanimelist.net/anime/")) {
                    info.malId = href.split("anime/")[1]?.split("/")[0];
                } else if (href.includes("anilist.co/anime/")) {
                    info.anilistId = href.split("anime/")[1]?.split("/")[0];
                }
            });

            // Extract Relations (Seasons)
            $("#main-content .os-list a.os-item").each((_, el) => {
                info.relations.push({
                    id: $(el).attr("href")?.slice(1)?.trim() || "",
                    name: $(el).attr("title")?.trim() || "",
                    poster: $(el).find(".season-poster").attr("style")?.split(" ")?.pop()?.split("(")?.pop()?.split(")")[0] || "",
                    relationType: "Season",
                    isCurrent: $(el).hasClass("active")
                });
            });

            // Extract Relations (Related Anime side-panel)
            $("section#related-anime .aitem-col a.aitem").each((_, el) => {
                const aTag = $(el);
                info.relations.push({
                    id: aTag.attr("href")?.replace("/watch/", "") || "",
                    name: aTag.find(".title").text().trim(),
                    poster: aTag.attr("style")?.match(/background-image:\s*url\('(.+?)'\)/)?.[1],
                    relationType: aTag.find(".info span > b.text-muted").text().trim() || "Related",
                    sub: parseInt(aTag.find(".info span.sub").text()) || 0,
                    dub: parseInt(aTag.find(".info span.dub").text()) || 0,
                    type: aTag.find(".info").children().last().text().trim(),
                });
            });

            return info;
        } catch (err) {
            console.error("[AnimeKai] Info Error:", err);
            return null;
        }
    }

    // ==========================================
    // 4. EPISODES LIST
    // ==========================================
    async getEpisodes(animeSlug: string) {
        const res = { episodes: [] as any[] };
        try {
            const { data: html } = await this.client.get(`${BASE_URL}/watch/${animeSlug}`);
            const $ = cheerio.load(html);
            const aniId = $(".rate-box#anime-rating").attr("data-id");
            
            if (!aniId) throw new Error("Could not find Anime ID");

            const tokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(aniId)}`);
            const { data: epData } = await this.client.get(`${BASE_URL}/ajax/episodes/list?ani_id=${aniId}&_=${tokenRes.data.result}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            const $$ = cheerio.load(epData.result || epData);
            
            $$("div.eplist > ul > li > a").each((_, el) => {
                const num = $$(el).attr("num")!;
                res.episodes.push({
                    episodeId: `${animeSlug}$ep=${num}$token=${$$(el).attr("token")}`,
                    number: parseInt(num),
                    title: $$(el).children("span").text().trim(),
                    isFiller: $$(el).hasClass("filler")
                });
            });
            return res;
        } catch (err) { return res; }
    }

    // ==========================================
    // 5. SERVERS & CATEGORIES
    // ==========================================
    async getEpisodeServers(episodeData: string) {
        try {
            const token = episodeData.split("$token=")[1];
            if (!token) throw new Error("Invalid Token");

            const ajaxTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(token)}`);
            const { data: serverHtml } = await this.client.get(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxTokenRes.data.result}`);
            
            const raw = serverHtml;
            const htmlStr = typeof raw === "string" ? raw : (raw.result?.html || raw.result || raw.html || JSON.stringify(raw));
            const $ = cheerio.load(htmlStr);
            
            const res = { softsub: [] as any[], sub: [] as any[], dub: [] as any[] };

            $(`.server-items.lang-group[data-id='softsub'] .server, .lang-group[data-id='softsub'] .server`).each((_, el) => {
                res.softsub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });
            $(`.server-items.lang-group[data-id='sub'] .server, .lang-group[data-id='sub'] .server`).each((_, el) => {
                res.sub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });
            $(`.server-items.lang-group[data-id='dub'] .server, .lang-group[data-id='dub'] .server`).each((_, el) => {
                res.dub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });

            return res;
        } catch (err: any) { throw new Error(err.message); }
    }

  // ==========================================
    // 6. SOURCES & DECRYPTION
    // ==========================================
    async getEpisodeSources(episodeData: string, serverName: string = "server 1", category: string = "sub") {
        try {
            const parts = episodeData.split("$ep=");
            const animeSlug = parts[0];
            const token = parts[1]?.split("$token=")[1];

            const ajaxTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(token)}`);
            const { data: serverHtml } = await this.client.get(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxTokenRes.data.result}`);
            
            const raw = serverHtml;
            const htmlStr = typeof raw === "string" ? raw : (raw.result?.html || raw.result || raw.html || JSON.stringify(raw));
            const $ = cheerio.load(htmlStr);
            
            let serverLid = null;
            
            // 1. MATCH EXACT SERVER NAME
            $(`.lang-group[data-id='${category}'] .server`).each((_, el) => {
                if ($(el).text().trim().toLowerCase().includes(serverName.toLowerCase())) {
                    serverLid = $(el).attr("data-lid");
                }
            });

            // 2. FALLBACKS
            if (!serverLid) serverLid = $(`.lang-group[data-id='${category}'] .server`).first().attr("data-lid");
            if (!serverLid) serverLid = $('.server').first().attr('data-lid');
            if (!serverLid) throw new Error(`No server found for category: ${category}`);

            // 3. GET VIEW TOKEN
            const viewTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(serverLid)}`);
            const { data: viewData } = await this.client.get(`${BASE_URL}/ajax/links/view?id=${serverLid}&_=${viewTokenRes.data.result}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            // 4. DECODE URL
            const decIframeRes = await axios.post(`${ENC_API}/dec-kai`, { text: viewData.result });
            const decoded = decIframeRes.data.result;

            const intro = { start: decoded.skip.intro[0], end: decoded.skip.intro[1] };
            const outro = { start: decoded.skip.outro[0], end: decoded.skip.outro[1] };

            // 5. MEGAUP EXTRACTION (TATAKAI API LOGIC)
              const videoUrl = decoded.url;
            
            if (videoUrl.includes("/e/")) {
                const megaUrl = videoUrl.replace("/e/", "/media/");
                const { data: megaData } = await axios.get(megaUrl, { headers: { "User-Agent": USER_AGENT, "Connection": "keep-alive" } });
                const textToDec = typeof megaData === 'object' ? (megaData.result || JSON.stringify(megaData)) : megaData;
                const res = await axios.post(`${ENC_API}/dec-mega`, { text: textToDec, agent: USER_AGENT });
                const finalData = res.data.result;

                return {
                    sources: finalData.sources.map((s: any) => ({ quality: s.file.includes("1080") ? "1080p" : "Auto", url: s.file, type: s.file.includes(".m3u8") || s.file.endsWith("m3u8") ? "hls" : "mp4" })),
                    tracks: finalData.tracks?.map((t: any) => ({ file: t.file, label: t.label, kind: t.kind })) || [],
                    intro, outro, headers: { "Referer": BASE_URL }
                };
            } 
            else if (videoUrl.includes("animekai.la/iframe/")) {
                // 🛠️ FIX: Hand it off to the Flutter app to solve Cloudflare!
                return {
                    requiresClientFetch: true,
                    iframeUrl: videoUrl,
                    intro,
                    outro,
                    headers: { "Referer": "https://animekai.la/" }
                };
            }

            throw new Error(`Unknown video host: ${videoUrl}`);

        } catch (err: any) { throw new Error(err.message); }
    }
}
