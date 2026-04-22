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
            "Accept-Language": "en-US,en;q=0.5",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-origin",
            "Pragma": "no-cache",
            "Cache-Control": "no-cache",
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
            const { data: html } = await this.client.get(`${BASE_URL}/watch/${animeSlug}`);
            const $ = cheerio.load(html);
            const aniId = $(".rate-box#anime-rating").attr("data-id");
            
            if (!aniId) {
                if (html.includes("Just a moment") || html.includes("Cloudflare")) {
                    throw new Error("Cloudflare blocked Vercel on Episode List fetch!");
                }
                throw new Error("Could not find Anime ID");
            }

            const tokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(aniId)}`);
            const episodesToken = tokenRes.data.result;

            const { data: epData } = await this.client.get(`${BASE_URL}/ajax/episodes/list?ani_id=${aniId}&_=${episodesToken}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            const $$ = cheerio.load(epData.result || epData);
            
            $$("div.eplist > ul > li > a").each((_, el) => {
                const numAttr = $$(el).attr("num")!;
                const tokenAttr = $$(el).attr("token")!;
                
                res.episodes.push({
                    episodeId: `${animeSlug}$ep=${numAttr}$token=${tokenAttr}`,
                    number: parseInt(numAttr),
                    title: $$(el).children("span").text().trim(),
                    isFiller: $$(el).hasClass("filler")
                });
            });
            return res;
        } catch (err: any) {
            console.error("[AnimeKai] Episodes Error:", err.message);
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

            // 1. Decrypt Token
            const ajaxTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(token)}`);
            const ajaxToken = ajaxTokenRes.data.result;
            
            if (!ajaxToken) throw new Error("enc-dec.app API failed to generate token!");

            // 2. Fetch Servers HTML
           const { data: rawServerData } = await this.client.get(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxToken}`);
            
            // 🛠️ FIX: Safely extract the HTML string out of AnimeKai's JSON wrapper!
            const serverHtml = typeof rawServerData === "string" 
                ? rawServerData 
                : (rawServerData.result?.html || rawServerData.result || rawServerData.html || JSON.stringify(rawServerData));
            
            // Check for Cloudflare Block
            if (serverHtml.includes("Just a moment") || serverHtml.includes("Cloudflare")) {
                console.error("[AnimeKai] FATAL: Vercel IP blocked by Cloudflare on Server Fetch!");
                throw new Error("Blocked by Cloudflare");
            }

            const $ = cheerio.load(serverHtml);
            const targetTypes = category === "dub" ? ["dub"] : ["softsub", "sub", "raw"];
            let serverLid = null;

            for (const type of targetTypes) {
                serverLid = $(`.server-items.lang-group[data-id='${type}'] .server`).first().attr("data-lid") ||
                            $(`.lang-group[data-id='${type}'] .server`).first().attr("data-lid");
                if (serverLid) break; 
            }
            
            if (!serverLid) {
                serverLid = $('.server').first().attr('data-lid');
            }
            
            if (!serverLid) {
                console.error("[AnimeKai] SERVER HTML DUMP:", serverHtml.substring(0, 500));
                throw new Error(`No server found for category: ${category}. See logs for HTML dump.`);
            }

            // 3. View the Link
            const viewTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(serverLid)}`);
            const { data: viewData } = await this.client.get(`${BASE_URL}/ajax/links/view?id=${serverLid}&_=${viewTokenRes.data.result}`, {
                headers: { "X-Requested-With": "XMLHttpRequest", "Referer": `${BASE_URL}/watch/${animeSlug}` }
            });

            // 4. Decode Iframe
            const decIframeRes = await axios.post(`${ENC_API}/dec-kai`, { text: viewData.result });
            const decoded = decIframeRes.data.result;

            // 5. Decrypt MegaUp Video
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
            console.error("[AnimeKai] Sources Error:", err.message);
            throw new Error(err.message); 
        }
    }
}
