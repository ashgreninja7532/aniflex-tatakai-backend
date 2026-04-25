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
            "Referer": `${BASE_URL}/`,
            // 🛠️ FIX: The legendary DDoS-Guard Bypass Trick from Tatakai!
            "Cookie": "__ddg1_=;__ddg2_=;" 
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
            
            if (!aniId) throw new Error("Could not find Anime ID");

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
    // 3. GET AVAILABLE SERVERS & CATEGORIES
    // ==========================================
    async getEpisodeServers(episodeData: string) {
        try {
            const parts = episodeData.split("$ep=");
            const animeSlug = parts[0];
            const token = parts[1]?.split("$token=")[1];

            if (!token) throw new Error("Invalid AnimeKai Episode Token");

            const ajaxTokenRes = await axios.get(`${ENC_API}/enc-kai?text=${encodeURIComponent(token)}`);
            const ajaxToken = ajaxTokenRes.data.result;

            const { data: serverHtml } = await this.client.get(`${BASE_URL}/ajax/links/list?token=${token}&_=${ajaxToken}`);
            const raw = serverHtml;
            const htmlStr = typeof raw === "string" ? raw : (raw.result?.html || raw.result || raw.html || JSON.stringify(raw));

            const $ = cheerio.load(htmlStr);
            
            const res = { softsub: [] as any[], sub: [] as any[], dub: [] as any[] };

            // Find Soft Sub (VTT)
            $(`.server-items.lang-group[data-id='softsub'] .server, .lang-group[data-id='softsub'] .server`).each((_, el) => {
                res.softsub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });

            // Find Hard Sub (Painted on video)
            $(`.server-items.lang-group[data-id='sub'] .server, .lang-group[data-id='sub'] .server`).each((_, el) => {
                res.sub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });

            // Find Dub (English Audio)
            $(`.server-items.lang-group[data-id='dub'] .server, .lang-group[data-id='dub'] .server`).each((_, el) => {
                res.dub.push({ serverName: $(el).text().trim().toLowerCase(), serverId: $(el).attr("data-lid") });
            });

            return res;
        } catch (err: any) {
            console.error("[AnimeKai] Servers Error:", err.message);
            throw new Error(err.message);
        }
    }
    
    // ==========================================
    // 4. CLIENT DECRYPTOR (For Plan B Handoff)
    // ==========================================
    async decryptClientData(encryptedString: string, intro: any, outro: any) {
        try {
            // Vercel takes the encrypted string that Flutter fetched and decrypts it
            const res = await axios.post(`${ENC_API}/dec-mega`, { text: encryptedString, agent: USER_AGENT });
            const finalData = res.data.result;

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
                intro: intro,
                outro: outro,
                headers: { "Referer": BASE_URL }
            };
        } catch (e: any) {
            console.error("[AnimeKai] Client Decryption Error:", e.message);
            throw new Error(`Client Decryption failed: ${e.message}`);
        }
    }
}
