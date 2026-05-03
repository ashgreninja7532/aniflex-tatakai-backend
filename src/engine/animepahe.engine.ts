import * as cheerio from "cheerio";

const BASE_URL = "https://animepahe.pw";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DDOS_GUARD_HEADERS = { Cookie: "__ddg1_=;__ddg2_=;" };

// ==========================================
// UTILITIES & UNPACKERS
// ==========================================
const substringBefore = (str: string, pat: string) => str.indexOf(pat) === -1 ? str : str.substring(0, str.indexOf(pat));
const substringAfter = (str: string, pat: string) => str.indexOf(pat) === -1 ? str : str.substring(str.indexOf(pat) + pat.length);
const substringAfterLast = (str: string, pat: string) => str.split(pat).pop() ?? "";
const getMapValue = (mapStr: string, key: string) => { try { const m = JSON.parse(mapStr); return m[key] != null ? String(m[key]) : ""; } catch { return ""; } };

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

// ==========================================
// CORE SCRAPER ENGINE
// ==========================================
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

            return {
                id,
                name: $('span[style="user-select:text"]').text().trim(),
                description: $(".anime-synopsis").text().trim(),
                poster: $('img[data-src$=".jpg"]').attr("data-src")?.trim() || null,
                background: $("div.anime-cover").attr("data-src")?.trim() || null,
                genres: $(".anime-genre li").map((_, el) => $(el).text().trim()).get(),
                externalLinks, mal_id, anilist_id
            };
        } catch { return null; }
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
                title: ep.title || `Episode ${ep.episode}`,
                episode: ep.episode,
                released: new Date(ep.created_at).toISOString(),
                snapshot: ep.snapshot.startsWith("http") ? ep.snapshot : `https://i.animepahe.si/screenshots/${ep.snapshot}`,
                duration: ep.duration,
                filler: ep.filler === 1,
                session: ep.session,
            })).sort((a, b) => a.episode - b.episode);
        } catch { return []; }
    }

  async getSources(animeId: string, episodeSession: string) {
        const sources = [];
        const debugLogs: string[] = []; // 🕵️‍♂️ We are going to catch EVERY error here

        try {
            debugLogs.push(`Fetching play page for Anime: ${animeId}, Session: ${episodeSession}`);
            const res = await fetch(`${BASE_URL}/play/${animeId}/${episodeSession}`, { headers: this.headers });
            const html = await res.text();
            const $ = cheerio.load(html);
            
            const buttons = $("div#resolutionMenu > button").toArray();
            const downloadLinks = $("div#pickDownload > a").toArray();

            debugLogs.push(`Found ${buttons.length} resolution buttons and ${downloadLinks.length} download links`);

            for (let i = 0; i < buttons.length; i++) {
                const btn = $(buttons[i]);
                const audio = btn.attr("data-audio") ?? "unknown";
                const kwikLink = btn.attr("data-src") ?? "";
                const quality = btn.attr("data-resolution") ?? "unknown";
                const paheWinLink = $(downloadLinks[i]).attr("href") ?? "";

                if (kwikLink) {
                    let directUrl = "";
                    debugLogs.push(`Processing ${quality}p (${audio}) - KwikLink: ${kwikLink}`);

                    try {
                        debugLogs.push(`Attempt 1: Direct JS Unpack for ${quality}p`);
                        directUrl = await this.extractDirect(kwikLink);
                    } catch (e: any) {
                        debugLogs.push(`Direct unpack failed: ${e.message}`);
                        
                        if (paheWinLink) {
                            try {
                                debugLogs.push(`Attempt 2: HLS Decryption via ${paheWinLink}`);
                                const originalRes = await fetch(kwikLink, { headers: this.headers });
                                directUrl = await this.extractHls(paheWinLink, originalRes, debugLogs);
                            } catch (hlsError: any) {
                                debugLogs.push(`HLS decryption failed: ${hlsError.message}`);
                            }
                        } else {
                            debugLogs.push(`No paheWinLink available for fallback on ${quality}p`);
                        }
                    }

                    if (directUrl) {
                        debugLogs.push(`✅ SUCCESS: Found direct URL for ${quality}p`);
                        sources.push({
                            quality,
                            audio,
                            url: directUrl,
                            isM3U8: directUrl.includes(".m3u8"),
                            originalKwik: kwikLink
                        });
                    }
                }
            }
        } catch (err: any) {
            debugLogs.push(`CRITICAL ERROR in getSources: ${err.message}`);
        }
        
        // We will attach debug logs to the output so we can see them!
        return { sources, debugLogs };
    }

    private async extractDirect(kwikLink: string): Promise<string> {
        const res = await fetch(kwikLink, { headers: { Referer: BASE_URL, "User-Agent": USER_AGENT } });
        const body = await res.text();
        const $ = cheerio.load(body);

        let packedScript = "";
        $("script").each((_, el) => {
            const content = $(el).html() ?? "";
            if (content.includes("eval(function")) packedScript = content;
        });

        if (!packedScript) throw new Error("No eval(function packed script found. Cloudflare likely blocked it.");

        const scriptPart = substringAfterLast(packedScript, "eval(function(");
        const unpacked = unpackJsAndCombine("eval(function(" + scriptPart);
        const videoUrl = substringBefore(substringAfter(unpacked, "const source='"), "';");

        if (!videoUrl || !videoUrl.startsWith("http")) throw new Error("Extracted source URL is invalid or empty.");
        return videoUrl;
    }

    private async extractHls(paheWinLink: string, originalRes: Response, debugLogs: string[]): Promise<string> {
        // 1. Get the redirect location
        const kwikHeadersRes = await fetch(`${paheWinLink}/i`, {
            redirect: "manual",
            headers: { Referer: BASE_URL },
        });

        let kwikLocation = kwikHeadersRes.headers.get("location") || kwikHeadersRes.headers.get("Location");
        if (!kwikLocation) throw new Error("Step 1 Failed: No redirect location found from paheWinLink/i");

        const kwikUrl = `https://${substringAfterLast(kwikLocation, "https://")}`;
        debugLogs.push(`HLS Step 1: Redirected to ${kwikUrl}`);

        // 2. Fetch the Kwik bypass page
        const kwikRes = await fetch(kwikUrl, { headers: { Referer: "https://kwik.cx/" } });
        const kwikBody = await kwikRes.text();

        // 3. Extract the ciphered token
        const tokenRegex = /"(\S+)",\d+,"(\S+)",(\d+),(\d+)/;
        const matches = kwikBody.match(tokenRegex);
        if (!matches || matches.length < 5) throw new Error("Step 3 Failed: Could not find token regex match on Kwik page");

        // 4. Decrypt Form
        const formHtml = decrypt(matches[1]!, matches[2]!, matches[3]!, parseInt(matches[4]!, 10));
        const actionUrl = formHtml.match(/action="([^"]+)"/)?.[1];
        const token = formHtml.match(/value="([^"]+)"/)?.[1];

        if (!actionUrl || !token) throw new Error("Step 4 Failed: Could not extract action URL or token from decrypted form");
        debugLogs.push(`HLS Step 4: Decrypted form. Target action: ${actionUrl}`);

        // 5. Combine Cookies
        let cookie = originalRes.headers.get("set-cookie") || originalRes.headers.get("Set-Cookie") || "";
        let setCookie = kwikRes.headers.get("set-cookie") || kwikRes.headers.get("Set-Cookie") || "";
        cookie += `; ${setCookie.replace("path=/;", "")}`;

        // 6. The 419 Bypass Loop (THIS IS WHAT WAS MISSING)
        let statusCode = 419;
        let attempts = 0;
        let finalLocation = "";

        while (statusCode !== 302 && attempts < 20) {
            const postRes = await fetch(actionUrl, {
                method: "POST",
                redirect: "manual",
                headers: {
                    Referer: kwikRes.url,
                    Cookie: cookie,
                    "User-Agent": USER_AGENT,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ _token: token }).toString(),
            });

            statusCode = postRes.status;
            attempts++;
            debugLogs.push(`HLS Step 6: Loop attempt ${attempts}. Status: ${statusCode}`);

            if (statusCode === 302) {
                finalLocation = postRes.headers.get("location") || postRes.headers.get("Location") || "";
                break;
            }
            // Sleep for 500ms before trying again
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        if (!finalLocation) throw new Error(`Step 6 Failed: Reached 20 attempts without a 302 redirect`);
        return finalLocation;
    }
}
