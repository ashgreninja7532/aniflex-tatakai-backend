import { Hono } from "hono";
import * as cheerio from "cheerio";

const kaidoRouter = new Hono();
const BASE_URL = "https://kaido.to";
const AJAX_URL = "https://kaido.to/ajax";

// 🛠️ OUR DISGUISE: Bypasses basic Cloudflare bot protection
const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Referer": BASE_URL,
};

// ==========================================
// 1. CUSTOM SEARCH SCRAPER
// ==========================================
kaidoRouter.get("/search", async (c) => {
    const query = c.req.query("q") || "";
    try {
        const response = await fetch(`${BASE_URL}/search?keyword=${encodeURIComponent(query)}`, { headers: HEADERS });
        const html = await response.text();
        const $ = cheerio.load(html);

        const animes: any[] = [];

        // Loop through every anime card on the search page
        $('.flw-item').each((i, el) => {
            const rawLink = $(el).find('.film-name a').attr('href') || "";
            // Extract the ID from the link (e.g., /watch/naruto-123 -> naruto-123)
            const id = rawLink.split('/watch/')[1]?.split('?')[0] || ""; 
            
            const title = $(el).find('.film-name a').text().trim();
            const image = $(el).find('.film-poster-img').attr('data-src') || "";
            const type = $(el).find('.fdi-item').first().text().trim() || "TV";

            if (id && title) {
                animes.push({ id, title, name: title, image, type });
            }
        });

        return c.json({ provider: "Tatakai-Custom", status: 200, data: { animes } });
    } catch (error) {
        console.error("Search Scraper Error:", error);
        return c.json({ provider: "Tatakai-Custom", status: 500, error: "Failed to scrape search" }, 500);
    }
});

// ==========================================
// 2. CUSTOM EPISODE LIST SCRAPER
// ==========================================
kaidoRouter.get("/anime/:animeId/episodes", async (c) => {
    const animeId = decodeURIComponent(c.req.param("animeId"));
    try {
        // Kaido hides episodes in an AJAX call that returns an HTML snippet
        const response = await fetch(`${AJAX_URL}/episode/list/${animeId}`, { headers: HEADERS });
        const json: any = await response.json();
        
        const $ = cheerio.load(json.html);
        const episodes: any[] = [];

        // Loop through the hidden episode list
        $('.ep-item').each((i, el) => {
            const episodeId = $(el).attr('data-id'); // The secret internal ID
            const number = $(el).attr('data-number');
            const title = $(el).attr('title') || `Episode ${number}`;
            const isFiller = $(el).hasClass('ssl-item-filler'); // Kaido marks fillers with this class!

            if (episodeId && number) {
                episodes.push({
                    episodeId,
                    number: parseInt(number),
                    title,
                    isFiller
                });
            }
        });

        return c.json({ provider: "Tatakai-Custom", status: 200, data: { episodes } });
    } catch (error) {
        console.error("Episode Scraper Error:", error);
        return c.json({ provider: "Tatakai-Custom", status: 500, error: "Failed to scrape episodes" }, 500);
    }
});

export { kaidoRouter };