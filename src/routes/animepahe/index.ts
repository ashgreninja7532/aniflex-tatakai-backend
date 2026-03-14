import { Hono } from "hono";
import { ANIME } from "@consumet/extensions";

const animepaheRouter = new Hono();

// Initialize the Consumet AnimePahe Scraper
const animepahe = new ANIME.AnimePahe();

// ==========================================
// 1. SEARCH ENDPOINT
// ==========================================
animepaheRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    try {
        const res = await animepahe.search(query);
        
        // Reformat to match HiAnime's Flutter expectation
        const formattedAnimes = res.results.map((item: any) => ({
            id: item.id, // This is the exact ID AnimePahe needs
            name: item.title,
            title: item.title,
            image: item.image,
            type: item.type || "TV"
        }));

        return c.json({ data: { animes: formattedAnimes } }, 200);
    } catch (error) {
        return c.json({ data: { animes: [] } }, 200); // Fail gracefully
    }
});

// ==========================================
// 2. EPISODES LIST ENDPOINT
// ==========================================
animepaheRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        // Fetch the episode list from AnimePahe
        const res = await animepahe.fetchAnimeInfo(animeId);
        
        const formattedEpisodes = res.episodes?.map((ep: any) => ({
            episodeId: ep.id, 
            number: ep.number,
            title: ep.title || `Episode ${ep.number}`,
            isFiller: false // AnimePahe doesn't track filler, so we default to false
        })) || [];

        return c.json({ data: { episodes: formattedEpisodes } }, 200);
    } catch (error) {
        return c.json({ error: "Failed to fetch episodes" }, 500);
    }
});

// ==========================================
// 3. FAKE SERVERS ENDPOINT
// ==========================================
// AnimePahe uses Kwik links natively, so they don't have multiple servers like HiAnime.
// We mock this endpoint so your Flutter 4-step pipeline doesn't break!
animepaheRouter.get("/episode/servers", async (c) => {
    return c.json({
        data: {
            sub: [{ serverName: "Kwik", serverId: "kwik" }],
            dub: [] // Animepahe rarely splits sub/dub at this level
        }
    }, 200);
});

// ==========================================
// 4. SOURCES & DECRYPTION ENDPOINT (THE MAGIC)
// ==========================================
animepaheRouter.get("/episode/sources", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    
    try {
        // Consumet handles the Kwık extraction and AES decryption automatically!
        const res = await animepahe.fetchEpisodeSources(episodeId);
        
        // Reformat the M3U8 links
        const formattedSources = res.sources.map((s: any) => ({
            url: s.url,
            quality: s.quality || "Auto"
        }));

        // Reformat the Subtitles (.vtt files)
        const formattedTracks = res.subtitles?.map((sub: any) => ({
            file: sub.url,
            url: sub.url,
            label: sub.lang || "English",
            kind: "captions"
        })) || [];

        // Grab the secret headers needed to bypass Kwik/OwOcdn security
        const headers = res.headers || { "Referer": "https://kwik.cx/" };

        return c.json({
            data: {
                sources: formattedSources,
                tracks: formattedTracks,
                headers: headers,
                intro: null, // AnimePahe doesn't provide skip times yet
                outro: null
            }
        }, 200);
    } catch (error) {
        return c.json({ error: "Failed to decrypt sources" }, 500);
    }
});

export { animepaheRouter };