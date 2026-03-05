import { Hono } from 'hono';

// Define the router variable explicitly
const anilistRouter = new Hono();
const ANILIST_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($id: Int, $page: Int, $perPage: Int, $search: String) {
  Page (page: $page, perPage: $perPage) {
    media (id: $id, search: $search, type: ANIME) {
      id
      title {
        romaji
        english
        native
      }
      coverImage {
        large
        extraLarge
      }
      bannerImage
      description
      episodes
      status
      averageScore
      genres
      seasonYear
      format
    }
  }
}`;

anilistRouter.get('/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: "Query 'q' is required" }, 400);

  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { search: query, page: 1, perPage: 15 }
      })
    });

    const data: any = await response.json();
    return c.json(data.data.Page.media);
  } catch (err) {
    return c.json({ error: "AniList Search Failed" }, 500);
  }
});

anilistRouter.get('/info/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { id: parseInt(id) }
      })
    });

    const data: any = await response.json();
    const result = data.data.Page.media[0];
    return result ? c.json(result) : c.json({ error: "Not Found" }, 404);
  } catch (err) {
    return c.json({ error: "AniList Info Failed" }, 500);
  }
});

// This is the line that was likely causing the error
export { anilistRouter };
