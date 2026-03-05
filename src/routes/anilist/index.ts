import { Hono } from 'hono';

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
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      studios {
        edges {
          isAnimationStudio
          node {
            id
            name
          }
        }
      }
      staff (perPage: 25) {
        edges {
          role
          node {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
      characters (role: MAIN, sort: [RELEVANCE, ROLE]) {
        edges {
          node {
            id
            name {
              full
            }
          }
          voiceActors (language: JAPANESE, sort: [RELEVANCE]) {
            id
            name {
              full
            }
            image {
              medium
            }
          }
        }
      }
    }
  }
}
`;

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
    
    if (!result) return c.json({ error: "Not Found" }, 404);

    // Helper to format dates
    const formatDate = (date: any) => 
      date.year ? `${date.year}-${String(date.month || 1).padStart(2, '0')}-${String(date.day || 1).padStart(2, '0')}` : "Unknown";

    // Separate Studios and Producers
    const studios = result.studios.edges
      .filter((edge: any) => edge.isAnimationStudio)
      .map((edge: any) => edge.node.name);
      
    const producers = result.studios.edges
      .filter((edge: any) => !edge.isAnimationStudio)
      .map((edge: any) => edge.node.name);

    // Filter Important Staff
    const impRoles = ["Original Creator", "Original Story", "Director", "Assistant Director", "Character Design"];
    const keyStaff = result.staff.edges
      .filter((edge: any) => impRoles.some(role => edge.role.includes(role)))
      .map((edge: any) => ({
        role: edge.role,
        name: edge.node.name.full,
        image: edge.node.image?.medium
      }));

    // Map Main Characters and their VAs
    const mainCharacters = result.characters.edges.map((edge: any) => ({
      character: edge.node.name.full,
      voiceActor: edge.voiceActors?.[0] ? {
        name: edge.voiceActors[0].name.full,
        image: edge.voiceActors[0].image?.medium
      } : null
    }));

    return c.json({
      id: result.id,
      title: result.title,
      coverImage: result.coverImage,
      bannerImage: result.bannerImage,
      description: result.description,
      status: result.status,
      episodes: result.episodes,
      averageScore: result.averageScore,
      genres: result.genres,
      format: result.format,
      startDate: formatDate(result.startDate),
      endDate: formatDate(result.endDate),
      studios,
      producers,
      keyStaff,
      mainCharacters
    });
  } catch (err) {
    return c.json({ error: "AniList Info Failed" }, 500);
  }
});

export { anilistRouter };
