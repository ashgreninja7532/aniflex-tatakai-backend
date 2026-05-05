import * as cheerio from "cheerio";
import stringSimilarity from "string-similarity"; // Already in your package.json!

const BASE_URL = "https://animepahe.pw";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DDOS_GUARD_HEADERS = { Cookie: "__ddg1_=;__ddg2_=;" };

// ... (Keep ALL the Utilities & Unpackers exactly as they were in the previous code)
const substringBefore = (str: string, pat: string) => str.indexOf(pat) === -1 ? str : str.substring(0, str.indexOf(pat));
const substringAfter = (str: string, pat: string) => str.indexOf(pat) === -1 ? str : str.substring(str.indexOf(pat) + pat.length);
const substringAfterLast = (str: string, pat: string) => str.split(pat).pop() ?? "";

function decrypt(packedStr: string, key: string, offsetStr: string, delimiterIndex: number): string {
    const offset = parseInt(offsetStr, 10);
    const delimiter = key[delimiterIndex];
    const radix = delimiterIndex;
    let html = "", i = 0;
    while (i < packedStr.length) {
        let chunk = "";
        while (i < packedStr.length && packedStr[i] !== delimiter) { chunk += packedStr[i]; i++; }
        let chunkWithDigits = chunk;
        for (let j = 0; j < key.length; j++) chunkWithDigits = chunkWithDigits.replaceAll(key[j]!, j.toString());
        html += String.fromCharCode(parseInt(chunkWithDigits, radix) - offset);
        i++;
    }
    return html;
}

class UnBase {
    private readonly dictionary: Record<string, number> = {};
    private alphabet = "";
    constructor(private radix: number) {
        const alpha62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        const alpha95 = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';
        if (radix > 36) {
            if (radix <= 62) this.alphabet = alpha62.substring(0, radix);
            else if (radix <= 95) this.alphabet = alpha95.substring(0, radix);
            for (let i = 0; i < this.alphabet.length; i++) this.dictionary[this.alphabet.charAt(i)] = i;
        }
    }
    unBase(str: string): number {
        if (!this.alphabet) return parseInt(str, this.radix);
        return str.split('').reverse().reduce((acc, char, i) => acc + Math.pow(this.radix, i) * (this.dictionary[char] || 0), 0);
    }
}

