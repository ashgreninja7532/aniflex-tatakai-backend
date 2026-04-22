import axios from "axios";
import * as cheerio from "cheerio";

const BASE_URL = "https://anikai.to";
const ENC_API = "https://enc-dec.app/api";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class AnimeKaiScraper {
    private client = axios.create({
        headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html, */*; q=0.01",
            "Referer": `${BASE_URL}/`
        }
    });

    // ==========================================
    // 1. SEARCH
    // ==========================================
    async search(query: string, page: number = 1) {
        const res = { animes: [] as any[], hasNextPage: false };
        try {
            const url = `${BASE_URL}/browser?keyword=${encodeURIComponent(query.replace(/[\W_]+/g, "+"))}&page=${page}`;
            const { data } = await this.client.get(url);
            const $ = cheerio.load(data);

            const nextPageHref = $("ul.pagination .page-item.active").next().find("a.page-link").attr("href");
            res.hasNextPage = !!nextPageHref;

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
                });
            });
            return res;
        } catch (err) {
            console.error("[AnimeKai] Search Error:", err);
            return res;
        }
    }

    // ==========================================
    // 2. EPISODES LIST
    // ==========================================
    async getEpisodes(animeSlug: string) {
        const res = { episodes: [] as any[] };
        try {
            // First, get the internal ani_id
            const { data: html } = await this.client.get(`${BASE_URL}/watch/${animeSlug}`);
            const $ = cheerio.load(html);
            const aniId = $(".rate-box#anime-rating").attr("data-id");
            if (!aniId) throw new Error("Could not find Anime ID");

            // Generate decryption token
            const tokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(aniId)}`);
            const episodesToken = tokenRes.data.result;

            // Fetch episodes
            const { data: epData } = await this.client.get(`${BASE_URL}/ajax/episodes/list?ani_id=${aniId}&_=${episodesToken}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            const $$ = cheerio.load(epData.result);
            
            $$("div.eplist > ul > li > a").each((_, el) => {
                const numAttr = $$(el).attr("num")!;
                const tokenAttr = $$(el).attr("token")!;
                
                res.episodes.push({
                    // AnimeKai needs the slug, episode number, and token bundled together for sources
                    episodeId: `${animeSlug}$ep=${numAttr}$token=${tokenAttr}`,
                    number: parseInt(numAttr),
                    title: $$(el).children("span").text().trim(),
                    isFiller: $$(el).hasClass("filler")
                });
            });
            return res;
        } catch (err) {
            console.error("[AnimeKai] Episodes Error:", err);
            return res;
        }
    }

    // ==========================================
    // 3. SOURCES & DECRYPTION (MegaUp Extractor)
    // ==========================================
    async getEpisodeSources(episodeData: string, serverName: string = "megaup", category: string = "sub") {
        try {
            const subOrDub = category === "dub" ? "dub" : "softsub";
            const parts = episodeData.split("$ep=");
            const animeSlug = parts[0];
            const token = parts[1]?.split("$token=")[1];

            if (!token) throw new Error("Invalid AnimeKai Episode Token");

            const ajaxTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(token)}`);
            const ajaxToken = ajaxTokenRes.data.result;

            // Fetch Servers
             const { data: serverHtml } = await this.client.get(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxToken}`);
            const $ = cheerio.load(serverHtml);
            
            // 🛠️ FIX: Array of target types to handle both softsub and hardsub!
            const targetTypes = category === "dub" ? ["dub"] : ["softsub", "sub"];
            let serverLid = null;

            for (const type of targetTypes) {
                serverLid = $(`.server-items.lang-group[data-id='${type}'] .server`).first().attr("data-lid") ||
                            $(`.lang-group[data-id='${type}'] .server`).first().attr("data-lid");
                
                if (serverLid) break; // Stop looking once we find a valid server
            }
            
            if (!serverLid) throw new Error(`No server found for category: ${category}`);

            // View the Link
            const viewTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(serverLid)}`);
            const { data: viewData } = await this.client.get(`${BASE_URL}/ajax/links/view?id=${serverLid}&_=${viewTokenRes.data.result}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            // Decode Iframe
            const decIframeRes = await axios.post(`${ENC_API}/dec-kai`, { text: viewData.result });
            const decoded = decIframeRes.data.result;

            // Decrypt MegaUp Video
            const megaUrl = decoded.url.replace("/e/", "/media/");
            const { data: megaData } = await axios.get(megaUrl, { headers: { "User-Agent": USER_AGENT, "Referer": BASE_URL } });
            
            const decryptMegaRes = await axios.post(`${ENC_API}/dec-mega`, { text: megaData.result, agent: USER_AGENT });
            const finalData = decryptMegaRes.data.result;

            return {
                sources: finalData.sources.map((s: any) => ({
                    url: s.file,
                    type: s.file.includes(".m3u8") ? "hls" : "mp4"
                })),
                tracks: finalData.tracks.map((t: any) => ({
                    file: t.file,
                    label: t.label,
                    kind: t.kind
                })),
                intro: { start: decoded.skip.intro[0], end: decoded.skip.intro[1] },
                outro: { start: decoded.skip.outro[0], end: decoded.skip.outro[1] },
                headers: { "Referer": BASE_URL }
            };

        } catch (err: any) {
            // 🛠️ FIX: Now throws the actual error message so the router can display it in the browser!
            console.error("[AnimeKai] Sources Error:", err.message);
            throw new Error(err.message); 
        }
    }
}
