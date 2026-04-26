import { Hono } from "hono";
import { AnimeKaiScraper } from "../../engine/animekai.engine.js";

const animekaiRouter = new Hono();
const animekai = new AnimeKaiScraper();

// 🛠️ FIX 1: ADDED THE MISSING HOME ROUTE FOR SPOTLIGHT & ROWS
animekaiRouter.get("/home", async (c) => {
    try {
        const [spotlight, trending, latest, movies, popular] = await Promise.all([
            animekai.getSpotlight(),
            animekai.filter("sort=recently_updated", 1),
            animekai.filter("status=Current&sort=recently_updated", 1),
            animekai.filter("type=Movie&sort=recently_updated", 1),
            animekai.filter("sort=most_watched", 1)
        ]);
        return c.json({
            data: {
                spotlightAnimes: spotlight,
                trendingAnimes: trending.animes,
                latestEpisodeAnimes: latest.animes,
                topMovies: movies.animes,
                mostPopularAnimes: popular.animes
            }
        }, 200);
    } catch (e) {
        return c.json({ data: {} }, 500);
    }
});

animekaiRouter.get("/search", async (c) => {
    const q = c.req.query("q") || "";
    const page = parseInt(c.req.query("page") || "1");
    try { return c.json({ data: await animekai.search(q, page) }, 200); } 
    catch (e) { return c.json({ data: { animes: [] } }, 200); }
});

// 🛠️ FIX 2: FIXED ADVANCED SEARCH TO ACCEPT ALL PARAMS
animekaiRouter.get("/filter", async (c) => {
    const url = new URL(c.req.url);
    const searchParams = new URLSearchParams(url.search);
    const page = parseInt(searchParams.get("page") || "1");
    searchParams.delete("page"); // Remove page so we can pass the raw filter string
    
    try { return c.json({ data: await animekai.filter(searchParams.toString(), page) }, 200); } 
    catch (e) { return c.json({ data: { animes: [] } }, 200); }
});

animekaiRouter.get("/spotlight", async (c) => {
    try { return c.json({ data: await animekai.getSpotlight() }, 200); } 
    catch (e) { return c.json({ data: [] }, 200); }
});

animekaiRouter.get("/recent-episodes", async (c) => {
    const page = parseInt(c.req.query("page") || "1");
    try { return c.json({ data: await animekai.recentlyUpdated(page) }, 200); } 
    catch (e) { return c.json({ data: { animes: [] } }, 200); }
});

animekaiRouter.get("/movies", async (c) => {
    const page = parseInt(c.req.query("page") || "1");
    try { return c.json({ data: await animekai.movies(page) }, 200); } 
    catch (e) { return c.json({ data: { animes: [] } }, 200); }
});

// 🛠️ FIX 3: FORMATTED INFO ROUTE SO THE APP DOESN'T SAY "UNAVAILABLE"
animekaiRouter.get("/info/:animeId", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try { 
        const info = await animekai.getAnimeInfo(animeId);
        if (!info) return c.json({ data: null }, 404);
        
        return c.json({ 
            data: { 
                info: info,
                seasons: info.relations.filter((r: any) => r.relationType === "Season"),
                relatedAnimes: info.relations.filter((r: any) => r.relationType !== "Season")
            } 
        }, 200); 
    } 
    catch (e: any) { return c.json({ error: e.message }, 500); }
});

animekaiRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try { return c.json({ data: await animekai.getEpisodes(animeId) }, 200); } 
    catch (e: any) { return c.json({ error: e.message }, 500); }
});

animekaiRouter.get("/episode/servers", async (c) => {
    const episodeData = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    try { return c.json({ data: await animekai.getEpisodeServers(episodeData) }, 200); } 
    catch (e: any) { return c.json({ error: e.message }, 500); }
});

animekaiRouter.get("/episode/sources", async (c) => {
    const episodeData = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    const server = decodeURIComponent(c.req.query("server") || "megaup");
    const category = decodeURIComponent(c.req.query("category") || "softsub");
    try { return c.json({ data: await animekai.getEpisodeSources(episodeData, server, category) }, 200); } 
    catch (e: any) { return c.json({ error: e.message }, 500); }
});

export { animekaiRouter };
