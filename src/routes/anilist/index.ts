import { Hono } from 'hono';

const anilist = new Hono();
const ANILIST_URL = 'https://graphql.anilist.co';

// GraphQL Query for Search & Info
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
      }
      bannerImage
      description
      episodes
      status
      averageScore
      genres
      seasonYear
    }
  }
}`;

anilist.get('/search', async (c) => {
  const query = c.req.query('q');
  if (!query) return c.json({ error: "Query parameter 'q' is required" }, 400);

  try {
    const response = await fetch(ANILIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables: { search: query, page: 1, perPage: 10 }
      })
    });

    const data: any = await response.json();
    return c.json(data.data.Page.media);
  } catch (err) {
    return c.json({ error: "Failed to fetch from AniList" }, 500);
  }
});

anilist.get('/info/:id', async (c) => {
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
    return c.json(data.data.Page.media[0] || { error: "Not Found" });
  } catch (err) {
    return c.json({ error: "Failed to fetch anime details" }, 500);
  }
});

export default anilist;
