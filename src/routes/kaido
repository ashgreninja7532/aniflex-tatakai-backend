import { Hono } from "hono";
import { ANIME } from "@consumet/extensions";

const kaidoRouter = new Hono();

// 🛠️ THE MAGIC: We use the Zoro engine, but override the URL to Kaido!
const kaido = new ANIME.Zoro("https://kaido.to");

// ==========================================
// 1. SEARCH ENDPOINT
// ==========================================
kaidoRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    try {
        const res = await kaido.search(query);
        // Map to match Flutter app expectations
        const formattedAnimes = res.results.map((item: any) => ({
            id: item.id, 
            name: item.title,
            title: item.title,
            image: item.image,
            type: item.type || "TV"
        }));
        return c.json({ data: { animes: formattedAnimes } }, 200);
    } catch (error) {
        return c.json({ data: { animes: [] } }, 200);
    }
});

// ==========================================
// 2. EPISODES LIST ENDPOINT
// ==========================================
kaidoRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await kaido.fetchAnimeInfo(animeId);
        const formattedEpisodes = res.episodes?.map((ep: any) => ({
            episodeId: ep.id, 
            number: ep.number,
            title: ep.title || `Episode ${ep.number}`,
            isFiller: ep.isFiller || false 
        })) || [];
        return c.json({ data: { episodes: formattedEpisodes } }, 200);
    } catch (error) {
        return c.json({ error: "Failed to fetch episodes" }, 500);
    }
});

// ==========================================
// 3. SERVERS ENDPOINT
// ==========================================
kaidoRouter.get("/episode/servers", async (c) => {
    return c.json({
        data: {
            // Kaido uses the exact same servers as HiAnime
            sub: [
                { serverName: "vidstreaming", serverId: "vidstreaming" },
                { serverName: "megacloud", serverId: "megacloud" }
            ],
            dub: [
                { serverName: "vidstreaming", serverId: "vidstreaming" },
                { serverName: "megacloud", serverId: "megacloud" }
            ]
        }
    }, 200);
});

// ==========================================
// 4. SOURCES ENDPOINT (With Intro/Outro & Subs!)
// ==========================================
kaidoRouter.get("/episode/sources", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    const server = decodeURIComponent(c.req.query("server") || "vidstreaming");

    try {
        const res = await kaido.fetchEpisodeSources(episodeId, server as any);
        
        // Reformat Subtitles
        const formattedTracks = res.subtitles?.map((sub: any) => ({
            file: sub.url,
            url: sub.url,
            label: sub.lang,
            kind: "captions"
        })) || [];

        return c.json({
            data: {
                sources: res.sources,
                tracks: formattedTracks,
                intro: res.intro,   // Skips are supported!
                outro: res.outro,
                headers: res.headers || { "Referer": "https://kaido.to/" }
            }
        }, 200);
    } catch (error: any) {
        console.error(error);
        return c.json({ error: "Failed to fetch sources", exact_reason: error.message }, 500);
    }
});

export { kaidoRouter };
