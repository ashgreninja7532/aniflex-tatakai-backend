import { Hono } from "hono";
import { KaidoScraper } from "../../engine/kaido.engine.js";

const kaidoRouter = new Hono();
const kaido = new KaidoScraper();

// 1. SEARCH ENDPOINT
kaidoRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    try {
        const res = await kaido.search(query);
        return c.json({ data: { animes: res.animes } }, 200);
    } catch (error) {
        console.error("Search Error:", error);
        return c.json({ data: { animes: [] } }, 200);
    }
});

// 2. EPISODES LIST ENDPOINT
kaidoRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await kaido.getEpisodes(animeId);
        return c.json({ data: { episodes: res.episodes } }, 200);
    } catch (error) {
        console.error("Episodes Error:", error);
        return c.json({ error: "Failed to fetch episodes" }, 500);
    }
});

// 3. SERVERS ENDPOINT
kaidoRouter.get("/episode/servers", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    try {
        const res = await kaido.getEpisodeServers(episodeId);
        return c.json({ data: { sub: res.sub, dub: res.dub } }, 200);
    } catch (error) {
        console.error("Servers Error:", error);
        // Silent fallback to prevent Flutter crashes
        return c.json({
            data: {
                sub: [{ serverName: "vidstreaming", serverId: "vidstreaming" }, { serverName: "megacloud", serverId: "megacloud" }],
                dub: [{ serverName: "vidstreaming", serverId: "vidstreaming" }, { serverName: "megacloud", serverId: "megacloud" }]
            }
        }, 200);
    }
});

// 4. SOURCES ENDPOINT (The Final Boss)
kaidoRouter.get("/episode/sources", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    const server = decodeURIComponent(c.req.query("server") || "vidstreaming");
    const category = decodeURIComponent(c.req.query("category") || "sub");

    try {
        const res = await kaido.getEpisodeSources(episodeId, server, category);
        
        const formattedTracks = res.tracks?.map((sub: any) => ({
            file: sub.url,
            url: sub.url,
            label: sub.lang,
            kind: "captions"
        })) || [];

        return c.json({
            data: {
                sources: res.sources,
                tracks: formattedTracks,
                intro: res.intro,
                outro: res.outro,
                headers: res.headers
            }
        }, 200);
    } catch (error: any) {
        console.error("Sources Error:", error);
        return c.json({ error: "Failed to fetch sources", exact_reason: error.message }, 500);
    }
});

export { kaidoRouter };
