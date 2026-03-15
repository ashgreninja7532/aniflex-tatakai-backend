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
    // 1. SEARCH
    // ==========================================
    async search(query: string) {
        const res = { animes: [] as any[] };
        try {
            const { data } = await this.client.get(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`);
            const $ = cheerio.load(data);
            
            $("#main-content .tab-content .film_list-wrap .flw-item").each((_, el) => {
                const id = $(el).find(".film-detail .film-name .dynamic-name").attr("href")?.slice(1).split("?")[0] || "";
                const name = $(el).find(".film-detail .film-name .dynamic-name").text().trim();
                const poster = $(el).find(".film-poster .film-poster-img").attr("data-src")?.trim() || "";
                const type = $(el).find(".film-detail .fd-infor .fdi-item:nth-of-type(1)").text().trim();
                
                if (id && name) res.animes.push({ id, name, poster, type });
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
}
