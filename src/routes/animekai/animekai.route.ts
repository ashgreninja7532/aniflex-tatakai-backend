import { Hono } from "hono";
import { AnimeKaiScraper } from "../../engine/animekai.engine.js";

const animekaiRouter = new Hono();
const animekai = new AnimeKaiScraper();

// 1. SEARCH ENDPOINT
animekaiRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    const page = parseInt(c.req.query("page") || "1");
    try {
        const res = await animekai.search(query, page);
        return c.json({ data: res }, 200);
    } catch (error) {
        console.error("AnimeKai Search Error:", error);
        return c.json({ data: { animes: [], hasNextPage: false } }, 200);
    }
});

// 2. EPISODES LIST ENDPOINT
animekaiRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await animekai.getEpisodes(animeId);
        return c.json({ data: res }, 200);
    } catch (error) {
        console.error("AnimeKai Episodes Error:", error);
        return c.json({ error: "Failed to fetch episodes" }, 500);
    }
});

// 3. SOURCES ENDPOINT
animekaiRouter.get("/episode/sources", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    const server = decodeURIComponent(c.req.query("server") || "vidstreaming");
    const category = decodeURIComponent(c.req.query("category") || "sub");

    try {
        const res = await animekai.getEpisodeSources(episodeId, server, category);
        
        if (!res) return c.json({ error: "Sources not found" }, 404);

        return c.json({ data: res }, 200);
    } catch (error: any) {
        console.error("AnimeKai Sources Error:", error);
        return c.json({ error: "Failed to fetch sources", details: error.message }, 500);
    }
});

// 4. DECRYPT CLIENT DATA ENDPOINT (Plan B Handoff)
animekaiRouter.post("/episode/decrypt", async (c) => {
    try {
        const body = await c.req.json();
        
        if (!body.encryptedData) {
            return c.json({ error: "Missing encryptedData" }, 400);
        }

        const res = await animekai.decryptClientData(body.encryptedData, body.intro, body.outro);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        console.error("AnimeKai Decrypt Error:", error);
        return c.json({ error: "Failed to decrypt client data", details: error.message }, 500);
    }
});

export { animekaiRouter };
