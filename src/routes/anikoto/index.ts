import { Hono } from "hono";
import { AnikotoScraper } from "../../engine/anikoto.engine.js";

const anikotoRouter = new Hono();
const anikoto = new AnikotoScraper();

// 1. SEARCH & FILTER ENDPOINT
anikotoRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    const page = parseInt(c.req.query("page") || "1");
    try {
        const res = await anikoto.search(query, page, {});
        return c.json({ data: res }, 200);
    } catch (error) {
        return c.json({ data: { animes: [], hasNextPage: false } }, 200);
    }
});

anikotoRouter.get("/filter", async (c) => {
    const queryParams = c.req.query();
    const page = parseInt(queryParams.page || "1");
    const keyword = queryParams.keyword || queryParams.q || ""; 
    
    const filters = {
        genres: queryParams.genres || "",
        type: queryParams.type || "",
        status: queryParams.status || "",
        season: queryParams.season || "",
        language: queryParams.language || "",
        score: queryParams.score || "",
        rated: queryParams.rated || "",
        sort: queryParams.sort || ""
    };
    
    try {
        const res = await anikoto.search(keyword, page, filters);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Filter failed", details: error.message }, 500);
    }
});

// 2. HOME PAGE
anikotoRouter.get("/home", async (c) => {
    try {
        const res = await anikoto.getHomePage();
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch home page", details: error.message }, 500);
    }
});

// 3. ANIME INFO
anikotoRouter.get("/info/:animeId", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await anikoto.getAnimeInfo(animeId);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch anime info", details: error.message }, 500);
    }
});

// 4. EPISODES LIST
anikotoRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        const res = await anikoto.getEpisodes(animeId);
        return c.json({ data: { episodes: res.episodes } }, 200);
    } catch (error) {
        return c.json({ error: "Failed to fetch episodes" }, 500);
    }
});

// 5. SERVERS
anikotoRouter.get("/episode/servers", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    try {
        const res = await anikoto.getEpisodeServers(episodeId);
        return c.json({ data: { sub: res.sub, dub: res.dub } }, 200);
    } catch (error) {
        return c.json({ data: { sub: [], dub: [] } }, 200);
    }
});

// 6. SOURCES (Backend Decryption)
anikotoRouter.get("/episode/sources", async (c) => {
    const episodeId = decodeURIComponent(c.req.query("animeEpisodeId") || "");
    const server = decodeURIComponent(c.req.query("server") || "hd-1");
    const category = decodeURIComponent(c.req.query("category") || "sub");

    try {
        const res = await anikoto.getEpisodeSources(episodeId, server, category);
        const formattedTracks = res.tracks?.map((sub: any) => ({
            file: sub.url, url: sub.url, label: sub.lang, kind: "captions"
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
        return c.json({ error: "Failed to fetch sources", exact_reason: error.message }, 500);
    }
});

// 7. SCHEDULE
anikotoRouter.get("/schedule", async (c) => {
    const date = c.req.query("date") || new Date().toISOString().split("T")[0]; 
    try {
        const res = await anikoto.getEstimatedSchedule(date);
        return c.json({ data: res }, 200);
    } catch (error: any) {
        return c.json({ error: "Failed to fetch schedule" }, 500);
    }
});

export { anikotoRouter };