function unpackJsAndCombine(packedJS: string): string {
    const exp = /\}\s*\('(.*)',\s*(.*?),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s;
    const matches = exp.exec(packedJS);
    if (!matches) throw new Error("Not a valid p.a.c.k.e.r payload");
    let payload = matches[1]!.replace(/\\'/g, "'");
    const radix = parseInt(matches[2]!, 10) || 36;
    const symArray = matches[4]!.split("|");
    const unBase = new UnBase(radix);
    return payload.replace(/\b\w+\b/g, (word) => {
        const index = unBase.unBase(word);
        return (index < symArray.length && symArray[index]) ? symArray[index] : word;
    });
}


export class AnimepaheScraper {
    private headers = { ...DDOS_GUARD_HEADERS };

    async search(query: string) {
        try {
            const res = await fetch(`${BASE_URL}/api?m=search&l=8&q=${encodeURIComponent(query)}`, { headers: this.headers });
            const json: any = await res.json();
            return (json?.data || []).map((item: any) => ({
                id: item.session,
                title: item.title,
                type: item.type,
                episodes: item.episodes,
                status: item.status,
                year: item.year,
                score: item.score,
                poster: item.poster.startsWith("http") ? item.poster : `https://i.animepahe.si/posters/${item.poster}`,
                session: item.session,
            }));
        } catch { return []; }
    }

    async getLatest() {
        try {
            const res = await fetch(`${BASE_URL}/api?m=airing&page=1`, { headers: this.headers });
            const json: any = await res.json();
            return (json?.data || []).map((item: any) => ({
                id: item.anime_session,
                title: item.anime_title,
                episode: item.episode,
                snapshot: item.snapshot.startsWith("http") ? item.snapshot : `https://i.animepahe.si/screenshots/${item.snapshot}`,
                session: item.session,
                fansub: item.fansub,
                created_at: item.created_at,
            }));
        } catch { return []; }
    }

    // 🛠️ FIX: Deep Scrape of Info Page for accurate details!
    async getAnimeInfo(id: string) {
        try {
            const res = await fetch(`${BASE_URL}/anime/${id}`, { headers: this.headers });
            const $ = cheerio.load(await res.text());

            const externalLinks: string[] = [];
            let mal_id, anilist_id;

            $(".external-links a").each((_, el) => {
                const href = $(el).attr("href");
                if (!href) return;
                externalLinks.push(href);
                if (href.includes("myanimelist.net/anime/")) mal_id = Number(href.match(/anime\/(\d+)/)?.[1]);
                if (href.includes("anilist.co/anime/")) anilist_id = Number(href.match(/anime\/(\d+)/)?.[1]);
            });

            // Extract text from the <p> tags in .anime-info
            let type = "TV", episodes = 0, status = "", aired = "", season = "", duration = "", studios = "";
            $(".anime-info p").each((_, el) => {
                const text = $(el).text().trim();
                if (text.includes("Type:")) type = text.replace("Type:", "").trim();
                if (text.includes("Episodes:")) episodes = Number(text.replace("Episodes:", "").trim());
                if (text.includes("Status:")) status = text.replace("Status:", "").trim();
                if (text.includes("Aired:")) aired = text.replace("Aired:", "").trim();
                if (text.includes("Season:")) season = text.replace("Season:", "").trim();
                if (text.includes("Duration:")) duration = text.replace("Duration:", "").trim();
                if (text.includes("Studios:")) studios = text.replace("Studios:", "").trim();
            });

            return {
                id,
                name: $('span[style="user-select:text"]').text().trim(),
                description: $(".anime-synopsis").text().trim(),
                poster: $('img[data-src$=".jpg"]').attr("data-src")?.trim() || null,
                background: $("div.anime-cover").attr("data-src")?.trim() || null,
                genres: $(".anime-genre li").map((_, el) => $(el).text().trim()).get(),
                type, episodes, status, aired, season, duration, studios: studios.split(", "),
                externalLinks, mal_id, anilistId: anilist_id // We use anilistId for matching!
            };
        } catch { return null; }
    }

    // 🛠️ NEW: THE DYNAMIC MATCHER ALGORITHM
    async findMapping(anilistId: number, titles: string[], year: number) {
        try {
            // 1. Compile all potential search results from different titles (Romaji, English)
            let searchResults: any[] = [];
            for (const title of titles) {
                if (!title) continue;
                const results = await this.search(title);
                searchResults.push(...results);
            }

            // Remove duplicates by session ID
            searchResults = searchResults.filter((v, i, a) => a.findIndex(t => (t.id === v.id)) === i);

            // 2. Filter by Year if available to narrow down
            if (year > 0) {
                const yearFiltered = searchResults.filter(r => r.year === year);
                if (yearFiltered.length > 0) searchResults = yearFiltered; 
            }

            // 3. Take the Top 3 closest matches via String Similarity to save server time
            const primaryTitle = titles[0] || "";
            searchResults.sort((a, b) => {
                const simA = stringSimilarity.compareTwoStrings(primaryTitle.toLowerCase(), a.title.toLowerCase());
                const simB = stringSimilarity.compareTwoStrings(primaryTitle.toLowerCase(), b.title.toLowerCase());
                return simB - simA; // Highest similarity first
            });

            const topResults = searchResults.slice(0, 3);

            // 4. Verify against the Info page's External Links
            for (const result of topResults) {
                const info = await this.getAnimeInfo(result.id);
                if (info && info.anilistId === anilistId) {
                    return result.id; // PERFECT MATCH FOUND!
                }
            }

            return null; // No match found on AnimePahe
        } catch (e) {
            console.error("Mapping error:", e);
            return null;
        }
    }

    async getEpisodes(id: string) {
        try {
            const firstPageRes = await fetch(`${BASE_URL}/api?m=release&id=${id}&sort=episode_dsc&page=1`, { headers: this.headers });
            const firstPage: any = await firstPageRes.json();
            if (!firstPage?.data) return [];
            let allData = [...firstPage.data];
            if (firstPage.last_page > 1) {
                const pages = Array.from({ length: firstPage.last_page - 1 }, (_, i) => i + 2);
                const remaining = await Promise.all(pages.map(p => fetch(`${BASE_URL}/api?m=release&id=${id}&sort=episode_dsc&page=${p}`, { headers: this.headers }).then(r => r.json())));
                for (const pageData of remaining as any[]) {
                    if (pageData?.data) allData = allData.concat(pageData.data);
                }
            }
            return allData.map((ep: any) => ({
                title: ep.title || `Episode ${ep.episode}`, episode: ep.episode,
                released: new Date(ep.created_at).toISOString(),
                snapshot: ep.snapshot.startsWith("http") ? ep.snapshot : `https://i.animepahe.si/screenshots/${ep.snapshot}`,
                duration: ep.duration, filler: ep.filler === 1, session: ep.session,
            })).sort((a, b) => a.episode - b.episode);
        } catch { return []; }
    }

    async getSources(animeId: string, episodeSession: string) {
        const sources = [];
        try {
            const res = await fetch(`${BASE_URL}/play/${animeId}/${episodeSession}`, { headers: this.headers });
            const html = await res.text();
            const $ = cheerio.load(html);
            const buttons = $("div#resolutionMenu > button").toArray();
            for (let i = 0; i < buttons.length; i++) {
                const btn = $(buttons[i]);
                const audio = btn.attr("data-audio") ?? "unknown";
                const kwikLink = btn.attr("data-src") ?? "";
                const quality = btn.attr("data-resolution") ?? "unknown";
                if (kwikLink) {
                    sources.push({ quality, audio, url: kwikLink, isM3U8: false });
                }
            }
        } catch (err: any) {}
        return { sources };
    }
}