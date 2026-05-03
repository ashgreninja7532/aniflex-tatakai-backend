import { Hono } from "hono";
import { AnimepaheScraper } from "../../engine/animepahe.engine.js";

const animepaheRouter = new Hono();
const animepahe = new AnimepaheScraper();

// 1. SEARCH
animepaheRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    if (!query) return c.json({ data: [] }, 200);

    try {
        const res = await animepahe.search(query);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Search failed", details: error.message }, 500);
    }
});

// 2. LATEST / AIRING
animepaheRouter.get("/latest", async (c) => {
    try {
        const res = await animepahe.getLatest();
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch latest", details: error.message }, 500);
    }
});

// 3. ANIME INFO
animepaheRouter.get("/info/:animeId", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await animepahe.getAnimeInfo(animeId);
        if (!res) return c.json({ error: "Anime not found" }, 404);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch anime info", details: error.message }, 500);
    }
});

// 4. EPISODES LIST
animepaheRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await animepahe.getEpisodes(animeId);
        return c.json({ data: { episodes: res } }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch episodes", details: error.message }, 500);
    }
});

// 5. SOURCES (Stream Links)
animepaheRouter.get("/episode/sources", async (c) => {
    const animeId = decodeURIComponent(c.req.query("animeId") || "");
    const session = decodeURIComponent(c.req.query("session") || "");

    if (!animeId || !session) {
        return c.json({ error: "Missing animeId or session in query" }, 400);
    }

    try {
        const res = await animepahe.getSources(animeId, session);
        return c.json({ 
            data: { 
                sources: res.sources,
                headers: { "Referer": "https://kwik.cx/" },
                debug_logs: res.debugLogs // 👀 We will see exactly what happens!
            } 
        }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch sources", details: error.message }, 500);
    }
});

export { animepaheRouter };
